import type { WorkerResponse } from "./providers/types";
import { TOOL_MAP } from "./tools/catalog";

export function enforceRuntimeEvidence(
  response: WorkerResponse,
  simulated: boolean,
  requiresRuntimeEvidence = false,
  verifiedEvidenceCount = 0,
): WorkerResponse {
  if (simulated) return response;

  // A response that contains executable tool calls is not asking the
  // human/manager for clarification. It is waiting for the deterministic
  // runtime to execute those calls and return verified evidence.
  //
  // Models sometimes return NEEDS_CLARIFICATION while simultaneously
  // supplying valid toolCalls. Treat that combination as WAITING_TOOL
  // (represented internally by BLOCKED) so collectTask follows the durable
  // tool path instead of failing the task.
  if (
    response.toolCalls.length > 0 &&
    (response.status === "COMPLETED" ||
      response.status === "NEEDS_CLARIFICATION" ||
      response.status === "BLOCKED")
  ) {
    return {
      ...response,
      status: "BLOCKED",
      summary: "Tool execution requested; awaiting deterministic runtime evidence.",
    };
  }

  if (response.status === "COMPLETED" && requiresRuntimeEvidence && verifiedEvidenceCount <= 0) {
    return {
      ...response,
      status: "BLOCKED",
      summary: "Runtime evidence is required before completion.",
    };
  }

  return response;
}
export function validateRuntimeToolRequests(
  response: WorkerResponse,
  allowedTools: readonly string[],
  hasVerifiedRuntimeEvidence = false,
): string | null {
  const allowed = new Set(allowedTools);

  if (
    allowedTools.length > 0 &&
    response.status === "COMPLETED" &&
    response.toolCalls.length === 0 &&
    !hasVerifiedRuntimeEvidence
  ) {
    return "TOOL_CALL_REQUIRED: task requires runtime evidence but the worker returned no executable tool request.";
  }

  if (response.status === "BLOCKED" && response.toolCalls.length === 0) {
    return "TOOL_CALL_INVALID: worker returned BLOCKED without an executable tool request.";
  }

  for (const call of response.toolCalls) {
    if (!allowed.has(call.toolId)) {
      return `TOOL_CALL_INVALID: ${call.toolId} is not allowed for this command.`;
    }

    const definition = TOOL_MAP[call.toolId];

    if (!definition) {
      return `TOOL_CALL_INVALID: unknown tool ${call.toolId}.`;
    }

    if (!call.arguments || Array.isArray(call.arguments) || typeof call.arguments !== "object") {
      return `TOOL_CALL_INVALID: ${call.toolId} must include an arguments object.`;
    }

    const missing = Object.entries(definition.inputSchema)
      .filter(([key, spec]) => {
        const optional = String(spec).includes("?");
        return !optional && !(key in call.arguments!);
      })
      .map(([key]) => key);

    if (missing.length > 0) {
      return `TOOL_CALL_INVALID: ${call.toolId} missing required arguments: ${missing.join(", ")}.`;
    }
  }

  return null;
}
