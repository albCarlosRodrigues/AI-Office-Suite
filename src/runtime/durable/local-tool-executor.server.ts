import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ArtifactSink, ToolExecutionGateway } from "../tools/gateway";
import type { ToolResult } from "../tools/types";
import type { DurableToolExecutor } from "./tool-worker.server";
import type { DurableToolRequest } from "./types";

export class DurableLocalToolExecutor implements DurableToolExecutor {
  constructor(
    private readonly gatewayFactory: (
      request: DurableToolRequest,
      approved: boolean,
    ) => ToolExecutionGateway,
    private readonly artifacts: ArtifactSink,
  ) {}

  execute(request: DurableToolRequest, approved: boolean, signal?: AbortSignal) {
    return this.gatewayFactory(request, approved).execute(
      {
        toolCallId: request.toolCallId,
        missionId: request.missionId,
        taskId: request.taskId,
        agentId: request.agentId,
        toolId: request.toolId,
        arguments: request.arguments,
        idempotencyKey: request.idempotencyKey,
      },
      signal,
    );
  }

  async probeCompletedEffect(request: DurableToolRequest): Promise<ToolResult | null> {
    if (request.toolId !== "filesystem_write") return null;
    const file = request.arguments["path"];
    const content = request.arguments["content"];
    if (typeof file !== "string" || typeof content !== "string") return null;
    let actual: Buffer;
    try {
      actual = await readFile(file);
    } catch {
      return null;
    }
    const expected = Buffer.from(content);
    if (!actual.equals(expected)) return null;
    const sha256 = createHash("sha256").update(actual).digest("hex");
    const evidence = await this.artifacts.put(
      JSON.stringify({ path: file, operation: "write", afterHash: sha256, recovered: true }),
    );
    const timestamp = new Date().toISOString();
    return {
      toolCallId: request.toolCallId,
      toolId: request.toolId,
      status: "COMPLETED",
      exitCode: 0,
      stdoutArtifactRef: evidence.artifactRef,
      stderrArtifactRef: null,
      startedAt: timestamp,
      completedAt: timestamp,
      executor: "local-runtime",
      verified: true,
    };
  }
}
