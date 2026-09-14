import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { localDbServer } from "@/local/database.server";
import { loadProviderSecrets, saveProviderSecrets } from "./provider-secret-service.server";

/** Save provider credentials. Secrets never reach the browser again after this. */
export const saveProviderSecret = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        providerId: z.string().uuid(),
        apiKey: z.string().max(4000).nullable().optional(),
        bearerToken: z.string().max(4000).nullable().optional(),
        secretHeaders: z.record(z.string(), z.string()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: provider, error } = await localDbServer
      .from("agent_providers")
      .select("id, organization_id")
      .eq("id", data.providerId)
      .single();
    if (error || !provider) throw new Error("Provider not found");
    await saveProviderSecrets(provider.id, provider.organization_id, {
      ...(data.apiKey !== undefined ? { api_key: data.apiKey } : {}),
      ...(data.bearerToken !== undefined ? { bearer_token: data.bearerToken } : {}),
      ...(data.secretHeaders !== undefined ? { secret_headers: data.secretHeaders } : {}),
    });
    const hasKey = Boolean(data.apiKey || data.bearerToken);
    await localDbServer
      .from("agent_providers")
      .update({ has_api_key: hasKey })
      .eq("id", provider.id);
    return { ok: true };
  });

/** Real health check against the provider endpoint. */
export const testProvider = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ providerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: row, error } = await localDbServer
      .from("agent_providers")
      .select("*")
      .eq("id", data.providerId)
      .single();
    if (error || !row) throw new Error("Provider not found");
    const { providerForHealth } = await import("./providers/resolve.server");
    let secrets: {
      api_key: string | null;
      bearer_token: string | null;
      secret_headers: Record<string, string>;
    } | null = null;
    if (row.type !== "simulation" && row.type !== "lovable_ai") {
      secrets = (await loadProviderSecrets([row.id])).get(row.id) ?? null;
    }
    const provider = providerForHealth(row, secrets, {
      lovableApiKey: process.env["LOVABLE_API_KEY"],
    });
    const result = await provider.healthCheck();
    await localDbServer
      .from("agent_providers")
      .update({ health: result.health, last_health_check_at: new Date().toISOString() })
      .eq("id", row.id);
    // external agents reflect provider health
    if (row.type === "custom") {
      const status = result.health === "CONNECTED" ? "IDLE" : "OFFLINE";
      await localDbServer
        .from("agents")
        .update({ status })
        .eq("provider_id", row.id)
        .in("status", ["IDLE", "OFFLINE"]);
    }
    return result;
  });
