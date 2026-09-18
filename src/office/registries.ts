import type { AgentStatus } from "@/types/domain";

/**
 * Central registries for the office renderer.
 * Everything visual is data-driven so the LimeZu pack can be swapped
 * for another tileset (or generated art) without touching the scene.
 */

export const TILE = 16;
export const MODERN_SINGLE_COUNT = 340;
export const modernSingleUrl = (number: number) =>
  `/assets/limezu/modern-office-revamped-v1.2/4_Modern_Office_singles/16x16/Modern_Office_Singles_${number}.png`;

export function modernSingleNumber(kind: string): number | null {
  const match = /^single:(\d+)$/.exec(kind);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 1 && number <= MODERN_SINGLE_COUNT ? number : null;
}

export interface TilesetDef {
  key: string;
  url: string;
  columns: number;
  rows: number;
}

export const TILESETS: Record<"room" | "office", TilesetDef> = {
  room: {
    key: "ts-room",
    url: "/assets/limezu/modern-office-revamped-v1.2/1_Room_Builder_Office/Room_Builder_Office_16x16.png",
    columns: 16,
    rows: 14,
  },
  office: {
    key: "ts-office",
    url: "/assets/limezu/modern-office-revamped-v1.2/3_Modern_Office_Shadowless/Modern_Office_Shadowless_16x16.png",
    columns: 16,
    rows: 53,
  },
};

/** Floor styles → (col,row) in the Room Builder sheet. */
export const FLOOR_TILES: Record<string, [number, number]> = {
  tile: [11, 5],
  wood: [14, 5],
  carpet_dark: [11, 7],
  carpet_brown: [14, 7],
  slate: [11, 9],
  carpet_pattern: [14, 9],
  carpet_red: [11, 11],
  mauve: [14, 11],
  corridor: [11, 9],
};

/** Wall styles → { top, bottom } rows in the Room Builder sheet (cols 0=left,1=mid,2=right). */
export const WALL_TILES: Record<string, { top: number; bottom: number }> = {
  light: { top: 11, bottom: 12 },
  grey: { top: 7, bottom: 8 },
  brick: { top: 9, bottom: 10 },
  purple: { top: 5, bottom: 6 },
};

export interface FurnitureDef {
  /** col,row,w,h in the Modern Office sheet */
  rect: [number, number, number, number];
  /** Footprint tiles (relative) that block walking. Defaults to the full rect. */
  footprint?: [number, number, number, number];
  /** Draw offset in tiles (e.g. tall items anchored at the bottom). */
  offset?: [number, number];
  /** Extra sprites drawn relative to the item (repeat parts). */
  repeat?: number;
}

export const FURNITURE: Record<string, FurnitureDef> = {
  desk: { rect: [7, 28, 3, 2] },
  desk_computer: { rect: [8, 38, 2, 3], offset: [0, -1] },
  exec_desk: { rect: [12, 38, 2, 3], offset: [0, -1] },
  meeting_table: { rect: [7, 28, 3, 2], repeat: 2 },
  reception_desk: { rect: [1, 30, 3, 2] },
  plant: { rect: [6, 8, 1, 2], offset: [0, -1], footprint: [0, 1, 1, 1] },
  plant_small: { rect: [6, 12, 1, 2], offset: [0, -1], footprint: [0, 1, 1, 1] },
  whiteboard: { rect: [9, 10, 2, 2], offset: [0, -1], footprint: [0, 1, 2, 1] },
  chartboard: { rect: [9, 12, 2, 2], offset: [0, -1], footprint: [0, 1, 2, 1] },
  bookshelf: { rect: [7, 12, 2, 2], offset: [0, -1], footprint: [0, 1, 2, 1] },
  cabinet: { rect: [11, 10, 2, 2], offset: [0, -1], footprint: [0, 1, 2, 1] },
  server_rack: { rect: [0, 23, 2, 3], offset: [0, -2], footprint: [0, 2, 2, 1] },
  printer: { rect: [14, 38, 2, 2], offset: [0, -1], footprint: [0, 1, 2, 1] },
  vending: { rect: [4, 24, 1, 2], offset: [0, -1], footprint: [0, 1, 1, 1] },
  water_cooler: { rect: [13, 33, 1, 2], offset: [0, -1], footprint: [0, 1, 1, 1] },
  sofa: { rect: [3, 15, 2, 2], offset: [0, -1], footprint: [0, 1, 2, 1] },
  chair: { rect: [0, 8, 1, 2], offset: [0, -1], footprint: [0, 0, 0, 0] },
  monitor: { rect: [12, 12, 1, 1], footprint: [0, 0, 0, 0] },
};

