import { describe, expect, it } from "vitest";
import { parsePrxReplyCandidate } from "./cdp-session.server";

const expected = {
  requestId: "req-123",
  sessionId: "session-abc",
  conversationId: "https://chatgpt.com/c/test",
  agentId: "agent-xyz",
};

describe("parsePrxReplyCandidate", () => {
  it("accepts the legacy valid envelope with text as a JSON string", () => {
    const inner = {
      rationale: "Plano",
      tasks: [{ code: "T1" }],
    };

    const raw = JSON.stringify({
      ...expected,
      messageId: "msg-1",
      text: JSON.stringify(inner),
    });

    const parsed = parsePrxReplyCandidate(raw, expected);

    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed!.text as string)).toEqual(inner);
  });

  it("accepts text as a structured JSON object and normalizes it to string", () => {
    const inner = {
      rationale: "Plano",
      tasks: [{ code: "T1" }, { code: "T2" }],
    };

    const raw = JSON.stringify({
      ...expected,
      messageId: "msg-2",
      text: inner,
    });

    const parsed = parsePrxReplyCandidate(raw, expected);

    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed!.text as string)).toEqual(inner);
  });

  it("recovers the malformed envelope observed in ChatGPT Desktop", () => {
    const inner = '{"rationale":"Executar em duas etapas","tasks":[{"code":"T1"},{"code":"T2"}]}';

    const raw =
      `{"requestId":"${expected.requestId}",` +
      `"sessionId":"${expected.sessionId}",` +
      `"conversationId":"${expected.conversationId}",` +
      `"agentId":"${expected.agentId}",` +
      `"messageId":"msg-3",` +
      `"text":"${inner}"}`;

    expect(() => JSON.parse(raw)).toThrow();

    const parsed = parsePrxReplyCandidate(raw, expected);

    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe(inner);
    expect(JSON.parse(parsed!.text as string).tasks).toHaveLength(2);
  });

  it("recovers the same malformed envelope when the UI prefixes ChatGPT disse:", () => {
    const inner = '{"rationale":"Plano","tasks":[{"code":"T1"}]}';

    const envelope =
      `{"requestId":"${expected.requestId}",` +
      `"sessionId":"${expected.sessionId}",` +
      `"conversationId":"${expected.conversationId}",` +
      `"agentId":"${expected.agentId}",` +
      `"messageId":"msg-4",` +
      `"text":"${inner}"}`;

    const parsed = parsePrxReplyCandidate(`ChatGPT disse:${envelope}`, expected);

    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed!.text as string).tasks).toHaveLength(1);
  });

  it("still rejects a correlated-looking reply with the wrong requestId", () => {
    const raw = JSON.stringify({
      ...expected,
      requestId: "wrong-request",
      messageId: "msg-5",
      text: { rationale: "Plano", tasks: [] },
    });

    expect(parsePrxReplyCandidate(raw, expected)).toBeNull();
  });
});
