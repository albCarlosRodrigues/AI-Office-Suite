import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileArtifactStore } from "../artifact-store.server";
import { contentGate, fileExistsGate } from "../gates";
import { ToolExecutionGateway, ToolRegistry } from "../tools/gateway";
import { createLocalToolHandlers } from "../tools/handlers.server";
import { DefaultDenyToolPolicy } from "../tools/policy";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { DurableLocalToolExecutor } from "../durable/local-tool-executor.server";
import { RecoveryService } from "../durable/recovery.server";
import { DurableApprovalService } from "../durable/approval-service.server";
import {
  SimulatedRuntimeCrash,
  ToolExecutionWorker,
  type CrashPoint,
} from "../durable/tool-worker.server";
import type { DurableToolRequest } from "../durable/types";
import { DurableRuntimeControl } from "../durable/runtime-control.server";
import type { ToolResult } from "../tools/types";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-durable-e2e-"));
  const stateFile = path.join(root, ".runtime", "state.json");
  const artifacts = new FileArtifactStore(path.join(root, ".artifacts"));
  const executions = { writes: 0 };
  const executor = new DurableLocalToolExecutor((request: DurableToolRequest, approved) => {
    const registry = new ToolRegistry();
    for (const tool of createLocalToolHandlers([root])) {
      if (tool.id === "filesystem_write") {
        const execute = tool.execute.bind(tool);
        tool.execute = async (...args) => {
          executions.writes++;
          return execute(...args);
        };
      }
      registry.register(tool);
    }
    return new ToolExecutionGateway(
      registry,
      new DefaultDenyToolPolicy({
        allowedTools: [request.toolId],
        approvedToolCallIds: approved ? new Set([request.toolCallId]) : new Set(),
      }),
      artifacts,
    );
  }, artifacts);
  return { root, stateFile, artifacts, executions, executor };
}

const request = (file: string, approvalPolicy: "AUTO" | "REQUIRE_APPROVAL" = "AUTO") => ({
  missionId: "mission",
  taskId: "task",
  commandId: "command",
  agentRunId: "run",
  agentId: "agent",
  toolCallId: "tool-call",
  toolId: "filesystem_write",
  arguments: { path: file, content: "durable runtime" },
  riskLevel: 2,
  approvalPolicy,
  policyVersion: "policy-v1",
  logicalOperationId: "write-durable-file",
  maxAttempts: 3,
});

async function completeMission(stateFile: string, file: string) {
  const restartedStore = new DurableRuntimeStore(stateFile);
  const runtime = new DurableMissionRuntime(restartedStore);
  const passed = await runtime.resumeTask("task", [
    () => fileExistsGate(file),
    () => contentGate(file, /^durable runtime$/),
  ]);
  const state = await restartedStore.snapshot();
  return { passed, state };
}

