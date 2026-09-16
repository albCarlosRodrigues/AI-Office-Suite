import { describe, expect, it } from "vitest";

import { parsePrxReplyV2, parsePrxTransportCandidate } from "../cdp-session.server";

const expected = {
  requestId: "163fc684-6132-42d9-b5fc-472dbd168cd1",
  sessionId: "prx-geral-confirmacao",
  conversationId: "https://chatgpt.com/g/project/c/conversation",
  agentId: "2c10fb31-1718-484f-a2f1-d6da2195ed74",
};

function frame(payload: string) {
  return [
    "ChatGPT disse:",
    `<<<PRX_REPLY_V2_BEGIN:${expected.requestId}>>>`,
    `<<<PRX_PAYLOAD_BEGIN:${expected.requestId}>>>`,
    payload,
    `<<<PRX_PAYLOAD_END:${expected.requestId}>>>`,
    `<<<PRX_REPLY_V2_END:${expected.requestId}>>>`,
  ].join("\n");
}

describe("PRX Transport V2", () => {
  it("preserves raw Windows paths", () => {
    const payload = String.raw`{"rationale":"Use C:\new\test and A:\Ambiente\DeliciasDoRio","tasks":[]}`;

    const parsed = parsePrxReplyV2(frame(payload), expected);

    expect(parsed).not.toBeNull();

    expect(parsed?.text).toBe(payload);

    expect(parsed).toMatchObject({
      ...expected,
      messageId: expected.requestId,
    });
  });

  it("accepts plain text", () => {
    expect(parsePrxReplyV2(frame("READY_FOR_CODEX_REVIEW"), expected)?.text).toBe(
      "READY_FOR_CODEX_REVIEW",
    );
  });

  it("rejects another request id", () => {
    const wrong = frame("OK").replaceAll(
      expected.requestId,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(parsePrxReplyV2(wrong, expected)).toBeNull();
  });

  it("rejects incomplete frame", () => {
    const incomplete = frame("OK").replace(`<<<PRX_REPLY_V2_END:${expected.requestId}>>>`, "");

    expect(parsePrxReplyV2(incomplete, expected)).toBeNull();
  });

  it("keeps V1 compatibility", () => {
    const legacy = JSON.stringify({
      ...expected,
      messageId: "legacy-message",
      text: "legacy response",
    });

    expect(parsePrxTransportCandidate(legacy, expected)?.text).toBe("legacy response");
  });
});
