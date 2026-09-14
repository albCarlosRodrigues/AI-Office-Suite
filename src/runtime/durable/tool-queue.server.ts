import { randomUUID } from "node:crypto";
import { redact } from "../security/redaction";
import { DurableRuntimeStore } from "./store.server";
import { addOutbox, audit, canonicalHash, iso, metric, plusMs } from "./helpers";
import type { DurableToolRequest } from "./types";

export interface EnqueueToolInput {
  toolCallId?: string;
  missionId: string;
  taskId: string;
  commandId: string;
  agentRunId: string;
  agentId: string;
  toolId: string;
  arguments: Record<string, unknown>;
  riskLevel: number;
  approvalPolicy: "AUTO" | "REQUIRE_APPROVAL";
  policyVersion: string;
  logicalOperationId: string;
  maxAttempts?: number;
}

export class DurableToolQueue {
  constructor(private readonly store: DurableRuntimeStore) {}

  enqueue(input: EnqueueToolInput, now = Date.now()) {
    return this.store.transaction((state) => {
      if (state.killSwitch) throw new Error("KILL_SWITCH_ACTIVE");
      const mission = state.missions.find((item) => item.id === input.missionId);
      if (mission?.status === "CANCELLED") throw new Error("MISSION_CANCELLED");
      const task = state.tasks.find((item) => item.id === input.taskId);
      if (task?.status === "CANCELLED") throw new Error("TASK_CANCELLED");
      if (
        state.cancellations.some(
          (item) =>
            item.missionId === input.missionId &&
            (item.scopeType === "MISSION" ||
              (item.scopeType === "TASK" && item.scopeId === input.taskId) ||
              (item.scopeType === "AGENT_RUN" && item.scopeId === input.agentRunId)),
        )
      )
        throw new Error("CANCELLATION_ALREADY_REQUESTED");
      const safeArguments = redact(input.arguments) as Record<string, unknown>;
      const inputHash = canonicalHash({ toolId: input.toolId, arguments: safeArguments });
      const idempotencyKey = canonicalHash({
        scope: input.missionId,
        operationType: input.toolId,
        inputHash,
        logicalOperationId: input.logicalOperationId,
      });
      const duplicate = state.toolRequests.find((item) => item.idempotencyKey === idempotencyKey);
      if (duplicate) return structuredClone(duplicate);
      const request: DurableToolRequest = {
        toolCallId: input.toolCallId ?? randomUUID(),
        missionId: input.missionId,
        taskId: input.taskId,
        commandId: input.commandId,
        agentRunId: input.agentRunId,
        agentId: input.agentId,
        toolId: input.toolId,
        arguments: safeArguments,
        inputHash,
        riskLevel: input.riskLevel,
        approvalPolicy: input.approvalPolicy,
        policyVersion: input.policyVersion,
        status: input.approvalPolicy === "AUTO" ? "READY" : "WAITING_APPROVAL",
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 3,
        createdAt: iso(now),
        availableAt: iso(now),
        claimedBy: null,
        claimToken: null,
        claimVersion: 0,
        cancellationVersion:
          state.cancellations
            .filter((item) => item.missionId === input.missionId)
            .sort((a, b) => b.version - a.version)[0]?.version ?? 0,
        claimExpiresAt: null,
        heartbeatAt: null,
        startedAt: null,
        completedAt: null,
        idempotencyKey,
        toolResultId: null,
        failureCode: null,
        failureMessage: null,
        failureHistory: [],
      };
      state.toolRequests.push(request);
      if (!state.idempotencyRecords.some((item) => item.idempotencyKey === idempotencyKey))
        state.idempotencyRecords.push({
          idempotencyKey,
          operationType: input.toolId,
          status: "RESERVED",
          resultRef: null,
          createdAt: iso(now),
          completedAt: null,
        });
      if (task) task.status = input.approvalPolicy === "AUTO" ? "WAITING_TOOL" : "WAITING_APPROVAL";
      addOutbox(
        state,
        input.approvalPolicy === "AUTO" ? "TOOL_READY" : "TOOL_APPROVAL_REQUIRED",
        "tool_request",
        request.toolCallId,
        {},
        now,
      );
      audit(state, "TOOL_REQUESTED", request, { inputHash }, now);
      return structuredClone(request);
    });
  }

