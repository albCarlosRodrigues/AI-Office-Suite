import type { AgentStatus, CommandStatus, MissionStatus, TaskStatus } from "@/types/domain";

function assertTransition<T extends string>(
  name: string,
  from: T,
  to: T,
  allowed: Record<T, readonly T[]>,
  event?: string,
) {
  if (from === to) return;
  if (name === "task" && from === "running" && to === "queued" && event === "RETRY") return;
  if (!allowed[from]?.includes(to))
    throw new Error(
      `INVALID_${name.toUpperCase()}_TRANSITION: ${from} → ${to}${event ? ` (${event})` : ""}`,
    );
}

const missionTransitions: Record<MissionStatus, readonly MissionStatus[]> = {
  DRAFT: ["PLANNING", "STOPPED"],
  PLANNING: ["RUNNING", "FAILED", "STOPPED"],
  RUNNING: ["WAITING_APPROVAL", "REVIEWING", "COMPLETED", "FAILED", "STOPPED"],
  WAITING_APPROVAL: ["RUNNING", "FAILED", "STOPPED"],
  REVIEWING: ["RUNNING", "COMPLETED", "FAILED", "STOPPED"],
  COMPLETED: [],
  FAILED: ["PLANNING"],
  STOPPED: ["PLANNING"],
};

const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "waiting", "blocked", "cancelled"],
  running: ["waiting", "completed", "failed", "blocked", "cancelled"],
  waiting: ["queued", "completed", "failed", "blocked", "cancelled"],
  blocked: ["queued", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: ["queued"],
};

const commandTransitions: Record<CommandStatus, readonly CommandStatus[]> = {
  PENDING: ["ACCEPTED", "RUNNING", "BLOCKED", "FAILED", "CANCELLED"],
  ACCEPTED: ["RUNNING", "COMPLETED", "FAILED", "BLOCKED", "CANCELLED"],
  RUNNING: [
    "COMPLETED",
    "FAILED",
    "BLOCKED",
    "NEEDS_CLARIFICATION",
    "REQUEST_PERMISSION",
    "REQUEST_SCOPE_EXTENSION",
    "CANCELLED",
  ],
  COMPLETED: [],
  FAILED: [],
  BLOCKED: ["PENDING", "CANCELLED"],
  NEEDS_CLARIFICATION: ["PENDING", "CANCELLED"],
  REQUEST_PERMISSION: ["PENDING", "BLOCKED", "CANCELLED"],
  REQUEST_SCOPE_EXTENSION: ["PENDING", "BLOCKED", "CANCELLED"],
  CANCELLED: [],
};

export const MissionStateMachine = {
  assert: (from: MissionStatus, to: MissionStatus, event?: string) =>
    assertTransition("mission", from, to, missionTransitions, event),
};
export const TaskStateMachine = {
  assert: (from: TaskStatus, to: TaskStatus, event?: string) =>
    assertTransition("task", from, to, taskTransitions, event),
};
export const CommandStateMachine = {
  assert: (from: CommandStatus, to: CommandStatus, event?: string) =>
    assertTransition("command", from, to, commandTransitions, event),
};

const agentTransitions: Partial<Record<AgentStatus, readonly AgentStatus[]>> = {
  OFFLINE: ["IDLE"],
  PAUSED: ["IDLE", "OFFLINE"],
  ERROR: ["IDLE", "OFFLINE", "PAUSED"],
};
export const AgentStateService = {
  assert(from: AgentStatus, to: AgentStatus) {
    const restricted = agentTransitions[from];
    if (restricted && from !== to && !restricted.includes(to))
      throw new Error(`INVALID_AGENT_TRANSITION: ${from} → ${to}`);
  },
};
