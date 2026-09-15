import type { Agent, Mission, Organization, OrganizationSettings } from "@/types/domain";
import {
  effectiveManagerOf,
  isOperationallyActive,
  operationalChainOfCommand,
} from "@/agents/hierarchy";

export type CommandAuthority =
  | "SELF_EXECUTION"
  | "DIRECT_MANAGER_ONLY"
  | "MANAGEMENT_CHAIN"
  | "EXECUTIVE_OVERRIDE"
  | "EXPLICIT_DELEGATION";

export interface DelegationDecision {
  allowed: boolean;
  authority: CommandAuthority;
  overrideUsed: boolean;
  reason: string;
}

interface ValidateDelegationInput {
  issuerAgent: Agent;
  targetAgent: Agent;
  organization: Organization;
  mission: Mission;
  agents: Agent[];
  settings: OrganizationSettings | null;
  issuerPermissions: string[];
  explicitDelegation?: boolean;
}

/**
 * The single authority for command routing. The default is deliberately strict:
 * an agent can command only its direct reports. Broader authority must be
 * explicit on the agent and is returned as an auditable override decision.
 */
export class DelegationPolicyService {
  static validate(input: ValidateDelegationInput): DelegationDecision {
    const { issuerAgent: issuer, targetAgent: target, mission, agents, settings } = input;
    if (
      issuer.organization_id !== target.organization_id ||
      issuer.organization_id !== mission.organization_id
    ) {
      return this.deny("Issuer, target and mission must belong to the same organization.");
    }
    if (!isOperationallyActive(issuer)) {
      return this.deny("The issuer is not active.");
    }
    if (!isOperationallyActive(target)) {
      return this.deny("The target agent is not available.");
    }
    if (issuer.id === target.id) {
      return {
        allowed: true,
        authority: "SELF_EXECUTION",
        overrideUsed: false,
        reason: "The agent is executing its own assigned work; no delegation is required.",
      };
    }
    if (issuer.autonomy_level < 3 || !input.issuerPermissions.includes("delegate_tasks")) {
      return this.deny("The issuer needs manager autonomy and delegate_tasks permission.");
    }
    const effectiveManager = effectiveManagerOf(target.id, agents);

    if (effectiveManager?.id === issuer.id) {
      return {
        allowed: true,
        authority: "DIRECT_MANAGER_ONLY",
        overrideUsed: false,
        reason: "Direct operational manager relationship.",
      };
    }

    const configured = this.authorityOf(issuer);
    const depth = this.distance(issuer.id, target.id, agents);
    const maxDepth = settings?.max_delegation_depth ?? 3;
    if (depth > 0 && depth <= maxDepth && configured === "MANAGEMENT_CHAIN") {
      return {
        allowed: true,
        authority: configured,
        overrideUsed: true,
        reason: `Management-chain delegation across ${depth} levels.`,
      };
    }
    if (input.explicitDelegation && configured === "EXPLICIT_DELEGATION") {
      return {
        allowed: true,
        authority: configured,
        overrideUsed: true,
        reason: "Explicit delegation grant supplied.",
      };
    }
    if (configured === "EXECUTIVE_OVERRIDE" && issuer.autonomy_level >= 4) {
      return {
        allowed: true,
        authority: configured,
        overrideUsed: true,
        reason: "Explicit executive override.",
      };
    }
    return this.deny("DIRECT_MANAGER_ONLY is the default and the target is not a direct report.");
  }

  private static authorityOf(agent: Agent): CommandAuthority {
    const cfg = (agent.external_config ?? {}) as Record<string, unknown>;
    const value = cfg["commandAuthority"];
    return value === "MANAGEMENT_CHAIN" ||
      value === "EXECUTIVE_OVERRIDE" ||
      value === "EXPLICIT_DELEGATION"
      ? value
      : "DIRECT_MANAGER_ONLY";
  }

  private static distance(issuerId: string, targetId: string, agents: Agent[]): number {
    const chain = operationalChainOfCommand(targetId, agents);
    const index = chain.findIndex((agent) => agent.id === issuerId);
    return index >= 0 ? index + 1 : -1;
  }

  private static deny(reason: string): DelegationDecision {
    return { allowed: false, authority: "DIRECT_MANAGER_ONLY", overrideUsed: false, reason };
  }
}
