import { randomUUID } from "node:crypto";
import {
  canonicalToolId,
  expandEnabledToolIds,
  getToolDefinition,
} from "@/permissions/tool-registry";
import type { DurableApproval, DurableToolRequest } from "../durable/types";
import type { AuthorizationDecision, AuthorizationSnapshot, PolicyDecisionPoint } from "./types";

const ACTIVE_MISSION_STATUSES = new Set(["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"]);

function effectivePermissions(snapshot: AuthorizationSnapshot): Set<string> {
  const permanent = new Set(snapshot.permanentPermissions);
  const mission = new Set(snapshot.missionPermissions);
  if (snapshot.missionPermissionMode === "restrict" && mission.size > 0) {
    return new Set([...permanent].filter((permission) => mission.has(permission)));
  }
  return new Set([...permanent, ...mission]);
}

function approvalMatches(
  approval: DurableApproval | null,
  request: DurableToolRequest,
  canonicalId: string,
  now: number,
): boolean {
  if (!approval || approval.status !== "APPROVED") return false;
  if (new Date(approval.expiresAt).getTime() <= now) return false;
  if (canonicalToolId(approval.toolId) !== canonicalId) return false;
  if (approval.inputHash !== request.inputHash) return false;
  if (approval.policyVersion !== request.policyVersion) return false;
  if (approval.requester && approval.requester !== request.agentId) return false;

  if (approval.scope === "ONCE") {
    return (
      approval.toolCallId === request.toolCallId &&
      approval.missionId === request.missionId &&
      approval.taskId === request.taskId
    );
  }
  if (approval.scope === "MISSION") return approval.missionId === request.missionId;
  return true;
}

function decision(
  request: DurableToolRequest,
  snapshot: AuthorizationSnapshot,
  effect: AuthorizationDecision["effect"],
  reasonCode: string,
  canonicalId: string,
  requiredPermissions: string[] = [],
  missingPermissions: string[] = [],
): AuthorizationDecision {
  return {
    decisionId: randomUUID(),
    effect,
    reasonCode,
    canonicalToolId: canonicalId,
    requiredPermissions,
    missingPermissions,
    policyVersion: request.policyVersion,
    evaluatedAt: new Date().toISOString(),
    obligations: {
      workspace: snapshot.mission?.workspace ?? null,
      dataAccess: getToolDefinition(canonicalId)?.dataAccess ?? null,
    },
  };
}

/**
 * Local deterministic PDP. It deliberately contains no LLM logic.
 * This interface can later be backed by Cedar/Cerbos/OpenFGA without changing PEP call sites.
 */
export class LocalNextGenPdp implements PolicyDecisionPoint {
  evaluate(request: DurableToolRequest, snapshot: AuthorizationSnapshot): AuthorizationDecision {
    const canonicalId = canonicalToolId(request.toolId);
    const definition = getToolDefinition(canonicalId);

    if (!definition) return decision(request, snapshot, "DENY", "UNKNOWN_TOOL", canonicalId);
    if (snapshot.killSwitch)
      return decision(request, snapshot, "DENY", "KILL_SWITCH_ACTIVE", canonicalId);
    if (!snapshot.inputHashValid)
      return decision(request, snapshot, "DENY", "INPUT_HASH_MISMATCH", canonicalId);
    if (!snapshot.agent) return decision(request, snapshot, "DENY", "AGENT_NOT_FOUND", canonicalId);
    if (snapshot.agent.suspended)
      return decision(request, snapshot, "DENY", "AGENT_SUSPENDED", canonicalId);
    if (!snapshot.mission)
      return decision(request, snapshot, "DENY", "MISSION_NOT_FOUND", canonicalId);
    if (!ACTIVE_MISSION_STATUSES.has(snapshot.mission.status))
      return decision(request, snapshot, "DENY", "MISSION_NOT_ACTIVE", canonicalId);
    if (snapshot.agent.organizationId !== snapshot.mission.organizationId)
      return decision(request, snapshot, "DENY", "ORGANIZATION_MISMATCH", canonicalId);
    if (
      snapshot.mission.allowedAgentIds.length > 0 &&
      !snapshot.mission.allowedAgentIds.includes(snapshot.agent.id)
    )
      return decision(request, snapshot, "DENY", "AGENT_NOT_ALLOWED_IN_MISSION", canonicalId);

    const enabled = expandEnabledToolIds(snapshot.enabledTools);
    if (!enabled.has(canonicalId))
      return decision(request, snapshot, "DENY", "TOOL_NOT_ENABLED", canonicalId);

    const permissions = effectivePermissions(snapshot);
    const missing = definition.requiredPermissions.filter(
      (permission) => !permissions.has(permission),
    );
    if (missing.length > 0)
      return decision(
        request,
        snapshot,
        "DENY",
        "MISSING_PERMISSION",
        canonicalId,
        definition.requiredPermissions,
        missing,
      );

    const requiresApproval =
      definition.approval === "ALWAYS" ||
      request.approvalPolicy === "REQUIRE_APPROVAL" ||
      (definition.approval === "CONDITIONAL" && snapshot.agent.requireApproval);

    if (requiresApproval && !approvalMatches(snapshot.approval, request, canonicalId, Date.now()))
      return decision(
        request,
        snapshot,
        "REQUIRE_APPROVAL",
        "VALID_APPROVAL_REQUIRED",
        canonicalId,
        definition.requiredPermissions,
      );

    return decision(
      request,
      snapshot,
      "ALLOW",
      "AUTHORIZED",
      canonicalId,
      definition.requiredPermissions,
    );
  }
}
