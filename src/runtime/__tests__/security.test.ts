import { describe, expect, it } from "vitest";
import { guardCommand, guardPath } from "../security/guards";
import { redact } from "../security/redaction";

describe("runtime security", () => {
  it.each([
    "sudo apt update",
    "rm -rf ./x",
    "git reset --hard",
    "git clean -fd",
    "git push --force",
  ])("blocks %s", (command) => expect(guardCommand(command).allowed).toBe(false));
  it("blocks path traversal", () =>
    expect(guardPath("C:/Windows/System32", ["C:/work"]).allowed).toBe(false));
  it("redacts secrets recursively", () =>
    expect(redact({ Authorization: "Bearer abcdefghijk", nested: "sk-abcdefghijklmnop" })).toEqual({
      Authorization: "[REDACTED]",
      nested: "[REDACTED]",
    }));
});
