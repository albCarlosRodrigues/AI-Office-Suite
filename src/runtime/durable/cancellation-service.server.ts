import { randomUUID } from "node:crypto";
import { DurableRuntimeStore } from "./store.server";
import { audit, iso } from "./helpers";
import type { CancellationTokenRecord } from "./types";

export interface CancellationScope {
  missionId: string;
  taskId?: string;
  agentRunId?: string;
}

export interface CancellationBus {
  observe(
    scope: CancellationScope,
    onCancel: (record: CancellationTokenRecord) => void,
  ): () => void;
}

export class CancellationService implements CancellationBus {
  constructor(
    private readonly store: DurableRuntimeStore,
    private readonly pollMs = 100,
  ) {}

  request(input: CancellationScope & { reason: string; requestedBy: string }, now = Date.now()) {
    return this.store.transaction((state) => {
      const scopeType = input.agentRunId ? "AGENT_RUN" : input.taskId ? "TASK" : "MISSION";
      const scopeId = input.agentRunId ?? input.taskId ?? input.missionId;
      const previous = state.cancellations
        .filter((item) => item.scopeType === scopeType && item.scopeId === scopeId)
        .sort((a, b) => b.version - a.version)[0];
      const record: CancellationTokenRecord = {
        id: randomUUID(),
        scopeType,
        scopeId,
        missionId: input.missionId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
        status: "REQUESTED",
        reason: input.reason,
        requestedAt: iso(now),
        requestedBy: input.requestedBy,
        version: (previous?.version ?? 0) + 1,
      };
      state.cancellations.push(record);
      const mission = state.missions.find((item) => item.id === input.missionId);
      if (mission && scopeType === "MISSION") mission.status = "CANCELLED";
      for (const task of state.tasks.filter(
        (item) =>
          item.missionId === input.missionId &&
          (scopeType === "MISSION" || item.id === input.taskId) &&
          item.status !== "COMPLETED",
      ))
        task.status = "CANCELLED";
      for (const request of state.toolRequests.filter(
        (item) =>
          item.missionId === input.missionId &&
          (scopeType === "MISSION" || item.taskId === input.taskId) &&
          !["COMPLETED", "FAILED"].includes(item.status),
      ))
        if (!["CLAIMED", "RUNNING"].includes(request.status)) request.status = "CANCELLED";
      for (const approval of state.approvals.filter(
        (item) => item.missionId === input.missionId && item.status === "PENDING",
      ))
        approval.status = "CANCELLED";
      for (const reservation of state.budgetReservations.filter(
        (item) => item.missionId === input.missionId && item.status === "RESERVED",
      )) {
        reservation.status = "RELEASED";
        reservation.reconciledAt = iso(now);
      }
      audit(
        state,
        "CANCELLATION_REQUESTED",
        input,
        { scopeType, scopeId, version: record.version },
        now,
      );
      return structuredClone(record);
    });
  }

  async current(scope: CancellationScope) {
    const state = await this.store.snapshot();
    return state.cancellations
      .filter(
        (item) =>
          item.missionId === scope.missionId &&
          (item.scopeType === "MISSION" ||
            (item.scopeType === "TASK" && item.scopeId === scope.taskId) ||
            (item.scopeType === "AGENT_RUN" && item.scopeId === scope.agentRunId)),
      )
      .sort((a, b) => b.version - a.version)[0];
  }

  observe(scope: CancellationScope, onCancel: (record: CancellationTokenRecord) => void) {
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      const record = await this.current(scope);
      if (record) {
        onCancel(record);
        stopped = true;
        await this.store.transaction((state) => {
          const item = state.cancellations.find((candidate) => candidate.id === record.id);
          if (item && item.status === "REQUESTED") item.status = "OBSERVED";
        });
      }
    };
    const timer = setInterval(() => void poll(), this.pollMs);
    timer.unref?.();
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  createAbortController(scope: CancellationScope) {
    const controller = new AbortController();
    const stop = this.observe(scope, (record) => controller.abort(new Error(record.reason)));
    return { controller, stop };
  }
}
