import { RecoveryService } from "./recovery.server";
import { DurableRuntimeStore } from "./store.server";
import { ToolExecutionWorker } from "./tool-worker.server";
import { TransactionalOutbox } from "./outbox.server";

export class DurableRuntimeLoop {
  constructor(
    private readonly store: DurableRuntimeStore,
    private readonly worker: ToolExecutionWorker,
    private readonly outbox = new TransactionalOutbox(store),
  ) {}

  async startup(now = Date.now()) {
    return new RecoveryService(this.store).run(now);
  }

  async runBounded(maxTools = 10, signal?: AbortSignal) {
    let processed = 0;
    while (processed < maxTools && !signal?.aborted) {
      const result = await this.worker.runOnce(signal);
      if (!result) break;
      processed++;
    }
    return processed;
  }

  publishEvents(consumer: string, handler: Parameters<TransactionalOutbox["publish"]>[1]) {
    return this.outbox.publish(consumer, handler);
  }
}
