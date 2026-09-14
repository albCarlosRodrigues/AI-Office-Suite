import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileArtifactStore } from "../artifact-store.server";
import { contentGate, fileExistsGate } from "../gates";
import { ToolExecutionGateway, ToolRegistry } from "../tools/gateway";
import { createLocalToolHandlers } from "../tools/handlers.server";
import { DefaultDenyToolPolicy } from "../tools/policy";
import { LocalToolExecutionBackend } from "@/orchestration/local-tool-backend";
import { MissionContractSchema } from "@/orchestration/contracts";
import { VerifiedMissionRunner } from "@/orchestration/verified-mission-runner";

async function runtime(root: string, allowedTools: string[], approved = new Set<string>()) {
  const registry = new ToolRegistry();
  for (const tool of createLocalToolHandlers([root])) registry.register(tool);
  return new ToolExecutionGateway(
    registry,
    new DefaultDenyToolPolicy({ allowedTools, approvedToolCallIds: approved }),
    new FileArtifactStore(path.join(root, ".artifacts")),
  );
}
const request = (toolCallId: string, toolId: string, args: Record<string, unknown>) => ({
  toolCallId,
  missionId: "mission-e2e",
  taskId: "task-e2e",
  agentId: "worker-e2e",
  toolId,
  arguments: args,
  idempotencyKey: `${toolCallId}:${toolId}`,
});

describe("real local tool E2E", () => {
  it("runs a filesystem mission through contract, backend, gateway and deterministic gates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-e2e-"));
    const hello = path.join(root, "hello.txt");
    const gateway = await runtime(root, ["filesystem_write"], new Set(["write-hello"]));
    const backend = new LocalToolExecutionBackend(gateway);
    const contract = MissionContractSchema.parse({
      missionId: "mission-e2e",
      goal: "Create hello.txt containing exactly hello world and validate it",
      scope: [root],
      nonGoals: [],
      constraints: [],
      globalDecisions: [],
      acceptanceCriteria: [{ id: "hello", description: "hello.txt is exact" }],
      taskContracts: [
        {
          taskId: "task-e2e",
          taskCode: "WRITE_HELLO",
          objective: "Write hello.txt",
          dependencies: [],
          acceptanceCriteria: [{ id: "hello", description: "hello.txt is exact" }],
          expectedArtifacts: [hello],
          allowedTools: ["filesystem_write"],
          forbiddenActions: [],
          maxAttempts: 1,
          tokenBudget: 0,
          costBudget: 0,
          modelTier: "TIER_0",
          executionMode: "REAL",
        },
      ],
      allowedTools: ["filesystem_write"],
      forbiddenActions: [],
      tokenBudget: 0,
      costBudget: 0,
      maxSteps: 2,
      maxEscalations: 0,
      createdAt: new Date().toISOString(),
      version: 1,
      decompositionMode: "single",
    });
    const result = await new VerifiedMissionRunner(backend).run(contract, [
      {
        taskId: "task-e2e",
        request: request("write-hello", "filesystem_write", {
          path: hello,
          content: "hello world",
        }),
        gates: [() => fileExistsGate(hello), () => contentGate(hello, /^hello world$/)],
      },
    ]);
    expect(result.status).toBe("COMPLETED");
    expect(result.backendId).toBe("local-tool-runtime");
    expect(result.toolResults[0]?.verified).toBe(true);
    expect(result.toolResults[0]?.executor).toBe("local-runtime");
    expect(result.gateResults.every((gate) => gate.passed)).toBe(true);
    expect(await readFile(hello, "utf8")).toBe("hello world");
  });
  it("reads a real file through the gateway", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-read-"));
    const hello = path.join(root, "hello.txt");
    const writeGateway = await runtime(root, ["filesystem_write"], new Set(["seed"]));
    await writeGateway.execute(
      request("seed", "filesystem_write", { path: hello, content: "hello world" }),
    );
    const readGateway = await runtime(root, ["filesystem_read"]);
    const result = await readGateway.execute(request("read", "filesystem_read", { path: hello }));
    expect(result.status).toBe("COMPLETED");
    expect(result.stdoutArtifactRef).toMatch(/^artifact:/);
  });
  it("executes a real argv shell process and stores stdout as an artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-shell-"));
    const gateway = await runtime(root, ["shell"], new Set(["node-version"]));
    const result = await gateway.execute(
      request("node-version", "shell", {
        argv: [process.execPath, "--version"],
        cwd: root,
        timeoutMs: 10_000,
      }),
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.exitCode).toBe(0);
    expect(result.stdoutArtifactRef).toMatch(/^artifact:/);
  });
  it("denies traversal and symlink escape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "ai-office-outside-"));
    const link = path.join(root, "escape");
    await mkdir(outside, { recursive: true });
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    const gateway = await runtime(root, ["filesystem_read"]);
    await expect(
      gateway.execute(request("read-outside", "filesystem_read", { path: link })),
    ).rejects.toThrow("PATH_DENIED");
  });
  it("requires approval for writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-policy-"));
    const gateway = await runtime(root, ["filesystem_write"]);
    await expect(
      gateway.execute(
        request("write", "filesystem_write", {
          path: path.join(root, "x.txt"),
          content: "x",
        }),
      ),
    ).rejects.toThrow("APPROVAL_REQUIRED");
  });
  it("denies destructive shell commands even when the call is approved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-command-"));
    const gateway = await runtime(root, ["shell"], new Set(["danger"]));
    await expect(
      gateway.execute(
        request("danger", "shell", {
          argv: ["git", "reset", "--hard"],
          cwd: root,
          timeoutMs: 10_000,
        }),
      ),
    ).rejects.toThrow("COMMAND_DENIED");
  });
  it("times out and cancels shell processes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-stop-"));
    const timeoutGateway = await runtime(root, ["shell"], new Set(["timeout"]));
    const timeout = await timeoutGateway.execute(
      request("timeout", "shell", {
        argv: [process.execPath, "-e", "setTimeout(()=>{},10000)"],
        cwd: root,
        timeoutMs: 20,
      }),
    );
    expect(timeout.status).toBe("FAILED");

    const controller = new AbortController();
    const cancelGateway = await runtime(root, ["shell"], new Set(["cancel"]));
    const pending = cancelGateway.execute(
      request("cancel", "shell", {
        argv: [process.execPath, "-e", "setTimeout(()=>{},10000)"],
        cwd: root,
        timeoutMs: 10_000,
      }),
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20);
    expect((await pending).status).toBe("CANCELLED");
  });
});
