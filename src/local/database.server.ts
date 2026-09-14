import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { bindAcmeIntegrations } from "./integration-bindings";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLocalClient } from "./client";
import type {
  LocalDatabaseOperation,
  LocalDatabaseResult,
  LocalFilter,
  LocalRpcOperation,
} from "./database.shared";

export const LOCAL_OPERATOR_ID = "00000000-0000-4000-8000-000000000001";
const TABLES = [
  "organizations",
  "organization_settings",
  "organization_members",
  "profiles",
  "departments",
  "office_maps",
  "office_zones",
  "workstations",
  "agent_providers",
  "provider_secrets",
  "agents",
  "agent_permissions",
  "agent_tools",
  "agent_memories",
  "missions",
  "mission_agents",
  "mission_events",
  "tasks",
  "commands",
  "command_results",
  "agent_messages",
  "agent_runs",
  "approval_requests",
  "mission_permissions",
  "tool_calls",
  "cost_records",
  "meetings",
  "meeting_participants",
  "meeting_messages",
  "audit_logs",
] as const;

type Row = Record<string, unknown>;
type Store = { version: 2; tables: Record<string, Row[]> };
const dataFile =
  process.env["AI_OFFICE_DATA_FILE"] ?? path.join(process.cwd(), "data", "ai-office.json");
let queue = Promise.resolve();

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function emptyStore(): Store {
  return { version: 2, tables: Object.fromEntries(TABLES.map((table) => [table, []])) };
}

async function loadStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(dataFile, "utf8")) as Store;
    if (!parsed.tables || typeof parsed.tables !== "object") parsed.tables = {};
    for (const table of TABLES) {
      if (!Array.isArray(parsed.tables[table])) parsed.tables[table] = [];
    }

    for (const map of parsed.tables["office_maps"] ?? []) {
      const layers = map["layers"];
      map["layers"] = layers && typeof layers === "object" && !Array.isArray(layers) ? layers : {};
      const normalizedLayers = map["layers"] as Row;
      if (!Array.isArray(normalizedLayers["furniture"])) normalizedLayers["furniture"] = [];
    }
    for (const zone of parsed.tables["office_zones"] ?? []) {
      const properties = zone["properties"];
      zone["properties"] =
        properties && typeof properties === "object" && !Array.isArray(properties)
          ? properties
          : {};
    }
    const arrayFields: Record<string, string[]> = {
      organization_settings: ["policies", "require_approval_for"],
      agents: ["capabilities", "allowed_tools"],
      missions: ["allowed_agent_ids"],
      tasks: ["depends_on", "evidence"],
      commands: ["constraints", "allowed_tools", "forbidden_actions"],
      approval_requests: ["required_permissions"],
      meetings: ["agenda", "decisions"],
    };
    const objectFields: Record<string, string[]> = {
      agents: ["external_config"],
      commands: ["context"],
      approval_requests: ["requested_action"],
      workstations: ["properties"],
      agent_tools: ["config"],
    };
    for (const [table, fields] of Object.entries(arrayFields)) {
      for (const row of parsed.tables[table] ?? [])
        for (const field of fields) if (!Array.isArray(row[field])) row[field] = [];
    }
    for (const [table, fields] of Object.entries(objectFields)) {
      for (const row of parsed.tables[table] ?? [])
        for (const field of fields) {
          const value = row[field];
          if (!value || typeof value !== "object" || Array.isArray(value)) row[field] = {};
        }
    }
    for (const [index, agent] of (parsed.tables["agents"] ?? []).entries()) {
      const modernCharacters = ["modern-adam", "modern-alex", "modern-amelia", "modern-bob"];
      const currentSprite = agent["character_sprite_id"];
      if (
        typeof currentSprite !== "string" ||
        currentSprite.startsWith("visual-") ||
        currentSprite.startsWith("placeholder:")
      )
        agent["character_sprite_id"] = modernCharacters[index % modernCharacters.length];
      agent["max_cost"] ??= 2;
      agent["max_iterations"] ??= 10;
      agent["context_limit"] ??= 32000;
      agent["memory_enabled"] ??= true;
    }
    let migrated = bindAcmeIntegrations(parsed.tables);
    const shouldSeedEmptyLegacyOrganizations = Number(parsed.version ?? 1) < 2;
    if (shouldSeedEmptyLegacyOrganizations) {
      parsed.version = 2;
      migrated = true;
    }
    for (const organization of parsed.tables["organizations"] ?? []) {
      organization["asset_mode"] = "ai-office-default";
      const organizationId = organization["id"] as string;
      const hasAgents = (parsed.tables["agents"] ?? []).some(
        (agent) => agent["organization_id"] === organizationId,
      );
      if (shouldSeedEmptyLegacyOrganizations && !hasAgents) {
        seedDefaultAgents(parsed, organizationId);
        parsed.tables["audit_logs"]!.push(
          defaults("audit_logs", {
            organization_id: organizationId,
            action: "agents.default_seeded",
            output_summary: "Codex -> GPT -> Claudinho",
          }),
        );
        migrated = true;
      }
    }
    for (const permission of parsed.tables["agent_permissions"] ?? []) {
      permission["granted"] ??= true;
      permission["always_allow"] ??= false;
    }
    for (const tool of parsed.tables["agent_tools"] ?? []) tool["enabled"] ??= true;
    for (const mission of parsed.tables["missions"] ?? []) {
      mission["total_cost"] ??= Number(mission["spent"] ?? 0);
      mission["total_tokens_in"] ??= 0;
      mission["total_tokens_out"] ??= 0;
      mission["error"] ??= mission["error_message"] ?? null;
      mission["report"] ??= mission["final_report"] ?? null;
      mission["result"] ??= null;
    }
    for (const task of parsed.tables["tasks"] ?? []) {
      task["cost"] ??= 0;
      task["tokens_in"] ??= 0;
      task["tokens_out"] ??= 0;
      task["retries"] ??= Number(task["attempt_count"] ?? 0);
      task["max_retries"] ??= Number(task["max_attempts"] ?? 2);
      task["result"] ??= task["output"] ?? null;
    }
    if (migrated) await saveStore(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const store = emptyStore();
    seedOrganization(store, "Pixel Labs", true);
    await saveStore(store);
    return store;
  }
}

