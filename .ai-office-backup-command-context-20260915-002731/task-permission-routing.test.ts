import { describe, expect, it } from "vitest";
import type { Agent, AgentPermission } from "@/types/domain";
import {
  buildExecutionCandidates,
  filterAgentsByTaskPermissions,
  formatPlanningPermissionMatrix,
  missingPermissionsForTask,
  requiredPermissionsForTools,
} from "./task-permission-routing";

const catalog = {
  repository_read: { requiredPermissions: ["repository.read"] },
  shell: { requiredPermissions: ["shell.execute"] },
  github_issue_read: { requiredPermissions: ["github.issue.read"] },
};

function agent(id: string, name: string): Agent {
  return { id, name, capabilities: [] } as unknown as Agent;
}

function permission(agentId: string, value: string, granted = true): AgentPermission {
  return {
    agent_id: agentId,
    permission: value,
    granted,
  } as unknown as AgentPermission;
}

describe("permission-aware task routing", () => {
  it("derives every permission required by a task's tools", () => {
    expect(requiredPermissionsForTools(["repository_read", "shell"], catalog)).toEqual([
      "repository.read",
      "shell.execute",
    ]);
  });

  it("keeps a task away from a subordinate missing one required permission", () => {
    const manager = agent("manager", "GPT Manager");
    const worker = agent("worker", "Claudinho");
    const permissions = [
      permission(manager.id, "repository.read"),
      permission(manager.id, "shell.execute"),
      permission(worker.id, "repository.read"),
    ];
    const task = { tools: ["repository_read", "shell"] };

    expect(missingPermissionsForTask(task, worker, permissions, catalog)).toEqual([
      "shell.execute",
    ]);
    expect(
      filterAgentsByTaskPermissions(task, [manager, worker], permissions, catalog).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["manager"]);
  });

  it("always includes the commander as an execution candidate", () => {
    const manager = agent("manager", "GPT Manager");
    const worker = agent("worker", "Claudinho");
    expect(buildExecutionCandidates(manager, [worker]).map((candidate) => candidate.id)).toEqual([
      "manager",
      "worker",
    ]);
  });

  it("shows the planner the granted permissions and tool requirements", () => {
    const manager = agent("manager", "GPT Manager");
    const worker = agent("worker", "Claudinho");
    const matrix = formatPlanningPermissionMatrix(
      [manager, worker],
      [permission(manager.id, "shell.execute"), permission(worker.id, "repository.read")],
      manager.id,
      catalog,
    );

    expect(matrix).toContain("COMMANDER GPT Manager");
    expect(matrix).toContain("shell.execute");
    expect(matrix).toContain("SUBORDINATE Claudinho");
    expect(matrix).toContain("github_issue_read: requires=[github.issue.read]");
  });
});
