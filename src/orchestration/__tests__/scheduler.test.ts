import { describe, expect, it } from "vitest";
import { BudgetService } from "../model-routing";
import {
  OrchestrationScheduler,
  ReadyTaskResolver,
  TokenBucket,
  type SchedulableTask,
} from "../scheduler";

const task = (id: string, missionId: string, dependencies: string[] = []): SchedulableTask => ({
  id,
  missionId,
  agentId: id,
  provider: "p",
  model: "m",
  status: "queued",
  dependencies,
  estimatedTokens: 10,
  reservedCost: 0.1,
});
const limits = {
  globalMaxConcurrentTasks: 2,
  maxConcurrentTasksPerMission: 2,
  maxConcurrentTasksPerAgent: 1,
  maxConcurrentCallsPerProvider: 2,
  maxConcurrentCallsPerModel: 2,
  maxConcurrentToolExecutions: 2,
};
describe("central scheduler", () => {
  it("runs independent tasks concurrently", async () => {
    let active = 0;
    let peak = 0;
    const scheduler = new OrchestrationScheduler(limits, new BudgetService(1));
    await scheduler.run([task("a", "m"), task("b", "m")], async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    });
    expect(peak).toBe(2);
  });
  it("limits concurrent calls to the same provider", async () => {
    let active = 0;
    let peak = 0;
    const constrained = { ...limits, maxConcurrentCallsPerProvider: 1 };
    await new OrchestrationScheduler(constrained, new BudgetService(1)).run(
      [task("a", "m"), task("b", "m")],
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
      },
    );
    expect(peak).toBe(1);
  });
  it("applies dedicated backpressure to tool executions", async () => {
    let active = 0;
    let peak = 0;
    const constrained = { ...limits, maxConcurrentToolExecutions: 1 };
    const toolTasks = [
      { ...task("a", "m"), usesToolExecution: true },
      { ...task("b", "m"), usesToolExecution: true },
    ];
    await new OrchestrationScheduler(constrained, new BudgetService(1)).run(toolTasks, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    });
    expect(peak).toBe(1);
  });
  it("does not expose dependent tasks before their parent completes", () =>
    expect(
      new ReadyTaskResolver()
        .resolve([task("parent", "m"), task("child", "m", ["parent"])])
        .map((item) => item.id),
    ).toEqual(["parent"]));
  it("prevents concurrent budget oversubscription", async () => {
    const budget = new BudgetService(1);
    const results = await Promise.all([
      Promise.resolve().then(() => budget.reserve(0.7)),
      Promise.resolve().then(() => budget.reserve(0.7)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("enforces RPM and TPM waits", async () => {
    let now = 0;
    const waits: number[] = [];
    const bucket = new TokenBucket(
      1,
      10,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    await bucket.consume(8);
    const waited = await bucket.consume(8);
    expect(waited).toBeGreaterThanOrEqual(60_000);
    expect(waits.length).toBeGreaterThan(0);
  });
  it("integrates provider rate limiting before execution", async () => {
    let now = 0;
    const bucket = new TokenBucket(
      1,
      10,
      () => now,
      async (ms) => {
        now += ms;
      },
    );
    const scheduler = new OrchestrationScheduler(limits, new BudgetService(1), {
      providers: new Map([["p", bucket]]),
    });
    const metrics = await scheduler.run([task("a", "m"), task("b", "m")], async () => {});
    expect(metrics.some((metric) => metric.rateLimitWaitMs >= 60_000)).toBe(true);
  });
  it("round-robins missions before taking a second task", async () => {
    const order: string[] = [];
    const one = { ...limits, globalMaxConcurrentTasks: 1 };
    await new OrchestrationScheduler(one, new BudgetService(1)).run(
      [task("a1", "a"), task("a2", "a"), task("b1", "b")],
      async (item) => {
        order.push(item.id);
      },
    );
    expect(order).toEqual(["a1", "b1", "a2"]);
  });
});
