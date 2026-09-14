import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCAL_OPERATOR_ID, localDbServer } from "@/local/database.server";
import { loadProviderSecrets } from "./provider-secret-service.server";
import { CancellationService } from "@/runtime/durable/cancellation-service.server";
import { runtimeDurableStore } from "@/runtime/durable/store.server";
import { DurableRuntimeControl } from "@/runtime/durable/runtime-control.server";
import { DurableApprovalService } from "@/runtime/durable/approval-service.server";

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

export const stepMission = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ missionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    return engine.step(data.missionId);
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
        .update({ status: data.decision })
        .eq("id", data.approvalId);
      return { ok: true, status: resolved.status };
    }
    const engine = await makeEngine();
    return engine.resolveApproval(data.approvalId, data.decision, data.note, data.scope);
  });
