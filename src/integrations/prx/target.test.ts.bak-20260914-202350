import { expect, it } from "vitest";
import { selectPrxTarget } from "./cdp-session.server";
const target = {
  id: "new-id",
  type: "page",
  url: "app://-/index.html",
  webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/new-id",
};
it("rediscovers the desktop target after its ID changes", () => {
  expect(selectPrxTarget([target], "old-id")?.id).toBe("new-id");
});
it("rejects unrelated and ambiguous targets", () => {
  expect(selectPrxTarget([{ ...target, url: "https://other.example" }], "new-id")).toBeUndefined();
  expect(() => selectPrxTarget([target, { ...target, id: "second" }], "")).toThrow("AMBIGUOUS");
});
