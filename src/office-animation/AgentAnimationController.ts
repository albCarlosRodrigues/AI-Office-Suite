import {
  officeResources,
} from "./OfficeResourceManager";

import {
  routeBack,
  routeToArmchair,
  routeToCoffee,
  routeToSofa,
  routeToSupervisor,
  routeToWater,
  routeToWhiteboard,
} from "./officeRoutes";

import {
  startRoute,
  updateMovement,
} from "./movement";

import type {
  AgentAnimationState,
  AgentBusinessState,
  OfficeResource,
  Point,
} from "./types";

/*
 * Regras solicitadas:
 *
 * 1. THINKING:
 *    permanece animado na mesa.
 *
 * 2. THINKING > 15-20 s:
 *    tenta ir ao quadro.
 *    Se ocupado, continua pensando na mesa.
 *
 * 3. IDLE:
 *    pode beber agua.
 *
 * 4. IDLE:
 *    pode tomar cafe.
 *
 * 5. IDLE:
 *    pode sentar no sofa.
 *
 * 6. WORKING:
 *    fica na mesa olhando o monitor.
 *
 * 7. Fim da tarefa:
 *    funcionario vai ao superior informar.
 *
 * 8. IDLE:
 *    pode usar poltrona, agua ou cafe.
 */

const MIN_THINKING_TO_BOARD = 15_000;
const MAX_THINKING_TO_BOARD = 20_000;

const IDLE_MIN_DELAY = 7_000;
const IDLE_MAX_DELAY = 16_000;

const ACTIVITY_MIN_DURATION = 4_000;
const ACTIVITY_MAX_DURATION = 8_000;

function randomBetween(
  min: number,
  max: number,
): number {
  return (
    min +
    Math.random() *
      (max - min)
  );
}

function nextIdleDecision(
  now: number,
): number {
  return (
    now +
    randomBetween(
      IDLE_MIN_DELAY,
      IDLE_MAX_DELAY,
    )
  );
}

function releaseTarget(
  agent: AgentAnimationState,
): void {
  if (agent.target) {
    officeResources.release(
      agent.target,
      agent.agentId,
    );
  }
}

function beginResourceAction(
  agent: AgentAnimationState,
  resource: OfficeResource,
  route: Point[],
): AgentAnimationState {
  if (
    !officeResources.acquire(
      resource,
      agent.agentId,
    )
  ) {
    return agent;
  }

  return startRoute(
    {
      ...agent,
      target: resource,
    },
    route,
  );
}

function chooseIdleActivity(
  agent: AgentAnimationState,
): AgentAnimationState {
  const actions: OfficeResource[] = [
    "water",
    "coffee",
    "sofa",
    "armchair",
  ];

  /*
   * Embaralha para que varios funcionarios
   * nao priorizem sempre o mesmo recurso.
   */
  actions.sort(
    () => Math.random() - 0.5,
  );

  for (const action of actions) {
    if (
      !officeResources.isAvailable(action)
    ) {
      continue;
    }

    switch (action) {
      case "water":
        return beginResourceAction(
          agent,
          "water",
          routeToWater(agent.position),
        );

      case "coffee":
        return beginResourceAction(
          agent,
          "coffee",
          routeToCoffee(agent.position),
        );

      case "sofa":
        return beginResourceAction(
          agent,
          "sofa",
          routeToSofa(agent.position),
        );

      case "armchair":
        return beginResourceAction(
          agent,
          "armchair",
          routeToArmchair(agent.position),
        );
    }
  }

  return agent;
}

export function createAgentAnimationState(
  agentId: string,
  homePosition: Point,
  businessState: AgentBusinessState,
  now = Date.now(),
): AgentAnimationState {
  return {
    agentId,

    businessState,

    activity: "desk",

    position: {
      ...homePosition,
    },

    homePosition: {
      ...homePosition,
    },

    route: [],

    routeIndex: 0,

    direction: "up",

    thinkingSince:
      businessState === "thinking"
        ? now
        : undefined,

    nextIdleDecisionAt:
      nextIdleDecision(now),

    reportingRequired: false,
  };
}

export function setBusinessState(
  agent: AgentAnimationState,
  newState: AgentBusinessState,
  now = Date.now(),
): AgentAnimationState {
  const previous =
    agent.businessState;

  /*
   * Tarefa que estava ativa e terminou.
   */
  const taskFinished =
    (previous === "working" ||
      previous === "thinking") &&
    (newState === "completed" ||
      newState === "idle");

  /*
   * Uma mudanca real de trabalho interrompe
   * cafe/agua/descanso.
   */
  if (
    newState === "working" ||
    newState === "thinking"
  ) {
    releaseTarget(agent);

    const reset: AgentAnimationState = {
      ...agent,

      businessState: newState,

      target: undefined,

      activity: "desk",

      route: [],

      routeIndex: 0,

      activityUntil: undefined,

      reportingRequired: false,

      thinkingSince:
        newState === "thinking"
          ? now
          : undefined,
    };

    /*
     * Se estava longe da mesa,
     * primeiro retorna.
     */
    if (
      reset.position.x !==
        reset.homePosition.x ||
      reset.position.y !==
        reset.homePosition.y
    ) {
      return startRoute(
        reset,
        routeBack(
          reset.position,
          reset.homePosition,
        ),
      );
    }

    return reset;
  }

  return {
    ...agent,

    businessState: newState,

    reportingRequired:
      taskFinished ||
      agent.reportingRequired,

    thinkingSince:
      newState === "thinking"
        ? agent.thinkingSince ?? now
        : undefined,
  };
}

