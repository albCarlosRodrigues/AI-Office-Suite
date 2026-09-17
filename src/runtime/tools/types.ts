import { z } from "zod";

export const RuntimeErrorCategorySchema = z.enum([
  "TRANSIENT",
  "CORRECTABLE",
  "PERMISSION",
  "POLICY",
  "FATAL",
]);

export const RuntimeErrorShapeSchema = z.object({
  code: z.string().min(1),
  category: RuntimeErrorCategorySchema,
  retryable: z.boolean(),
  message: z.string(),
  suggestedAction: z.string().optional(),
  causeCode: z.string().optional(),
});

export const ToolRequestSchema = z.object({
  toolCallId: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  toolId: z.string().min(1),
  arguments: z.record(z.unknown()),
  idempotencyKey: z.string().min(1),
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  toolId: z.string(),
  status: z.enum(["COMPLETED", "FAILED", "DENIED", "CANCELLED"]),
  exitCode: z.number().int().nullable(),
  stdoutArtifactRef: z.string().nullable(),
  stderrArtifactRef: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  executor: z.literal("local-runtime"),
  verified: z.literal(true),
  error: RuntimeErrorShapeSchema.nullable().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
