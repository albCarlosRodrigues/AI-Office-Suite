import { LOCAL_OPERATOR_ID, localDbServer } from "@/local/database.server";
import { OrchestrationEngine } from "./engine.server";
import { loadProviderSecrets } from "./provider-secret-service.server";
import { BudgetService } from "./model-routing";
import { OrchestrationScheduler, type SchedulableTask } from "./scheduler";
import { runtimeMetricsStore } from "@/runtime/metrics.server";
import { runtimeDurableStore } from "@/runtime/durable/store.server";
import { RecoveryService } from "@/runtime/durable/recovery.server";
import { runDurableToolWorker } from "./durable-tool-worker.server";

const ACTIVE_STATUSES = ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"] as const;

/** One bounded scheduler pass. Safe to invoke concurrently or retry. */
export async function runOrchestrationWorker(limit = 20) {
  await new RecoveryService(runtimeDurableStore()).run();
  await runDurableToolWorker(Math.max(1, Math.min(limit, 20)));
  const { data: missions, error } = await localDbServer
    .from("missions")
    .select("id")
    .in("status", [...ACTIVE_STATUSES])
    .order("updated_at")
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(error.message);

  const missionRows = missions ?? [];
  const outputs = new Map<string, { missionId: string; acted: boolean; note: string }>();
  const configuredConcurrency = Number(process.env["AI_OFFICE_GLOBAL_MAX_CONCURRENT_TASKS"] ?? 4);
  const globalMax = Math.max(
    1,
    Math.min(Number.isFinite(configuredConcurrency) ? configuredConcurrency : 4, 32),
  );
  const scheduler = new OrchestrationScheduler(
    {
      globalMaxConcurrentTasks: globalMax,
      maxConcurrentTasksPerMission: 1,
      maxConcurrentTasksPerAgent: 1,
      maxConcurrentCallsPerProvider: Math.max(1, Math.min(globalMax, 4)),
      maxConcurrentCallsPerModel: Math.max(1, Math.min(globalMax, 2)),
      maxConcurrentToolExecutions: Math.max(
        1,
        Number(process.env["AI_OFFICE_MAX_CONCURRENT_TOOL_EXECUTIONS"] ?? 2),
      ),
    },
    new BudgetService(Number.MAX_SAFE_INTEGER),
  );
  const scheduled: SchedulableTask[] = missionRows.map(({ id }) => ({
    id: `mission-step:${id}`,
    missionId: id,
    agentId: `mission:${id}`,
    provider: "mission-provider",
    model: "mission-model",
    status: "queued",
    dependencies: [],
    estimatedTokens: 0,
    reservedCost: 0,
  }));
  const metrics = await scheduler.run(scheduled, async (scheduledTask) => {
    try {
      const engine = new OrchestrationEngine(
        localDbServer,
        LOCAL_OPERATOR_ID,
        { lovableApiKey: process.env["LOVABLE_API_KEY"] },
        loadProviderSecrets,
      );
      outputs.set(scheduledTask.missionId, {
        missionId: scheduledTask.missionId,
        ...(await engine.step(scheduledTask.missionId)),
      });
    } catch (error) {
      outputs.set(scheduledTask.missionId, {
        missionId: scheduledTask.missionId,
        acted: false,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  });
  const metricsStore = runtimeMetricsStore();
  await Promise.all(
    metrics.flatMap((metric) => [
      metricsStore.record({
        name: "scheduler.queued_duration",
        value: metric.queuedDurationMs,
        unit: "ms",
        timestamp: metric.completedAt,
        missionId: metric.missionId,
        taskId: metric.taskId,
      }),
      metricsStore.record({
        name: "scheduler.execution_duration",
        value: metric.executionDurationMs,
        unit: "ms",
        timestamp: metric.completedAt,
        missionId: metric.missionId,
        taskId: metric.taskId,
      }),
      metricsStore.record({
        name: "scheduler.rate_limit_wait",
        value: metric.rateLimitWaitMs,
        unit: "ms",
        timestamp: metric.completedAt,
        missionId: metric.missionId,
        taskId: metric.taskId,
      }),
    ]),
  );
  return missionRows.map(({ id }) => outputs.get(id)!);
}
