import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCAL_OPERATOR_ID, localDbServer } from "@/local/database.server";
import { loadProviderSecrets } from "./provider-secret-service.server";
import { CancellationService } from "@/runtime/durable/cancellation-service.server";
import { runtimeDurableStore } from "@/runtime/durable/store.server";
import { DurableRuntimeControl } from "@/runtime/durable/runtime-control.server";
import { DurableApprovalService } from "@/runtime/durable/approval-service.server";
import { runDurableToolWorker } from "./durable-tool-worker.server";

/**
 * Server functions for the orchestration engine.
 * All run as the signed-in user (RLS enforced). Provider secrets are the only
 * privileged read and happen through a narrow admin loader after membership
 * has already been proven by the RLS-scoped reads inside the engine.
 */
async function makeEngine() {
  const { OrchestrationEngine } = await import("./engine.server");
  return new OrchestrationEngine(
    localDbServer,
    LOCAL_OPERATOR_ID,
    { lovableApiKey: process.env["LOVABLE_API_KEY"] },
    loadProviderSecrets,
  );
}

export const startMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    return engine.start(data.missionId);
  });

const PENDING_RUNTIME_TOOL_STATUSES = new Set([
  "REQUESTED",
  "WAITING_APPROVAL",
  "READY",
  "CLAIMED",
  "RUNNING",
]);

function durableRiskToOperational(riskLevel: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (riskLevel >= 4) return "CRITICAL";
  if (riskLevel >= 3) return "HIGH";
  if (riskLevel >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * Durable approvals are the execution authority.
 *
 * The UI still reads approval_requests from the operational database, so every
 * durable approval must have a projection there using the SAME id.
 *
 * This projection is not a second authorization decision. The durable store
 * remains authoritative.
 */
async function syncDurableApprovalsToOperationalDb(missionId: string) {
  const store = runtimeDurableStore();
  const snapshot = await store.snapshot();

  const approvals = snapshot.approvals.filter((approval) => approval.missionId === missionId);

  if (approvals.length === 0) return 0;

  const { data: mission, error: missionError } = await localDbServer
    .from("missions")
    .select("id,organization_id")
    .eq("id", missionId)
    .single();

  if (missionError || !mission) {
    throw new Error(
      missionError?.message ?? `Mission ${missionId} not found while syncing durable approvals`,
    );
  }

  let synced = 0;

  for (const approval of approvals) {
    const request = snapshot.toolRequests.find((item) => item.toolCallId === approval.toolCallId);

    const operationalStatus = approval.status === "CANCELLED" ? "EXPIRED" : approval.status;

    const { error } = await localDbServer.from("approval_requests").upsert({
      id: approval.approvalId,

      organization_id: mission.organization_id,

      mission_id: approval.missionId,

      task_id: approval.taskId,

      agent_id: approval.requester,

      kind: "TOOL_EXECUTION",

      action: `Executar ferramenta ${approval.toolId}`,

      reason: approval.reason,

      required_permissions: [],

      requested_action: {
        durable: true,
        toolCallId: approval.toolCallId,
        toolId: approval.toolId,
        arguments: request?.arguments ?? {},
        inputHash: approval.inputHash,
        policyVersion: approval.policyVersion,
      },

      risk_level: durableRiskToOperational(approval.riskLevel),

      status: operationalStatus,

      approval_scope: approval.scope,

      always_allow: approval.status === "APPROVED" && approval.scope === "PERSISTENT",

      tool_id: approval.toolId,

      resolved_at: approval.decisionAt,

      resolved_by: approval.decisionBy,

      resolution_note: approval.decision,
    } as never);

    if (error) {
      throw new Error(`Failed to sync durable approval ${approval.approvalId}: ${error.message}`);
    }

    synced += 1;
  }

  return synced;
}

export const stepMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    // The desktop pacemaker calls stepMission directly. Pump the durable tool
    // queue here so model tool requests are actually executed instead of
    // remaining READY forever.
    await runDurableToolWorker(20);

    // Project durable approvals into the operational database so the human
    // approval UI always sees the same approval id used by the runtime.
    await syncDurableApprovalsToOperationalDb(data.missionId);

    // A mission waiting for deterministic tool execution must not consume a
    // mission step. The next pacemaker tick will continue pumping the queue.
    const durableState = await runtimeDurableStore().snapshot();
    const waitingForRuntimeTools = durableState.toolRequests.some(
      (request) =>
        request.missionId === data.missionId && PENDING_RUNTIME_TOOL_STATUSES.has(request.status),
    );

    if (waitingForRuntimeTools) {
      return {
        acted: false,
        note: "waiting for runtime tools",
      };
    }

    const engine = await makeEngine();
    return engine.step(data.missionId);
  });

export const pauseMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    return engine.requestPause(data.missionId);
  });

export const resumeMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    return engine.resume(data.missionId);
  });

export const retryMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: mission, error } = await localDbServer
      .from("missions")
      .select("id,status")
      .eq("id", data.missionId)
      .single();

    if (error || !mission) {
      throw new Error("Mission not found");
    }

    if (mission.status !== "FAILED") {
      throw new Error(`Only a FAILED mission can be retried; current status is ${mission.status}`);
    }

    const engine = await makeEngine();
    return engine.start(data.missionId);
  });
export const stopMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    const result = await engine.requestStop(data.missionId);
    await new CancellationService(runtimeDurableStore()).request({
      missionId: data.missionId,
      reason: "User requested mission stop",
      requestedBy: LOCAL_OPERATOR_ID,
    });
    return result;
  });

export const setKillSwitch = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ orgId: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    const result = await engine.killSwitch(data.orgId, data.active);
    await new DurableRuntimeControl(runtimeDurableStore()).setKillSwitch(data.active);
    return result;
  });

export const resolveApproval = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        approvalId: z.string().uuid(),
        decision: z.enum(["APPROVED", "DENIED"]),
        note: z.string().max(2000).nullable(),
        scope: z.enum(["ONCE", "MISSION", "PERSISTENT"]),
        confirmedPersistent: z.boolean(),
      })
      .refine(
        (value) => value.scope !== "PERSISTENT" || value.confirmedPersistent,
        "Persistent permissions require explicit confirmation.",
      )
      .parse(d),
  )
  .handler(async ({ data }) => {
    const store = runtimeDurableStore();
    const approval = (await store.snapshot()).approvals.find(
      (a) => a.approvalId === data.approvalId,
    );
    if (approval) {
      const resolved = await new DurableApprovalService(store).resolve(
        approval.approvalId,
        data.decision,
        LOCAL_OPERATOR_ID,
        approval,
      );
      await localDbServer
        .from("approval_requests")
        .update({
          status: data.decision,
          approval_scope: data.scope,
          resolved_by: LOCAL_OPERATOR_ID,
          resolved_at: new Date().toISOString(),
          resolution_note: data.note,
        })
        .eq("id", data.approvalId);

      // APPROVED moves the durable request to READY. Pump the worker now
      // instead of waiting for an unrelated future scheduler tick.
      if (data.decision === "APPROVED") {
        await runDurableToolWorker(20);
      }

      await syncDurableApprovalsToOperationalDb(approval.missionId);

      return {
        ok: true,
        status: resolved.status,
      };
    }
    const engine = await makeEngine();
    return engine.resolveApproval(data.approvalId, data.decision, data.note, data.scope);
  });
