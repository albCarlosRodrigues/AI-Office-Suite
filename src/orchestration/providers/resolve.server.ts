import type { Agent, AgentProvider as ProviderRow, Organization } from "@/types/domain";
import type { AgentProvider } from "./types";
import { SimulationProvider } from "./SimulationProvider";
import { OpenAiCompatProvider } from "./OpenAiCompatProvider.server";
import { ExternalAgentProvider } from "./ExternalAgentProvider.server";
import { UnavailableProvider } from "./UnavailableProvider.server";

export interface ProviderSecrets {
  api_key: string | null;
  bearer_token: string | null;
  secret_headers: Record<string, string>;
}

const BASE_URLS: Record<string, string> = {
  lovable_ai: "https://ai.gateway.lovable.dev/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
};

const simulation = new SimulationProvider();

/**
 * Resolves the provider instance for an agent.
 * - Organization in simulation mode → always SimulationProvider (no network).
 * - Otherwise by provider row type. Missing credentials surface as real errors.
 */
export function resolveProvider(
  agent: Agent,
  org: Organization,
  row: ProviderRow | null,
  secrets: ProviderSecrets | null,
  env: { lovableApiKey?: string | undefined },
): AgentProvider {
  if (org.simulation_mode) return simulation;
  if (!row) return new UnavailableProvider("custom", "External provider is not connected.");
  if (!row.is_enabled) return new UnavailableProvider(row.type, "Provider is disabled.");
  if (row.type === "simulation")
    return new UnavailableProvider(
      row.type,
      "Simulation provider cannot execute while Simulation Mode is off.",
    );
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const headers = {
    ...((row.headers ?? {}) as Record<string, string>),
    ...(secrets?.secret_headers ?? {}),
  };
  if (row.type === "custom" || agent.kind === "external") {
    return new ExternalAgentProvider({
      baseUrl: row.base_url,
      bearerToken: secrets?.bearer_token ?? secrets?.api_key ?? null,
      headers,
      healthEndpoint:
        typeof cfg["health_endpoint"] === "string" ? (cfg["health_endpoint"] as string) : "/health",
      timeoutMs: row.timeout_ms,
    });
  }
  const isLovable = row.type === "lovable_ai";
  const apiKey = isLovable ? (env.lovableApiKey ?? null) : (secrets?.api_key ?? null);
  const model = agent.model || row.model || (isLovable ? "google/gemini-3.8-flash" : "gpt-4o-mini");
  return new OpenAiCompatProvider({
    type: row.type,
    baseUrl: row.base_url || BASE_URLS[row.type] || BASE_URLS["openai"]!,
    apiKey,
    model,
    temperature: Number(row.temperature),
    maxTokens: row.max_tokens,
    timeoutMs: row.timeout_ms,
    headers: isLovable ? { ...headers, "X-Lovable-AIG-SDK": "fetch" } : headers,
    ...(isLovable ? { authHeaderName: "Lovable-API-Key" } : {}),
  });
}

export function providerForHealth(
  row: ProviderRow,
  secrets: ProviderSecrets | null,
  env: { lovableApiKey?: string | undefined },
): AgentProvider {
  const fakeAgent = { kind: row.type === "custom" ? "external" : "llm", model: row.model } as Agent;
  const fakeOrg = { simulation_mode: false } as Organization;
  return resolveProvider(fakeAgent, fakeOrg, row, secrets, env);
}
