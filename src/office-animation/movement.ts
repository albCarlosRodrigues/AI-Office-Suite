import type {
  AgentAnimationState,
  Direction,
  Point,
} from "./types";

const DEFAULT_SPEED = 0.085;

function distance(
  a: Point,
  b: Point,
): number {
  return Math.hypot(
    b.x - a.x,
    b.y - a.y,
  );
}

function getDirection(
  from: Point,
  to: Point,
): Direction {
  const dx =
    to.x - from.x;

  const dy =
    to.y - from.y;

  if (
    Math.abs(dx) >
    Math.abs(dy)
  ) {
    return dx >= 0
      ? "right"
      : "left";
  }

  return dy >= 0
    ? "down"
    : "up";
}

export function startRoute(
  agent: AgentAnimationState,
  route: Point[],
): AgentAnimationState {
  if (
    route.length === 0
  ) {
    return agent;
  }

  /*
   * A primeira posicao normalmente representa
   * a posicao atual do agente.
   *
   * Portanto iniciamos no waypoint seguinte.
   */
  const initialIndex =
    route.length > 1
      ? 1
      : 0;

  return {
    ...agent,

    activity: "walking",

    route,

    routeIndex:
      initialIndex,
  };
}

export function updateMovement(
  agent: AgentAnimationState,
  deltaSeconds: number,
  speed = DEFAULT_SPEED,
): {
  agent: AgentAnimationState;
  arrived: boolean;
} {
  /*
   * Nao existe movimento ativo.
   */
  if (
    agent.activity !== "walking" ||
    agent.route.length === 0 ||
    agent.routeIndex >=
      agent.route.length
  ) {
    return {
      agent,
      arrived: true,
    };
  }

  /*
   * Com noUncheckedIndexedAccess habilitado,
   * TypeScript considera route[index]
   * potencialmente undefined.
   */
  const target =
    agent.route[
      agent.routeIndex
    ];

  if (!target) {
    return {
      arrived: true,

      agent: {
        ...agent,

        routeIndex:
          agent.route.length,
      },
    };
  }

  const currentPosition: Point = {
    x: agent.position.x,
    y: agent.position.y,
  };

  const d =
    distance(
      currentPosition,
      target,
    );

  const safeDelta =
    Math.max(
      deltaSeconds,
      0,
    );

  const maxStep =
    speed * safeDelta;

  /*
   * Ja esta exatamente no waypoint.
   */
  if (d === 0) {
    const nextIndex =
      agent.routeIndex + 1;

    const arrived =
      nextIndex >=
      agent.route.length;

    return {
      arrived,

      agent: {
        ...agent,

        position: {
          x: target.x,
          y: target.y,
        },

        routeIndex:
          nextIndex,
      },
    };
  }

  /*
   * O proximo frame consegue alcancar
   * completamente o waypoint.
   */
  if (d <= maxStep) {
    const nextIndex =
      agent.routeIndex + 1;

    const arrived =
      nextIndex >=
      agent.route.length;

    return {
      arrived,

      agent: {
        ...agent,

        position: {
          x: target.x,
          y: target.y,
        },

        routeIndex:
          nextIndex,

        direction:
          getDirection(
            currentPosition,
            target,
          ),
      },
    };
  }

  /*
   * Movimento parcial em direcao
   * ao waypoint atual.
   */
  const ratio =
    maxStep / d;

  const nextPosition: Point = {
    x:
      currentPosition.x +
      (
        target.x -
        currentPosition.x
      ) *
        ratio,

    y:
      currentPosition.y +
      (
        target.y -
        currentPosition.y
      ) *
        ratio,
  };

  return {
    arrived: false,

    agent: {
      ...agent,

      direction:
        getDirection(
          currentPosition,
          target,
        ),

      position:
        nextPosition,
    },
  };
}