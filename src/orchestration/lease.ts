import { z } from "zod";

export const MissionLeaseSchema = z.object({
  mission: z.object({ id: z.string(), current_step: z.number().int().nonnegative() }).passthrough(),
  leaseId: z.string().min(1),
  leaseVersion: z.number().int().positive(),
  expiresAt: z.string().datetime(),
});
export type MissionLease = z.infer<typeof MissionLeaseSchema>;

export function parseMissionLease(value: unknown): MissionLease {
  return MissionLeaseSchema.parse(value);
}
