import type { RegisteredTool, ToolPolicy } from "./gateway";
import type { ToolRequest } from "./types";

export interface PolicyContext {
  allowedTools: readonly string[];
  approvedToolCallIds?: ReadonlySet<string>;
}
export class DefaultDenyToolPolicy implements ToolPolicy {
  constructor(private readonly context: PolicyContext) {}
  async evaluate(request: ToolRequest, tool: RegisteredTool) {
    if (!this.context.allowedTools.includes(tool.id)) return "DENY" as const;
    if (tool.risk >= 2 && !this.context.approvedToolCallIds?.has(request.toolCallId))
      return "APPROVAL_REQUIRED" as const;
    return "ALLOW" as const;
  }
}