async function saveStore(store: Store) {
  await mkdir(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, dataFile);
}

function defaults(table: string, input: Row): Row {
  const timestamp = now();
  const common = { id: id(), created_at: timestamp, updated_at: timestamp };
  const byTable: Record<string, Row> = {
    organizations: {
      ...common,
      owner_id: LOCAL_OPERATOR_ID,
      simulation_mode: true,
      kill_switch_active: false,
      asset_mode: "modern-office-revamped",
      currency: "USD",
    },
    organization_settings: {
      ...common,
      max_steps: 60,
      max_mission_cost: 5,
      max_concurrent_missions: 3,
      default_timeout_seconds: 120,
      policies: [],
      require_approval_for: ["deploy.production", "email.send"],
    },
    departments: { ...common, description: null, manager_agent_id: null, sort_order: 0 },
    office_maps: { ...common, width: 44, height: 30, tile_size: 16, layers: {}, is_default: true },
    office_zones: { ...common, department_id: null, properties: {} },
    workstations: {
      ...common,
      assigned_agent_id: null,
      status: "available",
      desk_kind: "desk",
      metadata: {},
    },
    agent_providers: {
      ...common,
      model: "simulated-llm",
      health: "CONNECTED",
      has_api_key: false,
      timeout_ms: 120000,
      config: {},
      is_enabled: true,
      last_health_check_at: null,
    },
    agents: {
      ...common,
      manager_agent_id: null,
      workstation_id: null,
      provider_id: null,
      status: "IDLE",
      kind: "llm",
      model: "simulated-llm",
      autonomy_level: 1,
      require_approval: false,
      is_primary_controller: false,
      is_suspended: false,
      capabilities: [],
      allowed_tools: [],
      external_config: {},
      max_concurrent_tasks: 1,
      current_task_id: null,
      system_prompt: "",
      description: "",
      character_sprite_id: null,
      max_cost: 2,
      max_iterations: 10,
      context_limit: 32000,
      memory_enabled: true,
    },
    missions: {
      ...common,
      status: "DRAFT",
      phase: "draft",
      budget: 5,
      spent: 0,
      total_cost: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      max_steps: 60,
      current_step: 0,
      stop_requested: false,
      is_simulated: true,
      execution_mode: "SIMULATION",
      allowed_agent_ids: [],
      approval_policy: "policy",
      summary: null,
      final_report: null,
      report: null,
      result: null,
      error: null,
      error_message: null,
      started_at: null,
      completed_at: null,
      step_lock_id: null,
      step_locked_until: null,
    },
    tasks: {
      ...common,
      status: "queued",
      description: "",
      priority: 0,
      order_index: 0,
      depends_on: [],
      assigned_agent_id: null,
      parent_task_id: null,
      output: null,
      result: null,
      evidence: [],
      attempt_count: 0,
      max_attempts: 2,
      retries: 0,
      max_retries: 2,
      cost: 0,
      tokens_in: 0,
      tokens_out: 0,
      claimed_at: null,
      claimed_by_run_id: null,
      started_at: null,
      completed_at: null,
    },
    commands: {
      ...common,
      status: "PENDING",
      parent_command_id: null,
      execution_mode: "SIMULATION",
      required_permissions: [],
      timeout_seconds: 120,
      max_iterations: 1,
      max_cost: 1,
      retry_count: 0,
      idempotency_key: id(),
      error_message: null,
      sent_at: null,
      completed_at: null,
    },
    approval_requests: {
      ...common,
      status: "PENDING",
      approval_scope: "ONCE",
      decided_at: null,
      decided_by: null,
      decision_note: null,
      requested_permissions: [],
      context: {},
      risk_level: "MEDIUM",
    },
    meetings: {
      ...common,
      status: "scheduled",
      current_round: 0,
      max_rounds: 1,
      summary: null,
      decisions: [],
      started_at: null,
      ended_at: null,
    },
    agent_runs: {
      ...common,
      status: "RUNNING",
      execution_mode: "SIMULATION",
      idempotency_key: id(),
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      latency_ms: 0,
      error_message: null,
      started_at: timestamp,
      completed_at: null,
    },
    cost_records: {
      ...common,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      currency: "USD",
      metadata: {},
    },
    audit_logs: {
      ...common,
      actor_user_id: LOCAL_OPERATOR_ID,
      actor_agent_id: null,
      input_summary: null,
      output_summary: null,
      risk_level: "LOW",
      metadata: {},
    },
    mission_events: { ...common, actor_agent_id: null, task_id: null, payload: {} },
    agent_permissions: { ...common, granted_by: LOCAL_OPERATOR_ID },
    mission_permissions: { ...common, granted_by: LOCAL_OPERATOR_ID },
    tool_calls: {
      ...common,
      status: "PENDING",
      execution_mode: "SIMULATION",
      idempotency_key: id(),
      arguments: {},
      result: null,
      error_message: null,
      started_at: timestamp,
      completed_at: null,
    },
  };
  return { ...(byTable[table] ?? common), ...input };
}

