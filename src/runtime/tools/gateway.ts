import type { ToolRequest, ToolResult } from "./types";
import { redact } from "../security/redaction";
import { RuntimeToolError, classifyRuntimeError } from "../errors/runtime-errors";
import {
  runtimeFailedToolRequestGuard,
  type FailedToolRequestGuard,
} from "./duplicate-failure-guard";

export type ToolRisk = 0 | 1 | 2 | 3 | 4;
export interface ToolHandlerOutput {
  exitCode: number | null;
  stdout?: string | Uint8Array;
  stderr?: string | Uint8Array;
  termination?: "timeout" | "cancelled";
}
export interface ArtifactSink {
  put(content: string | Uint8Array, mediaType?: string): Promise<{ artifactRef: string }>;
}
export interface RegisteredTool {
  id: string;
  risk: ToolRisk;
  execute(request: ToolRequest, signal?: AbortSignal): Promise<ToolHandlerOutput>;
}
export interface ToolPolicy {
  evaluate(
    request: ToolRequest,
    tool: RegisteredTool,
  ): Promise<"ALLOW" | "APPROVAL_REQUIRED" | "DENY">;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  register(tool: RegisteredTool) {
    this.tools.set(tool.id, tool);
  }
  get(id: string) {
    return this.tools.get(id);
  }
}

export class ToolExecutionGateway {
  private readonly completed = new Map<string, ToolResult>();
  constructor(
    private registry: ToolRegistry,
    private policy: ToolPolicy,
    private artifacts: ArtifactSink,
    private failedRequestGuard: FailedToolRequestGuard = runtimeFailedToolRequestGuard,
  ) {}

  async execute(request: ToolRequest, signal?: AbortSignal): Promise<ToolResult> {
    const prior = this.completed.get(request.idempotencyKey);
    if (prior) return prior;
    const tool = this.registry.get(request.toolId);
    if (!tool) {
      throw new RuntimeToolError({
        code: "UNKNOWN_TOOL",
        category: "FATAL",
        retryable: false,
        message: `UNKNOWN_TOOL:${request.toolId}`,
      });
    }

    const decision = await this.policy.evaluate(request, tool);
    if (decision === "APPROVAL_REQUIRED") {
      throw new RuntimeToolError({
        code: "APPROVAL_REQUIRED",
        category: "PERMISSION",
        retryable: false,
        message: decision,
      });
    }
    if (decision === "DENY") {
      throw new RuntimeToolError({
        code: "POLICY_DENIED",
        category: "POLICY",
        retryable: false,
        message: decision,
      });
    }

    this.failedRequestGuard.assertAllowed(request);
    const startedAt = new Date().toISOString();

    let raw: ToolHandlerOutput;
    try {
      raw = await tool.execute(request, signal);
    } catch (error) {
      const classified = classifyRuntimeError(error);
      this.failedRequestGuard.recordFailure(request, classified.toJSON());
      throw classified;
    }
    const safeContent = (value: string | Uint8Array) => {
      const text = typeof value === "string" ? value : new TextDecoder().decode(value);
      return String(redact(text));
    };
    const stdoutArtifactRef =
      raw.stdout === undefined
        ? null
        : (await this.artifacts.put(safeContent(raw.stdout))).artifactRef;
    const stderrArtifactRef =
      raw.stderr === undefined
        ? null
        : (await this.artifacts.put(safeContent(raw.stderr))).artifactRef;
    const failure =
      raw.termination === "timeout"
        ? new RuntimeToolError({
            code: "PROCESS_TIMEOUT",
            category: "TRANSIENT",
            retryable: true,
            message: "Tool process timed out.",
          })
        : raw.termination === "cancelled"
          ? new RuntimeToolError({
              code: "EXECUTION_CANCELLED",
              category: "FATAL",
              retryable: false,
              message: "Tool execution was cancelled.",
            })
          : raw.exitCode === 0
            ? null
            : new RuntimeToolError({
                code: "TOOL_EXIT_NONZERO",
                category: "CORRECTABLE",
                retryable: false,
                message:
                  raw.stderr === undefined
                    ? `Tool exited with code ${String(raw.exitCode)}.`
                    : safeContent(raw.stderr),
              });

    if (failure) this.failedRequestGuard.recordFailure(request, failure.toJSON());
    else this.failedRequestGuard.clear(request);

    const result: ToolResult = {
      toolCallId: request.toolCallId,
      toolId: request.toolId,
      status:
        raw.termination === "cancelled" ? "CANCELLED" : raw.exitCode === 0 ? "COMPLETED" : "FAILED",
      exitCode: raw.exitCode,
      stdoutArtifactRef,
      stderrArtifactRef,
      startedAt,
      completedAt: new Date().toISOString(),
      executor: "local-runtime",
      verified: true,
      error: failure?.toJSON() ?? null,
    };
    this.completed.set(request.idempotencyKey, result);
    return result;
  }
}
