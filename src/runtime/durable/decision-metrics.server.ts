import { DurableRuntimeStore } from "./store.server";
import { metric } from "./helpers";
import type { BackendExecutionEvent } from "@/orchestration/execution-backend";

export type RuntimeDecisionKind =
  "TECHNICAL_FALLBACK" | "ECONOMIC_DOWNGRADE" | "REASONING_ESCALATION" | "HUMAN_ESCALATION";

export interface RuntimeDecision {
  kind: RuntimeDecisionKind;
  reason: string;
  missionId: string;
  taskId: string;
  agentRunId: string;
  provider?: string;
  model?: string;
  from: string;
  to: string;
}

export class RuntimeDecisionMetrics {
  constructor(private readonly store: DurableRuntimeStore) {}
  record(decision: RuntimeDecision, now = Date.now()) {
    const name = {
      TECHNICAL_FALLBACK: "fallback_count",
      ECONOMIC_DOWNGRADE: "economic_downgrade_count",
      REASONING_ESCALATION: "escalation_count",
      HUMAN_ESCALATION: "escalation_count",
    }[decision.kind];
    return this.store.transaction((state) => {
      metric(
        state,
        name,
        1,
        {
          missionId: decision.missionId,
          taskId: decision.taskId,
          agentRunId: decision.agentRunId,
          ...(decision.provider ? { provider: decision.provider } : {}),
          ...(decision.model ? { model: decision.model } : {}),
          attributes: {
            kind: decision.kind,
            reason: decision.reason,
            from: decision.from,
            to: decision.to,
          },
        },
        now,
      );
    });
  }

  backendObserver() {
    return (event: BackendExecutionEvent) =>
      this.record({
        kind: "TECHNICAL_FALLBACK",
        reason: event.reason,
        missionId: event.input.missionId ?? "unknown",
        taskId: event.input.taskId,
        agentRunId: event.input.agentRunId ?? "unknown",
        ...(event.input.provider ? { provider: event.input.provider } : {}),
        ...(event.input.model ? { model: event.input.model } : {}),
        from: event.from,
        to: event.to,
      });
  }
}
