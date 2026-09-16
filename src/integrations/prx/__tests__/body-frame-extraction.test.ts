import { describe, expect, it } from "vitest";

import { extractPrxV2ReplyFrames, parsePrxReplyV2 } from "../cdp-session.server";

const requestId = "7e8cec54-6dcc-4515-ba87-8c19b9c5033c";

const expected = {
  requestId,

  sessionId: "prx-geral-confirmacao",

  conversationId: "conversation-test",

  agentId: "agent-test",
};

function makeFrame(payload: string) {
  return [
    `<<<PRX_REPLY_V2_BEGIN:${requestId}>>>`,
    `<<<PRX_PAYLOAD_BEGIN:${requestId}>>>`,
    payload,
    `<<<PRX_PAYLOAD_END:${requestId}>>>`,
    `<<<PRX_REPLY_V2_END:${requestId}>>>`,
  ].join("\n");
}

describe("PRX body frame extraction", () => {
  it("extracts the real response while ignoring the outbound template", () => {
    const template = makeFrame("YOUR RESPONSE HERE");

    const payload = String.raw`{"rationale":"Workspace A:\Ambiente\DeliciasDoRio","tasks":[]}`;

    const response = makeFrame(payload);

    /*
     * Simula exatamente o caso observado:
     *
     * document.body.innerText contém:
     * - pedido/template;
     * - outros elementos da UI;
     * - resposta real.
     *
     * Não existe dependência de
     * data-message-author-role.
     */
    const body = [
      "Confirmação do canal",
      "Texto da interface",
      template,
      "Mais conteúdo React",
      response,
      "Rodapé",
    ].join("\n");

    const frames = extractPrxV2ReplyFrames(body, requestId);

    expect(frames).toHaveLength(1);

    expect(frames[0]).toBe(response);

    const parsed = parsePrxReplyV2(frames[0]!, expected);

    expect(parsed).not.toBeNull();

    expect(parsed?.text).toBe(payload);
  });

  it("does not treat the outbound template as a reply", () => {
    const frames = extractPrxV2ReplyFrames(makeFrame("YOUR RESPONSE HERE"), requestId);

    expect(frames).toEqual([]);
  });

  it("allows the placeholder phrase inside a real payload when it is not the whole payload", () => {
    const payload = JSON.stringify({
      note: "The text YOUR RESPONSE HERE appears only as documentation",
    });

    const response = makeFrame(payload);

    expect(extractPrxV2ReplyFrames(response, requestId)).toEqual([response]);
  });
});
