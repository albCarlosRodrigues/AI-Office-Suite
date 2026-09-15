import { describe, expect, it } from "vitest";
import type { Agent, Mission, Organization } from "@/types/domain";
import {
  buildOperationalHierarchy,
  effectiveManagerOf,
  operationalChainOfCommand,
} from "@/agents/hierarchy";
import { DelegationPolicyService } from "../DelegationPolicyService";

function makeAgent(
  id: string,
  manager: string | null,
  options: {
    suspended?: boolean;
    status?: Agent["status"];
    autonomy?: number;
  } = {},
): Agent {
  return {
    id,
    organization_id: "org-1",
    name: id,
    manager_agent_id: manager,
    is_suspended: options.suspended ?? false,
    status: options.status ?? "IDLE",
    autonomy_level: options.autonomy ?? 3,
    external_config: {},
  } as Agent;
}

describe("operational hierarchy stack", () => {
  it("pops a suspended superior and promotes the next active agent", () => {
    const codex = makeAgent("codex", null, {
      suspended: true,
      autonomy: 4,
    });

    const gpt = makeAgent("gpt", "codex");
    const claudinho = makeAgent("claudinho", "gpt");

    const agents = [codex, gpt, claudinho];

    expect(effectiveManagerOf("gpt", agents)).toBeNull();
    expect(operationalChainOfCommand("gpt", agents).map((agent) => agent.id)).toEqual([]);

    expect(effectiveManagerOf("claudinho", agents)?.id).toBe("gpt");
    expect(operationalChainOfCommand("claudinho", agents).map((agent) => agent.id)).toEqual([
      "gpt",
    ]);
  });

  it("pushes the superior back automatically when reactivated", () => {
    const codex = makeAgent("codex", null, {
      suspended: false,
      autonomy: 4,
    });

    const gpt = makeAgent("gpt", "codex");
    const claudinho = makeAgent("claudinho", "gpt");

    const agents = [codex, gpt, claudinho];

    expect(effectiveManagerOf("gpt", agents)?.id).toBe("codex");

    expect(operationalChainOfCommand("claudinho", agents).map((agent) => agent.id)).toEqual([
      "gpt",
      "codex",
    ]);
  });

  it.each(["OFFLINE", "PAUSED", "ERROR"] as const)(
    "pops a manager whose runtime status is %s",
    (status) => {
      const codex = makeAgent("codex", null, {
        status,
        autonomy: 4,
      });

      const gpt = makeAgent("gpt", "codex");

      expect(effectiveManagerOf("gpt", [codex, gpt])).toBeNull();
    },
  );

  it("collapses a suspended middle manager", () => {
    const codex = makeAgent("codex", null, {
      autonomy: 4,
    });

    const gpt = makeAgent("gpt", "codex", {
      suspended: true,
    });

    const claudinho = makeAgent("claudinho", "gpt");

    const agents = [codex, gpt, claudinho];

    expect(effectiveManagerOf("claudinho", agents)?.id).toBe("codex");
  });

  it("renders active descendants against their effective manager", () => {
    const codex = makeAgent("codex", null, {
      suspended: true,
      autonomy: 4,
    });

    const gpt = makeAgent("gpt", "codex");
    const claudinho = makeAgent("claudinho", "gpt");

    const tree = buildOperationalHierarchy([codex, gpt, claudinho]);

    const roots = tree.map((node) => node.agent.id);

    expect(roots).toContain("codex");
    expect(roots).toContain("gpt");

    const gptNode = tree.find((node) => node.agent.id === "gpt");

    expect(gptNode?.children.map((node) => node.agent.id)).toContain("claudinho");
  });

  it("treats the next active level as the direct operational manager", () => {
    const codex = makeAgent("codex", null, {
      autonomy: 4,
    });

    const gpt = makeAgent("gpt", "codex", {
      suspended: true,
    });

    const claudinho = makeAgent("claudinho", "gpt");

    const agents = [codex, gpt, claudinho];

    const decision = DelegationPolicyService.validate({
      issuerAgent: codex,
      targetAgent: claudinho,
      organization: {
        id: "org-1",
      } as Organization,
      mission: {
        organization_id: "org-1",
      } as Mission,
      agents,
      settings: null,
      issuerPermissions: ["delegate_tasks"],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.authority).toBe("DIRECT_MANAGER_ONLY");
  });
});
