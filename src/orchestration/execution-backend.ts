export type BackendFailureCode =
  | "timeout"
  | "rate_limit"
  | "provider_unavailable"
  | "process_crashed"
  | "policy_denied"
  | "approval_required"
  | "safety_block"
  | "invalid_scope"
  | "budget_denied";
export interface BackendCapabilities {
  plan: boolean;
  execute: boolean;
  review: boolean;
  tools: string[];
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsReasoning?: boolean;
  supportsImages?: boolean;
  supportsLargeContext?: boolean;
  supportsLocalFilesystem?: boolean;
  supportsLongRunning?: boolean;
  supportsSessionResume?: boolean;
}
export interface BackendHealth {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  message: string;
}
export interface ExecutionInput {
  taskId: string;
  payload: unknown;
  missionId?: string;
  agentRunId?: string;
  provider?: string;
  model?: string;
}
export interface ExecutionOutput {
  status: "COMPLETED" | "FAILED";
  result: unknown;
  backendId: string;
  fallbackCount: number;
}
export interface ExecutionBackend {
  id: string;
  capabilities: BackendCapabilities;
  healthCheck(): Promise<BackendHealth>;
  execute(input: ExecutionInput, signal?: AbortSignal): Promise<ExecutionOutput>;
}
export interface BackendSelectionPolicy {
  canDispatch(backendId: string): Promise<boolean>;
}
export type BackendExecutionEvent = {
  kind: "TECHNICAL_FALLBACK";
  reason: BackendFailureCode;
  from: string;
  to: string;
  input: ExecutionInput;
};
export class BackendError extends Error {
  constructor(
    readonly code: BackendFailureCode,
    message: string,
  ) {
    super(message);
  }
}
const fallbackAllowed = new Set<BackendFailureCode>([
  "timeout",
  "rate_limit",
  "provider_unavailable",
  "process_crashed",
]);

export class ExecutionBackendRegistry {
  private backends = new Map<string, { backend: ExecutionBackend; priority: number }>();
  constructor(
    private readonly selectionPolicy?: BackendSelectionPolicy,
    private readonly observe?: (event: BackendExecutionEvent) => Promise<void> | void,
  ) {}
  register(backend: ExecutionBackend, priority = 100) {
    this.backends.set(backend.id, { backend, priority });
  }
  get(id: string) {
    return this.backends.get(id)?.backend;
  }
  async health() {
    return Promise.all(
      [...this.backends.values()].map(async ({ backend }) => ({
        id: backend.id,
        ...(await backend.healthCheck()),
      })),
    );
  }
  async execute(
    primary: string,
    fallbacks: readonly string[],
    input: ExecutionInput,
    signal?: AbortSignal,
  ): Promise<ExecutionOutput> {
    const chain = [primary, ...fallbacks];
    let fallbackCount = 0;
    for (const id of chain) {
      const backend = this.get(id);
      if (!backend) throw new BackendError("provider_unavailable", `BACKEND_NOT_FOUND:${id}`);
      if (this.selectionPolicy && !(await this.selectionPolicy.canDispatch(id))) {
        const next = chain[chain.indexOf(id) + 1];
        if (!next) throw new BackendError("provider_unavailable", `BACKEND_UNHEALTHY:${id}`);
        await this.observe?.({
          kind: "TECHNICAL_FALLBACK",
          reason: "provider_unavailable",
          from: id,
          to: next,
          input,
        });
        fallbackCount++;
        continue;
      }
      try {
        const result = await backend.execute(input, signal);
        return { ...result, fallbackCount };
      } catch (error) {
        const code = error instanceof BackendError ? error.code : "process_crashed";
        if (!fallbackAllowed.has(code) || id === chain.at(-1)) throw error;
        await this.observe?.({
          kind: "TECHNICAL_FALLBACK",
          reason: code,
          from: id,
          to: chain[chain.indexOf(id) + 1]!,
          input,
        });
        fallbackCount++;
      }
    }
    throw new BackendError("provider_unavailable", "NO_BACKEND_AVAILABLE");
  }
}
