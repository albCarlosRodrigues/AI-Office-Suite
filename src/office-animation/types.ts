export type AgentBusinessState = "idle" | "thinking" | "working" | "completed" | string;

export type Direction = "up" | "down" | "left" | "right";

export type VisualActivity =
  "desk" | "walking" | "whiteboard" | "water" | "coffee" | "sofa" | "armchair" | "reporting";

export interface Point {
  x: number;
  y: number;
}

export interface Route {
  id: string;
  points: Point[];
}

export interface AgentAnimationState {
  agentId: string;

  businessState: AgentBusinessState;

  activity: VisualActivity;

  position: Point;

  homePosition: Point;

  route: Point[];

  routeIndex: number;

  direction: Direction;

  target?: OfficeResource | undefined;

  thinkingSince?: number | undefined;

  activityUntil?: number | undefined;

  nextIdleDecisionAt: number;

  reportingRequired: boolean;
}

export type OfficeResource = "whiteboard" | "water" | "coffee" | "sofa" | "armchair" | "supervisor";
