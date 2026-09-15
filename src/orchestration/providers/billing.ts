import type { AgentProvider } from "@/types/domain";

export type ProviderBillingMode = "FREE" | "PLAN_QUOTA" | "METERED";

type BillingProvider = Pick<AgentProvider, "type" | "config" | "model" | "name">;

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function providerBillingMode(
  provider: BillingProvider | null | undefined,
): ProviderBillingMode {
  if (!provider) return "METERED";

  const config = (provider.config ?? {}) as Record<string, unknown>;
  const explicit = normalized(config["billingMode"] ?? config["billing_mode"]);
  const backend = normalized(config["backend"]);
  const costClass = normalized(config["costClass"] ?? config["cost_class"]);
  const model = normalized(provider.model);
  const name = normalized(provider.name);

  if (["free", "zero", "local"].includes(explicit)) return "FREE";
  if (["plan_quota", "plan", "quota", "subscription", "weekly", "time"].includes(explicit))
    return "PLAN_QUOTA";
  if (["metered", "paid", "token"].includes(explicit)) return "METERED";

  if (provider.type === "simulation" || provider.type === "ollama") return "FREE";

  // ChatGPT/Codex authenticated sessions consume plan/time quota, not API token billing.
  if (backend === "prx-localant" || backend === "codex-chatgpt") return "PLAN_QUOTA";

  // This backend is intentionally the free worker route used by Claudinho.
  if (backend === "free-claude") return "FREE";

  if (["free", "zero", "local"].includes(costClass)) return "FREE";
  if (["plan", "quota", "subscription", "weekly", "time"].includes(costClass))
    return "PLAN_QUOTA";

  // OpenRouter convention for explicitly free model variants.
  if (provider.type === "openrouter" && (model.endsWith(":free") || /\bfree\b/.test(name)))
    return "FREE";

  return "METERED";
}

export function providerUsesMonetaryBudget(
  provider: BillingProvider | null | undefined,
) {
  return providerBillingMode(provider) === "METERED";
}
