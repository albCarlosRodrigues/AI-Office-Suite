import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { CancellationService } from "../durable/cancellation-service.server";
import { ToolExecutionWorker } from "../durable/tool-worker.server";
import { BackendHealthService } from "../durable/backend-health-service.server";
import { RuntimeDecisionMetrics } from "../durable/decision-metrics.server";
import { DeadLetterService } from "../durable/dead-letter-service.server";
import { DurableTraceService } from "../durable/trace-service.server";
import { RuntimeOperationsService } from "../operations.server";
import { WorkerSupervisor } from "../supervisor.server";
import { NetworkGuard, assertMissionScope } from "../security/network-guard.server";
import { DefaultSideEffectStrategy } from "../side-effect-strategy";
import { ExecutionBackendRegistry, type ExecutionBackend } from "@/orchestration/execution-backend";
import { ProductionBackendRouter } from "@/orchestration/backend-roles";
import { verifyMissionResult } from "@/orchestration/mission-result";
import type { ToolResult } from "../tools/types";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-production-"));
  const store = new DurableRuntimeStore(path.join(root, "runtime.json"));
  const runtime = new DurableMissionRuntime(store);
  await runtime.createMission("mission", ["task"]);
  return { root, store, runtime };
}

const enqueue = (runtime: DurableMissionRuntime) =>
  runtime.requestTools(
    [
      {
        missionId: "mission",
        taskId: "task",
        commandId: "command",
        agentRunId: "run",
        agentId: "worker",
        toolCallId: "call",
        toolId: "filesystem_write",
        arguments: { path: "result.txt", content: "done" },
        riskLevel: 2,
        approvalPolicy: "AUTO" as const,
        policyVersion: "v1",
        logicalOperationId: "write-result",
        maxAttempts: 2,
      },
    ],
    { phase: "execution" },
  );

const result: ToolResult = {
  toolCallId: "call",
  toolId: "filesystem_write",
  status: "COMPLETED",
  exitCode: 0,
  stdoutArtifactRef: "artifact:result",
  stderrArtifactRef: null,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  executor: "local-runtime",
  verified: true,
};

