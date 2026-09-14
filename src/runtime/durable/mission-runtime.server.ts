import type { GateResult } from "../gates";
import type { ToolResult } from "../tools/types";
import { DurableRuntimeStore } from "./store.server";
import { DurableToolQueue, type EnqueueToolInput } from "./tool-queue.server";
import { addOutbox, audit, iso, metric } from "./helpers";
import type { DurableToolRequest } from "./types";
import { DurableApprovalService } from "./approval-service.server";

export class DurableMissionRuntime {
  readonly queue: DurableToolQueue;
  constructor(private readonly store: DurableRuntimeStore) {
    this.queue = new DurableToolQueue(store);
  }

  createMission(missionId: string, taskIds: string[], now = Date.now()) {
    return this.store.transaction((state) => {
      const created = !state.missions.some((item) => item.id === missionId);
      if (created)
        state.missions.push({
          id: missionId,
          status: "RUNNING",
          updatedAt: iso(now),
          lastProgressAt: iso(now),
        });
      for (const taskId of taskIds)
        if (!state.tasks.some((item) => item.id === taskId))
          state.tasks.push({
            id: taskId,
            missionId,
            status: "QUEUED",
            continuation: null,
            updatedAt: iso(now),
          });
      addOutbox(state, "TASK_READY", "mission", missionId, { taskIds }, now);
      return created;
    });
  }

  async requestTools(
    inputs: EnqueueToolInput[],
    continuation: Record<string, unknown>,
    now = Date.now(),
  ) {
    const requests: DurableToolRequest[] = [];
    for (const input of inputs) {
      const request = await this.queue.enqueue(input, now);
      requests.push(request);
      if (request.approvalPolicy === "REQUIRE_APPROVAL")
        await new DurableApprovalService(this.store).request(
          {
            missionId: request.missionId,
            taskId: request.taskId,
            toolCallId: request.toolCallId,
            requester: request.agentId,
            riskLevel: request.riskLevel,
            reason: `Policy requires approval for ${request.toolId}`,
            scope: "ONCE",
            toolId: request.toolId,
            inputHash: request.inputHash,
            policyVersion: request.policyVersion,
          },
          now,
        );
    }
    await this.store.transaction((state) => {
      const task = state.tasks.find((item) => item.id === inputs[0]?.taskId);
      if (task) {
        task.continuation = continuation;
        task.status = requests.some((item) => item.status === "WAITING_APPROVAL")
          ? "WAITING_APPROVAL"
          : "WAITING_TOOL";
        task.updatedAt = iso(now);
      }
    });
    return requests;
  }

  async resumeTask(
    taskId: string,
    gates: Array<(result: ToolResult) => Promise<GateResult> | GateResult>,
    now = Date.now(),
  ) {
    const snapshot = await this.store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "READY_TO_RESUME") return false;
    const requests = snapshot.toolRequests.filter((item) => item.taskId === taskId);
    if (!requests.length || requests.some((item) => item.status !== "COMPLETED")) return false;
    const results = requests.map((request) =>
      snapshot.toolResults.find((item) => item.id === request.toolResultId),
    );
    if (results.some((item) => !item)) return false;
    const started = Date.now();
    const gateResults: GateResult[] = [];
    for (const result of results)
      for (const gate of gates) gateResults.push(await gate(result!.result));
    const passed = gateResults.length > 0 && gateResults.every((gate) => gate.passed);
    return this.store.transaction((state) => {
      const currentTask = state.tasks.find((item) => item.id === taskId);
      const mission = state.missions.find((item) => item.id === task.missionId);
      if (!currentTask || !mission || mission.status === "CANCELLED") return false;
      currentTask.status = passed ? "COMPLETED" : "FAILED";
      currentTask.updatedAt = iso(now);
      mission.lastProgressAt = iso(now);
      mission.updatedAt = iso(now);
      metric(
        state,
        "gate_duration_ms",
        Date.now() - started,
        { missionId: mission.id, taskId },
        now,
      );
      if (
        passed &&
        state.tasks
          .filter((item) => item.missionId === mission.id)
          .every((item) => item.status === "COMPLETED")
      ) {
        mission.status = "COMPLETED";
        addOutbox(state, "MISSION_COMPLETED", "mission", mission.id, {}, now);
      } else if (!passed) mission.status = "FAILED";
      audit(
        state,
        passed ? "TASK_RESUMED_COMPLETED" : "TASK_GATE_FAILED",
        { missionId: mission.id, taskId },
        { gateResults },
        now,
      );
      return passed;
    });
  }
}
