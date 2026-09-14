import { randomUUID } from "node:crypto";
import { DurableRuntimeStore } from "./store.server";
import { audit, iso } from "./helpers";

export class DeadLetterService {
  constructor(private readonly store: DurableRuntimeStore) {}

  inspect(missionId?: string) {
    return this.store
      .snapshot()
      .then((state) =>
        state.toolRequests.filter(
          (item) => item.status === "DEAD_LETTER" && (!missionId || item.missionId === missionId),
        ),
      );
  }

  retry(toolCallId: string, operator: string, now = Date.now()) {
    return this.transition(toolCallId, "READY", "OPERATOR_RETRY", operator, now);
  }

  cancel(toolCallId: string, operator: string, now = Date.now()) {
    return this.transition(toolCallId, "CANCELLED", "OPERATOR_CANCEL", operator, now);
  }

  resolve(toolCallId: string, operator: string, now = Date.now()) {
    return this.transition(toolCallId, "FAILED", "OPERATOR_RESOLVE", operator, now);
  }

  private transition(
    toolCallId: string,
    status: "READY" | "CANCELLED" | "FAILED",
    reason: string,
    operator: string,
    now: number,
  ) {
    return this.store.transaction((state) => {
      const request = state.toolRequests.find((item) => item.toolCallId === toolCallId);
      if (!request || request.status !== "DEAD_LETTER") throw new Error("DEAD_LETTER_NOT_FOUND");
      const originalState = request.status;
      request.status = status;
      request.claimedBy = null;
      request.claimToken = null;
      request.claimExpiresAt = null;
      request.availableAt = iso(now);
      state.recoveryHistory.push({
        id: randomUUID(),
        entityType: "tool_request",
        entityId: toolCallId,
        reason,
        originalState,
        newState: status,
        timestamp: iso(now),
      });
      audit(state, "DEAD_LETTER_TRANSITION", request, { reason, operator, status }, now);
      return structuredClone(request);
    });
  }
}
