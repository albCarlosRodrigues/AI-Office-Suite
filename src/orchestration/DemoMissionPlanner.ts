import type { PlannedTask } from "./providers/types";

/** Deterministic showcase plan. Real providers are free to produce any valid DAG. */
export class DemoMissionPlanner {
  static plan(goal: string): PlannedTask[] {
    const short = goal.length > 60 ? `${goal.slice(0, 57)}…` : goal;
    return [
      {
        code: "T1",
        title: `Investigate: ${short}`,
        description: `Collect references, constraints and prior art relevant to "${goal}". Return findings with sources.`,
        role: "research",
        dependsOn: [],
        tools: ["web_search", "repository_read"],
        expectedOutput: "Findings list with references",
      },
      {
        code: "T2",
        title: "Analyze affected code and risks",
        description: `Map the modules affected by "${goal}", list risks and propose an implementation approach.`,
        role: "analysis",
        dependsOn: [],
        tools: ["code_analysis", "repository_read"],
        expectedOutput: "Impact analysis + approach",
      },
      {
        code: "T3",
        title: "Implement the change",
        description: `Implement "${goal}" following the approved approach. Do not touch unrelated files.`,
        role: "implement",
        dependsOn: ["T1", "T2"],
        tools: ["repository_read", "repository_write", "shell", "testing"],
        expectedOutput: "Diff + passing local tests",
      },
      {
        code: "T4",
        title: "Verify and report",
        description: "Run the test suite against the delivered change and report results honestly.",
        role: "verify",
        dependsOn: ["T3"],
        tools: ["testing", "repository_read"],
        expectedOutput: "Test report",
      },
    ];
  }
}
