import { expect, it } from "vitest";
// Explicit opt-in; credentials are resolved exclusively from the desktop SecretStore.
for (const [name, variable] of [
  ["PRX", "AI_OFFICE_PRX_PROVIDER_ID"],
  ["OpenRouter", "AI_OFFICE_OPENROUTER_PROVIDER_ID"],
]) {
  const providerId = process.env[variable!];
  it.skipIf(!providerId)(
    `${name} real smoke`,
    async () => {
      const { localDbServer } = await import("@/local/database.server");
      const { loadProviderSecrets } =
        await import("@/orchestration/provider-secret-service.server");
      const { providerForHealth } = await import("@/orchestration/providers/resolve.server");
      const { data: row } = await localDbServer
        .from("agent_providers")
        .select("*")
        .eq("id", providerId!)
        .single();
      expect(row).toBeTruthy();
      const secrets = (await loadProviderSecrets([providerId!])).get(providerId!);
      const result = await providerForHealth(row!, secrets ?? null, {}).healthCheck();
      expect(result.health, result.message).toBe("CONNECTED");
    },
    180000,
  );
}
