import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { ToolExecutionWorker } from "../durable/tool-worker.server";
import { commandExitGate } from "../gates";

describe("bounded production load", () => {
  it("runs 10 missions with 5 tasks without duplicate work, stuck state or budget leak", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-load-"));
    const store = new DurableRuntimeStore(path.join(root, "runtime.json"), 20_000);
    const missionIds = Array.from({ length: 10 }, (_, index) => `mission-${index}`);
    const runtime = new DurableMissionRuntime(store);
    for (const missionId of missionIds) {
      const taskIds = Array.from({ length: 5 }, (_, index) => `${missionId}-task-${index}`);
      await runtime.createMission(missionId, taskIds);
      for (const taskId of taskIds)
        await runtime.requestTools(
          [
            {
              missionId,
              taskId,
              commandId: `command-${taskId}`,
              agentRunId: `run-${taskId}`,
              agentId: `agent-${taskId}`,
              toolCallId: `call-${taskId}`,
              toolId: "filesystem_read",
              arguments: { path: root },
              riskLevel: 1,
              approvalPolicy: "AUTO",
              policyVersion: "v1",
              logicalOperationId: `operation-${taskId}`,
              maxAttempts: 2,
            },
          ],
          { phase: "load" },
        );
    }
    const executions = new Map<string, number>();
    const executor = {
      async execute(request: { toolCallId: string; toolId: string }) {
        executions.set(request.toolCallId, (executions.get(request.toolCallId) ?? 0) + 1);
        const now = new Date().toISOString();
        return {
          toolCallId: request.toolCallId,
          toolId: request.toolId,
          status: "COMPLETED" as const,
          exitCode: 0,
          stdoutArtifactRef: `artifact:${request.toolCallId}`,
          stderrArtifactRef: null,
          startedAt: now,
          completedAt: now,
          executor: "local-runtime" as const,
          verified: true as const,
        };
      },
    };
    await Promise.all(
      Array.from({ length: 10 }, async (_, worker) => {
        const runner = new ToolExecutionWorker(`load-worker-${worker}`, store, executor);
        for (;;) if (!(await runner.runOnce())) break;
      }),
    );
    for (const missionId of missionIds)
      for (let task = 0; task < 5; task++)
        expect(await runtime.resumeTask(`${missionId}-task-${task}`, [commandExitGate])).toBe(true);
    const state = await store.snapshot();
    expect(state.toolResults).toHaveLength(50);
    expect(new Set(state.toolResults.map((item) => item.toolCallId)).size).toBe(50);
    expect([...executions.values()].every((count) => count === 1)).toBe(true);
    expect(state.missions.every((mission) => mission.status === "COMPLETED")).toBe(true);
    expect(state.tasks.some((task) => !["COMPLETED", "CANCELLED"].includes(task.status))).toBe(
      false,
    );
    expect(state.budgetReservations.some((item) => item.status === "RESERVED")).toBe(false);
  }, 30_000);
});