function seedOrganization(store: Store, name: string, withAgents: boolean): string {
  const orgId = id();
  const timestamp = now();
  const slug = `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "office"
  }-${orgId.slice(0, 6)}`;
  store.tables["organizations"]!.push(defaults("organizations", { id: orgId, name, slug }));
  store.tables["organization_settings"]!.push(
    defaults("organization_settings", {
      organization_id: orgId,
      policies: [
        { id: "prod-deploy", rule: "Production deployment requires approval", enforced: true },
        { id: "no-repo-delete", rule: "Agents cannot delete repositories", enforced: true },
        { id: "external-comm", rule: "External communication requires approval", enforced: true },
      ],
    }),
  );
  store.tables["profiles"]!.push({
    id: LOCAL_OPERATOR_ID,
    email: "local@ai-office",
    display_name: "Operador local",
    created_at: timestamp,
    updated_at: timestamp,
  });
  store.tables["organization_members"]!.push(
    defaults("organization_members", {
      organization_id: orgId,
      user_id: LOCAL_OPERATOR_ID,
      role: "owner",
    }),
  );

  const departmentSpecs = [
    ["Executive", "executive", "#e0b35a"],
    ["Engineering", "engineering", "#5aa9e0"],
    ["Research", "research", "#a07ce0"],
    ["QA", "qa", "#5ad1a6"],
    ["Design", "design", "#e07ca8"],
    ["Product", "product", "#e08c5a"],
    ["Security", "security", "#d95a5a"],
    ["Operations", "operations", "#8a9bb0"],
  ];
  const departments = departmentSpecs.map(([departmentName, departmentSlug, color], index) =>
    defaults("departments", {
      organization_id: orgId,
      name: departmentName,
      slug: departmentSlug,
      color,
      sort_order: index,
    }),
  );
  store.tables["departments"]!.push(...departments);
  const departmentId = (slugValue: string) =>
    departments.find((row) => row["slug"] === slugValue)!["id"] as string;

  const mapId = id();
  store.tables["office_maps"]!.push(
    defaults("office_maps", {
      id: mapId,
      organization_id: orgId,
      name: `${name} HQ`,
      layers: {
        furniture: [
          { kind: "plant", x: 2, y: 3 },
          { kind: "whiteboard", x: 18, y: 3 },
          { kind: "meeting_table", x: 34, y: 5 },
          { kind: "server_rack", x: 31, y: 14 },
        ],
      },
    }),
  );
  const zoneSpecs: Array<[string, string, number, number, number, number, string | null]> = [
    ["Executive Office", "executive_office", 1, 1, 10, 8, "executive"],
    ["Engineering", "engineering", 12, 1, 16, 12, "engineering"],
    ["QA", "qa", 12, 14, 8, 8, "qa"],
    ["Research", "research", 21, 14, 7, 8, "research"],
    ["Meeting Room", "meeting_room", 29, 1, 14, 9, null],
    ["Product", "product", 29, 19, 14, 10, "product"],
    ["Break Room", "break_room", 1, 19, 10, 10, null],
  ];
  const zones = zoneSpecs.map(([zoneName, kind, x, y, width, height, department]) =>
    defaults("office_zones", {
      organization_id: orgId,
      office_map_id: mapId,
      department_id: department ? departmentId(department) : null,
      name: zoneName,
      kind,
      x,
      y,
      width,
      height,
      color: department
        ? departments.find((row) => row["slug"] === department)!["color"]
        : "#8a9bb0",
      properties: { floor: "tile", wall: "grey", door: { x, y: y + Math.floor(height / 2) } },
    }),
  );
  store.tables["office_zones"]!.push(...zones);
  const simulationProvider = defaults("agent_providers", {
    organization_id: orgId,
    name: "Local Simulation",
    type: "simulation",
    config: { note: "Runs entirely on this computer." },
  });
  store.tables["agent_providers"]!.push(simulationProvider);

  if (withAgents) seedDefaultAgents(store, orgId);
  store.tables["audit_logs"]!.push(
    defaults("audit_logs", {
      organization_id: orgId,
      action: "organization.created",
      output_summary: name,
    }),
  );
  return orgId;
}

