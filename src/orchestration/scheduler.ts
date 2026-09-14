import { BudgetService } from "./model-routing";

export interface SchedulableTask {
  id: string;
  missionId: string;
  agentId: string;
  provider: string;
  model: string;
  status: string;
  dependencies: string[];
  estimatedTokens: number;
  reservedCost: number;
  usesToolExecution?: boolean;
  backendHealth?:
    | "HEALTHY"
    | "DEGRADED"
    | "RATE_LIMITED"
    | "CIRCUIT_OPEN"
    | "UNAVAILABLE"
    | "DISABLED"
    | "UNKNOWN";
}
export interface SchedulerLimits {
  globalMaxConcurrentTasks: number;
  maxConcurrentTasksPerMission: number;
  maxConcurrentTasksPerAgent: number;
  maxConcurrentCallsPerProvider: number;
  maxConcurrentCallsPerModel: number;
  maxConcurrentToolExecutions: number;
}
export interface SchedulerMetric {
  taskId: string;
  missionId: string;
  queuedAt: string;
  startedAt: string;
  completedAt: string;
  queuedDurationMs: number;
  executionDurationMs: number;
  rateLimitWaitMs: number;
}
export interface SchedulerRateLimits {
  providers?: ReadonlyMap<string, TokenBucket>;
  models?: ReadonlyMap<string, TokenBucket>;
}

export class AsyncSemaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error("INVALID_CONCURRENCY_LIMIT");
  }
  async acquire() {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return () => {
      this.active--;
      this.waiters.shift()?.();
    };
  }
}

export class TokenBucket {
  private requests: number[] = [];
  private tokens: { at: number; count: number }[] = [];
  constructor(
    private readonly rpm: number,
    private readonly tpm: number,
    private readonly now = () => Date.now(),
    private readonly sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  async consume(tokenCount: number): Promise<number> {
    let waited = 0;
    for (;;) {
      const now = this.now();
      const cutoff = now - 60_000;
      this.requests = this.requests.filter((at) => at > cutoff);
      this.tokens = this.tokens.filter((item) => item.at > cutoff);
      const usedTokens = this.tokens.reduce((sum, item) => sum + item.count, 0);
      if (this.requests.length < this.rpm && usedTokens + tokenCount <= this.tpm) {
        this.requests.push(now);
        this.tokens.push({ at: now, count: tokenCount });
        return waited;
      }
      const oldest = Math.min(this.requests[0] ?? now, this.tokens[0]?.at ?? now);
      const delay = Math.max(1, 60_001 - (now - oldest));
      waited += delay;
      await this.sleep(delay);
    }
  }
}

export class ReadyTaskResolver {
  resolve(tasks: readonly SchedulableTask[]): SchedulableTask[] {
    const done = new Set(
      tasks.filter((task) => task.status === "completed").map((task) => task.id),
    );
    return tasks
      .filter((task) => task.status === "queued" && task.dependencies.every((id) => done.has(id)))
      .filter(
        (task) => !task.backendHealth || ["HEALTHY", "DEGRADED"].includes(task.backendHealth),
      );
  }
}

export class OrchestrationScheduler {
  private global: AsyncSemaphore;
  private missions = new Map<string, AsyncSemaphore>();
  private agents = new Map<string, AsyncSemaphore>();
  private providers = new Map<string, AsyncSemaphore>();
  private models = new Map<string, AsyncSemaphore>();
  private tools: AsyncSemaphore;
  constructor(
    private readonly limits: SchedulerLimits,
    private readonly budget: BudgetService,
    private readonly rateLimits: SchedulerRateLimits = {},
  ) {
    this.global = new AsyncSemaphore(limits.globalMaxConcurrentTasks);
    this.tools = new AsyncSemaphore(limits.maxConcurrentToolExecutions);
  }
  private semaphore(map: Map<string, AsyncSemaphore>, key: string, limit: number) {
    let value = map.get(key);
    if (!value) {
      value = new AsyncSemaphore(limit);
      map.set(key, value);
    }
    return value;
  }
  async run(
    tasks: readonly SchedulableTask[],
    execute: (task: SchedulableTask) => Promise<void>,
  ): Promise<SchedulerMetric[]> {
    const ready = new ReadyTaskResolver().resolve(tasks);
    const byMission = new Map<string, SchedulableTask[]>();
    for (const task of ready)
      byMission.set(task.missionId, [...(byMission.get(task.missionId) ?? []), task]);
    const fair: SchedulableTask[] = [];
    while ([...byMission.values()].some((queue) => queue.length))
      for (const queue of byMission.values()) {
        const next = queue.shift();
        if (next) fair.push(next);
      }
    return Promise.all(
      fair.map(async (task) => {
        const queuedAt = Date.now();
        if (!this.budget.reserve(task.reservedCost)) throw new Error(`BUDGET_DENIED:${task.id}`);
        const rateLimitWaitMs =
          (await this.rateLimits.providers?.get(task.provider)?.consume(task.estimatedTokens)) ?? 0;
        const modelWaitMs =
          (await this.rateLimits.models
            ?.get(`${task.provider}:${task.model}`)
            ?.consume(task.estimatedTokens)) ?? 0;
        const capacity = [
          this.global.acquire(),
          this.semaphore(
            this.missions,
            task.missionId,
            this.limits.maxConcurrentTasksPerMission,
          ).acquire(),
          this.semaphore(
            this.agents,
            task.agentId,
            this.limits.maxConcurrentTasksPerAgent,
          ).acquire(),
          this.semaphore(
            this.providers,
            task.provider,
            this.limits.maxConcurrentCallsPerProvider,
          ).acquire(),
          this.semaphore(
            this.models,
            `${task.provider}:${task.model}`,
            this.limits.maxConcurrentCallsPerModel,
          ).acquire(),
        ];
        if (task.usesToolExecution) capacity.push(this.tools.acquire());
        const releases = await Promise.all(capacity);
        const startedAt = Date.now();
        try {
          await execute(task);
          this.budget.settle(task.reservedCost, task.reservedCost);
        } catch (error) {
          this.budget.settle(task.reservedCost, 0);
          throw error;
        } finally {
          for (const release of releases.reverse()) release();
        }
        const completedAt = Date.now();
        return {
          taskId: task.id,
          missionId: task.missionId,
          queuedAt: new Date(queuedAt).toISOString(),
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date(completedAt).toISOString(),
          queuedDurationMs: startedAt - queuedAt,
          executionDurationMs: completedAt - startedAt,
          rateLimitWaitMs: rateLimitWaitMs + modelWaitMs,
        };
      }),
    );
  }
}
