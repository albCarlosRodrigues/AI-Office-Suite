import { afterEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { PrxChatBackend, type PrxRequest, type PrxSessionClient } from "./prx/session";
import { FreeClaudeBackend } from "./free-claude/backend";
import { LocalAntExecutionAdapter } from "./localant/adapter";
import { ToolExecutionGateway, ToolRegistry } from "@/runtime/tools/gateway";
import { DefaultDenyToolPolicy } from "@/runtime/tools/policy";
import { bindAcmeIntegrations } from "@/local/integration-bindings";
import { ManagerResponseSchema } from "@/orchestration/manager-contract";

afterEach(() => vi.unstubAllGlobals());
const payload = { system: "system", user: "hello", json: true };
const config = {
  sessionId: "session",
  conversationId: "conversation",
  agentId: "manager",
  timeoutMs: 1000,
};
function transport() {
  let saved: PrxRequest;
  return {
    health: vi.fn(async () => true),
    close: vi.fn(),
    send: vi.fn(async (request: PrxRequest) => {
      saved = request;
    }),
    receive: vi.fn(async () => ({
      requestId: saved.requestId,
      sessionId: saved.sessionId,
      conversationId: saved.conversationId,
      agentId: saved.agentId,
      messageId: "reply",
      text: "OK",
    })),
  } satisfies PrxSessionClient;
}
describe("PRX correlation and lifecycle", () => {
  it("carries mission/task/run IDs and accepts only the current request", async () => {
    const client = transport();
    client.receive.mockResolvedValueOnce({
      requestId: "wrong",
      sessionId: "session",
      conversationId: "conversation",
      agentId: "manager",
      messageId: "old",
      text: "wrong",
    });
    const backend = new PrxChatBackend(client, config);
    const result = await backend.execute({ missionId: "m", taskId: "t", agentRunId: "r", payload });
    expect(result.result).toBe("OK");
    expect(client.send.mock.calls[0]![0]).toMatchObject({
      missionId: "m",
      taskId: "t",
      agentRunId: "r",
    });
    expect(client.receive).toHaveBeenCalledTimes(2);
    expect(client.close).toHaveBeenCalled();
  });
  it("rejects pre-cancellation before sending", async () => {
    const client = transport();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new PrxChatBackend(client, config).execute({ taskId: "t", payload }, controller.signal),
    ).rejects.toThrow();
    expect(client.send).not.toHaveBeenCalled();
  });
  it("interrupts waiting on cancellation", async () => {
    const client: PrxSessionClient = {
      ...transport(),
      receive: async (_r, signal) => delay(10000, null, { signal }),
    };
    const controller = new AbortController();
    const pending = new PrxChatBackend(client, config).execute(
      { taskId: "t", payload },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(client.close).toHaveBeenCalled();
  });
  it("times out and releases the session lock", async () => {
    const client: PrxSessionClient = {
      ...transport(),
      receive: async (_r, signal) => delay(10000, null, { signal }),
    };
    await expect(
      new PrxChatBackend(client, { ...config, timeoutMs: 10 }).execute({ taskId: "t", payload }),
    ).rejects.toThrow();
    expect(
      (await new PrxChatBackend(transport(), config).execute({ taskId: "t", payload })).result,
    ).toBe("OK");
  });
  it("rejects concurrent writers to the same session", async () => {
    const client: PrxSessionClient = {
      ...transport(),
      receive: async (_r, signal) => delay(10000, null, { signal }),
    };
    const controller = new AbortController();
    const first = new PrxChatBackend(client, config).execute(
      { taskId: "t", payload },
      controller.signal,
    );
    await expect(
      new PrxChatBackend(transport(), config).execute({ taskId: "t2", payload }),
    ).rejects.toThrow("PRX_SESSION_BUSY");
    controller.abort();
    await expect(first).rejects.toThrow();
  });
});

describe("FreeClaude OpenRouter", () => {
  const cfg = {
    apiKey: "secret-test-value",
    model: "user-selected-model",
    baseUrl: "https://openrouter.ai/api/v1",
    temperature: 0.2,
    maxOutputTokens: 100,
    timeoutMs: 1000,
  };
  it("uses native Messages protocol and a configurable model", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await new FreeClaudeBackend(cfg).execute({ taskId: "t", payload })).result).toBe("OK");
    const [url, options] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/messages");
    expect(JSON.parse(String(options.body)).model).toBe(cfg.model);
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${cfg.apiKey}` });
  });
  it("accepts reasoning models but returns only their completed answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              stop_reason: "end_turn",
              content: [
                { type: "thinking", thinking: "private reasoning" },
                { type: "text", text: "OK" },
              ],
            }),
          ),
      ),
    );
    expect((await new FreeClaudeBackend(cfg).execute({ taskId: "t", payload })).result).toBe("OK");
  });
  it.each(["max_tokens", "tool_use", "pause_turn"])(
    "rejects incomplete stop reason %s",
    async (reason) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                stop_reason: reason,
                content: [{ type: "text", text: "partial" }],
              }),
            ),
        ),
      );
      await expect(new FreeClaudeBackend(cfg).execute({ taskId: "t", payload })).rejects.toThrow(
        "INCOMPLETE_PROVIDER_RESPONSE",
      );
    },
  );
  it("rejects tool blocks instead of executing them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: [{ type: "tool_use", name: "shell", input: { command: "unexpected" } }],
            }),
          ),
      ),
    );
    await expect(new FreeClaudeBackend(cfg).execute({ taskId: "t", payload })).rejects.toThrow(
      "INVALID_PROVIDER_RESPONSE",
    );
  });
  it.each([
    [401, "INVALID_KEY"],
    [403, "INVALID_KEY"],
    [429, "RATE_LIMITED"],
    [404, "MODEL_UNAVAILABLE"],
    [500, "ERROR"],
  ])("classifies %s without leaking secrets", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(cfg.apiKey, { status: Number(status) })),
    );
    await expect(new FreeClaudeBackend(cfg).execute({ taskId: "t", payload })).rejects.toThrow(
      String(message),
    );
  });
  it("fails closed without credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new FreeClaudeBackend({ ...cfg, apiKey: null }).execute({ taskId: "t", payload }),
    ).rejects.toThrow("INVALID_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses secret forwarding to an arbitrary endpoint", () => {
    expect(() => new FreeClaudeBackend({ ...cfg, baseUrl: "https://example.com/api" })).toThrow(
      "ENDPOINT_DENIED",
    );
  });
});

describe("LocalAnt policy", () => {
  const request = {
    missionId: "m",
    taskId: "t",
    agentId: "gpt",
    toolCallId: "call",
    toolId: "write",
    arguments: {},
    idempotencyKey: "key",
  };
  function gateway(allowed: string[], approved: boolean) {
    const execute = vi.fn(async () => ({ exitCode: 0, stdout: "result" }));
    const registry = new ToolRegistry();
    registry.register({ id: "repository_write", risk: 2, execute });
    return {
      execute,
      adapter: new LocalAntExecutionAdapter(
        new ToolExecutionGateway(
          registry,
          new DefaultDenyToolPolicy({
            allowedTools: allowed,
            approvedToolCallIds: new Set(approved ? ["call"] : []),
          }),
          { put: async () => ({ artifactRef: "artifact:real-runtime" }) },
        ),
      ),
    };
  }
  it("cannot bypass policy", async () => {
    const { adapter, execute } = gateway([], true);
    await expect(adapter.execute(request)).rejects.toThrow("DENY");
    expect(execute).not.toHaveBeenCalled();
  });
  it("cannot bypass approval", async () => {
    const { adapter, execute } = gateway(["repository_write"], false);
    await expect(adapter.execute(request)).rejects.toThrow("APPROVAL_REQUIRED");
    expect(execute).not.toHaveBeenCalled();
  });
  it("returns executor-produced evidence after approval", async () => {
    const { adapter, execute } = gateway(["repository_write"], true);
    expect(await adapter.execute(request)).toMatchObject({
      verified: true,
      executor: "local-runtime",
      stdoutArtifactRef: "artifact:real-runtime",
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("existing Acme hierarchy", () => {
  it("reuses IDs, preserves layout and binds only once", () => {
    const tables = {
      organizations: [{ id: "org", name: "Acme Robots" }],
      agents: [
        { id: "codex", organization_id: "org", slug: "codex", name: "Codex" },
        { id: "gpt", organization_id: "org", name: "GPT", workstation_id: "seat" },
        { id: "worker", organization_id: "org", name: "Claudinho" },
      ] as Record<string, unknown>[],
      agent_providers: [] as Record<string, unknown>[],
    };
    expect(bindAcmeIntegrations(tables)).toBe(true);
    expect(tables.agents).toHaveLength(3);
    expect(tables.agents[1]).toMatchObject({
      id: "gpt",
      manager_agent_id: "codex",
      workstation_id: "seat",
    });
    expect(tables.agents[2]).toMatchObject({ manager_agent_id: "gpt" });
    expect(bindAcmeIntegrations(tables)).toBe(false);
    expect(tables.agent_providers).toHaveLength(2);
  });
  it("rejects model attempts to inject policy fields", () => {
    expect(
      ManagerResponseSchema.safeParse({
        decision: "CONTINUE",
        instructions: "go",
        approvedActions: [],
        requestedTools: [],
        escalationRequired: false,
        summary: "go",
        permissions: ["all"],
      }).success,
    ).toBe(false);
  });
});