function seedDefaultAgents(store: Store, orgId: string): void {
  const organizationDepartments = store.tables["departments"]!.filter(
    (row) => row["organization_id"] === orgId,
  );
  const ensureDepartment = (name: string, slug: string, color: string) => {
    const existing = organizationDepartments.find((row) => row["slug"] === slug);
    if (existing) return existing;
    const department = defaults("departments", {
      organization_id: orgId,
      name,
      slug,
      color,
      sort_order: organizationDepartments.length,
    });
    organizationDepartments.push(department);
    store.tables["departments"]!.push(department);
    return department;
  };
  const executive = ensureDepartment("Executive", "executive", "#e0b35a");
  const engineering = ensureDepartment("Engineering", "engineering", "#5aa9e0");
  const departmentBySlug = (slug: string) =>
    (slug === "engineering" ? engineering : executive)["id"] as string;

  let officeMap = store.tables["office_maps"]!.find(
    (row) => row["organization_id"] === orgId && row["is_default"] === true,
  );
  officeMap ??= store.tables["office_maps"]!.find((row) => row["organization_id"] === orgId);
  if (!officeMap) {
    officeMap = defaults("office_maps", {
      organization_id: orgId,
      name: "AI Office HQ",
      layers: { furniture: [] },
    });
    store.tables["office_maps"]!.push(officeMap);
  }

  const organizationZones = store.tables["office_zones"]!.filter(
    (row) => row["organization_id"] === orgId && row["office_map_id"] === officeMap!["id"],
  );
  const ensureZone = (name: string, kind: string, departmentId: string, x: number, y: number) => {
    const existing = organizationZones.find((row) => row["department_id"] === departmentId);
    if (existing) return existing;
    const zone = defaults("office_zones", {
      organization_id: orgId,
      office_map_id: officeMap!["id"],
      department_id: departmentId,
      name,
      kind,
      x,
      y,
      width: 10,
      height: 8,
      color: kind === "engineering" ? "#5aa9e0" : "#e0b35a",
      properties: { floor: "tile", wall: "grey", door: { x, y: y + 4 } },
    });
    organizationZones.push(zone);
    store.tables["office_zones"]!.push(zone);
    return zone;
  };
  ensureZone("Executive Office", "executive_office", executive["id"] as string, 1, 1);
  ensureZone("Engineering", "engineering", engineering["id"] as string, 12, 1);

  let simulationProvider = store.tables["agent_providers"]!.find(
    (row) => row["organization_id"] === orgId && row["type"] === "simulation",
  );
  if (!simulationProvider) {
    simulationProvider = defaults("agent_providers", {
      organization_id: orgId,
      name: "Local Simulation",
      type: "simulation",
      config: { note: "Runs entirely on this computer." },
    });
    store.tables["agent_providers"]!.push(simulationProvider);
  }

  const agentSpecs = [
    {
      name: "Codex",
      slug: "codex",
      role: "Leader / CEO / Orchestrator",
      department: "executive",
      manager: null,
      kind: "controller",
      autonomy: 4,
      color: "#e0b35a",
      model: "codex-leader",
      primary: true,
      description: "Líder global: cria missões, decide, delega e aceita o resultado consolidado.",
      capabilities: ["delegate_tasks", "approve_tasks", "manage_agents", "final_review"],
      allowedTools: ["repository_read"],
      externalConfig: { mode: "orchestrator", role: "leader" },
    },
    {
      name: "GPT",
      slug: "gpt",
      role: "Manager",
      department: "executive",
      manager: "codex",
      kind: "llm",
      autonomy: 3,
      color: "#5aa9e0",
      model: "chatgpt-session",
      primary: false,
      description: "Gerente inspirado no LocalAnt: decompõe, supervisiona, revisa e consolida.",
      capabilities: ["delegate_tasks", "approve_tasks", "code_analysis", "review"],
      allowedTools: ["repository_read", "testing"],
      externalConfig: { mode: "chatgpt-session", protocol: "mcp-style", apiRequired: false },
    },
    {
      name: "Claudinho",
      slug: "claudinho",
      role: "Worker / Executor",
      department: "engineering",
      manager: "gpt",
      kind: "external",
      autonomy: 1,
      color: "#f2b544",
      model: "free-claude-worker",
      primary: false,
      description: "Executor operacional econômico inspirado no free-claude.",
      capabilities: ["repository_read", "repository_write", "shell", "testing"],
      allowedTools: ["repository_read", "repository_write", "shell", "testing"],
      externalConfig: { mode: "free-claude", protocol: "command", costClass: "cheap" },
    },
  ];
  const modernCharacters = ["modern-adam", "modern-alex", "modern-amelia", "modern-bob"];
  const agents = agentSpecs.map((spec, index) =>
    defaults("agents", {
      organization_id: orgId,
      department_id: departmentBySlug(spec.department),
      provider_id: simulationProvider["id"],
      name: spec.name,
      slug: spec.slug,
      role: spec.role,
      kind: spec.kind,
      model: spec.model,
      autonomy_level: spec.autonomy,
      color: spec.color,
      character_sprite_id: modernCharacters[index % modernCharacters.length],
      capabilities: spec.capabilities,
      allowed_tools: spec.allowedTools,
      external_config: spec.externalConfig,
      is_primary_controller: spec.primary,
      description: spec.description,
      system_prompt: `You are ${spec.name}, ${spec.role}.`,
    }),
  );
  for (let index = 0; index < agents.length; index++) {
    const spec = agentSpecs[index]!;
    const agent = agents[index]!;
    agent["manager_agent_id"] = spec.manager
      ? agents.find((row) => row["slug"] === spec.manager)!["id"]
      : null;
    const zone =
      organizationZones.find((row) => row["department_id"] === agent["department_id"]) ??
      organizationZones[0]!;
    const workstation = defaults("workstations", {
      organization_id: orgId,
      office_map_id: officeMap["id"],
      zone_id: zone["id"],
      department_id: agent["department_id"],
      assigned_agent_id: agent["id"],
      status: "occupied",
      name: `${spec.name} Desk`,
      x: (zone["x"] as number) + 2 + (index % 3) * 3,
      y: (zone["y"] as number) + 3,
      seat_x: (zone["x"] as number) + 2 + (index % 3) * 3,
      seat_y: (zone["y"] as number) + 5,
    });
    agent["workstation_id"] = workstation["id"];
    store.tables["workstations"]!.push(workstation);
  }
  store.tables["agents"]!.push(...agents);
  const permissions: Record<string, string[]> = {
    codex: ["delegate_tasks", "approve_tasks", "manage_agents", "repository.read"],
    gpt: ["delegate_tasks", "approve_tasks", "repository.read", "tests.execute"],
    claudinho: ["repository.read", "repository.write", "shell.execute", "tests.execute"],
  };
  for (const agent of agents)
    for (const permission of permissions[agent["slug"] as string] ?? [])
      store.tables["agent_permissions"]!.push(
        defaults("agent_permissions", {
          organization_id: orgId,
          agent_id: agent["id"],
          permission,
        }),
      );
}

