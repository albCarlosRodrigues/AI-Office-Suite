import type { Agent, AgentPermission, AgentProvider, Department } from "@/types/domain";
import type { PlannedTask } from "./providers/types";

interface MatchContext {
  departments: Department[];
  providers: AgentProvider[];
  permissions: AgentPermission[];
  load: Map<string, number>;
  simulationMode: boolean;
}

/** Capability-first agent selection. Role keywords are intentionally only a fallback. */
export class AgentCapabilityMatcher {
  static select(task: PlannedTask, candidates: Agent[], context: MatchContext): Agent | null {
    const ranked = candidates
      .map((agent) => ({ agent, score: this.score(agent, task, context) }))
      .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
    return ranked[0]?.agent ?? null;
  }

  private static score(agent: Agent, task: PlannedTask, context: MatchContext): number {
    if (agent.is_suspended || ["OFFLINE", "PAUSED", "ERROR"].includes(agent.status))
      return Number.NEGATIVE_INFINITY;
    const provider = context.providers.find((item) => item.id === agent.provider_id);
    if (
      !context.simulationMode &&
      provider &&
      (!provider.is_enabled ||
        [
          "UNKNOWN",
          "OFFLINE",
          "FAILED",
          "TIMEOUT",
          "UNAUTHORIZED",
          "DISABLED",
          "UNCONFIGURED",
          "ERROR",
        ].includes(provider.health))
    ) {
      return Number.NEGATIVE_INFINITY;
    }
    const granted = new Set(
      context.permissions
        .filter((permission) => permission.agent_id === agent.id && permission.granted)
        .map((permission) => permission.permission),
    );
    const requiredCapabilities = this.capabilitiesFor(task.role);
    const capabilityScore = requiredCapabilities.reduce(
      (total, capability) => total + (agent.capabilities.includes(capability) ? 18 : 0),
      0,
    );
    const permissionScore = task.tools.reduce(
      (total, tool) => total + (this.hasToolPermission(tool, granted) ? 8 : -12),
      0,
    );
    const department =
      context.departments.find((item) => item.id === agent.department_id)?.slug ?? "";
    const departmentScore = this.departmentFor(task.role) === department ? 20 : 0;
    const kindScore = task.role === "implement" && agent.kind === "external" ? 8 : 0;
    const availabilityScore = agent.status === "IDLE" ? 8 : agent.status === "WAITING" ? 3 : 0;
    const costPenalty = Math.min(Number(agent.max_cost) * 2, 10);
    const loadPenalty = (context.load.get(agent.id) ?? 0) * 7;
    const hierarchyPenalty =
      agent.autonomy_level >= 3 && ["implement", "verify"].includes(task.role) ? 12 : 0;
    const keywordFallback = new RegExp(task.role === "verify" ? "qa|test" : task.role, "i").test(
      agent.role,
    )
      ? 2
      : 0;
    return (
      capabilityScore +
      permissionScore +
      departmentScore +
      kindScore +
      availabilityScore +
      keywordFallback -
      costPenalty -
      loadPenalty -
      hierarchyPenalty
    );
  }

  private static capabilitiesFor(role: PlannedTask["role"]): string[] {
    return {
      research: ["browse_web"],
      analysis: ["code_analysis"],
      implement: ["repository_write"],
      verify: ["testing"],
      design: ["browser"],
      docs: ["repository_write"],
      ops: ["shell"],
      security: ["code_analysis"],
    }[role];
  }

  private static departmentFor(role: PlannedTask["role"]): string {
    return {
      research: "research",
      analysis: "engineering",
      implement: "engineering",
      verify: "qa",
      design: "design",
      docs: "engineering",
      ops: "operations",
      security: "security",
    }[role];
  }

  private static hasToolPermission(tool: string, permissions: Set<string>): boolean {
    const requirements: Record<string, string[]> = {
      repository_read: ["repository.read"],
      repository_write: ["repository.write"],
      code_analysis: ["repository.read"],
      shell: ["shell.execute"],
      testing: ["tests.execute"],
      github_issue_read: ["github.issue.read"],
      github_pr_create: ["github.pr.create"],
      git_commit: ["git.commit"],
      browser: ["web.browse"],
      web_search: ["web.browse"],
      filesystem: ["repository.read"],
      database_query: ["database.read"],
      database_write: ["database.write"],
      deploy_staging: ["deploy.staging"],
      deploy_production: ["deploy.production"],
      send_email: ["email.send"],
    };
    return (requirements[tool] ?? []).every((permission) => permissions.has(permission));
  }
}
