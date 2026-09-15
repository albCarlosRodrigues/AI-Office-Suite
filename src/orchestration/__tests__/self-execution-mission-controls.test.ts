import { describe, expect, it } from "vitest";
import type { Agent, Mission, Organization } from "@/types/domain";
import { DelegationPolicyService } from "../DelegationPolicyService";

function agent(id: string): Agent {
  return {
    id,
    organization_id: "org-1",
    name: id,
    status: "IDLE",
    is_suspended: false,
    autonomy_level: 3,
    manager_agent_id: null,
    external_config: {},
  } as Agent;
}

describe("self execution", () => {
  it("does not treat an agent executing its own assigned work as forbidden delegation", () => {
    const gpt = agent("gpt");

    const decision = DelegationPolicyService.validate({
      issuerAgent: gpt,
      targetAgent: gpt,
      organization: {
        id: "org-1",
      } as Organization,
      mission: {
        organization_id: "org-1",
      } as Mission,
      agents: [gpt],
      settings: null,
      issuerPermissions: [],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.authority).toBe("SELF_EXECUTION");
    expect(decision.overrideUsed).toBe(false);
  });
});
