import { z } from "zod";
import type { ExecutionBackend, ExecutionInput } from "@/orchestration/execution-backend";
import { ChatPayload } from "../prx/session";

/** Free-claude-code's OpenRouter transport, hosted inside the existing runtime. No second executor. */
export class FreeClaudeBackend implements ExecutionBackend {
  readonly id = "free-claude";
  readonly capabilities = { plan: false, execute: true, review: true, tools: [] };
  constructor(
    private config: {
      apiKey: string | null;
      model: string;
      baseUrl: string;
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
    },
  ) {
    const url = new URL(config.baseUrl);
    if (
      url.origin !== "https://openrouter.ai" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("OPENROUTER_ENDPOINT_DENIED");
  }
  async healthCheck() {
    try {
      const result = await this.execute({
        taskId: "health",
        payload: {
          system: "Health probe. No tools.",
          user: "Responda exatamente OK.",
          json: false,
        },
      });
      return {
        status: result.result === "OK" ? ("HEALTHY" as const) : ("DEGRADED" as const),
        message: result.result === "OK" ? "CONNECTED" : "Unexpected probe response",
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE" as const,
        message: error instanceof Error ? error.message : "ERROR",
      };
    }
  }
  async execute(input: ExecutionInput, signal?: AbortSignal) {
    if (!this.config.apiKey) throw new Error("INVALID_KEY");
    if (!this.config.model.trim()) throw new Error("MODEL_UNAVAILABLE");
    const payload = ChatPayload.parse(input.payload);
    const deadline = AbortSignal.timeout(this.config.timeoutMs);
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxOutputTokens,
        stream: false,
        system: payload.system,
        messages: [{ role: "user", content: payload.user }],
      }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "INVALID_KEY"
          : response.status === 429
            ? "RATE_LIMITED"
            : response.status === 400 || response.status === 404
              ? "MODEL_UNAVAILABLE"
              : "ERROR",
      );
    const result = z
      .object({
        stop_reason: z.string().nullable().optional(),
        content: z
          .array(
            z.discriminatedUnion("type", [
              z.object({ type: z.literal("text"), text: z.string() }),
              // Reasoning blocks are never exposed as the agent's answer or evidence.
              z.object({ type: z.literal("thinking") }),
              z.object({ type: z.literal("redacted_thinking") }),
            ]),
          )
          .min(1),
      })
      .safeParse(await response.json());
    if (!result.success) throw new Error("INVALID_PROVIDER_RESPONSE");
    if (result.data.stop_reason && result.data.stop_reason !== "end_turn")
      throw new Error("INCOMPLETE_PROVIDER_RESPONSE");
    const text = result.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("EMPTY_PROVIDER_RESPONSE");
    return {
      status: "COMPLETED" as const,
      result: text,
      backendId: this.id,
      fallbackCount: 0,
    };
  }
}
