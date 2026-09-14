import { randomUUID } from "node:crypto";
import type { ToolResult } from "../tools/types";
import { DurableRuntimeStore } from "./store.server";
import { DurableToolQueue } from "./tool-queue.server";
import { addOutbox, audit, iso, metric } from "./helpers";
import type { DurableToolRequest } from "./types";
import { CancellationService } from "./cancellation-service.server";

export type CrashPoint =
  "afterClaim" | "afterExecution" | "afterResultSave" | "afterRequestComplete";
export class SimulatedRuntimeCrash extends Error {}

export interface DurableToolExecutor {
  execute(
    request: DurableToolRequest,
    approved: boolean,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
  probeCompletedEffect?(request: DurableToolRequest): Promise<ToolResult | null>;
}

const retryableCodes = new Set(["timeout", "filesystem_locked", "process_unavailable"]);

export class ToolExecutionWorker {
  private readonly queue: DurableToolQueue;
  constructor(
    private readonly workerId: string,
    private readonly store: DurableRuntimeStore,
    private readonly executor: DurableToolExecutor,
    private readonly crashAt?: CrashPoint,
  ) {
    this.queue = new DurableToolQueue(store);
  }

  private crash(point: CrashPoint) {
    if (this.crashAt === point) throw new SimulatedRuntimeCrash(`SIMULATED_CRASH:${point}`);
  }

