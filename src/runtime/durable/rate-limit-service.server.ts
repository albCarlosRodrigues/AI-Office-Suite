import { DurableRuntimeStore } from "./store.server";
import { iso, metric } from "./helpers";

export class DurableRateLimitService {
  constructor(private readonly store: DurableRuntimeStore) {}

  consume(
    provider: string,
    model: string,
    tokens: number,
    limits: { rpm: number; tpm: number; windowMs?: number },
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const key = `${provider}:${model}`;
      const windowMs = limits.windowMs ?? 60_000;
      let item = state.rateLimits.find((candidate) => candidate.key === key);
      if (!item) {
        item = {
          key,
          provider,
          model,
          windowStartedAt: iso(now),
          windowMs,
          requestsConsumed: 0,
          tokensConsumed: 0,
          blockedUntil: null,
          updatedAt: iso(now),
          version: 0,
        };
        state.rateLimits.push(item);
      }
      if (item.blockedUntil && new Date(item.blockedUntil).getTime() > now)
        return { allowed: false, retryAt: item.blockedUntil, reason: "RETRY_AFTER" as const };
      if (now - new Date(item.windowStartedAt).getTime() >= item.windowMs) {
        item.windowStartedAt = iso(now);
        item.requestsConsumed = 0;
        item.tokensConsumed = 0;
        item.blockedUntil = null;
      }
      if (item.requestsConsumed + 1 > limits.rpm || item.tokensConsumed + tokens > limits.tpm) {
        const retryAt = iso(new Date(item.windowStartedAt).getTime() + item.windowMs + 1);
        return { allowed: false, retryAt, reason: "WINDOW_CAPACITY" as const };
      }
      item.requestsConsumed++;
      item.tokensConsumed += tokens;
      item.updatedAt = iso(now);
      item.version++;
      return { allowed: true, retryAt: null, version: item.version };
    });
  }

  block(provider: string, model: string, retryAfterMs: number, now = Date.now()) {
    return this.store.transaction((state) => {
      const key = `${provider}:${model}`;
      let item = state.rateLimits.find((candidate) => candidate.key === key);
      if (!item) {
        item = {
          key,
          provider,
          model,
          windowStartedAt: iso(now),
          windowMs: 60_000,
          requestsConsumed: 0,
          tokensConsumed: 0,
          blockedUntil: null,
          updatedAt: iso(now),
          version: 0,
        };
        state.rateLimits.push(item);
      }
      item.blockedUntil = iso(now + retryAfterMs);
      item.updatedAt = iso(now);
      item.version++;
      metric(state, "rate_limit_wait_ms", retryAfterMs, { provider, model }, now);
    });
  }
}
