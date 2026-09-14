import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { ToolResult } from "./tools/types";

export interface GateResult {
  passed: boolean;
  gate: string;
  reason: string;
}
export function commandExitGate(result: ToolResult, expected = 0): GateResult {
  const passed = result.verified && result.status === "COMPLETED" && result.exitCode === expected;
  return {
    passed,
    gate: "CommandExitGate",
    reason: passed
      ? `exitCode=${expected}`
      : `Expected verified exitCode=${expected}; received ${result.exitCode}`,
  };
}
export async function fileExistsGate(file: string): Promise<GateResult> {
  try {
    await stat(file);
    return { passed: true, gate: "FileExistsGate", reason: "file exists" };
  } catch {
    return { passed: false, gate: "FileExistsGate", reason: "file missing" };
  }
}
export async function contentGate(file: string, pattern: RegExp): Promise<GateResult> {
  const content = await readFile(file, "utf8");
  const passed = pattern.test(content);
  return {
    passed,
    gate: "ContentGate",
    reason: passed ? "content matched" : "required content missing",
  };
}
export function schemaGate(schema: z.ZodType, value: unknown): GateResult {
  const parsed = schema.safeParse(value);
  return {
    passed: parsed.success,
    gate: "SchemaGate",
    reason: parsed.success ? "schema valid" : parsed.error.message,
  };
}
