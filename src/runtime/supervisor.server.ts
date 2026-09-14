import { DurableRuntimeStore } from "./durable/store.server";
import { iso } from "./durable/helpers";
import type { WorkerHeartbeat } from "./durable/types";

export interface SupervisedWorker {
  workerId: string;
  workerType: WorkerHeartbeat["workerType"];
  intervalMs: number;
  tick(signal: AbortSignal): Promise<string | void>;
}

export class WorkerSupervisor {
  private controllers = new Map<string, AbortController>();
  private loops = new Map<string, Promise<void>>();
  constructor(
    private readonly store: DurableRuntimeStore,
    private readonly workers: SupervisedWorker[],
    private readonly maxRestarts = 3,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private heartbeat(
    worker: SupervisedWorker,
    status: WorkerHeartbeat["status"],
    currentWork: string | null,
    error: string | null,
    incrementRestart = false,
  ) {
    return this.store.transaction((state) => {
      let record = state.workerHeartbeats.find((item) => item.workerId === worker.workerId);
      if (!record) {
        record = {
          workerId: worker.workerId,
          workerType: worker.workerType,
          startedAt: iso(),
          heartbeatAt: iso(),
          status,
          currentWork,
          restartCount: 0,
          lastError: error,
        };
        state.workerHeartbeats.push(record);
      } else {
        record.heartbeatAt = iso();
        record.status = status;
        record.currentWork = currentWork;
        record.lastError = error;
        if (incrementRestart) record.restartCount++;
      }
      return structuredClone(record);
    });
  }

  async runWorkerCycle(worker: SupervisedWorker, signal: AbortSignal) {
    if ((await this.store.snapshot()).killSwitch) {
      await this.heartbeat(worker, "DEGRADED", null, "KILL_SWITCH_ACTIVE");
      return false;
    }
    await this.heartbeat(worker, "RUNNING", "tick", null);
    try {
      const work = await worker.tick(signal);
      await this.heartbeat(worker, signal.aborted ? "STOPPING" : "RUNNING", work ?? null, null);
      return true;
    } catch (error) {
      const record = await this.heartbeat(
        worker,
        "FAILED",
        null,
        error instanceof Error ? error.message : String(error),
        true,
      );
      if (record.restartCount >= this.maxRestarts)
        await this.heartbeat(worker, "DEGRADED", null, "CRASH_LOOP_PROTECTED");
      return false;
    }
  }

  start() {
    for (const worker of this.workers) {
      if (this.loops.has(worker.workerId)) continue;
      const controller = new AbortController();
      this.controllers.set(worker.workerId, controller);
      const loop = (async () => {
        let crashLoop = false;
        await this.heartbeat(worker, "STARTING", null, null);
        while (!controller.signal.aborted) {
          const continued = await this.runWorkerCycle(worker, controller.signal);
          const state = await this.store.snapshot();
          const restarts =
            state.workerHeartbeats.find((item) => item.workerId === worker.workerId)
              ?.restartCount ?? 0;
          if (!continued && restarts >= this.maxRestarts) {
            crashLoop = true;
            break;
          }
          const backoff = continued
            ? worker.intervalMs
            : Math.min(30_000, 250 * 2 ** Math.max(0, restarts - 1)) +
              Math.floor(Math.random() * 100);
          await this.sleep(backoff);
        }
        if (!crashLoop) await this.heartbeat(worker, "STOPPED", null, null);
      })();
      this.loops.set(worker.workerId, loop);
    }
  }

  async stop(graceMs = 5_000) {
    await Promise.all(this.workers.map((worker) => this.heartbeat(worker, "STOPPING", null, null)));
    for (const controller of this.controllers.values()) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(this.loops.values()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    for (const worker of this.workers) await this.heartbeat(worker, "STOPPED", null, null);
    this.controllers.clear();
    this.loops.clear();
  }

  health() {
    return this.store.snapshot().then((state) => structuredClone(state.workerHeartbeats));
  }
}
