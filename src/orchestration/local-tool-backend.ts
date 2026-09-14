import type { ToolExecutionGateway } from "@/runtime/tools/gateway";
import { ToolRequestSchema } from "@/runtime/tools/types";
import type {
  BackendHealth,
  ExecutionBackend,
  ExecutionInput,
  ExecutionOutput,
} from "./execution-backend";

export class LocalToolExecutionBackend implements ExecutionBackend {
  readonly id = "local-tool-runtime";
  readonly capabilities = {
    plan: false,
    execute: true,
    review: false,
    tools: [
      "filesystem_read",
      "filesystem_write",
      "repository_read",
      "repository_write",
      "shell",
      "git_status",
      "git_diff",
      "git_diff_check",
      "git_apply",
      "testing",
      "typecheck",
      "lint",
      "build",
    ],
  };
  constructor(private readonly gateway: ToolExecutionGateway) {}
  async healthCheck(): Promise<BackendHealth> {
    return { status: "HEALTHY", message: "local runtime ready" };
  }
  async execute(input: ExecutionInput, signal?: AbortSignal): Promise<ExecutionOutput> {
    const request = ToolRequestSchema.parse(input.payload);
    const result = await this.gateway.execute(request, signal);
    return {
      status: result.status === "COMPLETED" ? "COMPLETED" : "FAILED",
      result,
      backendId: this.id,
      fallbackCount: 0,
    };
  }
}
