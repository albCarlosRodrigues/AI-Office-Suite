import type {
  Agent,
  Evidence,
  ProviderHealth,
  ProviderType,
  RiskLevel,
  WorkerResponseStatus,
} from "@/types/domain";

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  simulated: boolean;
}

export interface PlannedTask {
  code: string;
  title: string;
  description: string;
  /** abstract role — engine maps to a concrete subordinate */
  role: "research" | "analysis" | "implement" | "verify" | "design" | "docs" | "ops" | "security";
  dependsOn: string[];
  tools: string[];
  expectedOutput: string;
}

export interface PlanInput {
  goal: string;
  title: string;
  commander: Agent;
  team: Agent[];
  policies: string[];
  systemPrompt: string;
}

export interface PlanResult {
  rationale: string;
  tasks: PlannedTask[];
  usage: Usage;
}

export interface ExecInput {
  agent: Agent;
  systemPrompt: string;
  command: {
    id: string;
    missionId: string;
    taskId: string;
    parentCommandId: string | null;
    objective: string;
    instructions: string;
    expectedOutput: string;
    allowedTools: string[];
    forbiddenActions: string[];
    constraints: Record<string, unknown>;
    context: Record<string, unknown>;
    maxIterations: number;
    maxCost: number;
    timeout: number;
  };
}

export interface ToolCallRecord {
  toolId: string;
  input: string;
  output: string;
  risk: RiskLevel;
  latencyMs: number;
}

export interface WorkerResponse {
  status: WorkerResponseStatus;
  summary: string;
  evidence: Evidence[];
  toolCalls: ToolCallRecord[];
  clarification?: string;
  permissionRequest?: {
    action: string;
    reason: string;
    risk: RiskLevel;
    requiredPermissions: string[];
  };
  scopeExtension?: {
    requestedAction: string;
    reason: string;
    risk: RiskLevel;
    requiredPermissions: string[];
  };
  usage: Usage;
}

export interface ReviewInput {
  reviewer: Agent;
  systemPrompt: string;
  task: {
    code: string;
    title: string;
    description: string;
    expectedOutput: string;
    retries: number;
  };
  result: { summary: string; evidence: Evidence[] };
}

export interface ReviewResult {
  decision: "APPROVE" | "REVISE" | "REJECT";
  feedback: string;
  usage: Usage;
}

export interface MeetingTurnInput {
  speaker: Agent;
  systemPrompt: string;
  topic: string;
  round: number;
  transcript: { speaker: string; content: string }[];
}

export interface MeetingTurnResult {
  message: string;
  usage: Usage;
}

export interface SummaryInput {
  goal: string;
  tasks: { code: string; title: string; status: string; result: string | null }[];
  systemPrompt: string;
}

export interface SummaryResult {
  summary: string;
  usage: Usage;
}

export interface AgentProvider {
  readonly type: ProviderType;
  readonly simulated: boolean;
  readonly model: string;
  plan(input: PlanInput): Promise<PlanResult>;
  executeTask(input: ExecInput): Promise<WorkerResponse>;
  review(input: ReviewInput): Promise<ReviewResult>;
  meetingTurn(input: MeetingTurnInput): Promise<MeetingTurnResult>;
  summarize(input: SummaryInput): Promise<SummaryResult>;
  healthCheck(): Promise<{ health: ProviderHealth; latencyMs: number; message: string }>;
}

/** Rough cost estimate ($) shared by all providers. */
export function estimateCost(usage: Usage): number {
  const inRate = 0.0004 / 1000;
  const outRate = 0.0016 / 1000;
  return +(usage.tokensIn * inRate + usage.tokensOut * outRate).toFixed(6);
}
