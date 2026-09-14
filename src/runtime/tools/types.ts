import { z } from "zod";

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
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
