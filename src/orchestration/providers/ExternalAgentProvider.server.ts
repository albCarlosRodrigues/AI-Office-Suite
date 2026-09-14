import type { ProviderHealth } from "@/types/domain";
import type {
  AgentProvider,
  ExecInput,
  MeetingTurnInput,
  MeetingTurnResult,
  PlanInput,
  PlanResult,
  ReviewInput,
  ReviewResult,
  SummaryInput,
  SummaryResult,
  WorkerResponse,
} from "./types";
import { z } from "zod";

const evidenceSchema = z.object({
  type: z.enum([
    "code_diff",
    "command_output",
    "file_reference",
    "test_result",
    "web_reference",
    "screenshot",
    "text",
    "json",
  ]),
  title: z.string().max(300),
  content: z.string().max(100_000),
  simulated: z.boolean().optional(),
});

const responseSchema = z.object({
  protocolVersion: z.literal("1.0"),
  commandId: z.string().uuid(),
  status: z.enum([
    "COMPLETED",
    "FAILED",
    "BLOCKED",
    "NEEDS_CLARIFICATION",
    "REQUEST_PERMISSION",
    "REQUEST_SCOPE_EXTENSION",
  ]),
  summary: z.string().max(20_000),
  evidence: z.array(evidenceSchema).max(100),
  actionsPerformed: z.array(z.unknown()).max(500).default([]),
  toolCalls: z
    .array(
      z.object({
        toolId: z.string().max(200),
        input: z.string().max(20_000),
        arguments: z.record(z.unknown()).optional(),
        output: z.string().max(100_000),
        risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        latencyMs: z.number().int().min(0).max(3_600_000),
      }),
    )
    .max(200)
    .default([]),
  requestedPermission: z
    .object({
      action: z.string().max(2_000),
      reason: z.string().max(10_000),
      risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      requiredPermissions: z.array(z.string().max(200)).max(100),
    })
    .nullable()
    .default(null),
  requestedScopeExtension: z
    .object({
      requestedAction: z.string().max(2_000),
      reason: z.string().max(10_000),
      risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      requiredPermissions: z.array(z.string().max(200)).max(100),
    })
    .nullable()
    .default(null),
  error: z.string().max(20_000).nullable().default(null),
  usage: z
    .object({ tokensIn: z.number().int().min(0), tokensOut: z.number().int().min(0) })
    .optional(),
});

/**
 * ExternalAgentProvider — bridge to an external executor such as "Claudinho".
 *
 * Protocol (v1, JSON over HTTPS):
 *   GET  {baseUrl}{healthEndpoint}              → 200 {"status":"ok"}
 *   POST {baseUrl}/commands                      body: FormalCommand → WorkerResponse
 *
 * The external agent never receives more than the command scope. It replies
 * with COMPLETED/FAILED/BLOCKED/NEEDS_CLARIFICATION/REQUEST_PERMISSION/
 * REQUEST_SCOPE_EXTENSION plus evidence. Until the endpoint is reachable the
 * agent is honestly reported OFFLINE and its tasks fail with a clear reason.
 */
export interface ExternalConfig {
  baseUrl: string | null;
  bearerToken: string | null;
  headers: Record<string, string>;
  healthEndpoint: string;
  timeoutMs: number;
}

export class ExternalAgentProvider implements AgentProvider {
  readonly type = "custom" as const;
  readonly simulated = false;
  readonly model = "external-executor";
  constructor(private cfg: ExternalConfig) {}

