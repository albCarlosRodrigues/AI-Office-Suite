import type { AgentAnimationState } from "./types";

export function normalizedPositionStyle(agent: AgentAnimationState): React.CSSProperties {
  return {
    position: "absolute",

    left: `${agent.position.x * 100}%`,

    top: `${agent.position.y * 100}%`,

    transform: "translate(-50%, -50%)",

    transition: "none",

    zIndex: Math.round(agent.position.y * 1000),
  };
}

export function animationName(agent: AgentAnimationState): string {
  if (agent.activity === "walking") {
    return `walk-${agent.direction}`;
  }

  if (agent.activity === "whiteboard") {
    return "thinking-board";
  }

  if (agent.activity === "water") {
    return "drink-water";
  }

  if (agent.activity === "coffee") {
    return "drink-coffee";
  }

  if (agent.activity === "sofa" || agent.activity === "armchair") {
    return "sit";
  }

  if (agent.activity === "reporting") {
    return "talk";
  }

  if (agent.businessState === "thinking") {
    return "thinking-desk";
  }

  if (agent.businessState === "working") {
    return "typing";
  }

  return "idle";
}
