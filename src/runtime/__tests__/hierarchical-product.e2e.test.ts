import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileArtifactStore } from "../artifact-store.server";
import { commandExitGate, contentGate, fileExistsGate } from "../gates";
import { ToolExecutionGateway, ToolRegistry } from "../tools/gateway";
import { createLocalToolHandlers } from "../tools/handlers.server";
import { DefaultDenyToolPolicy } from "../tools/policy";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { DurableLocalToolExecutor } from "../durable/local-tool-executor.server";
import { ToolExecutionWorker } from "../durable/tool-worker.server";
import { DurableTraceService } from "../durable/trace-service.server";
import { HierarchicalMissionCoordinator } from "@/orchestration/hierarchical-runtime";
import { verifyMissionResult } from "@/orchestration/mission-result";
import { validateTaskDag } from "@/orchestration/dag-validator";
import type { DurableToolRequest } from "../durable/types";

describe("hierarchical product E2E", () => {
  it("rejects a worker self-report without operational evidence", () => {
    expect(() =>
      verifyMissionResult({
        missionId: "negative",
        status: "COMPLETED",
        summary: "Corrigi o bug e todos os testes passaram.",
        criteria: { passed: ["claimed"], failed: [] },
        changes: [],
        artifacts: [],
        evidence: [],
        taskResults: [{ taskId: "task", agentId: "worker", status: "COMPLETED", summary: "claim" }],
        tests: [],
        unresolved: [],
        review: { reviewer: "leader", approved: true, notes: "self-report only" },
        cost: { total: 0, byProvider: {}, byModel: {}, byAgent: {} },
        tokens: { input: 0, output: 0, cached: 0 },
        retries: 0,
        fallbacks: 0,
        escalations: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    ).toThrow("VERIFIED_EVIDENCE_REQUIRED");
  });
  it("plans, delegates, fixes a real bug, runs a real test and returns reviewed evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-hierarchy-"));
    const source = path.join(root, "math.mjs");
    const testFile = path.join(root, "math.test.mjs");
    await writeFile(source, "export const add = (a, b) => a - b;\n");
    await writeFile(
      testFile,
      "import { add } from './math.mjs';\nif (add(2, 3) !== 5) throw new Error('add failed');\n",
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node math.test.mjs" } }),
    );

    const store = new DurableRuntimeStore(path.join(root, ".runtime", "state.json"));
    const runtime = new DurableMissionRuntime(store);
    const artifacts = new FileArtifactStore(path.join(root, ".artifacts"));
    const executor = new DurableLocalToolExecutor((request: DurableToolRequest, approved) => {
      const registry = new ToolRegistry();
      for (const handler of createLocalToolHandlers([root])) registry.register(handler);
      return new ToolExecutionGateway(
        registry,
        new DefaultDenyToolPolicy({
          allowedTools: [request.toolId],
          approvedToolCallIds: approved ? new Set([request.toolCallId]) : new Set(),
        }),
        artifacts,
      );
    }, artifacts);
    const runTool = async (
      taskId: string,
      toolCallId: string,
      toolId: string,
      args: Record<string, unknown>,
    ) => {
      await runtime.requestTools(
        [
          {
            missionId: "mission-product",
            taskId,
            commandId: `command-${taskId}`,
            agentRunId: `run-${taskId}`,
            agentId: `worker-${taskId}`,
            toolCallId,
            toolId,
            arguments: args,
            riskLevel: toolId === "filesystem_write" ? 2 : 1,
            approvalPolicy: "AUTO",
            policyVersion: "v1",
            logicalOperationId: `${taskId}:${toolId}`,
            maxAttempts: 2,
          },
        ],
        { phase: taskId },
      );
      const result = await new ToolExecutionWorker(`worker-${taskId}`, store, executor).runOnce();
      expect(result?.verified).toBe(true);
      return result!;
    };

    const startedAt = new Date().toISOString();
    const coordinator = new HierarchicalMissionCoordinator(new DurableTraceService(store));
    const envelope = await coordinator.run(
      {
        missionId: "mission-product",
        leaderId: "leader-codex",
        managerId: "manager-code",
        workerIds: ["worker-analysis", "worker-implementation", "worker-qa"],
      },
      {
        async plan() {
          const tasks = [
            { id: "analysis", dependencies: [] as string[] },
            { id: "implementation", dependencies: ["analysis"] },
            { id: "qa", dependencies: ["implementation"] },
          ];
          await runtime.createMission(
            "mission-product",
            tasks.map((task) => task.id),
          );
          return tasks;
        },
        async validateAndDelegate(tasks) {
          expect(
            validateTaskDag(tasks.map((task) => ({ code: task.id, dependsOn: task.dependencies }))),
          ).toMatchObject({ valid: true });
        },
        async executeWorkers() {
          const inspected = await runTool("analysis", "inspect", "filesystem_read", {
            path: source,
          });
          expect(
            await runtime.resumeTask("analysis", [
              () => commandExitGate(inspected),
              () => fileExistsGate(source),
            ]),
          ).toBe(true);
          const fixed = await runTool("implementation", "fix", "filesystem_write", {
            path: source,
            content: "export const add = (a, b) => a + b;\n",
          });
          expect(
            await runtime.resumeTask("implementation", [
              () => commandExitGate(fixed),
              () => contentGate(source, /a \+ b/),
            ]),
          ).toBe(true);
          const tested = await runTool("qa", "test", "testing", { cwd: root, timeoutMs: 10_000 });
          expect(await runtime.resumeTask("qa", [() => commandExitGate(tested)])).toBe(true);
        },
        async review() {
          const state = await store.snapshot();
          const testResult = state.toolResults.find((item) => item.toolCallId === "test")!;
          return {
            missionId: "mission-product",
            status: "COMPLETED",
            summary: "Bug de soma corrigido e validado por teste real.",
            criteria: { passed: ["bug-fixed", "tests-pass"], failed: [] },
            changes: [{ path: source, summary: "Operação de soma corrigida." }],
            artifacts: [{ name: "math.mjs", artifactRef: source, verified: true }],
            evidence: [
              {
                taskId: "qa",
                kind: "test-exit",
                reference: testResult.result.stdoutArtifactRef ?? testResult.id,
                verified: testResult.result.verified,
              },
            ],
            taskResults: state.tasks.map((task) => ({
              taskId: task.id,
              agentId: `worker-${task.id}`,
              status: task.status,
              summary: `${task.id} verificada`,
            })),
            tests: [
              {
                name: "npm test",
                passed: testResult.result.status === "COMPLETED",
                evidenceRef: testResult.result.stdoutArtifactRef ?? testResult.id,
              },
            ],
            unresolved: [],
            review: {
              reviewer: "leader-codex",
              approved: state.missions[0]?.status === "COMPLETED",
              notes: "Artefato e evidência conferidos.",
            },
            cost: { total: 0, byProvider: {}, byModel: {}, byAgent: {} },
            tokens: { input: 0, output: 0, cached: 0 },
            retries: 0,
            fallbacks: 0,
            escalations: 0,
            startedAt,
            completedAt: new Date().toISOString(),
          };
        },
      },
    );
    expect(envelope.review.approved).toBe(true);
    expect(await readFile(source, "utf8")).toContain("a + b");
    const state = await store.snapshot();
    expect(state.missions[0]?.status).toBe("COMPLETED");
    expect(state.toolResults).toHaveLength(3);
    expect(state.traces.map((trace) => trace.name)).toEqual([
      "leader.plan",
      "manager.delegate",
      "workers.execute",
      "leader.final-review",
    ]);
  });
});
