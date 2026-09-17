/**
 * Compatibility facade.
 * The canonical tool/security catalog lives in @/permissions/tool-registry.
 */
export {
  TOOL_CATALOG,
  TOOL_MAP,
  canonicalToolId,
  expandEnabledToolIds,
  getToolDefinition,
  isKnownTool,
  toolRequiresDurableApproval,
} from "@/permissions/tool-registry";
export type {
  ToolApprovalMode,
  ToolDataAccess,
  ToolDef,
  ToolExecutionBackend,
} from "@/permissions/tool-registry";
