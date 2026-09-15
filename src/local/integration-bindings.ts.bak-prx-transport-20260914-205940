type Row = Record<string, unknown>;
/** Bind existing Acme records once. Never changes permissions, layout, secrets or simulation. */
export function bindAcmeIntegrations(
  tables: Record<string, Row[]>,
  createId = () => crypto.randomUUID(),
) {
  let changed = false;
  for (const org of tables["organizations"] ?? []) {
    if (String(org["name"]).toLowerCase() !== "acme robots") continue;
    const agents = (tables["agents"] ?? []).filter((a) => a["organization_id"] === org["id"]);
    const leader =
      agents.find((a) => a["slug"] === "codex") ?? agents.find((a) => a["is_primary_controller"]);
    const manager =
      agents.find((a) => /^(gpt|gpt manager|manager)$/i.test(String(a["name"]))) ??
      agents.find((a) => /manager/i.test(String(a["role"])) && a !== leader);
    const worker = agents.find((a) => /^claudinho$/i.test(String(a["name"])));
    if (!leader || !manager || !worker || new Set([leader, manager, worker]).size !== 3) continue;
    const bind = (
      agent: Row,
      backend: string,
      parent: Row,
      type: string,
      baseUrl: string,
      model: string | null,
    ) => {
      const config = (agent["external_config"] ?? {}) as Row;
      if (config["integrationVersion"] === 1) return;
      const providers = (tables["agent_providers"] ??= []);
      let provider = providers.find(
        (p) => p["organization_id"] === org["id"] && (p["config"] as Row)?.["backend"] === backend,
      );
      if (!provider) {
        provider = {
          id: createId(),
          organization_id: org["id"],
          name:
            backend === "prx-localant"
              ? "GPT — PRX + LocalAnt"
              : "Claudinho — FreeClaude / OpenRouter",
          type,
          base_url: baseUrl,
          model,
          config: { backend },
          headers: {},
          is_enabled: true,
          health: "UNCONFIGURED",
          has_api_key: false,
          temperature: 0.2,
          max_tokens: 4096,
          timeout_ms: 120000,
          last_health_check_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        providers.push(provider);
      }
      agent["provider_id"] = provider["id"];
      const toolRows = (tables["agent_tools"] ??= []);
      for (const toolId of Array.isArray(agent["allowed_tools"]) ? agent["allowed_tools"] : []) {
        if (!toolRows.some((t) => t["agent_id"] === agent["id"] && t["tool_id"] === toolId))
          toolRows.push({
            id: createId(),
            organization_id: org["id"],
            agent_id: agent["id"],
            tool_id: toolId,
            enabled: true,
            config: {},
          });
      }
      agent["manager_agent_id"] = parent["id"];
      agent["model"] = model;
      agent["external_config"] = { ...config, backend, integrationVersion: 1 };
      agent["role"] =
        backend === "prx-localant" ? "Manager / Supervisor / Reviewer" : "Worker / Executor";
      changed = true;
    };
    bind(manager, "prx-localant", leader, "custom", "http://127.0.0.1:9223", "chatgpt-session");
    bind(worker, "free-claude", manager, "openrouter", "https://openrouter.ai/api/v1", null);
  }
  return changed;
}
