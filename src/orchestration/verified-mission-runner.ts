import { MissionContractSchema, type MissionContract } from "./contracts";
import type { ExecutionBackend } from "./execution-backend";
import type { GateResult } from "@/runtime/gates";
import { ToolResultSchema, type ToolRequest, type ToolResult } from "@/runtime/tools/types";

export interface PlannedToolTask {
  taskId: string;
  request: ToolRequest;
  gates: Array<(result: ToolResult) => Promise<GateResult> | GateResult>;
}

export interface VerifiedMissionResult {
  missionId: string;
  status: "COMPLETED" | "BLOCKED";
  backendId: string;
  toolResults: ToolResult[];
  gateResults: GateResult[];
}

/** Runs a deterministic plan without accepting a worker's prose as completion evidence. */
export class VerifiedMissionRunner {
  constructor(private readonly backend: ExecutionBackend) {}

  async run(contractInput: MissionContract, plan: readonly PlannedToolTask[]) {
    const contract = MissionContractSchema.parse(contractInput);
    const knownTasks = new Set(contract.taskContracts.map((task) => task.taskId));
    const toolResults: ToolResult[] = [];
    const gateResults: GateResult[] = [];
    let backendId = this.backend.id;

    for (const item of plan) {
      if (!knownTasks.has(item.taskId) || item.request.missionId !== contract.missionId)
        throw new Error("PLAN_OUTSIDE_MISSION_CONTRACT");
      const execution = await this.backend.execute({ taskId: item.taskId, payload: item.request });
      backendId = execution.backendId;
      const parsed = ToolResultSchema.safeParse(execution.result);
      if (!parsed.success || execution.status !== "COMPLETED")
        return {
          missionId: contract.missionId,
          status: "BLOCKED",
          backendId,
          toolResults,
          gateResults,
        } satisfies VerifiedMissionResult;
      toolResults.push(parsed.data);
      for (const gate of item.gates) gateResults.push(await gate(parsed.data));
    }

    return {
      missionId: contract.missionId,
      status:
        gateResults.length > 0 && gateResults.every((gate) => gate.passed)
          ? "COMPLETED"
          : "BLOCKED",
      backendId,
      toolResults,
      gateResults,
    } satisfies VerifiedMissionResult;
  }
}
