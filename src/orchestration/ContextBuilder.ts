import type { Agent, Department, OrgPolicy } from "@/types/domain";
import { AUTONOMY_LEVELS } from "@/types/domain";

/**
 * ContextBuilder — assembles the exact context an agent is allowed to see.
 * Principle: least information. A worker receives its command, the mission
 * goal, its department context, the constraints and the results of the tasks
 * it depends on. Nothing else.
 */
export interface BuiltContext {
  systemPrompt: string;
  scope: Record<string, unknown>;
}

export function buildAgentSystemPrompt(
  agent: Agent,
  department: Department | null,
  policies: OrgPolicy[],
  manager: Agent | null,
): string {
  const autonomy =
    AUTONOMY_LEVELS.find((l) => l.level === agent.autonomy_level) ?? AUTONOMY_LEVELS[1]!;
  const parts = [
    `You are ${agent.name}, ${agent.role}${department ? ` in the ${department.name} department` : ""} of an AI organization.`,
    agent.system_prompt?.trim() || "",
    agent.personality ? `Personality: ${agent.personality}` : "",
    department?.context ? `Department context: ${department.context}` : "",
    `Autonomy level ${autonomy.level} (${autonomy.name}): ${autonomy.description}`,
    manager
      ? `You report to ${manager.name} (${manager.role}). You obey commands from your direct superior and report results back with evidence.`
      : "You are at the top of the hierarchy and answer to the human operator.",
    agent.kind === "controller" || agent.autonomy_level >= 3
      ? "As a controller you plan, delegate formal commands inside your subtree, review evidence and approve or request revisions. You never bypass the hierarchy."
      : "You execute only the exact command received. You never expand scope. If you need something outside scope you return REQUEST_SCOPE_EXTENSION or REQUEST_PERMISSION.",
    `Capabilities: ${agent.capabilities.join(", ") || "none declared"}.`,
    policies.length
      ? `Organization policies (mandatory):\n${policies
          .filter((p) => p.enforced)
          .map((p) => `- ${p.rule}`)
          .join("\n")}`
      : "",
    "Always be honest about what was and was not verified. Never fabricate evidence.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function buildCommandContext(args: {
  missionTitle: string;
  goal: string;
  task: { code: string; title: string; description: string };
  dependencyResults: { code: string; title: string; result: string | null }[];
  department: Department | null;
  constraints: Record<string, unknown>;
  permissions: string[];
}): Record<string, unknown> {
  return {
    mission: { title: args.missionTitle, goal: args.goal },
    task: args.task,
    inputs: args.dependencyResults.map((d) => ({
      from: d.code,
      title: d.title,
      result: (d.result ?? "").slice(0, 1500),
    })),
    department: args.department
      ? { name: args.department.name, context: args.department.context }
      : null,
    constraints: args.constraints,
    permissions: args.permissions,
  };
}
