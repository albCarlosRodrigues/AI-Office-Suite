import { describe, expect, it } from "vitest";
import { providerBillingMode, providerUsesMonetaryBudget } from "./billing";

const base = {
  type: "custom",
  config: {},
  model: "model",
  name: "provider",
} as const;

describe("provider billing classification", () => {
  it("treats PRX ChatGPT sessions as plan quota, not token billing", () => {
    const provider = { ...base, config: { backend: "prx-localant" } };
    expect(providerBillingMode(provider as never)).toBe("PLAN_QUOTA");
    expect(providerUsesMonetaryBudget(provider as never)).toBe(false);
  });

  it("treats FreeClaude as free", () => {
    const provider = { ...base, type: "openrouter", config: { backend: "free-claude" } };
    expect(providerBillingMode(provider as never)).toBe("FREE");
    expect(providerUsesMonetaryBudget(provider as never)).toBe(false);
  });

  it("treats local Ollama as free", () => {
    expect(providerBillingMode({ ...base, type: "ollama" } as never)).toBe("FREE");
  });

  it("treats OpenRouter :free models as free", () => {
    expect(
      providerBillingMode({ ...base, type: "openrouter", model: "vendor/model:free" } as never),
    ).toBe("FREE");
  });

  it("keeps ordinary API providers metered", () => {
    expect(providerBillingMode({ ...base, type: "openai" } as never)).toBe("METERED");
    expect(providerUsesMonetaryBudget({ ...base, type: "openai" } as never)).toBe(true);
  });
});
