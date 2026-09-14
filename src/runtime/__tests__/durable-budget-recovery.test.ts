import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { DurableBudgetService, type EconomicCandidate } from "../durable/budget-service.server";
import { RecoveryService } from "../durable/recovery.server";
import { RuntimeHealthService } from "../durable/health.server";
import { DurableRuntimeControl } from "../durable/runtime-control.server";
import { DurableBudgetedModelExecutor } from "../durable/budgeted-model-executor.server";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-budget-"));
  const store = new DurableRuntimeStore(path.join(root, "runtime.json"));
  await new DurableMissionRuntime(store).createMission("m", ["t"]);
  return store;
}
const candidate = (
  tier: EconomicCandidate["tier"],
  cost: number,
  model: string,
): EconomicCandidate => ({
  provider: "p",
  model,
  tier,
  estimatedCost: cost,
  capabilities: ["code"],
  contextWindow: 10_000,
  available: true,
  healthy: true,
  permitted: true,
  toolSupport: true,
  structuredOutputSupport: true,
  estimatedLatencyMs: 1,
});

describe("durable budget and recovery", () => {
  it("prevents concurrent persistent budget oversubscription", async () => {
    const store = await setup();
    const service = new DurableBudgetService(store);
    const reserve = () =>
      service.reserve({
        missionId: "m",
        taskId: "t",
        provider: "p",
        model: "x",
        estimatedInputTokens: 1,
        reservedOutputTokens: 1,
        reservedCost: 0.7,
        missionLimit: 1,
      });
    const results = await Promise.all([reserve(), reserve()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reconciles provider usage once without double billing", async () => {
    const store = await setup();
    const service = new DurableBudgetService(store);
    const reservation = await service.reserve({
      missionId: "m",
      taskId: "t",
      provider: "p",
      model: "x",
      estimatedInputTokens: 10,
      reservedOutputTokens: 10,
      reservedCost: 0.2,
      missionLimit: 1,
    });
    expect(await service.reconcile(reservation!.reservationId, 12, 0.12)).toBe(true);
    expect(await service.reconcile(reservation!.reservationId, 12, 0.12)).toBe(false);
    const saved = (await store.snapshot()).budgetReservations[0]!;
    expect(saved).toMatchObject({ status: "CONSUMED", actualCost: 0.12, actualTokens: 12 });
  });

  it("denies the expensive tier before invocation and reserves a capable cheaper tier", async () => {
    const store = await setup();
    await new DurableBudgetService(store).reserve({
      missionId: "m",
      taskId: "other",
      provider: "p",
      model: "existing",
      estimatedInputTokens: 1,
      reservedOutputTokens: 1,
      reservedCost: 0.8,
      missionLimit: 1,
    });
    const expensive = vi.fn();
    const cheap = vi.fn();
    const routed = await new DurableBudgetedModelExecutor(new DurableBudgetService(store)).execute(
      {
        missionId: "m",
        taskId: "t",
        missionLimit: 1,
        desiredTier: "TIER_3",
        candidates: [candidate("TIER_3", 0.5, "expensive"), candidate("TIER_1", 0.1, "cheap")],
        requiredCapabilities: ["code"],
        minimumContext: 1_000,
        requiresTools: true,
        requiresStructuredOutput: true,
        estimatedInputTokens: 100,
        reservedOutputTokens: 100,
      },
      async (selected) => {
        (selected.model === "expensive" ? expensive : cheap)();
        return { output: "ok", actualTokens: 100, actualCost: 0.1 };
      },
    );
    expect(routed.candidate?.model).toBe("cheap");
    expect(expensive).not.toHaveBeenCalled();
    expect(cheap).toHaveBeenCalledOnce();
  });

  it("blocks without a provider call when no capable tier fits", async () => {
    const store = await setup();
    const call = vi.fn();
    const routed = await new DurableBudgetedModelExecutor(new DurableBudgetService(store)).execute(
      {
        missionId: "m",
        taskId: "t",
        missionLimit: 0.05,
        desiredTier: "TIER_3",
        candidates: [candidate("TIER_3", 0.5, "expensive"), candidate("TIER_1", 0.1, "cheap")],
        requiredCapabilities: ["code"],
        minimumContext: 1_000,
        requiresTools: true,
        requiresStructuredOutput: true,
        estimatedInputTokens: 100,
        reservedOutputTokens: 100,
      },
      async () => {
        call();
        return { output: "unexpected", actualTokens: 1, actualCost: 0.1 };
      },
    );
    expect(routed.status).toBe("BUDGET_BLOCKED");
    expect(call).not.toHaveBeenCalled();
    expect((await store.snapshot()).tasks[0]?.status).toBe("BUDGET_BLOCKED");
  });

  it("recovers expired budgets, approvals and orphaned tasks deterministically", async () => {
    const store = await setup();
    await store.transaction((state) => {
      state.tasks[0]!.status = "RUNNING";
      state.approvals.push({
        approvalId: "a",
        missionId: "m",
        taskId: "t",
        toolCallId: "missing",
        requester: "x",
        riskLevel: 2,
        reason: "x",
        scope: "ONCE",
        status: "PENDING",
        requestedAt: new Date(0).toISOString(),
        expiresAt: new Date(1).toISOString(),
        decision: null,
        decisionBy: null,
        decisionAt: null,
        toolId: "shell",
        inputHash: "h",
        policyVersion: "v1",
      });
    });
    await new DurableBudgetService(store).reserve(
      {
        missionId: "m",
        taskId: "t",
        provider: "p",
        model: "x",
        estimatedInputTokens: 1,
        reservedOutputTokens: 1,
        reservedCost: 0.1,
        missionLimit: 1,
        ttlMs: 1,
      },
      0,
    );
    const report = await new RecoveryService(store).run(2);
    expect(report).toMatchObject({ releasedBudgets: 1, expiredApprovals: 1, resetTasks: 1 });
  });

  it("persists kill switch and cancellation across instances", async () => {
    const store = await setup();
    const control = new DurableRuntimeControl(store);
    await control.setKillSwitch(true);
    expect((await new RuntimeHealthService(store).snapshot()).scheduler).toBe("PAUSED");
    await control.setKillSwitch(false);
    await control.cancelMission("m");
    expect((await store.snapshot()).missions[0]?.status).toBe("CANCELLED");
  });
});
