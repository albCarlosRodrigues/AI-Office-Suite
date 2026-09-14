import { describe, expect, it } from "vitest";
import { retryContext, TaskContractSchema } from "../contracts";
import { ContextBudgeter } from "../context-budgeter";

const task = TaskContractSchema.parse({
  taskId: "1",
  taskCode: "T1",
  objective: "Test",
  dependencies: [],
  acceptanceCriteria: [{ id: "AC-1", description: "tests exit 0" }],
  expectedArtifacts: [],
  allowedTools: ["testing"],
  forbiddenActions: ["deploy"],
  maxAttempts: 2,
  tokenBudget: 1000,
  costBudget: 1,
  modelTier: "TIER_1",
  executionMode: "REAL",
});
describe("immutable contracts and budgets", () => {
  it("preserves the task contract across retries", () => {
    const retry = retryContext(task, 2, ["exit 1"], "fix");
    expect(retry.contract).toEqual(task);
    expect(retry.contract.allowedTools).toEqual(["testing"]);
    expect(Object.isFrozen(retry)).toBe(true);
  });
  it("includes reserved output in context budget", () =>
    expect(
      new ContextBudgeter().fits(
        {
          systemTokens: 100,
          taskTokens: 200,
          dependencyTokens: 100,
          artifactTokens: 100,
          reservedOutputTokens: 600,
        },
        1000,
        2000,
      ).fits,
    ).toBe(false));
});
