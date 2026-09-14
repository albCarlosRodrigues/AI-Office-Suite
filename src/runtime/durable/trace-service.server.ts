import { randomUUID } from "node:crypto";
import { DurableRuntimeStore } from "./store.server";
import type { TraceEvent } from "./types";

export interface TraceExporter {
  export(event: TraceEvent): Promise<void> | void;
}

export class DurableTraceService {
  constructor(
    private readonly store: DurableRuntimeStore,
    private readonly exporter?: TraceExporter,
  ) {}

  async record(
    input: Omit<TraceEvent, "spanId" | "timestamp"> & { spanId?: string },
    now = Date.now(),
  ) {
    const event: TraceEvent = {
      ...input,
      spanId: input.spanId ?? randomUUID(),
      timestamp: new Date(now).toISOString(),
    };
    await this.store.transaction((state) => state.traces.push(event));
    await this.exporter?.export(event);
    return event;
  }

  async span<T>(
    input: Omit<TraceEvent, "spanId" | "timestamp" | "durationMs" | "status">,
    operation: () => Promise<T>,
  ) {
    const started = Date.now();
    try {
      const result = await operation();
      await this.record({ ...input, durationMs: Date.now() - started, status: "OK" });
      return result;
    } catch (error) {
      await this.record({
        ...input,
        durationMs: Date.now() - started,
        status: "ERROR",
        attributes: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
