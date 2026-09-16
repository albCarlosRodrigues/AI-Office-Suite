import { describe, expect, it } from "vitest";

import { extractPrxV2ReplyFrames, parsePrxReplyV2 } from "../cdp-session.server";

const requestId = "322b8e40-1c8f-4c3b-a64d-c4bcd0b936d0";

const expected = {
  requestId,

  sessionId: "test-session",

  conversationId: "test-conversation",

  agentId: "test-agent",
};

const begin = `<<<PRX_REPLY_V2_BEGIN:${requestId}>>>`;

const payloadBegin = `<<<PRX_PAYLOAD_BEGIN:${requestId}>>>`;

const payloadEnd = `<<<PRX_PAYLOAD_END:${requestId}>>>`;

const end = `<<<PRX_REPLY_V2_END:${requestId}>>>`;

describe("PRX streaming response race", () => {
  it("does not classify an in-progress streamed response as complete", () => {
    /*
     * Estado real possível enquanto ChatGPT ainda está
     * produzindo a resposta:
     *
     * requestId já apareceu no DOM,
     * mas os marcadores finais ainda não chegaram.
     */
    const partial = [
      begin,
      payloadBegin,
      '{"rationale":"Resposta ainda sendo transmitida",',
      '"tasks":[',
    ].join("\n");

    expect(partial.includes(requestId)).toBe(true);

    expect(partial.includes("YOUR RESPONSE HERE")).toBe(false);

    /*
     * Essa é a propriedade importante:
     *
     * candidateTexts poderia considerar isso um candidato,
     * mas o transport V2 NÃO considera uma resposta completa.
     */
    expect(extractPrxV2ReplyFrames(partial, requestId)).toEqual([]);
  });

  it("accepts the response only after the full V2 frame is rendered", () => {
    const payload = String.raw`{"rationale":"Workspace A:\Ambiente\DeliciasDoRio","tasks":[]}`;

    const complete = [begin, payloadBegin, payload, payloadEnd, end].join("\n");

    const frames = extractPrxV2ReplyFrames(complete, requestId);

    expect(frames).toHaveLength(1);

    const parsed = parsePrxReplyV2(frames[0]!, expected);

    expect(parsed).not.toBeNull();

    expect(parsed?.text).toBe(payload);
  });

  it("ignores the outbound template", () => {
    const template = [begin, payloadBegin, "YOUR RESPONSE HERE", payloadEnd, end].join("\n");

    expect(extractPrxV2ReplyFrames(template, requestId)).toEqual([]);
  });
});
