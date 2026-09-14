import { z } from "zod";

export const MissionResultEnvelopeSchema = z.object({
  missionId: z.string().min(1),
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"]),
  summary: z.string().min(1),
  criteria: z.object({ passed: z.array(z.string()), failed: z.array(z.string()) }),
  changes: z.array(z.object({ path: z.string(), summary: z.string() })),
  artifacts: z.array(
    z.object({ name: z.string(), artifactRef: z.string(), verified: z.boolean() }),
  ),
  evidence: z.array(
    z.object({
      taskId: z.string(),
      kind: z.string(),
      reference: z.string(),
      verified: z.boolean(),
    }),
  ),
  taskResults: z.array(
    z.object({ taskId: z.string(), agentId: z.string(), status: z.string(), summary: z.string() }),
  ),
  tests: z.array(z.object({ name: z.string(), passed: z.boolean(), evidenceRef: z.string() })),
  unresolved: z.array(z.string()),
  review: z.object({ reviewer: z.string(), approved: z.boolean(), notes: z.string() }),
  cost: z.object({
    total: z.number().nonnegative(),
    byProvider: z.record(z.number().nonnegative()),
    byModel: z.record(z.number().nonnegative()),
    byAgent: z.record(z.number().nonnegative()),
  }),
  tokens: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cached: z.number().nonnegative(),
  }),
  retries: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
  escalations: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type MissionResultEnvelope = z.infer<typeof MissionResultEnvelopeSchema>;

export function verifyMissionResult(value: unknown) {
  const result = MissionResultEnvelopeSchema.parse(value);
  if (result.status === "COMPLETED") {
    if (!result.review.approved) throw new Error("FINAL_REVIEW_REQUIRED");
    if (result.artifacts.some((item) => !item.verified)) throw new Error("UNVERIFIED_DELIVERABLE");
    if (result.evidence.length === 0 || result.evidence.some((item) => !item.verified))
      throw new Error("VERIFIED_EVIDENCE_REQUIRED");
    if (result.criteria.failed.length || result.tests.some((test) => !test.passed))
      throw new Error("FAILED_ACCEPTANCE_CRITERIA");
  }
  return result;
}
