import type { ToolRequest } from "@/runtime/tools/types";
import { ToolRequestSchema } from "@/runtime/tools/types";
import type { ToolExecutionGateway } from "@/runtime/tools/gateway";

const aliases: Record<string, string> = {
  read: "repository_read",
  write: "repository_write",
  bash: "shell",
  apply_patch: "git_apply",
  git_status: "git_status",
  git_diff: "git_diff",
  project_run_tests: "testing",
  project_run_lint: "lint",
  project_run_typecheck: "typecheck",
  project_run_build: "build",
};
/** Only translates tool names. Identity, arguments, scope and approval stay in the runtime. */
export class LocalAntExecutionAdapter {
  static toolId(name: string) {
    return aliases[name] ?? name;
  }
  constructor(private gateway: ToolExecutionGateway) {}
  execute(request: ToolRequest, signal?: AbortSignal) {
    return this.gateway.execute(
      ToolRequestSchema.parse({
        ...request,
        toolId: LocalAntExecutionAdapter.toolId(request.toolId),
      }),
      signal,
    );
  }
}
