import { verifyMissionResult, type MissionResultEnvelope } from "./mission-result";
import type { DurableTraceService } from "@/runtime/durable/trace-service.server";

export interface HierarchicalMissionDefinition {
  missionId: string;
  leaderId: string;
  managerId: string;
  workerIds: string[];
}

export interface HierarchicalMissionCallbacks<TPlan> {
  plan(): Promise<TPlan>;
  validateAndDelegate(plan: TPlan): Promise<void>;
  executeWorkers(plan: TPlan): Promise<void>;
  review(plan: TPlan): Promise<MissionResultEnvelope>;
}

/** Enforces the Leader -> Manager -> Workers -> Manager -> Leader product workflow. */
export class HierarchicalMissionCoordinator {
  constructor(private readonly traces: DurableTraceService) {}

  async run<TPlan>(
    definition: HierarchicalMissionDefinition,
    callbacks: HierarchicalMissionCallbacks<TPlan>,
  ) {
    const traceId = definition.missionId;
    const plan = await this.traces.span(
      {
        traceId,
        parentSpanId: null,
        name: "leader.plan",
        missionId: definition.missionId,
        agentId: definition.leaderId,
      },
      callbacks.plan,
    );
    await this.traces.span(
      {
        traceId,
        parentSpanId: null,
        name: "manager.delegate",
        missionId: definition.missionId,
        agentId: definition.managerId,
      },
      () => callbacks.validateAndDelegate(plan),
    );
    await this.traces.span(
      {
        traceId,
        parentSpanId: null,
        name: "workers.execute",
        missionId: definition.missionId,
        attributes: { workerIds: definition.workerIds },
      },
      () => callbacks.executeWorkers(plan),
    );
    const envelope = await this.traces.span(
      {
        traceId,
        parentSpanId: null,
        name: "leader.final-review",
        missionId: definition.missionId,
        agentId: definition.leaderId,
      },
      () => callbacks.review(plan),
    );
    return verifyMissionResult(envelope);
  }
}
