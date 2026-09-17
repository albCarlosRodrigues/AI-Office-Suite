import type { Agent, AgentStatus, MissionEvent, Meeting } from "@/types/domain";

export type OfficeAnimationTestAction =
  | "idle"
  | "thinking"
  | "working"
  | "meeting"
  | "whiteboard"
  | "water"
  | "coffee"
  | "sofa"
  | "armchair"
  | "supervisor"
  | "home"
  | "talk"
  | "reset";

/**
 * OfficeEventBus — in-memory bridge between real orchestration data
 * (Supabase realtime / query refetches) and the Phaser office scene.
 * The office NEVER invents state: it only reacts to events emitted here.
 */
export type OfficeEvent =
  | { type: "agents:sync"; agents: Agent[] }
  | {
      type: "agent:status";
      agentId: string;
      status: AgentStatus;
      previous?: AgentStatus | undefined;
    }
  | {
      type: "agent:message";
      fromAgentId: string | null;
      toAgentId: string | null;
      text: string;
      kind: string;
    }
  | { type: "mission:event"; event: MissionEvent }
  | { type: "meeting:changed"; meeting: Meeting }
  | { type: "kill_switch"; active: boolean }
  | {
      type: "debug:animation";
      agentId: string;
      action: OfficeAnimationTestAction;
    }
  | { type: "focus:agent"; agentId: string | null };

type Listener = (e: OfficeEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: OfficeEvent) {
    for (const l of this.listeners) l(e);
  }
}

export const officeBus = new EventBus();