describe("durable runtime restart E2E", () => {
  it("persists a request, restarts, executes a real tool and completes the mission", async () => {
    const fx = await fixture();
    const file = path.join(fx.root, "durable.txt");
    const firstProcess = new DurableMissionRuntime(new DurableRuntimeStore(fx.stateFile));
    await firstProcess.createMission("mission", ["task"]);
    await firstProcess.requestTools([request(file)], { step: "after-write" });

    const restartedStore = new DurableRuntimeStore(fx.stateFile);
    expect((await restartedStore.snapshot()).toolRequests[0]?.status).toBe("READY");
    await new RecoveryService(restartedStore).run();
    const result = await new ToolExecutionWorker("worker-2", restartedStore, fx.executor).runOnce();
    expect(result).toMatchObject({
      verified: true,
      executor: "local-runtime",
      status: "COMPLETED",
    });
    const completed = await completeMission(fx.stateFile, file);
    expect(completed.passed).toBe(true);
    expect(completed.state.tasks[0]?.status).toBe("COMPLETED");
    expect(completed.state.missions[0]?.status).toBe("COMPLETED");
    expect(await readFile(file, "utf8")).toBe("durable runtime");
  });

  it("recovers after the side effect without executing the write twice", async () => {
    const fx = await fixture();
    const file = path.join(fx.root, "durable.txt");
    const store = new DurableRuntimeStore(fx.stateFile);
    const runtime = new DurableMissionRuntime(store);
    await runtime.createMission("mission", ["task"]);
    await runtime.requestTools([request(file)], { step: "after-write" }, 100);
    await expect(
      new ToolExecutionWorker("crashing-worker", store, fx.executor, "afterExecution").runOnce(
        undefined,
        100,
      ),
    ).rejects.toBeInstanceOf(SimulatedRuntimeCrash);
    expect(fx.executions.writes).toBe(1);
    expect(await readFile(file, "utf8")).toBe("durable runtime");

    const restarted = new DurableRuntimeStore(fx.stateFile);
    expect((await new RecoveryService(restarted).run(60_101)).reclaimedTools).toBe(1);
    const recovered = await new ToolExecutionWorker(
      "recovery-worker",
      restarted,
      fx.executor,
    ).runOnce(undefined, 60_102);
    expect(recovered?.verified).toBe(true);
    expect(fx.executions.writes).toBe(1);
    const state = (await completeMission(fx.stateFile, file)).state;
    expect(state.toolResults).toHaveLength(1);
    expect(state.toolResults[0]?.recoveredEffect).toBe(true);
    expect(state.idempotencyRecords[0]?.status).toBe("COMPLETED");
  });

  it.each(["afterResultSave", "afterRequestComplete"] satisfies CrashPoint[])(
    "recovers deterministically from %s",
    async (crashPoint) => {
      const fx = await fixture();
      const file = path.join(fx.root, "durable.txt");
      const store = new DurableRuntimeStore(fx.stateFile);
      const runtime = new DurableMissionRuntime(store);
      await runtime.createMission("mission", ["task"]);
      await runtime.requestTools([request(file)], { step: "resume" }, 100);
      await expect(
        new ToolExecutionWorker("worker", store, fx.executor, crashPoint).runOnce(undefined, 100),
      ).rejects.toBeInstanceOf(SimulatedRuntimeCrash);
      const restarted = new DurableRuntimeStore(fx.stateFile);
      const report = await new RecoveryService(restarted).run(60_101);
      expect(report.completedFromResults + report.resumedTasks).toBeGreaterThan(0);
      expect((await completeMission(fx.stateFile, file)).passed).toBe(true);
      expect(fx.executions.writes).toBe(1);
    },
  );

  it("preserves approval over restart and resumes the same request after human approval", async () => {
    const fx = await fixture();
    const file = path.join(fx.root, "durable.txt");
    const runtime = new DurableMissionRuntime(new DurableRuntimeStore(fx.stateFile));
    await runtime.createMission("mission", ["task"]);
    await runtime.requestTools(
      [request(file, "REQUIRE_APPROVAL")],
      { step: "approved-write" },
      100,
    );

    const restartedStore = new DurableRuntimeStore(fx.stateFile);
    const before = await restartedStore.snapshot();
    expect(before.approvals[0]?.status).toBe("PENDING");
    expect(before.toolRequests[0]?.status).toBe("WAITING_APPROVAL");
    const approval = before.approvals[0]!;
    await new DurableApprovalService(restartedStore).resolve(
      approval.approvalId,
      "APPROVED",
      "human",
      {
        toolId: approval.toolId,
        inputHash: approval.inputHash,
        riskLevel: approval.riskLevel,
        policyVersion: approval.policyVersion,
      },
      101,
    );
    await new ToolExecutionWorker("worker", restartedStore, fx.executor).runOnce(undefined, 102);
    expect((await completeMission(fx.stateFile, file)).passed).toBe(true);
    const after = await restartedStore.snapshot();
    expect(after.toolRequests).toHaveLength(1);
    expect(after.approvals).toHaveLength(1);
    expect(after.approvals[0]?.status).toBe("APPROVED");
  });

  it("rejects a late result after durable mission cancellation", async () => {
    const fx = await fixture();
    const file = path.join(fx.root, "durable.txt");
    const store = new DurableRuntimeStore(fx.stateFile);
    const runtime = new DurableMissionRuntime(store);
    await runtime.createMission("mission", ["task"]);
    await runtime.requestTools([request(file)], { step: "cancelled" });
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const releasePromise = new Promise<void>((resolve) => (release = resolve));
    const lateResult: ToolResult = {
      toolCallId: "tool-call",
      toolId: "filesystem_write",
      status: "COMPLETED",
      exitCode: 0,
      stdoutArtifactRef: "artifact:late",
      stderrArtifactRef: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executor: "local-runtime",
      verified: true,
    };
    const pending = new ToolExecutionWorker("worker", store, {
      async execute() {
        started();
        await releasePromise;
        return lateResult;
      },
    }).runOnce();
    await startedPromise;
    await new DurableRuntimeControl(store).cancelMission("mission");
    release();
    await pending;
    const state = await store.snapshot();
    expect(state.toolRequests[0]?.status).toBe("CANCELLED");
    expect(state.toolResults).toHaveLength(0);
    expect(state.missions[0]?.status).toBe("CANCELLED");
  });
});
