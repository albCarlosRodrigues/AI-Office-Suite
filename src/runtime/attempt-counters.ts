export type AttemptDimension = "taskAttempt" | "toolAttempt" | "providerAttempt" | "httpAttempt";

export interface AttemptCounter {
  current: number;
  max: number;
}

export interface AttemptCounters {
  taskAttempt: AttemptCounter;
  toolAttempt: AttemptCounter;
  providerAttempt: AttemptCounter;
  httpAttempt: AttemptCounter;
}

export function boundedAttempt(current: number, max: number): AttemptCounter {
  const safeMax = Math.max(1, Math.trunc(max));
  return {
    current: Math.min(Math.max(1, Math.trunc(current)), safeMax),
    max: safeMax,
  };
}

export function taskAttemptCounter(retries: number, maxRetries: number): AttemptCounter {
  const safeMaxRetries = Math.max(0, Math.trunc(maxRetries));
  const safeRetries = Math.min(Math.max(0, Math.trunc(retries)), safeMaxRetries);
  return {
    current: safeRetries + 1,
    max: safeMaxRetries + 1,
  };
}

export function boundedRetryCount(retries: number, maxRetries: number): number {
  return Math.min(Math.max(0, Math.trunc(retries)), Math.max(0, Math.trunc(maxRetries)));
}
