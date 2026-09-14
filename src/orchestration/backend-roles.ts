import type { OperationalBackendStatus } from "@/runtime/durable/backend-health-service.server";

export type AgentRole = "LEADER" | "MANAGER" | "WORKER";
export type WorkKind =
  "PLANNING" | "DECOMPOSITION" | "NARROW_EXECUTION" | "FINAL_REVIEW" | "ESCALATION";

export interface ProductionBackendProfile {
  id: string;
  provider: string;
  model: string;
  roles: AgentRole[];
  capabilities: string[];
  status: OperationalBackendStatus;
  costPerMillionTokens: number;
  successRate: number;
  latencyP95Ms: number;
  contextWindow: number;
}

export interface RoutingRequest {
  role: AgentRole;
  workKind: WorkKind;
  requiredCapabilities: string[];
  estimatedTokens: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
}

const unavailable = new Set<OperationalBackendStatus>([
  "UNAVAILABLE",
  "CIRCUIT_OPEN",
  "RATE_LIMITED",
  "DISABLED",
  "UNKNOWN",
]);

/** Cost-aware production policy: capable cheap workers first; premium reasoning is reserved. */
export class ProductionBackendRouter {
  constructor(private readonly profiles: readonly ProductionBackendProfile[]) {}

  select(request: RoutingRequest) {
    const premiumWork = ["PLANNING", "FINAL_REVIEW", "ESCALATION"].includes(request.workKind);
    return this.profiles
      .filter(
        (profile) =>
          !unavailable.has(profile.status) &&
          profile.roles.includes(request.role) &&
          profile.contextWindow >= request.estimatedTokens &&
          request.requiredCapabilities.every((capability) =>
            profile.capabilities.includes(capability),
          ) &&
          (premiumWork || !profile.capabilities.includes("premium-reasoning")),
      )
      .sort((a, b) => {
        if (premiumWork) {
          const reasoning =
            Number(b.capabilities.includes("premium-reasoning")) -
            Number(a.capabilities.includes("premium-reasoning"));
          if (reasoning) return reasoning;
        }
        return (
          a.costPerMillionTokens - b.costPerMillionTokens ||
          b.successRate - a.successRate ||
          a.latencyP95Ms - b.latencyP95Ms
        );
      })[0];
  }
}

export const roleResponsibilities: Record<AgentRole, readonly string[]> = {
  LEADER: ["mission-contract", "strategy", "final-review", "human-escalation"],
  MANAGER: ["dag", "delegation", "evidence-review", "budget-control"],
  WORKER: ["bounded-task", "tool-use", "artifact-production", "verified-report"],
};
