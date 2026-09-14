import { DurableRuntimeStore } from "./store.server";

export interface RuntimeHealth {
  scheduler: "READY" | "PAUSED";
  toolWorkers: { activeLeases: number; expiredLeases: number };
  providerBackends: "UNKNOWN";
  pendingApprovals: number;
  queueDepth: number;
  stuckExecutions: number;
  openCircuits: number;
  rateLimitedProviders: number;
}

export class RuntimeHealthService {
  constructor(private readonly store: DurableRuntimeStore) {}
  async snapshot(now = Date.now()): Promise<RuntimeHealth> {
    const state = await this.store.snapshot();
    const running = state.toolRequests.filter((item) =>
      ["CLAIMED", "RUNNING"].includes(item.status),
    );
    const expired = running.filter(
      (item) => item.claimExpiresAt && new Date(item.claimExpiresAt).getTime() <= now,
    ).length;
    return {
      scheduler: state.killSwitch ? "PAUSED" : "READY",
      toolWorkers: { activeLeases: running.length - expired, expiredLeases: expired },
      providerBackends: "UNKNOWN",
      pendingApprovals: state.approvals.filter((item) => item.status === "PENDING").length,
      queueDepth: state.toolRequests.filter((item) =>
        ["READY", "WAITING_APPROVAL"].includes(item.status),
      ).length,
      stuckExecutions: expired + state.tasks.filter((item) => item.status === "RUNNING").length,
      openCircuits: 0,
      rateLimitedProviders: state.rateLimits.filter(
        (item) => item.blockedUntil && new Date(item.blockedUntil).getTime() > now,
      ).length,
    };
  }
}
