import { describe, expect, it } from "vitest";
import { BudgetService, CircuitBreaker, ModelRouter } from "../model-routing";

describe("cost-aware routing", () => {
  it("selects the cheapest capable tier", () => {
    const candidates = [
      {
        provider: "p",
        model: "strong",
        tier: "TIER_4" as const,
        capabilities: ["code"],
        contextWindow: 1,
        available: true,
        estimatedLatencyMs: 1,
      },
      {
        provider: "p",
        model: "cheap",
        tier: "TIER_1" as const,
        capabilities: ["code"],
        contextWindow: 1,
        available: true,
        estimatedLatencyMs: 2,
      },
    ];
    expect(new ModelRouter().select(candidates, ["code"], "TIER_4")?.model).toBe("cheap");
  });
  it("prevents overspending before execution", () => {
    const budget = new BudgetService(1);
    expect(budget.reserve(0.8)).toBe(true);
    expect(budget.reserve(0.3)).toBe(false);
  });
  it("opens and half-opens a circuit", () => {
    const breaker = new CircuitBreaker(2, 100);
    breaker.failure(1000);
    breaker.failure(1000);
    expect(breaker.state(1050)).toBe("OPEN");
    expect(breaker.state(1100)).toBe("HALF_OPEN");
  });
});
