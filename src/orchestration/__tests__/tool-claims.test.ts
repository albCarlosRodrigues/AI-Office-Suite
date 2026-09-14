import { describe, expect, it } from "vitest";
import { enforceRuntimeEvidence } from "../tool-claims";

const claimed = {
  status: "COMPLETED" as const,
  summary: "tests passed",
  evidence: [],
  toolCalls: [
    { toolId: "testing", input: "npm test", output: "passed", risk: "LOW" as const, latencyMs: 1 },
  ],
  usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1, model: "x", simulated: false },
};
describe("model tool claims", () => {
  it("blocks completion from every real provider until runtime evidence exists", () =>
    expect(enforceRuntimeEvidence(claimed, false).status).toBe("BLOCKED"));
  it("keeps simulation explicitly simulated", () =>
    expect(enforceRuntimeEvidence(claimed, true).status).toBe("COMPLETED"));
  it("rejects a bare self-report when the contract requires runtime evidence", () =>
    expect(enforceRuntimeEvidence({ ...claimed, toolCalls: [] }, false, true, 0).status).toBe(
      "BLOCKED",
    ));
});
