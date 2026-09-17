import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createAgentAnimationState,
  setBusinessState,
  updateAgentAnimation,
} from "./AgentAnimationController";

import type {
  AgentAnimationState,
  AgentBusinessState,
  Point,
} from "./types";

interface Options {
  agentId: string;
  state: AgentBusinessState;
  home: Point;
}

export function useAgentAnimation({
  agentId,
  state,
  home,
}: Options): AgentAnimationState {
  const [animation, setAnimation] =
    useState(() =>
      createAgentAnimationState(
        agentId,
        home,
        state,
      ),
    );

  const lastFrame =
    useRef(performance.now());

  /*
   * Sincroniza o estado real do agente
   * com a maquina visual.
   */
  useEffect(() => {
    setAnimation(current =>
      setBusinessState(
        current,
        state,
      ),
    );
  }, [state]);

  /*
   * Um loop por agente e suficiente nesta primeira
   * integracao. Depois pode ser migrado para um
   * OfficeAnimationProvider global, se necessario.
   */
  useEffect(() => {
    let frame = 0;

    const tick = (
      timestamp: number,
    ) => {
      const delta =
        Math.min(
          (timestamp -
            lastFrame.current) /
            1000,
          0.05,
        );

      lastFrame.current =
        timestamp;

      setAnimation(current =>
        updateAgentAnimation(
          current,
          delta,
        ),
      );

      frame =
        requestAnimationFrame(tick);
    };

    frame =
      requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  return animation;
}
