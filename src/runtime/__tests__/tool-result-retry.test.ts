import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { DurableToolQueue } from "../durable/tool-queue.server";
import { ToolExecutionWorker } from "../durable/tool-worker.server";

describe("durable failed tool retry", () => {
  it("uses maxAttempts for FAILED ToolResult", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-tool-retry-"));

    const store = new DurableRuntimeStore(path.join(root, "runtime.json"));

    await new DurableMissionRuntime(store).createMission("mission-1", ["task-1"]);

    const queue = new DurableToolQueue(store);

    await queue.enqueue(
      {
        toolCallId: "call-1",
        missionId: "mission-1",
        taskId: "task-1",
        commandId: "command-1",
        agentRunId: "run-1",
        agentId: "agent-1",
        toolId: "github_issue_read",
        arguments: {
          repository: "owner/repo",
          issue: 12,
        },
        riskLevel: 1,
        approvalPolicy: "AUTO",
        policyVersion: "test",
        logicalOperationId: "issue-read",
        maxAttempts: 3,
      },
      100,
    );

    let executions = 0;

    const executor = {
      async execute() {
        executions += 1;

        const timestamp = new Date(100 + executions).toISOString();

        return {
          toolCallId: "call-1",
          toolId: "github_issue_read",
          status: "FAILED" as const,
          exitCode: 1,
          stdoutArtifactRef: null,
          stderrArtifactRef: "artifact:test-error",
          startedAt: timestamp,
          completedAt: timestamp,
          executor: "local-runtime" as const,
          verified: true as const,
        };
      },
    };

    const worker = new ToolExecutionWorker("worker-1", store, executor);

    await worker.runOnce(undefined, 100);

    let snapshot = await store.snapshot();

    expect(snapshot.toolRequests[0]?.status).toBe("READY");

    expect(snapshot.toolRequests[0]?.attempt).toBe(1);

    await worker.runOnce(undefined, 10_000);

    snapshot = await store.snapshot();

    expect(snapshot.toolRequests[0]?.status).toBe("READY");

    expect(snapshot.toolRequests[0]?.attempt).toBe(2);

    await worker.runOnce(undefined, 20_000);

    snapshot = await store.snapshot();

    expect(snapshot.toolRequests[0]?.status).toBe("DEAD_LETTER");

    expect(snapshot.toolRequests[0]?.attempt).toBe(3);

    expect(executions).toBe(3);
  });
});
