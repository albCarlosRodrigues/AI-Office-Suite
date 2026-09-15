import type { Agent, AgentPermission } from "@/types/domain";
import type { PlannedTask } from "./providers/types";
import { TOOL_MAP } from "./tools/catalog";

type ToolDefinitionLike = { requiredPermissions: readonly string[] };
type ToolCatalogLike = Record<string, ToolDefinitionLike | undefined>;

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
      tools.flatMap((toolId) => toolCatalog[toolId]?.requiredPermissions ?? []),
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
  catalog?: ToolCatalogLike,
): string {
  const toolCatalog = catalogOrDefault(catalog);
  const agentLines = agents.map((agent) => {
    const granted = [...grantedPermissionsForAgent(agent.id, permissions)].sort();
    const capabilities = [...(agent.capabilities ?? [])].sort();
    const role = agent.id === commanderId ? "COMMANDER" : "SUBORDINATE";
    return `- ${role} ${agent.name} (${agent.id}): permissions=[${granted.join(", ") || "none"}] capabilities=[${capabilities.join(", ") || "none declared"}]`;
  });

  const toolLines = Object.entries(toolCatalog)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([toolId, definition]) => {
      const required = definition?.requiredPermissions ?? [];
      return `- ${toolId}: requires=[${required.join(", ") || "none"}]`;
    });

  return [
    "EXECUTION CANDIDATES AND GRANTED PERMISSIONS:",
    ...agentLines,
    "",
    "TOOL PERMISSION REQUIREMENTS:",
    ...toolLines,
  ].join("\n");
}