describe("production runtime operations", () => {
  it("cancels queued work before execution", async () => {
    const { store, runtime } = await setup();
    await enqueue(runtime);
    await new CancellationService(store).request({
      missionId: "mission",
      reason: "stop before claim",
      requestedBy: "human",
    });
    const execute = vi.fn(async () => result);
    await expect(
      new ToolExecutionWorker("worker", store, { execute }).runOnce(),
    ).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect((await store.snapshot()).toolRequests[0]?.status).toBe("CANCELLED");
  });

  it("propagates a durable cancellation to an in-flight tool and fences its late result", async () => {
    const { store, runtime } = await setup();
    await enqueue(runtime);
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const execute = vi.fn(async (_request: unknown, _approved: boolean, signal?: AbortSignal) => {
      started();
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      return result;
    });
    const pending = new ToolExecutionWorker("worker", store, { execute }).runOnce();
    await running;
    await new CancellationService(store, 1).request({
      missionId: "mission",
      taskId: "task",
      reason: "operator stop",
      requestedBy: "human",
    });
    await expect(pending).resolves.toBeNull();
    const state = await store.snapshot();
    expect(state.toolRequests[0]?.status).toBe("CANCELLED");
    expect(state.toolResults).toHaveLength(0);
    expect(state.tasks[0]?.status).toBe("CANCELLED");
  });

  it("releases reservations and cancels pending approvals atomically", async () => {
    const { store } = await setup();
    await store.transaction((state) => {
      state.approvals.push({
        approvalId: "approval",
        missionId: "mission",
        taskId: "task",
        toolCallId: "call",
        requester: "worker",
        riskLevel: 3,
        reason: "risk",
        scope: "ONCE",
        status: "PENDING",
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        decision: null,
        decisionBy: null,
        decisionAt: null,
        toolId: "shell",
        inputHash: "hash",
        policyVersion: "v1",
      });
      state.budgetReservations.push({
        reservationId: "reservation",
        missionId: "mission",
        taskId: "task",
        provider: "provider",
        model: "model",
        estimatedInputTokens: 10,
        reservedOutputTokens: 10,
        reservedCost: 1,
        status: "RESERVED",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        reconciledAt: null,
        actualTokens: null,
        actualCost: null,
      });
    });
    await new CancellationService(store).request({
      missionId: "mission",
      reason: "stop",
      requestedBy: "human",
    });
    const state = await store.snapshot();
    expect(state.approvals[0]?.status).toBe("CANCELLED");
    expect(state.budgetReservations[0]?.status).toBe("RELEASED");
  });

  it("opens, cools down and closes a persistent backend circuit", async () => {
    const { store } = await setup();
    const health = new BackendHealthService(store, 2, 100);
    await health.register(
      {
        backendId: "primary",
        provider: "p",
        model: "m",
        configured: true,
        credentialsAvailable: true,
        enabled: true,
      },
      1_000,
    );
    await health.recordFailure("primary", "timeout", 100, undefined, 1_010);
    await health.recordFailure("primary", "timeout", 200, undefined, 1_020);
    expect((await health.snapshot("primary", 1_021)).status).toBe("CIRCUIT_OPEN");
    expect((await health.snapshot("primary", 1_121)).status).toBe("DEGRADED");
    await health.recordSuccess("primary", 50, 1_122);
    expect((await health.snapshot("primary", 1_123)).circuitState).toBe("CLOSED");
  });

  it("skips an unhealthy backend and records a technical fallback separately", async () => {
    const { store } = await setup();
    const health = new BackendHealthService(store, 1);
    for (const id of ["primary", "fallback"])
      await health.register({
        backendId: id,
        provider: "p",
        model: id,
        configured: true,
        credentialsAvailable: true,
        enabled: true,
      });
    await health.recordFailure("primary", "timeout", 10);
    const backend = (id: string): ExecutionBackend => ({
      id,
      capabilities: { plan: true, execute: true, review: true, tools: [] },
      async healthCheck() {
        return { status: "HEALTHY", message: "ok" };
      },
      async execute() {
        return { status: "COMPLETED", result: id, backendId: id, fallbackCount: 0 };
      },
    });
    const metrics = new RuntimeDecisionMetrics(store);
    const registry = new ExecutionBackendRegistry(health, metrics.backendObserver());
    registry.register(backend("primary"));
    registry.register(backend("fallback"));
    const output = await registry.execute("primary", ["fallback"], {
      taskId: "task",
      missionId: "mission",
      agentRunId: "run",
      payload: {},
    });
    expect(output).toMatchObject({ backendId: "fallback", fallbackCount: 1 });
    expect((await store.snapshot()).metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "fallback_count",
          attributes: expect.objectContaining({ kind: "TECHNICAL_FALLBACK" }),
        }),
      ]),
    );
    await metrics.record({
      kind: "ECONOMIC_DOWNGRADE",
      reason: "budget",
      missionId: "mission",
      taskId: "task",
      agentRunId: "run",
      from: "T3",
      to: "T1",
    });
    await metrics.record({
      kind: "REASONING_ESCALATION",
      reason: "review failed",
      missionId: "mission",
      taskId: "task",
      agentRunId: "run",
      from: "T1",
      to: "T3",
    });
    await metrics.record({
      kind: "HUMAN_ESCALATION",
      reason: "approval",
      missionId: "mission",
      taskId: "task",
      agentRunId: "run",
      from: "manager",
      to: "human",
    });
    const names = (await store.snapshot()).metrics.map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining(["economic_downgrade_count", "escalation_count"]));
  });

  it("protects worker crash loops and supports graceful shutdown", async () => {
    const { store } = await setup();
    const supervisor = new WorkerSupervisor(
      store,
      [
        {
          workerId: "unstable",
          workerType: "TOOL",
          intervalMs: 1,
          async tick() {
            throw new Error("boom");
          },
        },
      ],
      2,
      async () => undefined,
    );
    supervisor.start();
    for (let i = 0; i < 20; i++) {
      if ((await supervisor.health())[0]?.status === "STOPPED") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect((await supervisor.health())[0]).toMatchObject({ status: "DEGRADED", restartCount: 2 });
    await supervisor.stop();

    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    let observedAbort = false;
    const graceful = new WorkerSupervisor(store, [
      {
        workerId: "graceful",
        workerType: "MISSION",
        intervalMs: 1,
        async tick(signal) {
          started();
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                resolve();
              },
              { once: true },
            ),
          );
        },
      },
    ]);
    graceful.start();
    await running;
    await graceful.stop(1_000);
    expect(observedAbort).toBe(true);
    expect((await graceful.health()).find((item) => item.workerId === "graceful")?.status).toBe(
      "STOPPED",
    );
  });

  it("exposes operational state, traces and auditable dead-letter recovery", async () => {
    const { store, runtime } = await setup();
    await enqueue(runtime);
    await store.transaction((state) => {
      state.toolRequests[0]!.status = "DEAD_LETTER";
    });
    await new DeadLetterService(store).retry("call", "operator");
    await new DurableTraceService(store).record({
      traceId: "trace",
      parentSpanId: null,
      name: "mission.task.tool",
      status: "OK",
      missionId: "mission",
      taskId: "task",
      toolCallId: "call",
    });
    const operations = await new RuntimeOperationsService(store).snapshot();
    expect(operations.recoveries[0]).toMatchObject({ reason: "OPERATOR_RETRY", newState: "READY" });
    expect((await store.snapshot()).traces[0]?.traceId).toBe("trace");
  });

  it("enforces SSRF and mission boundaries and classifies unknown effects", async () => {
    const guard = new NetworkGuard(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(guard.assertSafe("http://127.0.0.1/admin")).rejects.toThrow("PRIVATE_ADDRESS");
    await expect(guard.assertSafe("https://example.com/path")).resolves.toBeInstanceOf(URL);
    expect(() => assertMissionScope("mission-a", "mission-b")).toThrow(
      "CROSS_MISSION_ACCESS_DENIED",
    );
    const { runtime } = await setup();
    const [request] = await enqueue(runtime);
    expect(
      new DefaultSideEffectStrategy().unknownOutcome({ ...request!, toolId: "email_send" }),
    ).toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("routes narrow work to a cheap worker and validates the final review envelope", () => {
    const router = new ProductionBackendRouter([
      {
        id: "codex",
        provider: "openai",
        model: "reasoning",
        roles: ["LEADER", "MANAGER"],
        capabilities: ["code", "premium-reasoning"],
        status: "HEALTHY",
        costPerMillionTokens: 20,
        successRate: 0.99,
        latencyP95Ms: 1000,
        contextWindow: 100000,
      },
      {
        id: "worker",
        provider: "local",
        model: "cheap",
        roles: ["WORKER"],
        capabilities: ["code"],
        status: "HEALTHY",
        costPerMillionTokens: 1,
        successRate: 0.9,
        latencyP95Ms: 100,
        contextWindow: 10000,
      },
    ]);
    expect(
      router.select({
        role: "WORKER",
        workKind: "NARROW_EXECUTION",
        requiredCapabilities: ["code"],
        estimatedTokens: 1000,
        risk: "LOW",
      })?.id,
    ).toBe("worker");
    expect(() =>
      verifyMissionResult({
        missionId: "m",
        status: "COMPLETED",
        summary: "done",
        criteria: { passed: ["fixed"], failed: [] },
        changes: [{ path: "math.mjs", summary: "fixed" }],
        artifacts: [{ name: "fix", artifactRef: "artifact:fix", verified: true }],
        evidence: [{ taskId: "t", kind: "test", reference: "artifact:test", verified: true }],
        taskResults: [{ taskId: "t", agentId: "a", status: "COMPLETED", summary: "fixed" }],
        tests: [{ name: "unit", passed: true, evidenceRef: "artifact:test" }],
        unresolved: [],
        review: { reviewer: "leader", approved: false, notes: "not approved" },
        cost: { total: 0, byProvider: {}, byModel: {}, byAgent: {} },
        tokens: { input: 1, output: 1, cached: 0 },
        retries: 0,
        fallbacks: 0,
        escalations: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    ).toThrow("FINAL_REVIEW_REQUIRED");
  });
});
