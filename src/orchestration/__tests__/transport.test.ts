import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, isRetryableStatus, retryAfterMs } from "../providers/transport";

afterEach(() => vi.unstubAllGlobals());
describe("HTTP transport retry policy", () => {
  it.each([
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [401, false],
    [403, false],
    [400, false],
  ])("classifies %s", (status, retry) => expect(isRetryableStatus(status)).toBe(retry));
  it("honors Retry-After seconds", () => expect(retryAfterMs("2")).toBe(2000));
  it("retries 429 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchWithRetry(
      "https://example.test",
      {},
      { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 100 },
    );
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not retry 401", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (
        await fetchWithRetry(
          "https://example.test",
          {},
          { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 100 },
        )
      ).status,
    ).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
