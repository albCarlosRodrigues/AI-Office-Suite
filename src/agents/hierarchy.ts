import type { Agent } from "@/types/domain";

export interface AgentNode {
  agent: Agent;
  children: AgentNode[];
  level: number;
}

const NON_OPERATIONAL_STATUSES = new Set(["OFFLINE", "PAUSED", "ERROR"]);

/**
 * Structural hierarchy is persistent, while operational hierarchy behaves
 * like a stack. Suspending/unavailable agents temporarily removes them from
 * the command stack without mutating manager_agent_id.
 */
export function isOperationallyActive(agent: Agent | null | undefined): boolean {
  return Boolean(agent && !agent.is_suspended && !NON_OPERATIONAL_STATUSES.has(agent.status));
}

/**
 * Returns the first active manager above an agent.
 *
 * Example:
 * Codex(suspended) -> GPT -> Claudinho
 *
 * effectiveManagerOf(GPT)       = null
 * effectiveManagerOf(Claudinho) = GPT
 *
 * Reactivating Codex automatically restores:
 * effectiveManagerOf(GPT) = Codex
 */
export function effectiveManagerOf(agentId: string, agents: Agent[]): Agent | null {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  let managerId = byId.get(agentId)?.manager_agent_id ?? null;
  const seen = new Set<string>();

  while (managerId && !seen.has(managerId)) {
    seen.add(managerId);

    const manager = byId.get(managerId);
    if (!manager) return null;

    if (isOperationallyActive(manager)) {
      return manager;
    }

    managerId = manager.manager_agent_id;
  }

  return null;
}

/**
 * Operational command stack, nearest active superior first.
 * Suspended/offline/paused/error agents are popped transparently.
 */
export function operationalChainOfCommand(agentId: string, agents: Agent[]): Agent[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const chain: Agent[] = [];
  const seen = new Set<string>();

  let current = byId.get(agentId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);

    const manager = effectiveManagerOf(current.id, agents);
    if (!manager || seen.has(manager.id)) break;

    chain.push(manager);
    current = manager;
  }

  return chain;
}

export function buildHierarchy(agents: Agent[]): AgentNode[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const parent = a.manager_agent_id && byId.has(a.manager_agent_id) ? a.manager_agent_id : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(a);
    childrenOf.set(parent, list);
  }
  const sortFn = (a: Agent, b: Agent) => a.name.localeCompare(b.name);
  const build = (parent: string | null, level: number, seen: Set<string>): AgentNode[] =>
    (childrenOf.get(parent) ?? [])
      .slice()
      .sort(sortFn)
      .filter((a) => !seen.has(a.id))
      .map((a) => {
        const next = new Set(seen);
        next.add(a.id);
        return { agent: a, level, children: build(a.id, level + 1, next) };
      });
  return build(null, 0, new Set());
}

/**
 * UI hierarchy using the operational stack.
 *
 * Active agents are re-parented to their effective active manager.
 * Inactive agents remain visible in their structural position, but active
 * descendants bypass them.
 */
export function buildOperationalHierarchy(agents: Agent[]): AgentNode[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenOf = new Map<string | null, Agent[]>();

  for (const agent of agents) {
    const structuralParent =
      agent.manager_agent_id && byId.has(agent.manager_agent_id) ? agent.manager_agent_id : null;

    const parent = isOperationallyActive(agent)
      ? (effectiveManagerOf(agent.id, agents)?.id ?? null)
      : structuralParent;

    const list = childrenOf.get(parent) ?? [];
    list.push(agent);
    childrenOf.set(parent, list);
  }

  const sortFn = (a: Agent, b: Agent) => a.name.localeCompare(b.name);

  const build = (parent: string | null, level: number, seen: Set<string>): AgentNode[] =>
    (childrenOf.get(parent) ?? [])
      .slice()
      .sort(sortFn)
      .filter((agent) => !seen.has(agent.id))
      .map((agent) => {
        const next = new Set(seen);
        next.add(agent.id);

        return {
          agent,
          level,
          children: build(agent.id, level + 1, next),
        };
      });

  return build(null, 0, new Set());
}
export function agentLevel(agent: Agent, agents: Agent[]): number {
  const byId = new Map(agents.map((a) => [a.id, a]));
  let level = 0;
  let cur = agent.manager_agent_id;
  const seen = new Set<string>();
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    level++;
    cur = byId.get(cur)!.manager_agent_id;
  }
  return level;
}

/** Returns true if assigning `managerId` as manager of `agentId` would create a cycle. */
export function wouldCreateCycle(
  agentId: string,
  managerId: string | null,
  agents: Agent[],
): boolean {
  if (!managerId) return false;
  if (managerId === agentId) return true;
  const byId = new Map(agents.map((a) => [a.id, a]));
  let cur: string | null = managerId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === agentId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = byId.get(cur)?.manager_agent_id ?? null;
  }
  return false;
}

export function subordinatesOf(agentId: string, agents: Agent[]): Agent[] {
  const result: Agent[] = [];
  const stack = [agentId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    for (const a of agents) {
      if (a.manager_agent_id === id && !seen.has(a.id)) {
        seen.add(a.id);
        result.push(a);
        stack.push(a.id);
      }
    }
  }
  return result;
}

export function chainOfCommand(agentId: string, agents: Agent[]): Agent[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const chain: Agent[] = [];
  let cur = byId.get(agentId)?.manager_agent_id ?? null;
  const seen = new Set<string>();
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    chain.push(byId.get(cur)!);
    cur = byId.get(cur)!.manager_agent_id;
  }
  return chain;
}
