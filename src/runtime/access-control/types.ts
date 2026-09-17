import type { DurableApproval, DurableToolRequest } from "../durable/types";

export type AuthorizationEffect = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface AuthorizationAgentSnapshot {
  id: string;
  organizationId: string;
  suspended: boolean;
  requireApproval: boolean;
  role: string | null;
  managerAgentId: string | null;
}

export interface AuthorizationMissionSnapshot {
  id: string;
  organizationId: string;
  status: string;
  allowedAgentIds: string[];
  workspace: string | null;
}

export interface AuthorizationSnapshot {
  killSwitch: boolean;
  agent: AuthorizationAgentSnapshot | null;
  mission: AuthorizationMissionSnapshot | null;
  enabledTools: string[];
  permanentPermissions: string[];
  missionPermissions: string[];
  missionPermissionMode: "augment" | "restrict";
  approval: DurableApproval | null;
  inputHashValid: boolean;
}

export interface AuthorizationDecision {
  decisionId: string;
  effect: AuthorizationEffect;
  reasonCode: string;
  canonicalToolId: string;
  requiredPermissions: string[];
  missingPermissions: string[];
  policyVersion: string;
  evaluatedAt: string;
  obligations: {
    workspace: string | null;
    dataAccess: string | null;
  };
}

export interface PolicyDecisionPoint {
  evaluate(request: DurableToolRequest, snapshot: AuthorizationSnapshot): AuthorizationDecision;
}

export interface DurableExecutionAuthorizer {
  authorize(request: DurableToolRequest): Promise<AuthorizationDecision>;
}
