import { DurableRuntimeStore } from "./store.server";
import { iso } from "./helpers";

export class IdempotencyService {
  constructor(private readonly store: DurableRuntimeStore) {}

  reserve(idempotencyKey: string, operationType: string, now = Date.now()) {
    return this.store.transaction((state) => {
      const existing = state.idempotencyRecords.find(
        (item) => item.idempotencyKey === idempotencyKey,
      );
      if (existing) return { acquired: false, record: structuredClone(existing) };
      const record = {
        idempotencyKey,
        operationType,
        status: "RESERVED" as const,
        resultRef: null,
        createdAt: iso(now),
        completedAt: null,
      };
      state.idempotencyRecords.push(record);
      return { acquired: true, record: structuredClone(record) };
    });
  }

  markRunning(idempotencyKey: string) {
    return this.store.transaction((state) => {
      const record = state.idempotencyRecords.find(
        (item) => item.idempotencyKey === idempotencyKey,
      );
      if (!record) throw new Error("IDEMPOTENCY_RECORD_NOT_FOUND");
      if (record.status === "COMPLETED") return false;
      record.status = "RUNNING";
      return true;
    });
  }

  complete(idempotencyKey: string, resultRef: string, now = Date.now()) {
    return this.store.transaction((state) => {
      const record = state.idempotencyRecords.find(
        (item) => item.idempotencyKey === idempotencyKey,
      );
      if (!record) throw new Error("IDEMPOTENCY_RECORD_NOT_FOUND");
      record.status = "COMPLETED";
      record.resultRef = resultRef;
      record.completedAt = iso(now);
    });
  }

  get(idempotencyKey: string) {
    return this.store
      .snapshot()
      .then((state) =>
        state.idempotencyRecords.find((item) => item.idempotencyKey === idempotencyKey),
      );
  }
}
