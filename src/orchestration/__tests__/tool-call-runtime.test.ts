import { describe, expect, it } from "vitest";
import type { WorkerResponse } from "../providers/types";
import { enforceRuntimeEvidence, validateRuntimeToolRequests } from "../tool-claims";
import { createLocalToolHandlers } from "@/runtime/tools/handlers.server";

function response(patch: Partial<WorkerResponse> = {}): WorkerResponse {
  return {
    status: "BLOCKED",
    summary: "test",
    evidence: [],
    toolCalls: [],
    usage: {
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      model: "test",
      simulated: false,
    },
    ...patch,
  };
}

describe("runtime tool-call contract", () => {
  it("rejects BLOCKED without an executable tool call", () => {
    expect(validateRuntimeToolRequests(response(), ["repository_read"])).toContain(
      "TOOL_CALL_INVALID",
    );
  });

  it("rejects a tool call without arguments", () => {
    expect(
      validateRuntimeToolRequests(
        response({
          toolCalls: [
            {
              toolId: "repository_read",
              input: "read package",
              output: "",
              risk: "LOW",
              latencyMs: 0,
            },
          ],
        }),
        ["repository_read"],
      ),
    ).toContain("arguments object");
  });

  it("rejects a tool outside command scope", () => {
    expect(
      validateRuntimeToolRequests(
        response({
          toolCalls: [
            {
              toolId: "shell",
              input: "git status",
              arguments: {
                argv: ["git", "status"],
                cwd: ".",
              },
              output: "",
              risk: "LOW",
              latencyMs: 0,
            },
          ],
        }),
        ["repository_read"],
      ),
    ).toContain("not allowed");
  });

  it("accepts valid github issue arguments", () => {
    expect(
      validateRuntimeToolRequests(
        response({
          toolCalls: [
            {
              toolId: "github_issue_read",
              input: "read issue 12",
              arguments: {
                repository: "albCarlosRodrigues/DeliciasDoRio",
                issue: 12,
              },
              output: "",
              risk: "LOW",
              latencyMs: 0,
            },
          ],
        }),
        ["github_issue_read"],
      ),
    ).toBeNull();
  });

  it("allows final synthesis after verified runtime evidence", () => {
    expect(
      validateRuntimeToolRequests(
        response({
          status: "COMPLETED",
          toolCalls: [],
        }),
        ["repository_read", "shell"],
        true,
      ),
    ).toBeNull();
  });

  it("registers issue reading and code analysis handlers", () => {
    const ids = createLocalToolHandlers([process.cwd()]).map((handler) => handler.id);

    expect(ids).toContain("github_issue_read");
    expect(ids).toContain("code_analysis");
  });

  it("resolves repository_read relative to workspace", async () => {
    const handler = createLocalToolHandlers([process.cwd()]).find(
      (candidate) => candidate.id === "repository_read",
    );

    expect(handler).toBeDefined();

    const result = await handler!.execute({
      toolCallId: "read-1",
      missionId: "mission-1",
      taskId: "task-1",
      agentId: "agent-1",
      toolId: "repository_read",
      arguments: {
        path: "package.json",
      },
      idempotencyKey: "read-package-json",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeDefined();
  });

  it("executes real code_analysis on a workspace file", async () => {
    const handler = createLocalToolHandlers([process.cwd()]).find(
      (candidate) => candidate.id === "code_analysis",
    );

    expect(handler).toBeDefined();

    const result = await handler!.execute({
      toolCallId: "analysis-1",
      missionId: "mission-1",
      taskId: "task-1",
      agentId: "agent-1",
      toolId: "code_analysis",
      arguments: {
        target: "package.json",
      },
      idempotencyKey: "analyze-package-json",
    });

    expect(result.exitCode).toBe(0);
    expect(String(result.stdout)).toContain("package.json");
  });

  it("converts NEEDS_CLARIFICATION with tool calls into runtime wait", () => {
    const result = enforceRuntimeEvidence(
      response({
        status: "NEEDS_CLARIFICATION",
        summary: "Need repository evidence",
        toolCalls: [
          {
            toolId: "repository_read",
            input: "Read repository instructions",
            arguments: {
              path: "AGENTS.md",
            },
            output: "",
            risk: "LOW",
            latencyMs: 0,
          },
        ],
      }),
      false,
      true,
      0,
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.summary).toContain("awaiting deterministic runtime evidence");
  });
});
