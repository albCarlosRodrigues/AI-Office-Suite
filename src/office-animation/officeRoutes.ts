import type { Point } from "./types";

/*
 * Os pontos sao normalizados de 0 a 1.
 *
 * Ajuste fino pode ser realizado visualmente sem alterar
 * a maquina de estados.
 *
 * MAPA LOGICO:
 *
 *  GPT / SUPERIOR
 *       |
 *       | corredor 7
 *       |
 * ------+---------------- funcionarios
 *       |
 *       +-- agua/cafe/poltrona (8)
 */

export const OFFICE_POINTS = {
  /*
   * Entrada principal da sala dos funcionarios.
   */
  EMPLOYEE_CORRIDOR: {
    x: 0.48,
    y: 0.67,
  },

  /*
   * Corredor vertical que liga os funcionarios ao GPT.
   */
  GPT_CORRIDOR_BOTTOM: {
    x: 0.34,
    y: 0.67,
  },

  GPT_CORRIDOR_TOP: {
    x: 0.34,
    y: 0.38,
  },

  /*
   * Frente da mesa do superior.
   */
  SUPERVISOR: {
    x: 0.29,
    y: 0.34,
  },

  /*
   * Quadro na parte superior.
   */
  WHITEBOARD_CORRIDOR: {
    x: 0.31,
    y: 0.21,
  },

  WHITEBOARD: {
    x: 0.17,
    y: 0.21,
  },

  /*
   * Area de descanso.
   */
  SOFA: {
    x: 0.22,
    y: 0.32,
  },

  ARMCHAIR: {
    x: 0.42,
    y: 0.54,
  },

  /*
   * Recursos dos funcionarios.
   */
  WATER: {
    x: 0.48,
    y: 0.51,
  },

  COFFEE: {
    x: 0.52,
    y: 0.51,
  },
} satisfies Record<string, Point>;

export function routeToSupervisor(from: Point): Point[] {
  return [
    from,

    {
      x: from.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.EMPLOYEE_CORRIDOR,

    OFFICE_POINTS.GPT_CORRIDOR_BOTTOM,

    OFFICE_POINTS.GPT_CORRIDOR_TOP,

    OFFICE_POINTS.SUPERVISOR,
  ];
}

export function routeToWhiteboard(from: Point): Point[] {
  return [
    from,

    {
      x: OFFICE_POINTS.GPT_CORRIDOR_TOP.x,
      y: from.y,
    },

    OFFICE_POINTS.GPT_CORRIDOR_TOP,

    OFFICE_POINTS.WHITEBOARD_CORRIDOR,

    OFFICE_POINTS.WHITEBOARD,
  ];
}

export function routeToWater(from: Point): Point[] {
  return [
    from,

    {
      x: from.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.EMPLOYEE_CORRIDOR,

    {
      x: OFFICE_POINTS.WATER.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.WATER,
  ];
}

export function routeToCoffee(from: Point): Point[] {
  return [
    from,

    {
      x: from.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.EMPLOYEE_CORRIDOR,

    {
      x: OFFICE_POINTS.COFFEE.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.COFFEE,
  ];
}

export function routeToArmchair(from: Point): Point[] {
  return [
    from,

    {
      x: from.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.EMPLOYEE_CORRIDOR,

    {
      x: OFFICE_POINTS.ARMCHAIR.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    OFFICE_POINTS.ARMCHAIR,
  ];
}

export function routeToSofa(from: Point): Point[] {
  return [
    from,

    {
      x: OFFICE_POINTS.GPT_CORRIDOR_TOP.x,
      y: from.y,
    },

    OFFICE_POINTS.GPT_CORRIDOR_TOP,

    {
      x: OFFICE_POINTS.SOFA.x,
      y: OFFICE_POINTS.GPT_CORRIDOR_TOP.y,
    },

    OFFICE_POINTS.SOFA,
  ];
}

export function routeBack(current: Point, home: Point): Point[] {
  return [
    current,

    {
      x: current.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    {
      x: home.x,
      y: OFFICE_POINTS.EMPLOYEE_CORRIDOR.y,
    },

    home,
  ];
}
