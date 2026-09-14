import type { ModelTier } from "./contracts";

export interface ModelCandidate {
  provider: string;
  model: string;
  tier: ModelTier;
  capabilities: string[];
  contextWindow: number;
  available: boolean;
  estimatedLatencyMs: number;
}
export interface Price {
  provider: string;
  model: string;
  effectiveFrom: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  reasoningPerMillion: number;
}

export class PricingRegistry {
  constructor(private readonly prices: readonly Price[]) {}
  resolve(provider: string, model: string, at = new Date()): Price | undefined {
    return this.prices
      .filter(
        (p) => p.provider === provider && p.model === model && new Date(p.effectiveFrom) <= at,
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  }
  worstCase(price: Price, inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000
    );
  }
}
const tierOrder: Record<ModelTier, number> = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
  TIER_4: 4,
};
export class ModelRouter {
  select(
    candidates: readonly ModelCandidate[],
    requiredCapabilities: readonly string[],
    maxTier: ModelTier,
  ): ModelCandidate | undefined {
    return candidates
      .filter(
        (c) =>
          c.available &&
          tierOrder[c.tier] <= tierOrder[maxTier] &&
          requiredCapabilities.every((cap) => c.capabilities.includes(cap)),
      )
      .sort(
        (a, b) =>
          tierOrder[a.tier] - tierOrder[b.tier] || a.estimatedLatencyMs - b.estimatedLatencyMs,
      )[0];
  }
}
export class BudgetService {
  private reserved = 0;
  constructor(
    private readonly limit: number,
    private spent = 0,
  ) {}
  reserve(cost: number): boolean {
    if (cost < 0 || this.spent + this.reserved + cost > this.limit) return false;
    this.reserved += cost;
    return true;
  }
  settle(reserved: number, actual: number) {
    this.reserved = Math.max(0, this.reserved - reserved);
    this.spent += actual;
  }
  remaining() {
    return Math.max(0, this.limit - this.spent - this.reserved);
  }
}
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
  ) {}
  state(now = Date.now()): CircuitState {
    if (!this.openedAt) return "CLOSED";
    return now - this.openedAt >= this.cooldownMs ? "HALF_OPEN" : "OPEN";
  }
  canRequest(now = Date.now()) {
    return this.state(now) !== "OPEN";
  }
  success() {
    this.failures = 0;
    this.openedAt = 0;
  }
  failure(now = Date.now()) {
    if (++this.failures >= this.threshold) this.openedAt = now;
  }
}