export function updateAgentAnimation(
  input: AgentAnimationState,
  deltaSeconds: number,
  now = Date.now(),
): AgentAnimationState {
  let agent = input;

  /*
   * Prioridade maxima:
   * informar superior ao concluir tarefa.
   */
  if (
    agent.reportingRequired &&
    agent.activity !== "walking" &&
    agent.activity !== "reporting"
  ) {
    releaseTarget(agent);

    if (
      officeResources.acquire(
        "supervisor",
        agent.agentId,
      )
    ) {
      return startRoute(
        {
          ...agent,

          target: "supervisor",
        },
        routeToSupervisor(
          agent.position,
        ),
      );
    }
  }

  /*
   * Movimento atual.
   */
  if (agent.activity === "walking") {
    const movement =
      updateMovement(
        agent,
        deltaSeconds,
      );

    agent =
      movement.agent;

    if (!movement.arrived) {
      return agent;
    }

    /*
     * Chegou ao destino.
     */
    if (agent.target === "supervisor") {
      return {
        ...agent,

        activity: "reporting",

        activityUntil:
          now + 2500,

        direction: "up",
      };
    }

    if (agent.target === "whiteboard") {
      return {
        ...agent,

        activity: "whiteboard",

        direction: "up",
      };
    }

    if (agent.target === "water") {
      return {
        ...agent,

        activity: "water",

        activityUntil:
          now +
          randomBetween(
            ACTIVITY_MIN_DURATION,
            ACTIVITY_MAX_DURATION,
          ),
      };
    }

    if (agent.target === "coffee") {
      return {
        ...agent,

        activity: "coffee",

        activityUntil:
          now +
          randomBetween(
            ACTIVITY_MIN_DURATION,
            ACTIVITY_MAX_DURATION,
          ),
      };
    }

    if (agent.target === "sofa") {
      return {
        ...agent,

        activity: "sofa",

        activityUntil:
          now +
          randomBetween(
            ACTIVITY_MIN_DURATION,
            ACTIVITY_MAX_DURATION,
          ),
      };
    }

    if (agent.target === "armchair") {
      return {
        ...agent,

        activity: "armchair",

        activityUntil:
          now +
          randomBetween(
            ACTIVITY_MIN_DURATION,
            ACTIVITY_MAX_DURATION,
          ),
      };
    }

    /*
     * Rota de retorno concluida.
     */
    return {
      ...agent,

      activity: "desk",

      route: [],

      routeIndex: 0,

      target: undefined,
    };
  }

  /*
   * Terminou de informar o superior.
   */
  if (
    agent.activity === "reporting" &&
    agent.activityUntil &&
    now >= agent.activityUntil
  ) {
    officeResources.release(
      "supervisor",
      agent.agentId,
    );

    return startRoute(
      {
        ...agent,

        reportingRequired: false,

        target: undefined,

        activityUntil: undefined,
      },
      routeBack(
        agent.position,
        agent.homePosition,
      ),
    );
  }

  /*
   * THINKING.
   */
  if (agent.businessState === "thinking") {
    const thinkingSince =
      agent.thinkingSince ?? now;

    /*
     * Ja esta pensando no quadro:
     * permanece ali ate o estado real mudar.
     */
    if (
      agent.activity === "whiteboard"
    ) {
      return {
        ...agent,
        thinkingSince,
      };
    }

    const delay =
      randomBetween(
        MIN_THINKING_TO_BOARD,
        MAX_THINKING_TO_BOARD,
      );

    if (
      now - thinkingSince >= delay &&
      officeResources.isAvailable(
        "whiteboard",
      )
    ) {
      return beginResourceAction(
        {
          ...agent,
          thinkingSince,
        },
        "whiteboard",
        routeToWhiteboard(
          agent.position,
        ),
      );
    }

    /*
     * Quadro ocupado:
     * continua pensando na mesa.
     */
    return {
      ...agent,

      activity: "desk",

      thinkingSince,
    };
  }

  /*
   * WORKING:
   * nunca passeia.
   */
  if (agent.businessState === "working") {
    return {
      ...agent,

      activity: "desk",

      route: [],

      routeIndex: 0,
    };
  }

  /*
   * IDLE.
   */
  if (agent.businessState === "idle") {
    /*
     * Acabou cafe/agua/sofa/poltrona.
     */
    if (
      agent.activityUntil &&
      now >= agent.activityUntil
    ) {
      releaseTarget(agent);

      return startRoute(
        {
          ...agent,

          target: undefined,

          activityUntil: undefined,

          nextIdleDecisionAt:
            nextIdleDecision(now),
        },
        routeBack(
          agent.position,
          agent.homePosition,
        ),
      );
    }

    /*
     * Nao escolhe outra atividade
     * enquanto ja estiver usando uma.
     */
    if (
      agent.activity !== "desk"
    ) {
      return agent;
    }

    if (
      now >=
      agent.nextIdleDecisionAt
    ) {
      const chosen =
        chooseIdleActivity(agent);

      if (chosen === agent) {
        return {
          ...agent,

          nextIdleDecisionAt:
            nextIdleDecision(now),
        };
      }

      return chosen;
    }
  }

  return agent;
}
