import { describe, expect, it } from "vitest";
import type { Agent, AgentPermission } from "@/types/domain";
import {
  allowedToolsForTask,
  buildExecutionCandidates,
  filterAgentsByTaskAccess,
  formatPlanningPermissionMatrix,
  missingTaskAccess,
  missingPermissionsForTask,
  requiredPermissionsForTools,
} from "./task-permission-routing";

const catalog = {
  repository_read: { requiredPermissions: ["repository.read"] },
  shell: { requiredPermissions: ["shell.execute"] },
  github_issue_read: { requiredPermissions: ["github.issue.read"] },
};

function agent(id: string, name: string, capabilities: string[] = []): Agent {
  return { id, name, capabilities } as unknown as Agent;
}

function permission(agentId: string, value: string, granted = true): AgentPermission {
  return {
    agent_id: agentId,
    permission: value,
    granted,
  } as unknown as AgentPermission;
}

function tool(agentId: string, toolId: string, enabled = true) {
  return {
    agent_id: agentId,
    tool_id: toolId,
    enabled,
  };
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
    const tools = [
      tool(manager.id, "repository_read"),
      tool(manager.id, "shell"),
      tool(worker.id, "repository_read"),
      tool(worker.id, "shell"),
    ];
    const task = { tools: ["repository_read", "shell"] };

    expect(missingPermissionsForTask(task, worker, permissions, catalog)).toEqual([
      "shell.execute",
    ]);
    expect(
      filterAgentsByTaskAccess(task, [manager, worker], permissions, tools, catalog).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["manager"]);
  });

  it("uses agent_tools as the source of enabled tools", () => {
    const manager = agent("manager", "GPT Manager", ["repository_read"]);
    const permissions = [
      permission(manager.id, "repository.read"),
      permission(manager.id, "github.issue.read"),
      permission(manager.id, "shell.execute"),
    ];
    const tools = [
      tool(manager.id, "repository_read"),
      tool(manager.id, "github_issue_read"),
      tool(manager.id, "shell"),
    ];
    const task = { tools: ["repository_read", "github_issue_read", "shell"] };

    expect(allowedToolsForTask(task, manager, permissions, tools, catalog)).toEqual([
      "repository_read",
      "github_issue_read",
      "shell",
    ]);
    expect(missingTaskAccess(task, manager, permissions, tools, catalog)).toEqual({
      missingTools: [],
      missingPermissions: [],
    });
  });

  it("rejects an explicitly disabled tool even when the permission is granted", () => {
    const manager = agent("manager", "GPT Manager");
    const permissions = [
      permission(manager.id, "repository.read"),
      permission(manager.id, "shell.execute"),
    ];
    const tools = [tool(manager.id, "repository_read"), tool(manager.id, "shell", false)];
    const task = { tools: ["repository_read", "shell"] };

    expect(missingTaskAccess(task, manager, permissions, tools, catalog)).toEqual({
      missingTools: ["shell"],
      missingPermissions: [],
    });
  });

  it("always includes the commander as an execution candidate", () => {
    const manager = agent("manager", "GPT Manager");
    const worker = agent("worker", "Claudinho");
    expect(buildExecutionCandidates(manager, [worker]).map((candidate) => candidate.id)).toEqual([
      "manager",
      "worker",
    ]);
  });

  it("shows the planner the granted permissions and enabled tools", () => {
    const manager = agent("manager", "GPT Manager");
    const worker = agent("worker", "Claudinho");
    const matrix = formatPlanningPermissionMatrix(
      [manager, worker],
      [permission(manager.id, "shell.execute"), permission(worker.id, "repository.read")],
      manager.id,
      [tool(manager.id, "shell"), tool(worker.id, "repository_read")],
      catalog,
    );

    expect(matrix).toContain("COMMANDER GPT Manager");
    expect(matrix).toContain("enabled_tools=[shell]");
    expect(matrix).toContain("shell.execute");
    expect(matrix).toContain("SUBORDINATE Claudinho");
    expect(matrix).toContain("github_issue_read: requires=[github.issue.read]");
  });
});
