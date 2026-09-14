import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCAL_OPERATOR_ID, localDbServer } from "@/local/database.server";

/**
 * Server functions for the orchestration engine.
 * All run as the signed-in user (RLS enforced). Provider secrets are the only
 * privileged read and happen through a narrow admin loader after membership
 * has already been proven by the RLS-scoped reads inside the engine.
 */
async function makeEngine() {
  const { OrchestrationEngine } = await import("./engine.server");
  const loadSecrets = async (providerIds: string[]) => {
    const map = new Map<
      string,
      {
        api_key: string | null;
        bearer_token: string | null;
        secret_headers: Record<string, string>;
      }
    >();
    if (!providerIds.length) return map;
    const { data } = await localDbServer
      .from("provider_secrets")
      .select("provider_id, api_key, bearer_token, secret_headers")
      .in("provider_id", providerIds);
    for (const row of data ?? [])
      map.set(row.provider_id, {
        api_key: row.api_key,
        bearer_token: row.bearer_token,
        secret_headers: (row.secret_headers ?? {}) as Record<string, string>,
      });
    return map;
  };
  return new OrchestrationEngine(
    localDbServer,
    LOCAL_OPERATOR_ID,
    { lovableApiKey: process.env["LOVABLE_API_KEY"] },
    loadSecrets,
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
    return engine.requestStop(data.missionId);
  });

export const setKillSwitch = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ orgId: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const engine = await makeEngine();
    return engine.killSwitch(data.orgId, data.active);
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
    const engine = await makeEngine();
    return engine.resolveApproval(data.approvalId, data.decision, data.note, data.scope);
  });