  private endpoint(path: string): string {
    if (!this.cfg.baseUrl) this.unavailable();
    const base = new URL(this.cfg.baseUrl);
    const host = base.hostname.toLowerCase();
    const privateHost =
      host === "localhost" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "169.254.169.254";
    if (base.protocol !== "https:" || privateHost || base.username || base.password) {
      throw new Error(
        "PROVIDER_ENDPOINT_REJECTED: custom providers require a public HTTPS endpoint without embedded credentials.",
      );
    }
    return new URL(path.replace(/^\//, ""), `${base.toString().replace(/\/$/, "")}/`).toString();
  }

  private headers() {
    const h: Record<string, string> = { "Content-Type": "application/json", ...this.cfg.headers };
    if (this.cfg.bearerToken) h["Authorization"] = `Bearer ${this.cfg.bearerToken}`;
    return h;
  }

  private unavailable(): never {
    throw new Error(
      "External executor is not configured (missing endpoint). Configure the provider base URL or run in simulation mode.",
    );
  }

  async plan(_input: PlanInput): Promise<PlanResult> {
    throw new Error("External executors cannot act as controllers.");
  }

  async executeTask(input: ExecInput): Promise<WorkerResponse> {
    if (!this.cfg.baseUrl) this.unavailable();
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(this.endpoint("/commands"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          protocolVersion: "1.0",
          command: {
            id: input.command.id,
            missionId: input.command.missionId,
            taskId: input.command.taskId,
            parentCommandId: input.command.parentCommandId,
            objective: input.command.objective,
            instructions: input.command.instructions,
            context: input.command.context,
            constraints: input.command.constraints,
            allowedTools: input.command.allowedTools,
            forbiddenActions: input.command.forbiddenActions,
            expectedOutput: input.command.expectedOutput,
            maxIterations: input.command.maxIterations,
            maxCost: input.command.maxCost,
            timeout: input.command.timeout,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`External executor responded ${res.status}`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > 1_000_000) throw new Error("External executor response exceeds the 1 MB limit.");
      const raw = await res.text();
      if (raw.length > 1_000_000)
        throw new Error("External executor response exceeds the 1 MB limit.");
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("External executor returned invalid JSON.");
      }
      const data = responseSchema.parse(json);
      if (data.commandId !== input.command.id)
        throw new Error("External executor returned a mismatched commandId.");
      if (data.status === "COMPLETED" && data.error)
        throw new Error("External executor returned COMPLETED with an error.");
      return {
        status: data.status,
        summary: data.error ? `${data.summary}\n${data.error}` : data.summary,
        evidence: data.evidence.map((item) =>
          item.simulated === undefined
            ? { type: item.type, title: item.title, content: item.content }
            : {
                type: item.type,
                title: item.title,
                content: item.content,
                simulated: item.simulated,
              },
        ),
        toolCalls: data.toolCalls,
        ...(data.requestedPermission ? { permissionRequest: data.requestedPermission } : {}),
        ...(data.requestedScopeExtension ? { scopeExtension: data.requestedScopeExtension } : {}),
        usage: {
          tokensIn: data.usage?.tokensIn ?? 0,
          tokensOut: data.usage?.tokensOut ?? 0,
          latencyMs: Date.now() - started,
          model: this.model,
          simulated: false,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async review(_input: ReviewInput): Promise<ReviewResult> {
    throw new Error("External executors do not review work.");
  }

  async meetingTurn(input: MeetingTurnInput): Promise<MeetingTurnResult> {
    return {
      message: `${input.speaker.name} (external executor) acknowledges the plan and will report through formal command results.`,
      usage: { tokensIn: 0, tokensOut: 0, latencyMs: 0, model: this.model, simulated: false },
    };
  }

  async summarize(_input: SummaryInput): Promise<SummaryResult> {
    throw new Error("External executors do not summarize missions.");
  }

  async healthCheck(): Promise<{ health: ProviderHealth; latencyMs: number; message: string }> {
    const started = Date.now();
    if (!this.cfg.baseUrl)
      return { health: "OFFLINE", latencyMs: 0, message: "No endpoint configured." };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(this.cfg.timeoutMs, 8000));
      const res = await fetch(this.endpoint(this.cfg.healthEndpoint), {
        headers: this.headers(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403)
        return {
          health: "UNAUTHORIZED",
          latencyMs: Date.now() - started,
          message: `HTTP ${res.status}`,
        };
      if (!res.ok)
        return { health: "FAILED", latencyMs: Date.now() - started, message: `HTTP ${res.status}` };
      return {
        health: "CONNECTED",
        latencyMs: Date.now() - started,
        message: "Health endpoint reachable.",
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        health: aborted ? "TIMEOUT" : "OFFLINE",
        latencyMs: Date.now() - started,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
