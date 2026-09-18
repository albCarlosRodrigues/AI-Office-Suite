import type { Agent, AgentPermission } from "@/types/domain";
import type { PlannedTask } from "./providers/types";
import { TOOL_MAP, canonicalToolId, expandEnabledToolIds, isKnownTool } from "./tools/catalog";

type ToolDefinitionLike = { requiredPermissions: readonly string[] };
type ToolCatalogLike = Record<string, ToolDefinitionLike | undefined>;
export type AgentToolSettingLike = {
  agent_id: string;
  tool_id: string;
  enabled: boolean;
};

function catalogOrDefault(catalog?: ToolCatalogLike): ToolCatalogLike {
  return catalog ?? (TOOL_MAP as ToolCatalogLike);
}

export function requiredPermissionsForTools(
  tools: readonly string[],
  catalog?: ToolCatalogLike,
): string[] {
  const toolCatalog = catalogOrDefault(catalog);
  return [
    ...new Set(
      tools.flatMap((toolId) => toolCatalog[canonicalToolId(toolId)]?.requiredPermissions ?? []),
    ),
  ];
}

export function grantedPermissionsForAgent(
  agentId: string,
  permissions: readonly AgentPermission[],
): Set<string> {
  return new Set(
    permissions
      .filter((permission) => permission.agent_id === agentId && permission.granted)
      .map((permission) => permission.permission),
  );
}

export function enabledToolsForAgent(
  agent: Pick<Agent, "id" | "capabilities">,
  toolSettings: readonly AgentToolSettingLike[],
  catalog?: ToolCatalogLike,
): Set<string> {
  const toolCatalog = catalogOrDefault(catalog);
  const rows = toolSettings.filter((tool) => tool.agent_id === agent.id);

  if (rows.length) {
    return expandEnabledToolIds(
      rows.filter((tool) => tool.enabled).map((tool) => canonicalToolId(tool.tool_id)),
    );
  }

  // Migration compatibility: local legacy rows can still contain agents.allowed_tools.
  // Unlike the previous behavior, an empty capability list no longer grants every tool.
  const legacyAllowed = Array.isArray(
    (agent as unknown as { allowed_tools?: unknown }).allowed_tools,
  )
    ? (agent as unknown as { allowed_tools: unknown[] }).allowed_tools.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const capabilities = agent.capabilities ?? [];
  const base = legacyAllowed.length > 0 ? legacyAllowed : capabilities.filter(isKnownTool);

  return expandEnabledToolIds(
    base.map(canonicalToolId).filter((toolId) => Boolean(toolCatalog[toolId])),
  );
}

export function missingPermissionsForTask(
  task: Pick<PlannedTask, "tools">,
  agent: Pick<Agent, "id">,
  permissions: readonly AgentPermission[],
  catalog?: ToolCatalogLike,
): string[] {
  const granted = grantedPermissionsForAgent(agent.id, permissions);
  return requiredPermissionsForTools(task.tools, catalog).filter(
    (permission) => !granted.has(permission),
  );
}

export function missingToolsForTask(
  task: Pick<PlannedTask, "tools">,
  agent: Pick<Agent, "id" | "capabilities">,
  toolSettings: readonly AgentToolSettingLike[],
  catalog?: ToolCatalogLike,
): string[] {
  const toolCatalog = catalogOrDefault(catalog);
  const enabled = enabledToolsForAgent(agent, toolSettings, toolCatalog);

  return task.tools.filter((requestedId) => {
    const toolId = canonicalToolId(requestedId);
    return !toolCatalog[toolId] || !enabled.has(toolId);
  });
}

export function missingTaskAccess(
  task: Pick<PlannedTask, "tools">,
  agent: Pick<Agent, "id" | "capabilities">,
  permissions: readonly AgentPermission[],
  toolSettings: readonly AgentToolSettingLike[],
  catalog?: ToolCatalogLike,
): { missingTools: string[]; missingPermissions: string[] } {
  return {
    missingTools: missingToolsForTask(task, agent, toolSettings, catalog),
    missingPermissions: missingPermissionsForTask(task, agent, permissions, catalog),
  };
}

export function allowedToolsForTask(
  task: Pick<PlannedTask, "tools">,
  agent: Pick<Agent, "id" | "capabilities">,
  permissions: readonly AgentPermission[],
  toolSettings: readonly AgentToolSettingLike[],
  catalog?: ToolCatalogLike,
): string[] {
  const toolCatalog = catalogOrDefault(catalog);
  const granted = grantedPermissionsForAgent(agent.id, permissions);
  const enabled = enabledToolsForAgent(agent, toolSettings, toolCatalog);

  return task.tools
    .map(canonicalToolId)
    .filter((toolId, index, all) => all.indexOf(toolId) === index)
    .filter((toolId) => {
      const definition = toolCatalog[toolId];
      return (
        Boolean(definition) &&
        enabled.has(toolId) &&
        definition!.requiredPermissions.every((permission) => granted.has(permission))
      );
    });
}

export function filterAgentsByTaskPermissions<T extends Pick<Agent, "id">>(
  task: Pick<PlannedTask, "tools">,
  agents: readonly T[],
  permissions: readonly AgentPermission[],
  catalog?: ToolCatalogLike,
): T[] {
  return agents.filter(
    (agent) => missingPermissionsForTask(task, agent, permissions, catalog).length === 0,
  );
}

export function filterAgentsByTaskAccess<T extends Pick<Agent, "id" | "capabilities">>(
  task: Pick<PlannedTask, "tools">,
  agents: readonly T[],
  permissions: readonly AgentPermission[],
  toolSettings: readonly AgentToolSettingLike[],
  catalog?: ToolCatalogLike,
): T[] {
  return agents.filter((agent) => {
    const gaps = missingTaskAccess(task, agent, permissions, toolSettings, catalog);
    return gaps.missingTools.length === 0 && gaps.missingPermissions.length === 0;
  });
}

export function buildExecutionCandidates<T extends Pick<Agent, "id">>(
  commander: T,
  team: readonly T[],
): T[] {
  return [commander, ...team.filter((agent) => agent.id !== commander.id)];
}

export function formatPlanningPermissionMatrix(
  agents: readonly Pick<Agent, "id" | "name" | "capabilities">[],
  permissions: readonly AgentPermission[],
  commanderId: string,
  toolSettings: readonly AgentToolSettingLike[] = [],
  catalog?: ToolCatalogLike,
): string {
  const toolCatalog = catalogOrDefault(catalog);
  const agentLines = agents.map((agent) => {
    const granted = [...grantedPermissionsForAgent(agent.id, permissions)].sort();
    const enabled = [...enabledToolsForAgent(agent, toolSettings, toolCatalog)].sort();
    const role = agent.id === commanderId ? "COMMANDER" : "SUBORDINATE";
    return `- ${role} ${agent.name} (${agent.id}): permissions=[${granted.join(", ") || "none"}] enabled_tools=[${enabled.join(", ") || "none"}]`;
  });

  const toolLines = Object.entries(toolCatalog)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([toolId, definition]) => {
      const required = definition?.requiredPermissions ?? [];
      return `- ${toolId}: requires=[${required.join(", ") || "none"}]`;
    });

  return [
    "EXECUTION CANDIDATES, ENABLED TOOLS, AND GRANTED PERMISSIONS:",
    ...agentLines,
    "",
    "TOOL PERMISSION REQUIREMENTS:",
    ...toolLines,
  ].join("\n");
}
