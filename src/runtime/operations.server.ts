import { DurableRuntimeStore } from "./durable/store.server";
import { BackendHealthService } from "./durable/backend-health-service.server";

export type AgentPresenceStatus =
  | "IDLE"
  | "PLANNING"
  | "THINKING"
  | "WORKING"
  | "WAITING_TOOL"
  | "WAITING_APPROVAL"
  | "REVIEWING"
  | "BLOCKED"
  | "ERROR"
  | "OFFLINE";

export class AgentPresenceService {
  derive(input: {
    agentId: string;
    missionPhase?: string;
    taskStatus?: string;
    toolStatus?: string;
    lastSeenAt?: string;
    staleAfterMs?: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    let status: AgentPresenceStatus = "IDLE";
    if (
      input.lastSeenAt &&
      now - new Date(input.lastSeenAt).getTime() > (input.staleAfterMs ?? 60_000)
    )
      status = "OFFLINE";
    else if (["FAILED", "DEAD_LETTER"].includes(input.toolStatus ?? "")) status = "ERROR";
    else if (["FAILED", "BUDGET_BLOCKED"].includes(input.taskStatus ?? "")) status = "BLOCKED";
    else if (input.toolStatus === "WAITING_APPROVAL" || input.taskStatus === "WAITING_APPROVAL")
      status = "WAITING_APPROVAL";
    else if (
      ["REQUESTED", "READY", "CLAIMED"].includes(input.toolStatus ?? "") ||
      input.taskStatus === "WAITING_TOOL"
    )
      status = "WAITING_TOOL";
    else if (input.missionPhase === "planning") status = "PLANNING";
    else if (input.missionPhase === "reviewing") status = "REVIEWING";
    else if (input.toolStatus === "RUNNING" || input.taskStatus === "RUNNING") status = "WORKING";
    else if (input.missionPhase === "thinking") status = "THINKING";
    return { agentId: input.agentId, status };
  }
}

export class RuntimeOperationsService {
  constructor(private readonly store: DurableRuntimeStore) {}

  async snapshot(now = Date.now()) {
    const state = await this.store.snapshot();
    const healthService = new BackendHealthService(this.store);
    const backendHealth = await Promise.all(
      state.backendHealth.map((backend) => healthService.snapshot(backend.backendId, now)),
    );
    const consumed = state.budgetReservations.filter((item) => item.status === "CONSUMED");
    return {
      generatedAt: new Date(now).toISOString(),
      killSwitch: state.killSwitch,
      missions: {
        active: state.missions.filter((item) => item.status === "RUNNING").length,
        waitingApproval: state.missions.filter((item) => item.status === "WAITING_APPROVAL").length,
      },
      tasks: {
        queued: state.tasks.filter((item) => item.status === "QUEUED").length,
        waitingTool: state.tasks.filter((item) => item.status === "WAITING_TOOL").length,
        blocked: state.tasks.filter((item) => ["FAILED", "BUDGET_BLOCKED"].includes(item.status))
          .length,
      },
      workers: state.workerHeartbeats,
      backendHealth,
      approvals: state.approvals.filter((item) => item.status === "PENDING"),
      deadLetters: state.toolRequests.filter((item) => item.status === "DEAD_LETTER"),
      recoveries: state.recoveryHistory,
      usage: {
        tokens: consumed.reduce((sum, item) => sum + (item.actualTokens ?? 0), 0),
        cost: consumed.reduce((sum, item) => sum + (item.actualCost ?? 0), 0),
        reservedCost: state.budgetReservations
          .filter((item) => item.status === "RESERVED")
          .reduce((sum, item) => sum + item.reservedCost, 0),
      },
      decisions: state.metrics.filter((item) =>
        ["fallback_count", "economic_downgrade_count", "escalation_count"].includes(item.name),
      ),
    };
  }

  async presence(staleAfterMs = 60_000, now = Date.now()) {
    const state = await this.store.snapshot();
    const agentIds = new Set(state.toolRequests.map((item) => item.agentId));
    const presence = new AgentPresenceService();
    return [...agentIds].map((agentId) => {
      const requests = state.toolRequests.filter((item) => item.agentId === agentId);
      const active = requests.find((item) =>
        [
          "RUNNING",
          "WAITING_APPROVAL",
          "REQUESTED",
          "READY",
          "CLAIMED",
          "FAILED",
          "DEAD_LETTER",
        ].includes(item.status),
      );
      return presence.derive({
        agentId,
        ...(active
          ? { toolStatus: active.status, lastSeenAt: active.heartbeatAt ?? active.createdAt }
          : {}),
        staleAfterMs,
        now,
      });
    });
  }
}
