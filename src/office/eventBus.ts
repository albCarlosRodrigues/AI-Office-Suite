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
  | "walk-up"
  | "walk-down"
  | "walk-left"
  | "walk-right"
  | "talk"
  | "reset";

/**
 * OfficeEventBus
 *
 * Os eventos normais representam o estado real.
 * debug:animation representa SOMENTE um override visual local.
 */
export type OfficeEvent =
  | {
      type: "agents:sync";
      agents: Agent[];
    }
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
  | {
      type: "mission:event";
      event: MissionEvent;
    }
  | {
      type: "meeting:changed";
      meeting: Meeting;
    }
  | {
      type: "kill_switch";
      active: boolean;
    }
  | {
      type: "debug:animation";
      agentId: string;
      action: OfficeAnimationTestAction;
    }
  | {
      type: "focus:agent";
      agentId: string | null;
    };

type Listener = (event: OfficeEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();

  on(fn: Listener) {
    this.listeners.add(fn);

    return () => this.listeners.delete(fn);
  }

  emit(event: OfficeEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const officeBus = new EventBus();
