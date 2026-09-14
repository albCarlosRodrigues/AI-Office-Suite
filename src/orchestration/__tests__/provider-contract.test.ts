import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatProvider } from "../providers/OpenAiCompatProvider.server";

const provider = () =>
  new OpenAiCompatProvider({
    type: "openai",
    baseUrl: "https://example.test",
    apiKey: null,
    model: "cheap",
    temperature: 0,
    maxTokens: 500,
    timeoutMs: 1000,
    headers: {},
  });
const response = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
afterEach(() => vi.unstubAllGlobals());

describe("provider output contracts fail closed", () => {
  it("never approves a malformed review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response('{"decision":"MAYBE"}')),
    );
    await expect(
      provider().review({
        reviewer: {} as never,
        systemPrompt: "policy",
        task: {
          code: "T1",
          title: "x",
          description: "x",
          expectedOutput: "tests",
          acceptanceCriteria: ["exit 0"],
          retries: 0,
        },
        result: { summary: "done", evidence: [] },
      }),
    ).rejects.toThrow("INVALID_SCHEMA: review");
  });
  it("turns described tool calls into a blocked request, never completion evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          JSON.stringify({
            status: "COMPLETED",
            summary: "I ran tests",
            evidence: [],
            toolCalls: [{ toolId: "testing", input: "npm test" }],
          }),
        ),
      ),
    );
    const result = await provider().executeTask({
      agent: {} as never,
      systemPrompt: "policy",
      command: {
        id: "c",
        missionId: "m",
        taskId: "t",
        parentCommandId: null,
        objective: "test",
        instructions: "test",
        expectedOutput: "green",
        acceptanceCriteria: ["tests exit 0"],
        allowedTools: ["testing"],
        forbiddenActions: [],
        constraints: {},
        context: {},
        maxIterations: 1,
        maxCost: 1,
        timeout: 1000,
      },
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.toolCalls[0]?.output).toBe("");
  });
  it("aborts provider calls on timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    const promise = provider().summarize({ goal: "x", tasks: [], systemPrompt: "x" });
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
  it("propagates an external distributed cancellation signal to the provider request", async () => {
    const controller = new AbortController();
    let requested!: () => void;
    const started = new Promise<void>((resolve) => (requested = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            requested();
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            );
          }),
      ),
    );
    const pending = provider().executeTask(
      {
        agent: {} as never,
        systemPrompt: "policy",
        command: {
          id: "c",
          missionId: "m",
          taskId: "t",
          parentCommandId: null,
          objective: "work",
          instructions: "work",
          expectedOutput: "result",
          acceptanceCriteria: [],
          allowedTools: [],
          forbiddenActions: [],
          constraints: {},
          context: {},
          maxIterations: 1,
          maxCost: 1,
          timeout: 10_000,
        },
      },
      controller.signal,
    );
    await started;
    controller.abort(new Error("mission cancelled"));
    await expect(pending).rejects.toThrow();
  });
});
