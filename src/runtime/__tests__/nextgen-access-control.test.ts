import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalToolId, expandEnabledToolIds } from "@/permissions/tool-registry";
import { LocalNextGenPdp } from "../access-control/pdp";
import type { AuthorizationSnapshot } from "../access-control/types";
import { DurableToolQueue } from "../durable/tool-queue.server";
import { DurableRuntimeStore } from "../durable/store.server";
import { canonicalHash } from "../durable/helpers";
import type { DurableApproval, DurableToolRequest } from "../durable/types";

function request(overrides: Partial<DurableToolRequest> = {}): DurableToolRequest {
  const argumentsValue = overrides.arguments ?? { argv: ["git", "status"] };
  const toolId = overrides.toolId ?? "shell";
  return {
    toolCallId: "call-1",
    missionId: "mission-1",
    taskId: "task-1",
    commandId: "command-1",
    agentRunId: "run-1",
    agentId: "agent-1",
    toolId,
    arguments: argumentsValue,
    inputHash: canonicalHash({ toolId, arguments: argumentsValue }),
    riskLevel: 2,
    approvalPolicy: "AUTO",
    policyVersion: "organization-policy-v1",
    status: "READY",
    attempt: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
    availableAt: new Date().toISOString(),
    claimedBy: null,
    claimToken: null,
    claimVersion: 0,
    cancellationVersion: 0,
    claimExpiresAt: null,
    heartbeatAt: null,
    startedAt: null,
    completedAt: null,
    idempotencyKey: "idem",
    toolResultId: null,
    failureCode: null,
    failureMessage: null,
    failureHistory: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<AuthorizationSnapshot> = {}): AuthorizationSnapshot {
  return {
    killSwitch: false,
    agent: {
      id: "agent-1",
      organizationId: "org-1",
      suspended: false,
      requireApproval: false,
      role: "executor",
      managerAgentId: null,
    },
    mission: {
      id: "mission-1",
      organizationId: "org-1",
      status: "RUNNING",
      allowedAgentIds: ["agent-1"],
      workspace: "C:/repo",
    },
    enabledTools: ["repository_read", "shell"],
    permanentPermissions: ["repository.read", "shell.execute"],
    missionPermissions: [],
    missionPermissionMode: "augment",
    approval: null,
    inputHashValid: true,
    ...overrides,
  };
}

function approvalFor(req: DurableToolRequest): DurableApproval {
  return {
    approvalId: "approval-1",
    missionId: req.missionId,
    taskId: req.taskId,
    toolCallId: req.toolCallId,
    requester: req.agentId,
    riskLevel: req.riskLevel,
    reason: "test",
    scope: "ONCE",
    status: "APPROVED",
    requestedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    decision: "APPROVED",
    decisionBy: "human",
    decisionAt: new Date().toISOString(),
    toolId: req.toolId,
    inputHash: req.inputHash,
    policyVersion: req.policyVersion,
  };
}

describe("next-gen access control", () => {
  it("canonicalizes aliases before authorization", () => {
    expect(canonicalToolId("apply_patch")).toBe("git_apply");
    expect(canonicalToolId("project_run_tests")).toBe("testing");
  });

  it("exposes specialized read-only Git tools when repository_read is enabled", () => {
    const expanded = expandEnabledToolIds(["repository_read"]);
    expect(expanded.has("git_status")).toBe(true);
    expect(expanded.has("git_diff")).toBe(true);
    expect(expanded.has("git_diff_check")).toBe(true);
    expect(expanded.has("shell")).toBe(false);
  });

  it("requires exact approval for shell even if a caller labels it AUTO", () => {
    const req = request();
    const pdp = new LocalNextGenPdp();
    expect(pdp.evaluate(req, snapshot()).effect).toBe("REQUIRE_APPROVAL");
    expect(pdp.evaluate(req, snapshot({ approval: approvalFor(req) })).effect).toBe("ALLOW");
  });

  it("rejects stale/tampered authorization state", () => {
    const req = request({ toolId: "repository_read", arguments: { path: "README.md" } });
    const pdp = new LocalNextGenPdp();
    expect(pdp.evaluate(req, snapshot({ inputHashValid: false })).reasonCode).toBe(
      "INPUT_HASH_MISMATCH",
    );
    expect(
      pdp.evaluate(
        req,
        snapshot({
          enabledTools: ["repository_read"],
          permanentPermissions: [],
        }),
      ).reasonCode,
    ).toBe("MISSING_PERMISSION");
  });

  it("durable queue normalizes aliases and upgrades always-approval tools", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-authz-"));
    const store = new DurableRuntimeStore(path.join(root, "state.json"));
    await store.transaction((state) => {
      state.missions.push({
        id: "mission-1",
        status: "RUNNING",
        updatedAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
      });
      state.tasks.push({
        id: "task-1",
        missionId: "mission-1",
        status: "QUEUED",
        continuation: null,
        updatedAt: new Date().toISOString(),
      });
    });

    const queue = new DurableToolQueue(store);
    const shell = await queue.enqueue({
      missionId: "mission-1",
      taskId: "task-1",
      commandId: "command-1",
      agentRunId: "run-1",
      agentId: "agent-1",
      toolId: "shell",
      arguments: { argv: ["git", "status"] },
      riskLevel: 0,
      approvalPolicy: "AUTO",
      policyVersion: "organization-policy-v1",
      logicalOperationId: "shell-1",
    });
    expect(shell.approvalPolicy).toBe("REQUIRE_APPROVAL");
    expect(shell.status).toBe("WAITING_APPROVAL");

    const patch = await queue.enqueue({
      missionId: "mission-1",
      taskId: "task-1",
      commandId: "command-1",
      agentRunId: "run-1",
      agentId: "agent-1",
      toolId: "apply_patch",
      arguments: { patch: "" },
      riskLevel: 1,
      approvalPolicy: "AUTO",
      policyVersion: "organization-policy-v1",
      logicalOperationId: "patch-1",
    });
    expect(patch.toolId).toBe("git_apply");
  });
});
