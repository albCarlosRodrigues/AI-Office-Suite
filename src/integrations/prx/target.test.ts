import { expect, it } from "vitest";
import { parsePrxReplyCandidate, selectPrxTarget } from "./cdp-session.server";

const desktop = {
  id: "desktop-current",
  type: "page",
  url: "app://-/index.html",
  webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/desktop-current",
};

it("rediscovers the ChatGPT Desktop shell when its target id changes", () => {
  expect(selectPrxTarget([desktop], "old-target-id")?.id).toBe("desktop-current");
});

it("prefers the operational Desktop shell over hidden chatgpt webviews", () => {
  const hiddenConversation = {
    id: "hidden-conversation",
    type: "webview",
    url: "https://chatgpt.com/g/test/c/test",
    webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/hidden-conversation",
  };

  expect(selectPrxTarget([hiddenConversation, desktop], "hidden-conversation")?.id).toBe(
    "desktop-current",
  );
});

it("fails closed when multiple Desktop shells are present", () => {
  expect(() =>
    selectPrxTarget(
      [
        desktop,
        {
          ...desktop,
          id: "desktop-second",
        },
      ],
      "",
    ),
  ).toThrow("PRX_AMBIGUOUS_DESKTOP_TARGET");
});
it("parses the rendered PRX reply and rejects the outbound template", () => {
  const expected = {
    requestId: "req-123",
    sessionId: "prx-geral-confirmacao",
    conversationId: "https://chatgpt.com/g/project/c/chat",
    agentId: "health",
  };

  const outbound = JSON.stringify({
    ...expected,
    messageId: "req-123",
    text: "YOUR RESPONSE HERE",
  });

  expect(parsePrxReplyCandidate(outbound, expected)).toBeNull();

  const rendered =
    "Resposta: " +
    JSON.stringify({
      ...expected,
      messageId: "req-123",
      text: "OK",
    });

  expect(parsePrxReplyCandidate(rendered, expected)).toMatchObject({
    requestId: "req-123",
    sessionId: "prx-geral-confirmacao",
    agentId: "health",
    messageId: "req-123",
    text: "OK",
  });
});
