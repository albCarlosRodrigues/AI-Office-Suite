import { describe, expect, it } from "vitest";
import { selectDependencyContext } from "../ContextBuilder";

describe("artifact-first context", () => {
  it("keeps small results inline and large results reference-first", () => {
    const selected = selectDependencyContext(
      [
        { code: "T1", title: "small", result: "ok" },
        { code: "T2", title: "large", result: "x".repeat(100), artifactRefs: ["artifact:1"] },
      ],
      10,
    );
    expect(selected[0]).toMatchObject({ inlineResult: "ok" });
    expect(selected[1]).toMatchObject({
      inlineResult: null,
      artifactRefs: ["artifact:1"],
      requiresArtifactFetch: true,
    });
  });
});
