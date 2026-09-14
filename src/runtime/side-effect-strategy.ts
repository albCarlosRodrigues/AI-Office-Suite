import type { DurableToolRequest } from "./durable/types";
import type { ToolResult } from "./tools/types";

export type SideEffectClass =
  "REPLAY_SAFE" | "IDEMPOTENCY_KEY" | "EFFECT_PROBE" | "NON_RETRYABLE_AFTER_UNKNOWN";
export type UnknownOutcome = "SAFE_TO_RETRY" | "REQUIRES_PROBE" | "REQUIRES_HUMAN_REVIEW";

export interface SideEffectStrategy {
  classify(request: DurableToolRequest): SideEffectClass;
  probe(request: DurableToolRequest): Promise<ToolResult | null>;
  unknownOutcome(request: DurableToolRequest): UnknownOutcome;
}

export class DefaultSideEffectStrategy implements SideEffectStrategy {
  private readonly pure = new Set(["filesystem_read", "testing"]);
  private readonly idempotent = new Set(["filesystem_write"]);
  classify(request: DurableToolRequest): SideEffectClass {
    if (this.pure.has(request.toolId)) return "REPLAY_SAFE";
    if (this.idempotent.has(request.toolId)) return "IDEMPOTENCY_KEY";
    if (request.toolId.startsWith("git_")) return "EFFECT_PROBE";
    return "NON_RETRYABLE_AFTER_UNKNOWN";
  }
  async probe() {
    return null;
  }
  unknownOutcome(request: DurableToolRequest): UnknownOutcome {
    const effect = this.classify(request);
    if (effect === "REPLAY_SAFE" || effect === "IDEMPOTENCY_KEY") return "SAFE_TO_RETRY";
    if (effect === "EFFECT_PROBE") return "REQUIRES_PROBE";
    return "REQUIRES_HUMAN_REVIEW";
  }
}
