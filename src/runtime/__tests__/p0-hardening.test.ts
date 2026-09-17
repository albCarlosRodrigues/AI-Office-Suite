import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_CATALOG, TOOL_REGISTRY } from "@/permissions/tool-registry";
import { taskAttemptCounter } from "../attempt-counters";
import {
  classifyRuntimeError,
  isAutomaticRetryAllowed,
  RuntimeToolError,
} from "../errors/runtime-errors";
import { FailedToolRequestGuard } from "../tools/duplicate-failure-guard";
import { ToolExecutionGateway, ToolRegistry } from "../tools/gateway";
import { createLocalToolHandlers } from "../tools/handlers.server";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-p0-"));
  tempRoots.push(root);
  return root;
}

function request(toolId: string, args: Record<string, unknown>, id: string = crypto.randomUUID()) {
  return {
    toolCallId: id,
    missionId: "m",
    taskId: "t",
    agentId: "a",
    toolId,
    arguments: args,
    idempotencyKey: id,
  };
}

describe("P0.1 repository_read hardening", () => {
  it("returns structured file and directory results without EISDIR", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;");

    const tool = createLocalToolHandlers([root]).find((item) => item.id === "repository_read");
    expect(tool).toBeTruthy();

    const dir = await tool!.execute(request("repository_read", { path: "src" }));
    const dirPayload = JSON.parse(String(dir.stdout));
    expect(dirPayload.type).toBe("directory");
    expect(dirPayload.entries).toContainEqual({ name: "a.ts", type: "file" });

    const file = await tool!.execute(request("repository_read", { path: "src/a.ts" }));
    const filePayload = JSON.parse(String(file.stdout));
    expect(filePayload.type).toBe("file");
    expect(filePayload.content).toContain("export const a");
  });

  it("blocks lexical traversal outside allowed roots", async () => {
    const root = await tempRoot();
    const tool = createLocalToolHandlers([root]).find((item) => item.id === "repository_read")!;
    await expect(
      tool.execute(request("repository_read", { path: "../outside.txt" })),
    ).rejects.toThrow("PATH_DENIED");
  });

  it("blocks symlink/junction escape after canonicalization", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(path.join(outside, "secret.txt"), "secret");

    try {
      await symlink(
        outside,
        path.join(root, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      return;
    }

    const tool = createLocalToolHandlers([root]).find((item) => item.id === "repository_read")!;
    await expect(
      tool.execute(request("repository_read", { path: "escape/secret.txt" })),
    ).rejects.toThrow("PATH_DENIED");
  });
});

describe("P0.2 governance registry", () => {
  it("maps every tool to capability, primary permission, risk and approval", () => {
    expect(Object.keys(TOOL_REGISTRY)).toHaveLength(TOOL_CATALOG.length);
    for (const tool of TOOL_CATALOG) {
      expect(tool.capability).toBeTruthy();
      expect(tool.permission).toBe(tool.requiredPermissions[0]);
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(tool.riskLevel);
      expect(["NONE", "CONDITIONAL", "ALWAYS"]).toContain(tool.approval);
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
    }
  });
});

describe("P0.3/P0.4 structured errors and duplicate guard", () => {
  it("retries only transient errors", () => {
    expect(
      isAutomaticRetryAllowed(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
    ).toBe(true);
    expect(isAutomaticRetryAllowed(Object.assign(new Error("directory"), { code: "EISDIR" }))).toBe(
      false,
    );
    expect(classifyRuntimeError(new Error("POLICY_DENIED")).category).toBe("POLICY");
  });

  it("blocks identical deterministic requests even with another idempotency key", async () => {
    const execute = vi.fn(async () => {
      throw Object.assign(new Error("illegal operation on a directory"), { code: "EISDIR" });
    });
    const registry = new ToolRegistry();
    registry.register({ id: "repository_read", risk: 1, execute });
    const guard = new FailedToolRequestGuard();
    const gateway = new ToolExecutionGateway(
      registry,
      { evaluate: async () => "ALLOW" },
      { put: async () => ({ artifactRef: "artifact:1" }) },
      guard,
    );

    await expect(
      gateway.execute(request("repository_read", { path: "src" }, "one")),
    ).rejects.toMatchObject({ category: "CORRECTABLE", retryable: false });

    await expect(
      gateway.execute(request("repository_read", { path: "src" }, "two")),
    ).rejects.toMatchObject({ code: "DUPLICATE_FAILED_REQUEST", retryable: false });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not convert approval failures into automatic retry", () => {
    const approval = new RuntimeToolError({
      code: "APPROVAL_REQUIRED",
      category: "PERMISSION",
      retryable: false,
      message: "approval required",
    });
    expect(isAutomaticRetryAllowed(approval)).toBe(false);
  });
});

describe("P0.5 attempts", () => {
  it("keeps retry and attempt semantics separate and bounded", () => {
    expect(taskAttemptCounter(0, 2)).toEqual({ current: 1, max: 3 });
    expect(taskAttemptCounter(1, 2)).toEqual({ current: 2, max: 3 });
    expect(taskAttemptCounter(2, 2)).toEqual({ current: 3, max: 3 });
    expect(taskAttemptCounter(3, 2)).toEqual({ current: 3, max: 3 });
  });
});
