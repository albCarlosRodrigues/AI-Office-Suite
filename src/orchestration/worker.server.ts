import { LOCAL_OPERATOR_ID, localDbServer } from "@/local/database.server";
import { OrchestrationEngine } from "./engine.server";
import type { ProviderSecrets } from "./providers/resolve.server";

const ACTIVE_STATUSES = ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"] as const;

async function loadSecrets(providerIds: string[]) {
  const map = new Map<string, ProviderSecrets>();
  if (!providerIds.length) return map;
  const { data } = await localDbServer
    .from("provider_secrets")
    .select("provider_id, api_key, bearer_token, secret_headers")
    .in("provider_id", providerIds);
  for (const row of data ?? []) {
    map.set(row.provider_id, {
      api_key: row.api_key,
      bearer_token: row.bearer_token,
      secret_headers: (row.secret_headers ?? {}) as Record<string, string>,
    });
  }
  return map;
}

/** One bounded scheduler pass. Safe to invoke concurrently or retry. */
export async function runOrchestrationWorker(limit = 20) {
  const { data: missions, error } = await localDbServer
    .from("missions")
    .select("id")
    .in("status", [...ACTIVE_STATUSES])
    .order("updated_at")
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(error.message);

  const results = await Promise.allSettled(
    (missions ?? []).map(async ({ id }) => {
      const engine = new OrchestrationEngine(
        localDbServer,
        LOCAL_OPERATOR_ID,
        { lovableApiKey: process.env["LOVABLE_API_KEY"] },
        loadSecrets,
      );
      return { missionId: id, ...(await engine.step(id)) };
    }),
  );
  return results.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          acted: false,
          note: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
  );
}
