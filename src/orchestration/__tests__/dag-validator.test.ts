import { describe, expect, it } from "vitest";
import { detectDeadlock, validateTaskDag } from "../dag-validator";

describe("task DAG validation", () => {
  it("accepts and orders a valid DAG", () =>
    expect(
      validateTaskDag([
        { code: "T1", dependsOn: [] },
        { code: "T2", dependsOn: ["T1"] },
      ]),
    ).toEqual({ valid: true, order: ["T1", "T2"] }));
  it.each([
    [
      [
        { code: "T1", dependsOn: [] },
        { code: "T1", dependsOn: [] },
      ],
      "DUPLICATE_TASK_CODE",
    ],
    [[{ code: "T1", dependsOn: ["T1"] }], "SELF_DEPENDENCY"],
    [[{ code: "T1", dependsOn: ["T9"] }], "UNKNOWN_DEPENDENCY"],
    [
      [
        { code: "T1", dependsOn: ["T2"] },
        { code: "T2", dependsOn: ["T1"] },
      ],
      "NO_ROOT_TASK",
    ],
  ])("rejects invalid graphs", (tasks, code) => {
    const result = validateTaskDag(tasks);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toContain(code);
  });
  it("detects impossible idle work", () =>
    expect(
      detectDeadlock([
        { code: "T2", status: "queued", dependsOn: ["T1"] },
        { code: "T1", status: "failed", dependsOn: [] },
      ]),
    ).toEqual({ deadlocked: true, reasons: ["T2:failed_parent:T1"] }));
});
