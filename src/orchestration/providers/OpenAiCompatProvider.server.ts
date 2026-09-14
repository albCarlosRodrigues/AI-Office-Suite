import type { ProviderType } from "@/types/domain";
import type {
  AgentProvider,
  ExecInput,
  MeetingTurnInput,
  MeetingTurnResult,
  PlanInput,
  PlanResult,
  PlannedTask,
  ReviewInput,
  ReviewResult,
  SummaryInput,
  SummaryResult,
  Usage,
  WorkerResponse,
} from "./types";

/**
 * Real LLM provider over any OpenAI-compatible chat endpoint.
 * Used for Lovable AI (gateway), OpenAI, OpenRouter, Ollama and custom bases.
 * Agents backed by this provider produce real reasoning — no scripted output.
 */
export interface OpenAiCompatConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  headers: Record<string, string>;
  authHeaderName?: string; // default Authorization: Bearer
}

const VALID_ROLES = new Set([
  "research",
  "analysis",
  "implement",
  "verify",
  "design",
  "docs",
  "ops",
  "security",
]);

export class OpenAiCompatProvider implements AgentProvider {
  readonly simulated = false;
  readonly type: ProviderType;
  readonly model: string;
  constructor(private cfg: OpenAiCompatConfig) {
    this.type = cfg.type;
    this.model = cfg.model;
  }

