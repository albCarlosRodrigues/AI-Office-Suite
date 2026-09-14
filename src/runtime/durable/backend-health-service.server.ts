import { DurableRuntimeStore } from "./store.server";
import { iso } from "./helpers";
import type { BackendHealthRecord } from "./types";

export type OperationalBackendStatus =
  "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "CIRCUIT_OPEN" | "UNAVAILABLE" | "DISABLED" | "UNKNOWN";

export interface BackendHealthSnapshot extends BackendHealthRecord {
  status: OperationalBackendStatus;
  latencyP50: number | null;
  latencyP95: number | null;
  errorRatio: number;
}

const percentile = (values: number[], fraction: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
};

export class BackendHealthService {
  constructor(
    private readonly store: DurableRuntimeStore,
    private readonly failureThreshold = 3,
    private readonly openDurationMs = 30_000,
  ) {}

  register(
    input: Pick<
      BackendHealthRecord,
      "backendId" | "provider" | "model" | "configured" | "credentialsAvailable" | "enabled"
    >,
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const existing = state.backendHealth.find((item) => item.backendId === input.backendId);
      if (existing) return Object.assign(existing, input, { updatedAt: iso(now) });
      const record: BackendHealthRecord = {
        ...input,
        circuitState: "CLOSED",
        consecutiveFailures: 0,
        successes: 0,
        failures: 0,
        latenciesMs: [],
        lastSuccessAt: null,
        lastFailureAt: null,
        rateLimitedUntil: null,
        circuitOpenedAt: null,
        lastErrorCode: null,
        updatedAt: iso(now),
      };
      state.backendHealth.push(record);
      return structuredClone(record);
    });
  }

  recordSuccess(backendId: string, latencyMs: number, now = Date.now()) {
    return this.store.transaction((state) => {
      const item = state.backendHealth.find((record) => record.backendId === backendId);
      if (!item) throw new Error("BACKEND_HEALTH_NOT_REGISTERED");
      item.successes++;
      item.consecutiveFailures = 0;
      item.lastSuccessAt = iso(now);
      item.lastErrorCode = null;
      item.circuitState = "CLOSED";
      item.circuitOpenedAt = null;
      item.latenciesMs = [...item.latenciesMs, latencyMs].slice(-100);
      item.updatedAt = iso(now);
    });
  }

  recordFailure(
    backendId: string,
    code: string,
    latencyMs: number,
    retryAfterMs?: number,
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const item = state.backendHealth.find((record) => record.backendId === backendId);
      if (!item) throw new Error("BACKEND_HEALTH_NOT_REGISTERED");
      item.failures++;
      item.consecutiveFailures++;
      item.lastFailureAt = iso(now);
      item.lastErrorCode = code;
      item.latenciesMs = [...item.latenciesMs, latencyMs].slice(-100);
      if (retryAfterMs) item.rateLimitedUntil = iso(now + retryAfterMs);
      if (item.consecutiveFailures >= this.failureThreshold) {
        item.circuitState = "OPEN";
        item.circuitOpenedAt = iso(now);
      }
      item.updatedAt = iso(now);
    });
  }

  async snapshot(backendId: string, now = Date.now()): Promise<BackendHealthSnapshot> {
    const item = (await this.store.snapshot()).backendHealth.find(
      (record) => record.backendId === backendId,
    );
    if (!item) throw new Error("BACKEND_HEALTH_NOT_REGISTERED");
    let circuitState = item.circuitState;
    if (
      circuitState === "OPEN" &&
      item.circuitOpenedAt &&
      now - new Date(item.circuitOpenedAt).getTime() >= this.openDurationMs
    )
      circuitState = "HALF_OPEN";
    const total = item.successes + item.failures;
    const errorRatio = total ? item.failures / total : 0;
    const latencyP50 = percentile(item.latenciesMs, 0.5);
    const latencyP95 = percentile(item.latenciesMs, 0.95);
    let status: OperationalBackendStatus = "HEALTHY";
    if (!item.enabled) status = "DISABLED";
    else if (!item.configured || !item.credentialsAvailable) status = "UNKNOWN";
    else if (item.rateLimitedUntil && new Date(item.rateLimitedUntil).getTime() > now)
      status = "RATE_LIMITED";
    else if (circuitState === "OPEN") status = "CIRCUIT_OPEN";
    else if (circuitState === "HALF_OPEN") status = "DEGRADED";
    else if (item.consecutiveFailures >= this.failureThreshold || errorRatio >= 0.8)
      status = "UNAVAILABLE";
    else if (errorRatio >= 0.25 || (latencyP95 ?? 0) > 5_000) status = "DEGRADED";
    return {
      ...structuredClone(item),
      circuitState,
      status,
      latencyP50,
      latencyP95,
      errorRatio,
    };
  }

  async canDispatch(backendId: string, now = Date.now()) {
    const health = await this.snapshot(backendId, now);
    return !["UNAVAILABLE", "CIRCUIT_OPEN", "DISABLED", "UNKNOWN", "RATE_LIMITED"].includes(
      health.status,
    );
  }
}