function matches(row: Row, filter: LocalFilter): boolean {
  const current = row[filter.column];
  switch (filter.op) {
    case "eq":
      return current === filter.value;
    case "neq":
      return current !== filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(current);
    case "is":
      return current === filter.value;
    case "lt":
      return current != null && current < filter.value!;
    case "lte":
      return current != null && current <= filter.value!;
    case "gt":
      return current != null && current > filter.value!;
    case "gte":
      return current != null && current >= filter.value!;
  }
}

function project(row: Row, columns = "*"): Row {
  if (columns.trim() === "*") return structuredClone(row);
  const names = columns
    .split(",")
    .map((column) => column.trim().split(/\s+/)[0]!)
    .filter(Boolean);
  return Object.fromEntries(names.map((column) => [column, row[column]]));
}

async function executeOperation(
  store: Store,
  operation: LocalDatabaseOperation,
): Promise<{ result: LocalDatabaseResult; changed: boolean }> {
  const table = store.tables[operation.table];
  if (!table)
    return {
      result: { data: null, error: { message: `Unknown local table: ${operation.table}` } },
      changed: false,
    };
  const filteredIndexes = table
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => operation.filters.every((filter) => matches(row, filter)));
  let rows: Row[] = [];
  let changed = false;
  if (operation.action === "select") rows = filteredIndexes.map(({ row }) => row);
  if (operation.action === "insert") {
    rows = (Array.isArray(operation.values) ? operation.values : [operation.values]).map((value) =>
      defaults(operation.table, value as Row),
    );
    table.push(...rows);
    changed = true;
  }
  if (operation.action === "update") {
    const patch = operation.values as Row;
    rows = filteredIndexes.map(({ row }) => Object.assign(row, patch, { updated_at: now() }));
    changed = rows.length > 0;
  }
  if (operation.action === "delete") {
    const indexes = new Set(filteredIndexes.map(({ index }) => index));
    rows = filteredIndexes.map(({ row }) => row);
    store.tables[operation.table] = table.filter((_row, index) => !indexes.has(index));
    changed = rows.length > 0;
  }
  if (operation.action === "upsert") {
    const conflictColumns = (operation.onConflict || "id")
      .split(",")
      .map((column) => column.trim());
    rows = (Array.isArray(operation.values) ? operation.values : [operation.values]).map(
      (value) => {
        const input = value as Row;
        const existing = table.find((row) =>
          conflictColumns.every((column) => row[column] === input[column]),
        );
        return existing
          ? Object.assign(existing, input, { updated_at: now() })
          : (table.push(defaults(operation.table, input)), table.at(-1)!);
      },
    );
    changed = true;
  }
  if (operation.order) {
    const { column, ascending } = operation.order;
    rows.sort(
      (a, b) =>
        String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * (ascending ? 1 : -1),
    );
  }
  if (operation.limit != null) rows = rows.slice(0, operation.limit);
  const projected = rows.map((row) => project(row, operation.columns));
  if (operation.cardinality === "single" && projected.length !== 1)
    return {
      result: {
        data: null,
        error: { message: `Expected one row, found ${projected.length}`, code: "PGRST116" },
      },
      changed,
    };
  if (operation.cardinality)
    return { result: { data: projected[0] ?? null, error: null }, changed };
  return {
    result: {
      data: operation.action === "select" || operation.returning ? projected : null,
      error: null,
    },
    changed,
  };
}

