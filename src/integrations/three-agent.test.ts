import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createLocalToolHandlers } from "@/runtime/tools/handlers.server";
import { ToolExecutionGateway, ToolRegistry } from "@/runtime/tools/gateway";
import { DefaultDenyToolPolicy } from "@/runtime/tools/policy";
import { FileArtifactStore } from "@/runtime/artifact-store.server";
import { LocalAntExecutionAdapter } from "./localant/adapter";
import { FreeClaudeBackend } from "./free-claude/backend";
import { PrxChatBackend, type PrxRequest } from "./prx/session";
import { ManagerResponseSchema } from "@/orchestration/manager-contract";

afterEach(() => vi.unstubAllGlobals());
it("worker asks manager through PRX, LocalAnt reads real fixture, worker fixes and validates through the same gateway", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-three-agent-"));
  try {
    const file = path.join(root, "answer.txt");
    await writeFile(file, "41");
    const artifacts = new FileArtifactStore(path.join(root, "artifacts"));
    const registry = new ToolRegistry();
    for (const handler of createLocalToolHandlers([root])) registry.register(handler);
    const gateway = new ToolExecutionGateway(
      registry,
      new DefaultDenyToolPolicy({
        allowedTools: ["repository_read", "repository_write", "shell"],
        approvedToolCallIds: new Set(["fix", "test"]),
      }),
      artifacts,
    );
    const adapter = new LocalAntExecutionAdapter(gateway);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "Should the answer be 42?" }] }),
          ),
      ),
    );
    const worker = new FreeClaudeBackend({
      apiKey: "fake-test-only",
      model: "fixture",
      baseUrl: "https://openrouter.ai/api/v1",
      temperature: 0,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    });
    const question = await worker.execute({
      missionId: "m",
      taskId: "t",
      payload: { system: "Worker", user: "Inspect", json: false },
    });
    let sent: PrxRequest;
    const manager = new PrxChatBackend(
      {
        health: async () => true,
        close() {},
        send: async (request) => {
          sent = request;
        },
        receive: async () => ({
          requestId: sent.requestId,
          sessionId: sent.sessionId,
          conversationId: sent.conversationId,
          agentId: sent.agentId,
          messageId: "manager-decision",
          text: JSON.stringify({
            decision: "CONTINUE",
            instructions: "Set answer to 42",
            summary: "Use 42",
            requestedTools: [],
            approvedActions: [],
            escalationRequired: false,
          }),
        }),
      },
      { agentId: "gpt", sessionId: "s", conversationId: "c", timeoutMs: 1000 },
    );
    const read = await adapter.execute({
      missionId: "m",
      taskId: "t",
      agentId: "gpt",
      toolCallId: "inspect",
      toolId: "read",
      arguments: { path: file },
      idempotencyKey: "inspect",
    });
    const verified = await artifacts.get(read.stdoutArtifactRef!);
    const verifiedPayload = JSON.parse(new TextDecoder().decode(verified.content)) as {
      type: "file" | "directory";
      content?: string;
    };

    expect(verifiedPayload).toMatchObject({
      type: "file",
      content: "41",
    });
    const decision = await manager.execute({
      missionId: "m",
      taskId: "t",
      agentRunId: "gpt-run",
      payload: {
        system: "Manager reporting to Codex",
        user: `${question.result}; runtime read: 41`,
        json: true,
      },
    });
    expect(ManagerResponseSchema.parse(JSON.parse(String(decision.result))).decision).toBe(
      "CONTINUE",
    );
    await gateway.execute({
      missionId: "m",
      taskId: "t",
      agentId: "claudinho",
      toolCallId: "fix",
      toolId: "repository_write",
      arguments: { path: file, content: "42" },
      idempotencyKey: "fix",
    });
    const tested = await gateway.execute({
      missionId: "m",
      taskId: "t",
      agentId: "claudinho",
      toolCallId: "test",
      toolId: "shell",
      arguments: {
        cwd: root,
        argv: [
          process.execPath,
          "-e",
          "if(require('node:fs').readFileSync('answer.txt','utf8')!=='42')process.exit(1);console.log('PASS')",
        ],
      },
      idempotencyKey: "test",
    });
    expect(tested).toMatchObject({ status: "COMPLETED", exitCode: 0, verified: true });
    expect(await readFile(file, "utf8")).toBe("42");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