  async runOnce(signal?: AbortSignal, now = Date.now()) {
    const request = await this.queue.claim(this.workerId, 60_000, now);
    if (!request) return null;
    this.crash("afterClaim");
    await this.queue.markRunning(
      request.toolCallId,
      request.claimToken!,
      request.claimVersion,
      now,
    );
    const distributed = new CancellationService(this.store).createAbortController({
      missionId: request.missionId,
      taskId: request.taskId,
      agentRunId: request.agentRunId,
    });
    const forwardAbort = () => distributed.controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const heartbeat = setInterval(() => {
      void this.queue.heartbeat(request.toolCallId, request.claimToken!, request.claimVersion);
    }, 20_000);
    heartbeat.unref?.();
    try {
      const approved =
        request.approvalPolicy === "AUTO" ||
        (await this.store.snapshot()).approvals.some(
          (item) =>
            item.toolCallId === request.toolCallId &&
            item.status === "APPROVED" &&
            item.inputHash === request.inputHash,
        );
      if (!approved) throw Object.assign(new Error("APPROVAL_REQUIRED"), { code: "policy_denied" });
      let result = await this.executor.probeCompletedEffect?.(request);
      const recoveredEffect = Boolean(result);
      result ??= await this.executor.execute(request, approved, distributed.controller.signal);
      this.crash("afterExecution");
      const resultId = randomUUID();
      await this.store.transaction((state) => {
        const current = state.toolRequests.find((item) => item.toolCallId === request.toolCallId);
        const mission = state.missions.find((item) => item.id === request.missionId);
        const task = state.tasks.find((item) => item.id === request.taskId);
        const cancelledVersion = state.cancellations
          .filter((item) => item.missionId === request.missionId)
          .reduce((highest, item) => Math.max(highest, item.version), 0);
        if (
          !current ||
          current.claimToken !== request.claimToken ||
          current.claimVersion !== request.claimVersion
        )
          throw new Error("STALE_TOOL_LEASE");
        if (
          mission?.status === "CANCELLED" ||
          task?.status === "CANCELLED" ||
          cancelledVersion > request.cancellationVersion
        )
          throw new Error("EXECUTION_CANCELLED");
        if (!state.toolResults.some((item) => item.toolCallId === request.toolCallId))
          state.toolResults.push({
            id: resultId,
            toolCallId: request.toolCallId,
            result,
            recoveredEffect,
            createdAt: iso(now),
          });
      });
      this.crash("afterResultSave");
      await this.store.transaction((state) => {
        const current = state.toolRequests.find((item) => item.toolCallId === request.toolCallId);
        const mission = state.missions.find((item) => item.id === request.missionId);
        const task = state.tasks.find((item) => item.id === request.taskId);
        const cancelledVersion = state.cancellations
          .filter((item) => item.missionId === request.missionId)
          .reduce((highest, item) => Math.max(highest, item.version), 0);
        const saved = state.toolResults.find((item) => item.toolCallId === request.toolCallId);
        if (
          !current ||
          current.claimToken !== request.claimToken ||
          current.claimVersion !== request.claimVersion
        )
          throw new Error("STALE_TOOL_LEASE");
        if (
          mission?.status === "CANCELLED" ||
          task?.status === "CANCELLED" ||
          cancelledVersion > request.cancellationVersion
        )
          throw new Error("EXECUTION_CANCELLED");
        if (!saved) throw new Error("TOOL_RESULT_NOT_FOUND");
        current.status = saved.result.status === "COMPLETED" ? "COMPLETED" : "FAILED";
        current.toolResultId = saved.id;
        current.completedAt = iso(now);
        const record = state.idempotencyRecords.find(
          (item) => item.idempotencyKey === current.idempotencyKey,
        );
        if (record) {
          record.status = saved.result.status === "COMPLETED" ? "COMPLETED" : "FAILED_FINAL";
          record.resultRef = saved.id;
          record.completedAt = iso(now);
        }
        addOutbox(
          state,
          "TOOL_COMPLETED",
          "tool_request",
          current.toolCallId,
          { resultId: saved.id },
          now,
        );
        audit(
          state,
          recoveredEffect ? "TOOL_RECOVERED" : "TOOL_EXECUTED",
          current,
          { resultId: saved.id },
          now,
        );
      });
      this.crash("afterRequestComplete");
      await this.wakeTask(request.toolCallId, now);
      return result;
    } catch (error) {
      if (error instanceof SimulatedRuntimeCrash) throw error;
      const snapshot = await this.store.snapshot();
      const cancelled =
        snapshot.missions.some(
          (mission) => mission.id === request.missionId && mission.status === "CANCELLED",
        ) ||
        snapshot.tasks.some((task) => task.id === request.taskId && task.status === "CANCELLED") ||
        snapshot.cancellations.some(
          (item) =>
            item.missionId === request.missionId &&
            (item.scopeType === "MISSION" ||
              (item.scopeType === "TASK" && item.scopeId === request.taskId) ||
              (item.scopeType === "AGENT_RUN" && item.scopeId === request.agentRunId)),
        );
      if (cancelled) {
        await this.store.transaction((state) => {
          const current = state.toolRequests.find((item) => item.toolCallId === request.toolCallId);
          if (
            current &&
            current.claimToken === request.claimToken &&
            current.claimVersion === request.claimVersion
          )
            current.status = "CANCELLED";
        });
        return null;
      }
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "process_unavailable";
      await this.queue.retry(
        request.toolCallId,
        request.claimToken!,
        request.claimVersion,
        code,
        error instanceof Error ? error.message : String(error),
        retryableCodes.has(code),
        now,
      );
      return null;
    } finally {
      clearInterval(heartbeat);
      signal?.removeEventListener("abort", forwardAbort);
      distributed.stop();
    }
  }

  async wakeTask(toolCallId: string, now = Date.now()) {
    return this.store.transaction((state) => {
      const request = state.toolRequests.find((item) => item.toolCallId === toolCallId);
      if (!request || request.status !== "COMPLETED") return false;
      const task = state.tasks.find((item) => item.id === request.taskId);
      const mission = state.missions.find((item) => item.id === request.missionId);
      if (!task || mission?.status === "CANCELLED") return false;
      if (
        state.toolRequests.some(
          (item) => item.taskId === request.taskId && item.status !== "COMPLETED",
        )
      )
        return false;
      task.status = "READY_TO_RESUME";
      task.updatedAt = iso(now);
      addOutbox(state, "TASK_READY", "task", task.id, { toolCallId }, now);
      metric(state, "queue_wait_ms", now - new Date(request.createdAt).getTime(), request, now);
      return true;
    });
  }
}
