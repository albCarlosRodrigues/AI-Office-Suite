import path from "node:path";
import { localDbServer } from "@/local/database.server";
import { FileArtifactStore } from "@/runtime/artifact-store.server";
import { OperationalToolAuthorizer } from "@/runtime/access-control/operational-authorizer.server";
import { DurableLocalToolExecutor } from "@/runtime/durable/local-tool-executor.server";
import { runtimeDurableStore } from "@/runtime/durable/store.server";
import { ToolExecutionWorker } from "@/runtime/durable/tool-worker.server";
import { CancellationService } from "@/runtime/durable/cancellation-service.server";
import { ToolExecutionGateway, ToolRegistry } from "@/runtime/tools/gateway";
import { createLocalToolHandlers } from "@/runtime/tools/handlers.server";
import { DefaultDenyToolPolicy } from "@/runtime/tools/policy";

const ACTIVE_OPERATIONAL_MISSION_STATUSES = new Set([
  "PLANNING",
  "RUNNING",
  "WAITING_APPROVAL",
  "REVIEWING",
]);

const TERMINAL_DURABLE_MISSION_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function inactiveDurableMissionIds(
  durableMissions: readonly { id: string; status: string }[],
  operationalMissions: readonly { id: string; status: string }[],
) {
  const activeOperationalIds = new Set(
    operationalMissions
      .filter((mission) => ACTIVE_OPERATIONAL_MISSION_STATUSES.has(mission.status))
      .map((mission) => mission.id),
  );

  return durableMissions
    .filter(
      (mission) =>
        !TERMINAL_DURABLE_MISSION_STATUSES.has(mission.status) &&
        !activeOperationalIds.has(mission.id),
    )
    .map((mission) => mission.id);
}

/**
 * Durable state survives mission completion/failure. Before consuming the
 * queue, cancel unfinished durable work whose operational mission is no
 * longer active. This prevents an old READY shell/write request from being
 * executed after a later application restart.
 */
export async function reconcileInactiveDurableMissions(store = runtimeDurableStore()) {
  const { data: operationalMissions, error } = await localDbServer
    .from("missions")
    .select("id,status");

  if (error) throw new Error(error.message);

  const snapshot = await store.snapshot();
  const staleMissionIds = inactiveDurableMissionIds(snapshot.missions, operationalMissions ?? []);
  if (staleMissionIds.length === 0) return 0;

  const cancellation = new CancellationService(store);
  for (const missionId of staleMissionIds) {
    await cancellation.request({
      missionId,
      reason:
        "Operational mission is no longer active; stale durable work was cancelled before tool execution.",
      requestedBy: "runtime-reconciler",
    });
  }
  return staleMissionIds.length;
}

/** Bounded autonomous worker pass; safe to invoke again after process restart. */
export async function runDurableToolWorker(limit = 10, signal?: AbortSignal) {
  const store = runtimeDurableStore();

  await reconcileInactiveDurableMissions(store);
  const dataFile =
    process.env["AI_OFFICE_DATA_FILE"] ?? path.join(process.cwd(), "data", "ai-office.json");
  const artifacts = new FileArtifactStore(
    process.env["AI_OFFICE_ARTIFACT_DIR"] ?? path.join(path.dirname(dataFile), "artifacts"),
  );
  const [{ data: agents }, { data: missions }] = await Promise.all([
    localDbServer.from("agents").select("id,external_config"),
    localDbServer.from("missions").select("id,mission_contract"),
  ]);

  // PEP immediately before a local side effect. The authorizer reloads current
  // permissions/agent/mission/approval state for every execution.
  const authorizer = new OperationalToolAuthorizer(store);
  const executor = new DurableLocalToolExecutor(
    (request, approved) => {
      const agent = agents?.find((candidate) => candidate.id === request.agentId);
      const mission = missions?.find((candidate) => candidate.id === request.missionId);

      const contract =
        mission?.mission_contract &&
        typeof mission.mission_contract === "object" &&
        !Array.isArray(mission.mission_contract)
          ? (mission.mission_contract as Record<string, unknown>)
          : {};
      const missionWorkspace = contract["workspace"];
      const agentWorkspace = (
        agent?.external_config as Record<string, unknown> | null | undefined
      )?.["workspace"];
      const workspace =
        typeof missionWorkspace === "string" && path.isAbsolute(missionWorkspace)
          ? missionWorkspace
          : typeof agentWorkspace === "string" && path.isAbsolute(agentWorkspace)
            ? agentWorkspace
            : process.cwd();

      const allowedRoots = [workspace];
      const registry = new ToolRegistry();
      for (const handler of createLocalToolHandlers(allowedRoots)) registry.register(handler);

      return new ToolExecutionGateway(
        registry,
        new DefaultDenyToolPolicy({
          allowedTools: [request.toolId],
          approvedToolCallIds: approved ? new Set([request.toolCallId]) : new Set(),
        }),
        artifacts,
      );
    },
    artifacts,
    authorizer,
  );

  const worker = new ToolExecutionWorker(`tool-worker:${process.pid}`, store, executor);
  let processed = 0;
  while (processed < Math.max(1, Math.min(limit, 100)) && !signal?.aborted) {
    const result = await worker.runOnce(signal);
    if (!result) break;
    processed++;
  }
  return processed;
}
