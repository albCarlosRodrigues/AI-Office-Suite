import path from "node:path";
import { localDbServer } from "@/local/database.server";
import { FileArtifactStore } from "@/runtime/artifact-store.server";
import { DurableLocalToolExecutor } from "@/runtime/durable/local-tool-executor.server";
import { runtimeDurableStore } from "@/runtime/durable/store.server";
import { ToolExecutionWorker } from "@/runtime/durable/tool-worker.server";
import { ToolExecutionGateway, ToolRegistry } from "@/runtime/tools/gateway";
import { createLocalToolHandlers } from "@/runtime/tools/handlers.server";
import { DefaultDenyToolPolicy } from "@/runtime/tools/policy";

/** Bounded autonomous worker pass; safe to invoke again after process restart. */
export async function runDurableToolWorker(limit = 10, signal?: AbortSignal) {
  const store = runtimeDurableStore();
  const dataFile =
    process.env["AI_OFFICE_DATA_FILE"] ?? path.join(process.cwd(), "data", "ai-office.json");
  const artifacts = new FileArtifactStore(
    process.env["AI_OFFICE_ARTIFACT_DIR"] ?? path.join(path.dirname(dataFile), "artifacts"),
  );
  const { data: agents } = await localDbServer.from("agents").select("id,external_config");
  const executor = new DurableLocalToolExecutor((request, approved) => {
    const agent = agents?.find((candidate) => candidate.id === request.agentId);
    const workspace = (agent?.external_config as Record<string, unknown>)?.["workspace"];
    const allowedRoots =
      typeof workspace === "string" && path.isAbsolute(workspace) ? [workspace] : [process.cwd()];
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
  }, artifacts);
  const worker = new ToolExecutionWorker(`tool-worker:${process.pid}`, store, executor);
  let processed = 0;
  while (processed < Math.max(1, Math.min(limit, 100)) && !signal?.aborted) {
    const result = await worker.runOnce(signal);
    if (!result) break;
    processed++;
  }
  return processed;
}
