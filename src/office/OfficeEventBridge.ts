import { officeBus, type OfficeEvent } from "./eventBus";
import type { OfficeScene } from "./OfficeScene";

/**
 * OfficeEventBridge — translates real system events into scene commands.
 * Kept separate from the scene so the mapping can evolve (or be tested)
 * without touching rendering code.
 */
export function attachOfficeBridge(scene: OfficeScene) {
  const handler = (e: OfficeEvent) => {
    switch (e.type) {
      case "agents:sync":
        scene.syncAgents(e.agents);
        break;
      case "agent:status":
        scene.setAgentStatus(e.agentId, e.status);
        break;
      case "agent:message":
        if (e.fromAgentId) scene.say(e.fromAgentId, e.text);
        break;
      case "mission:event": {
        const ev = e.event;
        if (ev.agent_id && shouldSpeak(ev.type))
          scene.say(ev.agent_id, humanize(ev.type, ev.message));
        if (
          (ev.type === "TASK_COMPLETED" ||
            ev.type === "REPORT_TO_MANAGER" ||
            ev.type === "ESCALATED") &&
          ev.agent_id
        )
          scene.reportToManager(ev.agent_id, ev.target_agent_id, ev.message);
        if (ev.type === "REVIEW_APPROVED" && ev.agent_id)
          scene.reportToManager(ev.agent_id, null, ev.message);
        break;
      }
      case "kill_switch":
        scene.setKillSwitch(e.active);
        break;
      case "focus:agent":
        scene.selectAgent(e.agentId);
        break;
    }
  };
  return officeBus.on(handler);
}

const SPEAK_TYPES = new Set([
  "COMMAND_ISSUED",
  "COMMAND_ACCEPTED",
  "TASK_COMPLETED",
  "REVIEW_APPROVED",
  "TASK_FAILED",
  "APPROVAL_REQUESTED",
  "REVISION_REQUESTED",
  "MEETING_MESSAGE",
  "AGENT_MESSAGE",
  "MISSION_COMPLETED",
  "MISSION_FAILED",
  "PLAN_CREATED",
  "SCOPE_EXTENSION_REQUESTED",
]);

function shouldSpeak(type: string) {
  return SPEAK_TYPES.has(type);
}

function humanize(type: string, message: string) {
  if (type === "APPROVAL_REQUESTED") return "Need human approval: " + message;
  return message;
}
