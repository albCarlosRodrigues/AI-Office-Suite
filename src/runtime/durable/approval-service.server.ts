import { randomUUID } from "node:crypto";
import { canonicalToolId } from "@/permissions/tool-registry";
import { DurableRuntimeStore } from "./store.server";
import { addOutbox, audit, iso, metric, plusMs } from "./helpers";
import type { ApprovalScope, DurableApproval } from "./types";

export interface ApprovalInput {
  missionId: string;
  taskId: string;
  toolCallId: string;
  requester: string;
  riskLevel: number;
  reason: string;
  scope: ApprovalScope;
  toolId: string;
  inputHash: string;
  policyVersion: string;
  ttlMs?: number;
}

export class DurableApprovalService {
  constructor(private readonly store: DurableRuntimeStore) {}

  request(input: ApprovalInput, now = Date.now()) {
    return this.store.transaction((state) => {
      const existing = state.approvals.find(
        (item) => item.toolCallId === input.toolCallId && item.status === "PENDING",
      );
      if (existing) return structuredClone(existing);
      const approval: DurableApproval = {
        approvalId: randomUUID(),
        ...input,
        toolId: canonicalToolId(input.toolId),
        status: "PENDING",
        requestedAt: iso(now),
        expiresAt: plusMs(input.ttlMs ?? 86_400_000, now),
        decision: null,
        decisionBy: null,
        decisionAt: null,
      };
      state.approvals.push(approval);
      const request = state.toolRequests.find((item) => item.toolCallId === input.toolCallId);
      if (request) request.status = "WAITING_APPROVAL";
      const task = state.tasks.find((item) => item.id === input.taskId);
      if (task) task.status = "WAITING_APPROVAL";
      const mission = state.missions.find((item) => item.id === input.missionId);
      if (mission) mission.status = "WAITING_APPROVAL";
      audit(state, "TOOL_APPROVAL_REQUIRED", input, { scope: input.scope }, now);
      return structuredClone(approval);
    });
  }

  resolve(
    approvalId: string,
    decision: "APPROVED" | "DENIED",
    decisionBy: string,
    approvedSnapshot: {
      toolId: string;
      inputHash: string;
      riskLevel: number;
      policyVersion: string;
    },
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const approval = state.approvals.find((item) => item.approvalId === approvalId);
      if (!approval || approval.status !== "PENDING") throw new Error("APPROVAL_NOT_PENDING");
      if (new Date(approval.expiresAt).getTime() <= now) {
        approval.status = "EXPIRED";
        throw new Error("APPROVAL_EXPIRED");
      }
      if (
        canonicalToolId(approval.toolId) !== canonicalToolId(approvedSnapshot.toolId) ||
        approval.inputHash !== approvedSnapshot.inputHash ||
        approval.riskLevel !== approvedSnapshot.riskLevel ||
        approval.policyVersion !== approvedSnapshot.policyVersion
      )
        throw new Error("APPROVAL_SNAPSHOT_MISMATCH");
      approval.status = decision;
      approval.decision = decision;
      approval.decisionBy = decisionBy;
      approval.decisionAt = iso(now);
      const request = state.toolRequests.find((item) => item.toolCallId === approval.toolCallId);
      if (request) request.status = decision === "APPROVED" ? "READY" : "DENIED";
      const task = state.tasks.find((item) => item.id === approval.taskId);
      if (task) task.status = decision === "APPROVED" ? "WAITING_TOOL" : "FAILED";
      const mission = state.missions.find((item) => item.id === approval.missionId);
      if (mission && decision === "APPROVED") mission.status = "RUNNING";
      addOutbox(state, "APPROVAL_RESOLVED", "tool_request", approval.toolCallId, { decision }, now);
      audit(state, decision === "APPROVED" ? "TOOL_APPROVED" : "TOOL_DENIED", approval, {}, now);
      metric(
        state,
        "approval_wait_ms",
        now - new Date(approval.requestedAt).getTime(),
        approval,
        now,
      );
      return structuredClone(approval);
    });
  }

  findReusable(
    missionId: string,
    toolId: string,
    inputHash: string,
    policyVersion: string,
    requester?: string,
    now = Date.now(),
  ) {
    const canonicalId = canonicalToolId(toolId);
    return this.store.snapshot().then((state) =>
      state.approvals.find(
        (item) =>
          item.status === "APPROVED" &&
          new Date(item.expiresAt).getTime() > now &&
          canonicalToolId(item.toolId) === canonicalId &&
          item.inputHash === inputHash &&
          item.policyVersion === policyVersion &&
          (!requester || !item.requester || item.requester === requester) &&
          item.scope !== "ONCE" &&
          (item.scope === "PERSISTENT" || item.missionId === missionId),
      ),
    );
  }
}
