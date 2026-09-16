import { describe, expect, it } from "vitest";

import { parseProviderJson } from "../OpenAiCompatProvider.server";

describe("provider JSON parser", () => {
  it("preserves Windows paths including escape-looking names", () => {
    const raw = String.raw`{"path":"C:\new\test\reports","workspace":"A:\Ambiente\DeliciasDoRio"}`;

    expect(
      parseProviderJson<{
        path: string;
        workspace: string;
      }>(raw),
    ).toEqual({
      path: String.raw`C:\new\test\reports`,
      workspace: String.raw`A:\Ambiente\DeliciasDoRio`,
    });
  });

  it("repairs trailing comma", () => {
    const raw = String.raw`{"status":"ok","workspace":"A:\Ambiente\DeliciasDoRio",}`;

    expect(
      parseProviderJson<{
        status: string;
        workspace: string;
      }>(raw),
    ).toEqual({
      status: "ok",
      workspace: String.raw`A:\Ambiente\DeliciasDoRio`,
    });
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = String.raw`resultado: {"status":"ok","path":"C:\temp\file.txt"} fim`;

    expect(
      parseProviderJson<{
        status: string;
        path: string;
      }>(raw),
    ).toEqual({
      status: "ok",
      path: String.raw`C:\temp\file.txt`,
    });
  });
});
