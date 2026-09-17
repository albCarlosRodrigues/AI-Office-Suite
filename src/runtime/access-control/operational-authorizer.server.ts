import { localDbServer } from "@/local/database.server";
import {
  canonicalToolId,
  expandEnabledToolIds,
  isKnownTool,
} from "@/permissions/tool-registry";
import { DurableRuntimeStore } from "../durable/store.server";
import { audit, canonicalHash } from "../durable/helpers";
import type { DurableApproval, DurableToolRequest } from "../durable/types";
import type { AuthorizationDecision, AuthorizationSnapshot, DurableExecutionAuthorizer } from "./types";
import { LocalNextGenPdp } from "./pdp";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function chooseApproval(
  approvals: readonly DurableApproval[],
  request: DurableToolRequest,
): DurableApproval | null {
  const canonicalId = canonicalToolId(request.toolId);
  const candidates = approvals.filter(
    (item) =>
      item.status === "APPROVED" &&
      new Date(item.expiresAt).getTime() > Date.now() &&
      canonicalToolId(item.toolId) === canonicalId &&
      item.inputHash === request.inputHash &&
      item.policyVersion === request.policyVersion &&
      (!item.requester || item.requester === request.agentId),
  );

  return (
    candidates.find((item) => item.toolCallId === request.toolCallId) ??
    candidates.find(
      (item) =>
        item.scope === "MISSION" &&
        item.missionId === request.missionId &&
        item.taskId === request.taskId,
    ) ??
    candidates.find((item) => item.scope === "MISSION" && item.missionId === request.missionId) ??
    candidates.find((item) => item.scope === "PERSISTENT") ??
    null
  );
}

/**
 * PIP + PDP adapter used by the durable execution PEP.
 * It reloads operational state for every side effect, closing the enqueue/execution TOCTOU gap.
 */
export class OperationalToolAuthorizer implements DurableExecutionAuthorizer {
  private readonly pdp = new LocalNextGenPdp();

  constructor(private readonly store: DurableRuntimeStore) {}

  async authorize(request: DurableToolRequest): Promise<AuthorizationDecision> {
    const [agentResult, missionResult] = await Promise.all([
      localDbServer.from("agents").select("*").eq("id", request.agentId).single(),
      localDbServer.from("missions").select("*").eq("id", request.missionId).single(),
    ]);

    const agent = agentResult.data as Record<string, unknown> | null;
    const mission = missionResult.data as Record<string, unknown> | null;
    const organizationId =
      (mission?.["organization_id"] as string | undefined) ??
      (agent?.["organization_id"] as string | undefined) ??
      "";

    const [organizationResult, permissionsResult, missionPermissionsResult, toolsResult] =
      await Promise.all([
        organizationId
          ? localDbServer.from("organizations").select("*").eq("id", organizationId).single()
          : Promise.resolve({ data: null, error: null }),
        localDbServer.from("agent_permissions").select("*").eq("agent_id", request.agentId),
        localDbServer
          .from("mission_permissions")
          .select("*")
          .eq("mission_id", request.missionId)
          .eq("agent_id", request.agentId),
        localDbServer.from("agent_tools").select("*").eq("agent_id", request.agentId),
      ]);

    const explicitToolRows = (toolsResult.data ?? []) as Array<Record<string, unknown>>;
    const explicitEnabled = explicitToolRows
      .filter((row) => row["enabled"] !== false)
      .map((row) => String(row["tool_id"] ?? ""))
      .filter(Boolean);

    const legacyAllowedTools = stringArray(agent?.["allowed_tools"]);
    const capabilities = stringArray(agent?.["capabilities"]);
    const capabilityTools = capabilities.filter(isKnownTool);
    const configuredTools =
      explicitToolRows.length > 0
        ? explicitEnabled
        : legacyAllowedTools.length > 0
          ? legacyAllowedTools
          : capabilityTools;

    const contract = asRecord(mission?.["mission_contract"]);
    const authorization = asRecord(contract["authorization"]);
    const permissionMode =
      authorization["permission_mode"] === "restrict" ? "restrict" : "augment";
    const workspace = typeof contract["workspace"] === "string" ? contract["workspace"] : null;

    const durable = await this.store.snapshot();
    const approval = chooseApproval(durable.approvals, request);
    const computedInputHash = canonicalHash({ toolId: request.toolId, arguments: request.arguments });

    const snapshot: AuthorizationSnapshot = {
      killSwitch:
        durable.killSwitch ||
        Boolean((organizationResult.data as Record<string, unknown> | null)?.["kill_switch_active"]),
      agent: agent
        ? {
            id: String(agent["id"]),
            organizationId: String(agent["organization_id"] ?? ""),
            suspended: Boolean(agent["is_suspended"]),
            requireApproval: Boolean(agent["require_approval"]),
            role: typeof agent["role"] === "string" ? agent["role"] : null,
            managerAgentId:
              typeof agent["manager_agent_id"] === "string" ? agent["manager_agent_id"] : null,
          }
        : null,
      mission: mission
        ? {
            id: String(mission["id"]),
            organizationId: String(mission["organization_id"] ?? ""),
            status: String(mission["status"] ?? ""),
            allowedAgentIds: stringArray(mission["allowed_agent_ids"]),
            workspace,
          }
        : null,
      enabledTools: [...expandEnabledToolIds(configuredTools)],
      permanentPermissions: ((permissionsResult.data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => row["granted"] !== false)
        .map((row) => String(row["permission"] ?? ""))
        .filter(Boolean),
      missionPermissions: ((missionPermissionsResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => String(row["permission"] ?? ""))
        .filter(Boolean),
      missionPermissionMode: permissionMode,
      approval,
      inputHashValid: computedInputHash === request.inputHash,
    };

    const decision = this.pdp.evaluate(request, snapshot);
    await this.store.transaction((state) => {
      audit(
        state,
        "AUTHORIZATION_DECISION",
        {
          missionId: request.missionId,
          taskId: request.taskId,
          toolCallId: request.toolCallId,
        },
        {
          decisionId: decision.decisionId,
          effect: decision.effect,
          reasonCode: decision.reasonCode,
          agentId: request.agentId,
          requestedToolId: request.toolId,
          canonicalToolId: decision.canonicalToolId,
          policyVersion: request.policyVersion,
          requiredPermissions: decision.requiredPermissions,
          missingPermissions: decision.missingPermissions,
        },
      );
    });
    return decision;
  }
}
