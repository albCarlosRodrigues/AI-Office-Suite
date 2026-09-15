import { describe, expect, it } from "vitest";

import { parsePrxReplyCandidate } from "../cdp-session.server";

describe("PRX malformed structured envelope recovery", () => {
  it("recovers an object payload containing an unescaped Windows path", () => {
    const raw = String.raw`{"requestId":"req-1","sessionId":"session-1","conversationId":"conversation-1","agentId":"agent-1","messageId":"message-1","text":{"rationale":"Use A:\Ambiente\DeliciasDoRio","tasks":[]}}`;

    const parsed = parsePrxReplyCandidate(raw, {
      requestId: "req-1",
      sessionId: "session-1",
      conversationId: "conversation-1",
      agentId: "agent-1",
    });

    expect(parsed).not.toBeNull();

    expect(JSON.parse(parsed!.text as string)).toEqual({
      rationale: String.raw`Use A:\Ambiente\DeliciasDoRio`,
      tasks: [],
    });
  });

  it("still rejects mismatched correlation metadata", () => {
    const raw = String.raw`{"requestId":"wrong","sessionId":"session-1","conversationId":"conversation-1","agentId":"agent-1","messageId":"message-1","text":{"rationale":"Use A:\Ambiente\DeliciasDoRio","tasks":[]}}`;

    const parsed = parsePrxReplyCandidate(raw, {
      requestId: "req-1",
      sessionId: "session-1",
      conversationId: "conversation-1",
      agentId: "agent-1",
    });

    expect(parsed).toBeNull();
  });
});