export interface StatusVisual {
  label: string;
  icon: string;
  /** CSS var name for colors (shared with the admin UI) */
  cssVar: string;
  /** Fallback hex for canvas rendering */
  hex: number;
  bubble: boolean;
  animation: "idle" | "typing" | "think" | "walk" | "talk" | "alert" | "dim";
}

export const STATUS_VISUALS: Record<AgentStatus, StatusVisual> = {
  IDLE: {
    label: "Ocioso",
    icon: "",
    cssVar: "--status-idle",
    hex: 0x9aa0ad,
    bubble: false,
    animation: "idle",
  },
  WALKING: {
    label: "Caminhando",
    icon: "",
    cssVar: "--status-walking",
    hex: 0x6fc3e0,
    bubble: false,
    animation: "walk",
  },
  THINKING: {
    label: "Pensando",
    icon: "…",
    cssVar: "--status-thinking",
    hex: 0x6ba7e8,
    bubble: true,
    animation: "think",
  },
  WORKING: {
    label: "Trabalhando",
    icon: "▮▮",
    cssVar: "--status-working",
    hex: 0x5ad18e,
    bubble: true,
    animation: "typing",
  },
  WAITING: {
    label: "Aguardando",
    icon: "◔",
    cssVar: "--status-waiting",
    hex: 0xe6c85a,
    bubble: true,
    animation: "idle",
  },
  DELEGATING: {
    label: "Delegando",
    icon: "➜",
    cssVar: "--status-delegating",
    hex: 0xe89a5a,
    bubble: true,
    animation: "talk",
  },
  REVIEWING: {
    label: "Revisando",
    icon: "◎",
    cssVar: "--status-reviewing",
    hex: 0xb07ce8,
    bubble: true,
    animation: "think",
  },
  MEETING: {
    label: "Em reunião",
    icon: "▣",
    cssVar: "--status-meeting",
    hex: 0x5ac8c0,
    bubble: true,
    animation: "talk",
  },
  NEEDS_APPROVAL: {
    label: "Exige aprovação",
    icon: "!",
    cssVar: "--status-needs-approval",
    hex: 0xf2c14e,
    bubble: true,
    animation: "alert",
  },
  ERROR: {
    label: "Erro",
    icon: "✕",
    cssVar: "--status-error",
    hex: 0xe06060,
    bubble: true,
    animation: "alert",
  },
  OFFLINE: {
    label: "Desconectado",
    icon: "",
    cssVar: "--status-offline",
    hex: 0x5a5f6b,
    bubble: false,
    animation: "dim",
  },
  PAUSED: {
    label: "Pausado",
    icon: "▌▌",
    cssVar: "--status-paused",
    hex: 0x8a8f9b,
    bubble: true,
    animation: "dim",
  },
};

/** Character sprite registry: id → generator kind. Real sprite sheets can be registered later. */
export interface CharacterSpriteDef {
  id: string;
  name: string;

  idleUrl: string;
  idleAnimUrl: string;

  runUrl: string;

  workUrl: string;
  thinkUrl: string;

  sitUrl: string;

  waterUrl: string;
  coffeeUrl: string;

  talkUrl: string;

  frameWidth: number;
  frameHeight: number;
}

const character = (id: string, name: string, folder: string): CharacterSpriteDef => {
  const base = `/assets/ai-office-animations/characters/${folder}`;

  return {
    id,
    name,

    idleUrl: `${base}/idle.png`,

    idleAnimUrl: `${base}/idle-anim.png`,

    runUrl: `${base}/run.png`,

    workUrl: `${base}/work.png`,

    thinkUrl: `${base}/think.png`,

    sitUrl: `${base}/sit.png`,

    waterUrl: `${base}/water.png`,

    coffeeUrl: `${base}/coffee.png`,

    talkUrl: `${base}/talk.png`,

    frameWidth: 16,
    frameHeight: 32,
  };
};

export const MODERN_CHARACTERS = [
  character("modern-adam", "Adam", "adam"),

  character("modern-alex", "Alex", "alex"),

  character("modern-amelia", "Amelia", "amelia"),

  character("modern-bob", "Bob", "bob"),
] as const;

export function resolveCharacterSprite(id: string | null | undefined): CharacterSpriteDef {
  const safeId = typeof id === "string" && id.trim() ? id : "modern-adam";
  const registered = MODERN_CHARACTERS.find((item) => item.id === safeId);
  if (registered) return registered;
  let h = 0;
  for (const c of safeId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MODERN_CHARACTERS[h % MODERN_CHARACTERS.length]!;
}

export function hexToNumber(hex: string): number {
  const clean = hex.replace("#", "");
  const n = parseInt(
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean,
    16,
  );
  return Number.isFinite(n) ? n : 0xf2b544;
}
