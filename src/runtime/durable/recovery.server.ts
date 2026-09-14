import { DurableRuntimeStore } from "./store.server";
import { addOutbox, audit, iso, metric } from "./helpers";

export interface RecoveryReport {
  reclaimedTools: number;
  completedFromResults: number;
  resumedTasks: number;
  releasedBudgets: number;
  expiredApprovals: number;
  resetTasks: number;
}

export class RecoveryService {
  constructor(private readonly store: DurableRuntimeStore) {}

  run(now = Date.now()): Promise<RecoveryReport> {
    return this.store.transaction((state) => {
      const report: RecoveryReport = {
        reclaimedTools: 0,
        completedFromResults: 0,
        resumedTasks: 0,
        releasedBudgets: 0,
        expiredApprovals: 0,
        resetTasks: 0,
      };
      audit(state, "RUNTIME_RECOVERY_STARTED", {}, {}, now);
      for (const approval of state.approvals) {
        if (approval.status === "PENDING" && new Date(approval.expiresAt).getTime() <= now) {
          approval.status = "EXPIRED";
          const request = state.toolRequests.find(
            (item) => item.toolCallId === approval.toolCallId,
          );
          if (request) request.status = "DENIED";
          report.expiredApprovals++;
        }
      }
      for (const request of state.toolRequests) {
        const result = state.toolResults.find((item) => item.toolCallId === request.toolCallId);
        if (result && request.status !== "COMPLETED") {
          request.status = "COMPLETED";
          request.toolResultId = result.id;
          request.completedAt = result.createdAt;
          const record = state.idempotencyRecords.find(
            (item) => item.idempotencyKey === request.idempotencyKey,
          );
          if (record) {
            record.status = "COMPLETED";
            record.resultRef = result.id;
            record.completedAt = result.createdAt;
          }
          addOutbox(
            state,
            "TOOL_COMPLETED",
            "tool_request",
            request.toolCallId,
            { recovered: true },
            now,
          );
          report.completedFromResults++;
        } else if (
          ["CLAIMED", "RUNNING"].includes(request.status) &&
          request.claimExpiresAt &&
          new Date(request.claimExpiresAt).getTime() <= now
        ) {
          request.status = request.attempt >= request.maxAttempts ? "DEAD_LETTER" : "READY";
          request.claimedBy = null;
          request.claimToken = null;
          request.claimExpiresAt = null;
          request.availableAt = iso(now);
          report.reclaimedTools++;
          metric(state, "lease_reclaim_count", 1, request, now);
        }
        if (request.status === "COMPLETED") {
          const task = state.tasks.find((item) => item.id === request.taskId);
          const mission = state.missions.find((item) => item.id === request.missionId);
          const allToolsCompleted = state.toolRequests
            .filter((item) => item.taskId === request.taskId)
            .every((item) => item.status === "COMPLETED");
          if (
            task &&
            allToolsCompleted &&
            task.status !== "COMPLETED" &&
            mission?.status !== "CANCELLED"
          ) {
            task.status = "READY_TO_RESUME";
            task.updatedAt = iso(now);
            report.resumedTasks++;
          }
        }
      }
      for (const reservation of state.budgetReservations) {
        if (reservation.status === "RESERVED" && new Date(reservation.expiresAt).getTime() <= now) {
          reservation.status = "EXPIRED";
          reservation.reconciledAt = iso(now);
          report.releasedBudgets++;
          audit(state, "BUDGET_RELEASED", reservation, { reason: "expired" }, now);
        }
      }
      for (const task of state.tasks) {
        if (task.status !== "RUNNING") continue;
        const active = state.toolRequests.some(
          (request) =>
            request.taskId === task.id && ["CLAIMED", "RUNNING"].includes(request.status),
        );
        if (!active) {
          task.status = "QUEUED";
          task.updatedAt = iso(now);
          report.resetTasks++;
        }
      }
      audit(
        state,
        "RUNTIME_RECOVERY_COMPLETED",
        {},
        report as unknown as Record<string, unknown>,
        now,
      );
      metric(
        state,
        "recovery_count",
        1,
        { attributes: report as unknown as Record<string, unknown> },
        now,
      );
      return report;
    });
  }
}
