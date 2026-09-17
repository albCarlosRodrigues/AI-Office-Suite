import { createHash } from "node:crypto";
import { RuntimeToolError, type RuntimeErrorShape } from "../errors/runtime-errors";
import type { ToolRequest } from "./types";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function failedRequestFingerprint(
  request: Pick<ToolRequest, "toolId" | "taskId" | "arguments">,
  errorCode: string,
) {
  return sha256(`${request.toolId}|${stable(request.arguments)}|${errorCode}|${request.taskId}`);
}

function requestKey(request: Pick<ToolRequest, "toolId" | "taskId" | "arguments">) {
  return sha256(`${request.toolId}|${stable(request.arguments)}|${request.taskId}`);
}

type Failure = {
  fingerprint: string;
  error: RuntimeErrorShape;
  expiresAt: number;
};

export class FailedToolRequestGuard {
  private readonly failures = new Map<string, Failure>();

  constructor(private readonly ttlMs = 15 * 60_000) {}

  assertAllowed(request: ToolRequest) {
    const key = requestKey(request);
    const prior = this.failures.get(key);
    if (!prior) return;

    if (prior.expiresAt <= Date.now()) {
      this.failures.delete(key);
      return;
    }

    throw new RuntimeToolError({
      code: "DUPLICATE_FAILED_REQUEST",
      category: "CORRECTABLE",
      retryable: false,
      message:
        `Identical ${request.toolId} request is blocked after deterministic failure ` +
        `${prior.error.code}. Change the arguments or resolve the cause before retrying.`,
      suggestedAction: prior.error.suggestedAction ?? "Change the tool arguments before retrying.",
      causeCode: prior.error.code,
    });
  }

  recordFailure(request: ToolRequest, error: RuntimeErrorShape) {
    if (error.retryable) return;
    const key = requestKey(request);
    this.failures.set(key, {
      fingerprint: failedRequestFingerprint(request, error.code),
      error,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(request: ToolRequest) {
    this.failures.delete(requestKey(request));
  }
}

export const runtimeFailedToolRequestGuard = new FailedToolRequestGuard();
