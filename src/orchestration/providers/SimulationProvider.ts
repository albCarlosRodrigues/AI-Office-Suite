import type { Evidence } from "@/types/domain";
import type {
  AgentProvider,
  ExecInput,
  MeetingTurnInput,
  MeetingTurnResult,
  PlanInput,
  PlanResult,
  PlannedTask,
  ReviewInput,
  ReviewResult,
  SummaryInput,
  SummaryResult,
  ToolCallRecord,
  Usage,
  WorkerResponse,
} from "./types";
import { DemoMissionPlanner } from "../DemoMissionPlanner";

/**
 * SimulationProvider — deterministic, honest fake.
 * Every output is labelled simulated. No network calls. Designed so the
 * orchestration engine exercises the exact same code path as real providers.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function usage(seed: string, base: number): Usage {
  const h = hash(seed);
  return {
    tokensIn: base + (h % 400),
    tokensOut: Math.round(base / 3) + (h % 220),
    latencyMs: 400 + (h % 900),
    model: "simulated-llm",
    simulated: true,
  };
}

function pick<T>(arr: T[], seed: string): T {
  return arr[hash(seed) % arr.length]!;
}

export class SimulationProvider implements AgentProvider {
  readonly type = "simulation" as const;
  readonly simulated = true;
  readonly model = "simulated-llm";

  async plan(input: PlanInput): Promise<PlanResult> {
    const g = input.goal.trim();
    const short = g.length > 60 ? g.slice(0, 57) + "…" : g;
    const tasks: PlannedTask[] = DemoMissionPlanner.plan(g);
    return {
      rationale: `Split "${short}" into research, analysis, implementation and verification so each subordinate works inside a narrow scope with evidence at every hand-off.`,
      tasks,
      usage: usage(g, 900),
    };
  }

  async executeTask(input: ExecInput): Promise<WorkerResponse> {
    const { command, agent } = input;
    const seed = command.id + agent.id;
    const tools = command.allowedTools.length ? command.allowedTools : ["repository_read"];
    const toolCalls: ToolCallRecord[] = tools.slice(0, 3).map((toolId, i) => ({
      toolId,
      input: simulatedInput(toolId, command.objective),
      output: simulatedOutput(toolId, seed + i),
      risk: toolId === "shell" ? "HIGH" : toolId === "repository_write" ? "MEDIUM" : "LOW",
      latencyMs: 150 + (hash(seed + i) % 700),
    }));
    const evidence: Evidence[] = toolCalls.map((tc) => ({
      type:
        tc.toolId === "testing"
          ? "test_result"
          : tc.toolId === "repository_write"
            ? "code_diff"
            : tc.toolId === "shell"
              ? "command_output"
              : tc.toolId === "web_search"
                ? "web_reference"
                : "text",
      title: `${tc.toolId} → ${tc.input.slice(0, 40)}`,
      content: tc.output,
      simulated: true,
    }));
    const flavor = pick(
      [
        "Executed within the delegated scope. No files outside the allowed set were touched.",
        "Completed as instructed. Two edge cases noted in evidence for the reviewer.",
        "Done. Kept the change minimal; flagged one follow-up outside my scope.",
      ],
      seed,
    );
    return {
      status: "COMPLETED",
      summary: `[SIMULATED] ${command.objective} — ${flavor}`,
      evidence,
      toolCalls,
      usage: usage(seed, 1400),
    };
  }

  async review(input: ReviewInput): Promise<ReviewResult> {
    // Deterministic: request one revision on implementation tasks the first time, to exercise the loop.
    const isImpl = /implement/i.test(input.task.title);
    if (isImpl && input.task.retries === 0) {
      return {
        decision: "REVISE",
        feedback:
          "[SIMULATED] Evidence lacks a test run for the new branch. Re-run tests and attach the output.",
        usage: usage(input.task.code + "r", 500),
      };
    }
    return {
      decision: "APPROVE",
      feedback: "[SIMULATED] Evidence matches the expected output. Approved.",
      usage: usage(input.task.code + "a", 450),
    };
  }

  async meetingTurn(input: MeetingTurnInput): Promise<MeetingTurnResult> {
    const lines: Record<number, string[]> = {
      1: [
        `From ${input.speaker.role}: I'll own my part of "${input.topic.slice(0, 40)}". Scope is clear.`,
        `Kick-off noted. I need the research findings before I start; otherwise I'm blocked.`,
        `I'll keep changes minimal and attach test evidence on hand-off.`,
      ],
      2: [
        `Risk: hidden coupling in the affected module. I'll surface it in the analysis.`,
        `Agreed on the plan. Any tool outside my allowed list goes through approval.`,
        `I'll verify against the acceptance criteria only — no scope creep.`,
      ],
      3: [
        `No further questions. Proceeding.`,
        `Confirmed. Reporting back with evidence when done.`,
        `Aligned. Escalating to the controller if anything drifts.`,
      ],
    };
    const opts = lines[Math.min(3, Math.max(1, input.round))]!;
    return {
      message: "[SIMULATED] " + pick(opts, input.speaker.id + input.round),
      usage: usage(input.speaker.id + input.round, 300),
    };
  }

  async summarize(input: SummaryInput): Promise<SummaryResult> {
    const done = input.tasks.filter((t) => t.status === "completed").length;
    return {
      summary:
        `[SIMULATED REPORT] Goal: ${input.goal}. ${done}/${input.tasks.length} tasks completed with evidence. ` +
        input.tasks.map((t) => `${t.code} ${t.status}`).join(", ") +
        ". No real code was modified: this mission ran in simulation mode.",
      usage: usage(input.goal, 700),
    };
  }

  async healthCheck() {
    return {
      health: "CONNECTED" as const,
      latencyMs: 1,
      message: "Simulation provider is always available.",
    };
  }
}

function simulatedInput(tool: string, objective: string) {
  switch (tool) {
    case "web_search":
      return `query: "${objective.slice(0, 50)}"`;
    case "repository_read":
      return "path: src/**";
    case "code_analysis":
      return "target: affected modules";
    case "repository_write":
      return "branch: feature/mission-scope";
    case "shell":
      return "command: bun test";
    case "testing":
      return "pattern: **/*.test.ts";
    default:
      return "(default input)";
  }
}

function simulatedOutput(tool: string, seed: string) {
  const n = hash(seed) % 40;
  switch (tool) {
    case "web_search":
      return `3 references found (simulated). Top: docs.example/${n} — matches the objective.`;
    case "repository_read":
      return `Read ${4 + n} files (simulated). Key module: src/core/module${n}.ts`;
    case "code_analysis":
      return `Findings (simulated): ${1 + (n % 3)} coupling points, cyclomatic complexity within limits.`;
    case "repository_write":
      return `--- a/src/core/module${n}.ts\n+++ b/src/core/module${n}.ts\n@@ -1,3 +1,5 @@\n+// simulated change\n+export const missionFlag = true;`;
    case "shell":
      return `$ bun test\n${12 + n} pass, 0 fail (simulated)`;
    case "testing":
      return `Suite: ${12 + n} passed, 0 failed, 0 skipped (simulated)`;
    default:
      return "ok (simulated)";
  }
}
