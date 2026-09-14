import { z } from "zod";
export const ManagerRequestSchema = z
  .object({
    missionId: z.string(),
    taskId: z.string(),
    agentRunId: z.string(),
    fromAgent: z.string(),
    toAgent: z.string(),
    objective: z.string(),
    workerSummary: z.string().max(6000),
    question: z.string().max(3000),
    evidenceRefs: z.array(z.string()),
    artifactRefs: z.array(z.string()),
    availableActions: z.array(z.string()),
  })
  .strict();
export const ManagerResponseSchema = z
  .object({
    decision: z.enum(["CONTINUE", "REVISE", "REQUEST_TOOL", "ESCALATE", "STOP"]),
    instructions: z.string().max(6000),
    approvedActions: z.array(z.string()),
    requestedTools: z.array(
      z.object({ toolId: z.string(), arguments: z.record(z.unknown()) }).strict(),
    ),
    escalationRequired: z.boolean(),
    summary: z.string().max(3000),
  })
  .strict();
export type ManagerRequest = z.infer<typeof ManagerRequestSchema>;
export type ManagerResponse = z.infer<typeof ManagerResponseSchema>;
