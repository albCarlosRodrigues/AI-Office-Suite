import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const state = z.enum(["STOPPED", "STARTING", "RUNNING", "STOPPING", "FAILED", "READY"]);
const statusSchema = z.object({
  timestamp: z.string(),
  system: state,
  gpt: state.optional(),
  claudinho: state.optional(),
  prx: state.optional(),
  error: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
});
export const startupStatus = createServerFn({ method: "GET" }).handler(async () => {
  const file = process.env["AI_OFFICE_DATA_FILE"];
  if (!file) return null;
  try {
    return statusSchema.parse(
      JSON.parse(await readFile(join(dirname(file), "startup", "status.json"), "utf8")),
    );
  } catch {
    return null;
  }
});