  private async chat(
    system: string,
    user: string,
    json = true,
  ): Promise<{ text: string; usage: Usage }> {
    const started = Date.now();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.cfg.headers,
    };
    if (this.cfg.apiKey) {
      if (this.cfg.authHeaderName) headers[this.cfg.authHeaderName] = this.cfg.apiKey;
      else headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
    }
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (json) body["response_format"] = { type: "json_object" };
    if (!/^openai\/gpt-5|^openai\/gpt-6|^openai\/chat-latest/.test(this.cfg.model))
      body["temperature"] = this.cfg.temperature;
    if (/^openai\/gpt-5\.6/.test(this.cfg.model)) body["reasoning_effort"] = "none";
    if (/^openai\/gpt-6-astra/.test(this.cfg.model)) body["reasoning_effort"] = "low";

    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      const err = new Error(
        `Provider ${this.cfg.type} responded ${res.status}: ${msg.slice(0, 300)}`,
      );
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? Math.round((system.length + user.length) / 4),
        tokensOut: data.usage?.completion_tokens ?? Math.round(text.length / 4),
        latencyMs: Date.now() - started,
        model: this.cfg.model,
        simulated: false,
      },
    };
  }

  private parseJson<T>(text: string): T | null {
    try {
      const cleaned = text
        .replace(/^```(?:json)?/m, "")
        .replace(/```$/m, "")
        .trim();
      return JSON.parse(cleaned) as T;
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  async plan(input: PlanInput): Promise<PlanResult> {
    const team = input.team
      .map((a) => `- ${a.name} (${a.role}, capabilities: ${a.capabilities.join(", ") || "none"})`)
      .join("\n");
    const { text, usage } = await this.chat(
      input.systemPrompt,
      `Mission title: ${input.title}\nGoal: ${input.goal}\n\nAvailable subordinates:\n${team}\n\nPolicies:\n${input.policies.map((p) => "- " + p).join("\n")}\n\nProduce a JSON plan: {"rationale": string, "tasks": [{"code":"T1","title":string,"description":string,"role": one of research|analysis|implement|verify|design|docs|ops|security,"dependsOn":[codes],"tools":[tool ids],"expectedOutput":string}]}. 3 to 6 tasks. Each task must be narrow, verifiable and mention what evidence is expected. Respond with JSON only.`,
    );
    const parsed = this.parseJson<{ rationale?: string; tasks?: Partial<PlannedTask>[] }>(text);
    const tasks: PlannedTask[] = (parsed?.tasks ?? [])
      .filter((t) => t && t.title)
      .slice(0, 6)
      .map((t, i) => ({
        code: t.code ?? `T${i + 1}`,
        title: String(t.title),
        description: String(t.description ?? ""),
        role: (VALID_ROLES.has(String(t.role)) ? t.role : "implement") as PlannedTask["role"],
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
        tools: Array.isArray(t.tools) ? t.tools.map(String) : [],
        expectedOutput: String(t.expectedOutput ?? "Evidence of completion"),
      }));
    if (!tasks.length) throw new Error("Provider returned no tasks in plan: " + text.slice(0, 200));
    return { rationale: parsed?.rationale ?? "", tasks, usage };
  }

  async executeTask(input: ExecInput): Promise<WorkerResponse> {
    const c = input.command;
    const { text, usage } = await this.chat(
      input.systemPrompt,
      `FORMAL COMMAND ${c.id}\nObjective: ${c.objective}\nInstructions: ${c.instructions}\nExpected output: ${c.expectedOutput}\nAllowed tools: ${c.allowedTools.join(", ") || "none"}\nForbidden: ${c.forbiddenActions.join(", ") || "none"}\nConstraints: ${JSON.stringify(c.constraints)}\nContext: ${JSON.stringify(c.context)}\n\nYou do not have live tool access in this environment. Perform the reasoning work and describe precisely what you would do with each allowed tool; be explicit when something cannot be verified. Respond with JSON only: {"status": COMPLETED|FAILED|BLOCKED|NEEDS_CLARIFICATION|REQUEST_PERMISSION|REQUEST_SCOPE_EXTENSION, "summary": string, "evidence": [{"type": text|code_diff|command_output|test_result|web_reference|file_reference, "title": string, "content": string}], "toolCalls": [{"toolId": string, "input": string, "output": string}], "clarification"?: string, "scopeExtension"?: {"requestedAction": string, "reason": string, "risk": LOW|MEDIUM|HIGH|CRITICAL, "requiredPermissions": [string]}}`,
    );
    const parsed = this.parseJson<
      Partial<WorkerResponse> & { toolCalls?: { toolId: string; input: string; output: string }[] }
    >(text);
    if (!parsed)
      return {
        status: "FAILED",
        summary: "Provider returned unparseable output: " + text.slice(0, 200),
        evidence: [{ type: "text", title: "Raw output", content: text }],
        toolCalls: [],
        usage,
      };
    const status = (
      [
        "COMPLETED",
        "FAILED",
        "BLOCKED",
        "NEEDS_CLARIFICATION",
        "REQUEST_PERMISSION",
        "REQUEST_SCOPE_EXTENSION",
      ] as const
    ).includes(parsed.status as never)
      ? parsed.status!
      : "COMPLETED";
    const out: WorkerResponse = {
      status,
      summary: String(parsed.summary ?? ""),
      evidence: (parsed.evidence ?? []).map((e) => ({
        type: e.type ?? "text",
        title: String(e.title ?? ""),
        content: String(e.content ?? ""),
      })),
      toolCalls: (parsed.toolCalls ?? []).map((t) => ({
        toolId: String(t.toolId),
        input: String(t.input ?? ""),
        output: String(t.output ?? ""),
        risk: "LOW" as const,
        latencyMs: 0,
      })),
      usage,
    };
    if (parsed.clarification) out.clarification = parsed.clarification;
    if (parsed.scopeExtension) out.scopeExtension = parsed.scopeExtension;
    return out;
  }

  async review(input: ReviewInput): Promise<ReviewResult> {
    const { text, usage } = await this.chat(
      input.systemPrompt,
      `Review this deliverable as the responsible manager.\nTask ${input.task.code}: ${input.task.title}\nExpected: ${input.task.expectedOutput}\nRetries so far: ${input.task.retries}\nSummary: ${input.result.summary}\nEvidence:\n${input.result.evidence.map((e) => `- [${e.type}] ${e.title}: ${e.content.slice(0, 400)}`).join("\n")}\n\nRespond with JSON only: {"decision": APPROVE|REVISE|REJECT, "feedback": string}`,
    );
    const parsed = this.parseJson<{ decision?: string; feedback?: string }>(text);
    const decision = (["APPROVE", "REVISE", "REJECT"] as const).includes(parsed?.decision as never)
      ? (parsed!.decision as ReviewResult["decision"])
      : "APPROVE";
    return { decision, feedback: parsed?.feedback ?? text.slice(0, 300), usage };
  }

  async meetingTurn(input: MeetingTurnInput): Promise<MeetingTurnResult> {
    const { text, usage } = await this.chat(
      input.systemPrompt,
      `You are in a short kick-off meeting (round ${input.round} of 3). Topic: ${input.topic}\nTranscript so far:\n${input.transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n") || "(none)"}\n\nReply with one or two concise sentences as ${input.speaker.name} (${input.speaker.role}). Plain text.`,
      false,
    );
    return { message: text.trim().slice(0, 400), usage };
  }

  async summarize(input: SummaryInput): Promise<SummaryResult> {
    const { text, usage } = await this.chat(
      input.systemPrompt,
      `Write the final mission report (5-8 sentences, plain text). Goal: ${input.goal}\nTasks:\n${input.tasks.map((t) => `- ${t.code} ${t.title} [${t.status}]: ${t.result ?? ""}`).join("\n")}`,
      false,
    );
    return { summary: text.trim(), usage };
  }

  async healthCheck() {
    const started = Date.now();
    try {
      const { text } = await this.chat(
        "You are a health probe.",
        "Reply with the single word OK.",
        false,
      );
      return {
        health: "CONNECTED" as const,
        latencyMs: Date.now() - started,
        message: `Model replied: ${text.trim().slice(0, 40)}`,
      };
    } catch (e) {
      const status = (e as { status?: number }).status;
      const health =
        status === 401 || status === 403 ? ("UNAUTHORIZED" as const) : ("FAILED" as const);
      return {
        health,
        latencyMs: Date.now() - started,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
