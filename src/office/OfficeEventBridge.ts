import { officeBus, type OfficeEvent } from "./eventBus";

import type { OfficeScene } from "./OfficeScene";

/**
 * Traduz eventos reais + comandos do painel para a cena Phaser.
 */
export function attachOfficeBridge(scene: OfficeScene) {
  const handler = (event: OfficeEvent) => {
    switch (event.type) {
      case "agents:sync":
        scene.syncAgents(event.agents);
        break;

      case "agent:status":
        scene.setAgentStatus(event.agentId, event.status);
        break;

      case "agent:message":
        if (event.fromAgentId) {
          scene.say(event.fromAgentId, event.text);
        }
        break;

      case "mission:event": {
        const ev = event.event;

        if (ev.agent_id && shouldSpeak(ev.type)) {
          scene.say(ev.agent_id, humanize(ev.type, ev.message));
        }

        if (
          (ev.type === "TASK_COMPLETED" ||
            ev.type === "REPORT_TO_MANAGER" ||
            ev.type === "ESCALATED") &&
          ev.agent_id
        ) {
          scene.reportToManager(ev.agent_id, ev.target_agent_id, ev.message);
        }

        if (ev.type === "REVIEW_APPROVED" && ev.agent_id) {
          scene.reportToManager(ev.agent_id, null, ev.message);
        }

        break;
      }

      case "debug:animation":
        scene.testAnimation(event.agentId, event.action);
        break;

      case "kill_switch":
        scene.setKillSwitch(event.active);
        break;

      case "focus:agent":
        scene.selectAgent(event.agentId);
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
  if (type === "APPROVAL_REQUESTED") {
    return "Need human approval: " + message;
  }

  return message;
}
