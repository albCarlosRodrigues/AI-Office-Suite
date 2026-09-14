import { DurableRuntimeStore } from "./store.server";
import { iso } from "./helpers";
import type { OutboxEvent } from "./types";

export class TransactionalOutbox {
  constructor(private readonly store: DurableRuntimeStore) {}

  async publish(
    consumer: string,
    handler: (event: OutboxEvent) => Promise<void>,
    limit = 100,
    now = Date.now(),
  ) {
    const events = (await this.store.snapshot()).outboxEvents
      .filter((event) => !event.publishedAt)
      .slice(0, limit);
    let processed = 0;
    for (const event of events) {
      const alreadyProcessed = (await this.store.snapshot()).processedEvents.some(
        (item) => item.consumer === consumer && item.eventId === event.eventId,
      );
      if (!alreadyProcessed) await handler(event);
      await this.store.transaction((state) => {
        if (
          !state.processedEvents.some(
            (item) => item.consumer === consumer && item.eventId === event.eventId,
          )
        )
          state.processedEvents.push({ consumer, eventId: event.eventId, processedAt: iso(now) });
        const current = state.outboxEvents.find((item) => item.eventId === event.eventId);
        if (current) {
          current.publishedAt = iso(now);
          current.attempt++;
        }
      });
      processed++;
    }
    return processed;
  }
}