  claim(workerId: string, leaseMs = 60_000, now = Date.now()) {
    return this.store.transaction((state) => {
      if (state.killSwitch) return null;
      const candidates = state.toolRequests
        .filter((item) => item.status === "READY" && new Date(item.availableAt).getTime() <= now)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let request: DurableToolRequest | undefined;
      for (const candidate of candidates) {
        const mission = state.missions.find((item) => item.id === candidate.missionId);
        const task = state.tasks.find((item) => item.id === candidate.taskId);
        const cancelled = state.cancellations.some(
          (item) =>
            item.missionId === candidate.missionId &&
            (item.scopeType === "MISSION" ||
              (item.scopeType === "TASK" && item.scopeId === candidate.taskId) ||
              (item.scopeType === "AGENT_RUN" && item.scopeId === candidate.agentRunId)),
        );
        if (mission?.status === "CANCELLED" || task?.status === "CANCELLED" || cancelled)
          candidate.status = "CANCELLED";
        else {
          request = candidate;
          break;
        }
      }
      if (!request) return null;
      request.status = "CLAIMED";
      request.claimedBy = workerId;
      request.claimToken = randomUUID();
      request.claimVersion++;
      request.claimExpiresAt = plusMs(leaseMs, now);
      request.heartbeatAt = iso(now);
      request.attempt++;
      const record = state.idempotencyRecords.find(
        (item) => item.idempotencyKey === request.idempotencyKey,
      );
      if (record && record.status !== "COMPLETED") record.status = "RUNNING";
      audit(state, "TOOL_CLAIMED", request, { workerId, claimVersion: request.claimVersion }, now);
      return structuredClone(request);
    });
  }

  heartbeat(
    toolCallId: string,
    claimToken: string,
    claimVersion: number,
    leaseMs = 60_000,
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const request = state.toolRequests.find((item) => item.toolCallId === toolCallId);
      if (!request || request.claimToken !== claimToken || request.claimVersion !== claimVersion)
        return false;
      if (!["CLAIMED", "RUNNING"].includes(request.status)) return false;
      request.heartbeatAt = iso(now);
      request.claimExpiresAt = plusMs(leaseMs, now);
      return true;
    });
  }

  markRunning(toolCallId: string, claimToken: string, claimVersion: number, now = Date.now()) {
    return this.store.transaction((state) => {
      const request = state.toolRequests.find((item) => item.toolCallId === toolCallId);
      if (!request || request.claimToken !== claimToken || request.claimVersion !== claimVersion)
        throw new Error("STALE_TOOL_LEASE");
      const mission = state.missions.find((item) => item.id === request.missionId);
      const task = state.tasks.find((item) => item.id === request.taskId);
      if (mission?.status === "CANCELLED" || task?.status === "CANCELLED") {
        request.status = "CANCELLED";
        throw new Error("EXECUTION_CANCELLED");
      }
      request.status = "RUNNING";
      request.startedAt ??= iso(now);
      return structuredClone(request);
    });
  }

  retry(
    toolCallId: string,
    claimToken: string,
    claimVersion: number,
    code: string,
    message: string,
    retryable: boolean,
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const request = state.toolRequests.find((item) => item.toolCallId === toolCallId);
      if (!request || request.claimToken !== claimToken || request.claimVersion !== claimVersion)
        throw new Error("STALE_TOOL_LEASE");
      request.failureCode = code;
      request.failureMessage = message;
      request.failureHistory.push({ at: iso(now), code, message });
      const exhausted = request.attempt >= request.maxAttempts;
      request.status = retryable && !exhausted ? "READY" : exhausted ? "DEAD_LETTER" : "FAILED";
      const delay =
        retryable && !exhausted
          ? Math.min(60_000, 250 * 2 ** (request.attempt - 1)) + Math.floor(Math.random() * 100)
          : 0;
      request.availableAt = plusMs(delay, now);
      request.claimedBy = null;
      request.claimToken = null;
      request.claimExpiresAt = null;
      const record = state.idempotencyRecords.find(
        (item) => item.idempotencyKey === request.idempotencyKey,
      );
      if (record) record.status = retryable && !exhausted ? "FAILED_RETRYABLE" : "FAILED_FINAL";
      metric(state, exhausted ? "tool_dead_letter_count" : "tool_retry_count", 1, request, now);
      if (exhausted) audit(state, "TOOL_DEAD_LETTERED", request, { code }, now);
      return { status: request.status, delay };
    });
  }
}
