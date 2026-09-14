import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("three-agent demo seed", () => {
  afterEach(() => {
    delete process.env["AI_OFFICE_DATA_FILE"];
    vi.resetModules();
  });

  it("creates Codex -> GPT -> Claudinho with operational configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-demo-seed-"));
    process.env["AI_OFFICE_DATA_FILE"] = path.join(root, "ai-office.json");
    const { executeLocalDatabase } = await import("../database.server");
    const result = await executeLocalDatabase({
      operation: { table: "agents", action: "select", filters: [], columns: "*" },
    });
    const agents = result.data as Array<Record<string, unknown>>;
    expect(agents.map((agent) => agent["name"]).sort()).toEqual(["Claudinho", "Codex", "GPT"]);
    const codex = agents.find((agent) => agent["slug"] === "codex")!;
    const gpt = agents.find((agent) => agent["slug"] === "gpt")!;
    const claudinho = agents.find((agent) => agent["slug"] === "claudinho")!;
    expect(gpt["manager_agent_id"]).toBe(codex["id"]);
    expect(claudinho["manager_agent_id"]).toBe(gpt["id"]);
    expect(codex["is_primary_controller"]).toBe(true);
    expect(gpt["external_config"]).toMatchObject({ mode: "chatgpt-session", apiRequired: false });
    expect(claudinho["external_config"]).toMatchObject({ mode: "free-claude", costClass: "cheap" });
  });

  it("migrates a legacy empty organization without replacing user data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-empty-migration-"));
    const file = path.join(root, "ai-office.json");
    process.env["AI_OFFICE_DATA_FILE"] = file;
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tables: {
          organizations: [
            {
              id: "existing-org",
              name: "Acme Robots",
              slug: "acme-robots",
              custom_setting: "preserve-me",
            },
          ],
          agents: [],
        },
      }),
      "utf8",
    );

    const { executeLocalDatabase } = await import("../database.server");
    const result = await executeLocalDatabase({
      operation: {
        table: "agents",
        action: "select",
        filters: [{ column: "organization_id", op: "eq", value: "existing-org" }],
        columns: "*",
      },
    });
    const agents = result.data as Array<Record<string, unknown>>;
    expect(agents.map((agent) => agent["name"]).sort()).toEqual(["Claudinho", "Codex", "GPT"]);
    const persisted = JSON.parse(await readFile(file, "utf8")) as {
      version: number;
      tables: { organizations: Array<Record<string, unknown>> };
    };
    expect(persisted.version).toBe(2);
    expect(persisted.tables.organizations[0]?.["custom_setting"]).toBe("preserve-me");
  });
});
