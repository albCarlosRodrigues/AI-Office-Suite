import { z } from "zod";

export const ModelTierSchema = z.enum(["TIER_0", "TIER_1", "TIER_2", "TIER_3", "TIER_4"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  gate: z.object({ type: z.string().min(1), config: z.record(z.unknown()).default({}) }).optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const TaskContractSchema = z.object({
  taskId: z.string().min(1),
  taskCode: z.string().min(1),
  objective: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  expectedArtifacts: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  forbiddenActions: z.array(z.string()).default([]),
  maxAttempts: z.number().int().positive(),
  tokenBudget: z.number().int().nonnegative(),
  costBudget: z.number().nonnegative(),
  modelTier: ModelTierSchema,
  executionMode: z.enum(["SIMULATION", "REAL"]),
});
export type TaskContract = z.infer<typeof TaskContractSchema>;

export const MissionContractSchema = z.object({
  missionId: z.string().min(1),
  goal: z.string().min(1),
  scope: z.array(z.string()),
  nonGoals: z.array(z.string()),
  constraints: z.array(z.string()),
  globalDecisions: z.array(z.string()),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  taskContracts: z.array(TaskContractSchema).min(1),
  allowedTools: z.array(z.string()),
  forbiddenActions: z.array(z.string()),
  tokenBudget: z.number().int().nonnegative(),
  costBudget: z.number().nonnegative(),
  maxSteps: z.number().int().positive(),
  maxEscalations: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  version: z.number().int().positive(),
  decompositionMode: z.enum(["partition", "relay", "layered", "single"]),
});
export type MissionContract = z.infer<typeof MissionContractSchema>;

/** A retry may add failure data, but never mutate its original contract. */
export function retryContext<T extends TaskContract>(
  contract: T,
  attempt: number,
  failureEvidence: readonly string[],
  reviewFeedback?: string,
) {
  return Object.freeze({
    contract: structuredClone(contract),
    attempt,
    failureEvidence: [...failureEvidence],
    reviewFeedback,
  });
}