async function executeRpc(
  store: Store,
  rpc: LocalRpcOperation,
): Promise<{ result: LocalDatabaseResult; changed: boolean }> {
  const args = rpc.args ?? {};
  if (rpc.name === "create_organization")
    return {
      result: {
        data: seedOrganization(
          store,
          String(args["p_name"] ?? "Local Office"),
          args["p_seed_demo"] !== false,
        ),
        error: null,
      },
      changed: true,
    };
  if (rpc.name === "has_org_role") return { result: { data: true, error: null }, changed: false };
  if (rpc.name === "claim_mission_step") {
    const mission = store.tables["missions"]!.find((row) => row["id"] === args["p_mission_id"]);
    if (!mission) return { result: { data: null, error: null }, changed: false };
    if (Number(mission["current_step"] ?? 0) >= Number(mission["max_steps"] ?? 0))
      return { result: { data: null, error: null }, changed: false };
    const expires = String(mission["step_locked_until"] ?? "");
    if (mission["step_lock_id"] && expires > now())
      return { result: { data: null, error: null }, changed: false };
    const leaseId = String(args["p_worker_id"]);
    const leaseVersion = Number(mission["lease_version"] ?? 0) + 1;
    const leaseSeconds = Math.max(30, Math.min(Number(args["p_lease_seconds"] ?? 180), 600));
    mission["current_step"] = Number(mission["current_step"] ?? 0) + 1;
    mission["lease_version"] = leaseVersion;
    mission["step_lock_id"] = leaseId;
    mission["step_locked_until"] = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    return {
      result: {
        data: {
          mission: structuredClone(mission),
          leaseId,
          leaseVersion,
          expiresAt: mission["step_locked_until"],
        },
        error: null,
      },
      changed: true,
    };
  }
  if (rpc.name === "release_mission_step") {
    const mission = store.tables["missions"]!.find(
      (row) =>
        row["id"] === args["p_mission_id"] &&
        row["step_lock_id"] === args["p_worker_id"] &&
        (args["p_lease_version"] == null || row["lease_version"] === args["p_lease_version"]),
    );
    if (mission) {
      mission["step_lock_id"] = null;
      mission["step_locked_until"] = null;
    }
    return { result: { data: Boolean(mission), error: null }, changed: Boolean(mission) };
  }
  return {
    result: { data: null, error: { message: `Unknown local RPC: ${rpc.name}` } },
    changed: false,
  };
}

export function executeLocalDatabase(
  payload: { operation: LocalDatabaseOperation } | { rpc: LocalRpcOperation },
): Promise<LocalDatabaseResult> {
  const work = queue.then(async () => {
    const store = await loadStore();
    const outcome =
      "operation" in payload
        ? await executeOperation(store, payload.operation)
        : await executeRpc(store, payload.rpc);
    if (outcome.changed) await saveStore(store);
    return outcome.result;
  });
  queue = work.then(
    () => undefined,
    () => undefined,
  );
  return work;
}

export const localDbServer = createLocalClient(executeLocalDatabase) as SupabaseClient<Database>;
