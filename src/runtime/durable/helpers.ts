import { createHash, randomUUID } from "node:crypto";
import type { DurableAudit, DurableRuntimeState, OutboxEvent } from "./types";

export const iso = (now = Date.now()) => new Date(now).toISOString();
export const plusMs = (ms: number, now = Date.now()) => iso(now + ms);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export const canonicalHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export function addOutbox(
  state: DurableRuntimeState,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
  now = Date.now(),
): OutboxEvent {
  const event = {
    eventId: randomUUID(),
    eventType,
    aggregateType,
    aggregateId,
    payload,
    createdAt: iso(now),
    publishedAt: null,
    attempt: 0,
  };
  state.outboxEvents.push(event);
  return event;
}

export function audit(
  state: DurableRuntimeState,
  event: string,
  ids: Pick<DurableAudit, "missionId" | "taskId" | "toolCallId"> = {},
  data?: Record<string, unknown>,
  now = Date.now(),
) {
  state.audits.push({ id: randomUUID(), event, at: iso(now), ...ids, ...(data ? { data } : {}) });
}

export function metric(
  state: DurableRuntimeState,
  name: string,
  value: number,
  ids: Omit<DurableRuntimeState["metrics"][number], "name" | "value" | "at"> = {},
  now = Date.now(),
) {
  state.metrics.push({ name, value, at: iso(now), ...ids });
}
