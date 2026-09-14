import type { ToolResult } from "../tools/types";

export type ToolRequestStatus =
  | "REQUESTED"
  | "WAITING_APPROVAL"
  | "READY"
  | "CLAIMED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "DENIED"
  | "DEAD_LETTER";
export type ApprovalScope = "ONCE" | "MISSION" | "PERSISTENT";

export interface DurableToolRequest {
  toolCallId: string;
  missionId: string;
  taskId: string;
  commandId: string;
  agentRunId: string;
  agentId: string;
  toolId: string;
  arguments: Record<string, unknown>;
  inputHash: string;
  riskLevel: number;
  approvalPolicy: "AUTO" | "REQUIRE_APPROVAL";
  policyVersion: string;
  status: ToolRequestStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  availableAt: string;
  claimedBy: string | null;
  claimToken: string | null;
  claimVersion: number;
  cancellationVersion: number;
  claimExpiresAt: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  idempotencyKey: string;
  toolResultId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  failureHistory: Array<{ at: string; code: string; message: string }>;
}

export interface DurableToolResult {
  id: string;
  toolCallId: string;
  result: ToolResult;
  recoveredEffect: boolean;
  createdAt: string;
}

export interface DurableApproval {
  approvalId: string;
  missionId: string;
  taskId: string;
  toolCallId: string;
  requester: string;
  riskLevel: number;
  reason: string;
  scope: ApprovalScope;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED";
  requestedAt: string;
  expiresAt: string;
  decision: string | null;
  decisionBy: string | null;
  decisionAt: string | null;
  toolId: string;
  inputHash: string;
  policyVersion: string;
}

export interface IdempotencyRecord {
  idempotencyKey: string;
  operationType: string;
  status: "RESERVED" | "RUNNING" | "COMPLETED" | "FAILED_RETRYABLE" | "FAILED_FINAL";
  resultRef: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface BudgetReservation {
  reservationId: string;
  missionId: string;
  taskId: string;
  provider: string;
  model: string;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  reservedCost: number;
  status: "RESERVED" | "CONSUMED" | "RELEASED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  reconciledAt: string | null;
  actualTokens: number | null;
  actualCost: number | null;
}

export interface DurableRateLimit {
  key: string;
  provider: string;
  model: string;
  windowStartedAt: string;
  windowMs: number;
  requestsConsumed: number;
  tokensConsumed: number;
  blockedUntil: string | null;
  updatedAt: string;
  version: number;
}

export interface OutboxEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  publishedAt: string | null;
  attempt: number;
}

export interface DurableMission {
  id: string;
  status: "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";
  updatedAt: string;
  lastProgressAt: string;
}

export interface DurableTask {
  id: string;
  missionId: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "WAITING_TOOL"
    | "WAITING_APPROVAL"
    | "READY_TO_RESUME"
    | "COMPLETED"
    | "FAILED"
    | "BUDGET_BLOCKED"
    | "CANCELLED";
  continuation: Record<string, unknown> | null;
  updatedAt: string;
}

export interface DurableAudit {
  id: string;
  event: string;
  at: string;
  missionId?: string;
  taskId?: string;
  toolCallId?: string;
  data?: Record<string, unknown>;
}

export interface DurableMetric {
  name: string;
  value: number;
  at: string;
  missionId?: string;
  taskId?: string;
  commandId?: string;
  agentRunId?: string;
  toolCallId?: string;
  provider?: string;
  model?: string;
  attributes?: Record<string, unknown>;
}

export interface CancellationTokenRecord {
  id: string;
  scopeType: "MISSION" | "TASK" | "AGENT_RUN";
  scopeId: string;
  missionId: string;
  taskId?: string;
  agentRunId?: string;
  status: "REQUESTED" | "OBSERVED" | "COMPLETED";
  reason: string;
  requestedAt: string;
  requestedBy: string;
  version: number;
}

export interface BackendHealthRecord {
  backendId: string;
  provider: string;
  model: string;
  configured: boolean;
  credentialsAvailable: boolean;
  enabled: boolean;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
  successes: number;
  failures: number;
  latenciesMs: number[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  rateLimitedUntil: string | null;
  circuitOpenedAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
}

export interface WorkerHeartbeat {
  workerId: string;
  workerType: "MISSION" | "TOOL" | "OUTBOX" | "RECOVERY" | "HEALTH";
  startedAt: string;
  heartbeatAt: string;
  status: "STARTING" | "RUNNING" | "DEGRADED" | "STOPPING" | "STOPPED" | "FAILED";
  currentWork: string | null;
  restartCount: number;
  lastError: string | null;
}

export interface TraceEvent {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  timestamp: string;
  durationMs?: number;
  status: string;
  missionId?: string;
  taskId?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  toolCallId?: string;
  attributes?: Record<string, unknown>;
}

export interface DurableRuntimeState {
  version: 1;
  killSwitch: boolean;
  missions: DurableMission[];
  tasks: DurableTask[];
  toolRequests: DurableToolRequest[];
  toolResults: DurableToolResult[];
  approvals: DurableApproval[];
  idempotencyRecords: IdempotencyRecord[];
  budgetReservations: BudgetReservation[];
  rateLimits: DurableRateLimit[];
  outboxEvents: OutboxEvent[];
  processedEvents: Array<{ consumer: string; eventId: string; processedAt: string }>;
  metrics: DurableMetric[];
  audits: DurableAudit[];
  cancellations: CancellationTokenRecord[];
  backendHealth: BackendHealthRecord[];
  workerHeartbeats: WorkerHeartbeat[];
  traces: TraceEvent[];
  recoveryHistory: Array<{
    id: string;
    entityType: string;
    entityId: string;
    reason: string;
    originalState: string;
    newState: string;
    timestamp: string;
  }>;
}

export function emptyDurableRuntimeState(): DurableRuntimeState {
  return {
    version: 1,
    killSwitch: false,
    missions: [],
    tasks: [],
    toolRequests: [],
    toolResults: [],
    approvals: [],
    idempotencyRecords: [],
    budgetReservations: [],
    rateLimits: [],
    outboxEvents: [],
    processedEvents: [],
    metrics: [],
    audits: [],
    cancellations: [],
    backendHealth: [],
    workerHeartbeats: [],
    traces: [],
    recoveryHistory: [],
  };
}
