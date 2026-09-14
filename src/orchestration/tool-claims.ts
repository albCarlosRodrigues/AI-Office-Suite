import type { WorkerResponse } from "./providers/types";

export function enforceRuntimeEvidence(
  response: WorkerResponse,
  simulated: boolean,
  requiresRuntimeEvidence = false,
  verifiedEvidenceCount = 0,
): WorkerResponse {
  if (
    simulated ||
    response.status !== "COMPLETED" ||
    (!response.toolCalls.length && (!requiresRuntimeEvidence || verifiedEvidenceCount > 0))
  )
    return response;
  return {
    ...response,
    status: "BLOCKED",
    summary: "Tool execution requested; awaiting deterministic runtime evidence.",
  };
}
