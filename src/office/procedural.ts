/**
 * Procedural placeholder characters.
 * 16x24 pixel figures, 4 directions x 3 frames, drawn from a palette.
 * These are replaced by real sprite sheets when registered in the
 * character registry — the scene only talks to texture keys and animations.
 */

export type Direction = "down" | "up" | "left" | "right";
export const DIRECTIONS: Direction[] = ["down", "up", "left", "right"];

const W = 16;
const H = 24;

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

function shade(n: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export interface CharacterPalette {
  body: number;
  hair: number;
  skin: number;
  external?: boolean;
}

/** Draws one frame into ctx at (ox, oy). frame: 0 = stand, 1/2 = step. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  dir: Direction,
  frame: number,
  p: CharacterPalette,
) {
  const px = (x: number, y: number, c: number, w = 1, h = 1) => {
    ctx.fillStyle = hex(c);
    ctx.fillRect(ox + x, oy + y, w, h);
  };
  const outline = 0x1a1a24;
  const bodyD = shade(p.body, 0.7);
  const skinD = shade(p.skin, 0.8);
  const hairD = shade(p.hair, 0.75);
  const legOff = frame === 0 ? 0 : frame === 1 ? 1 : -1;

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(ox + 4, oy + 22, 8, 2);

  // legs
  px(5, 17 + Math.max(0, legOff), outline, 3, 5 - Math.max(0, legOff));
  px(8, 17 + Math.max(0, -legOff), outline, 3, 5 - Math.max(0, -legOff));
  px(6, 17 + Math.max(0, legOff), 0x2f3542, 1, 4 - Math.max(0, legOff));
  px(9, 17 + Math.max(0, -legOff), 0x2f3542, 1, 4 - Math.max(0, -legOff));

  // torso
  px(4, 10, outline, 8, 8);
  px(5, 11, p.body, 6, 6);
  px(5, 15, bodyD, 6, 2);
  if (p.external) {
    // external agents wear a visor/lanyard marker
    px(7, 12, 0xffffff, 2, 1);
  }
  // arms
  const armSwing = frame === 0 ? 0 : legOff;
  px(3, 11 + armSwing, outline, 1, 5);
  px(12, 11 - armSwing, outline, 1, 5);
  px(3, 12 + armSwing, p.skin, 1, 3);
  px(12, 12 - armSwing, p.skin, 1, 3);

  // head
  px(4, 2, outline, 8, 9);
  px(5, 3, p.skin, 6, 7);
  px(5, 9, skinD, 6, 1);

  // hair
  if (dir === "up") {
    px(5, 3, p.hair, 6, 6);
    px(5, 8, hairD, 6, 1);
  } else {
    px(5, 3, p.hair, 6, 2);
    px(5, 5, hairD, 1, 2);
    px(10, 5, hairD, 1, 2);
    if (dir === "left") px(5, 5, p.hair, 1, 3);
    if (dir === "right") px(10, 5, p.hair, 1, 3);
  }

  // eyes
  const eye = 0x1a1a24;
  if (dir === "down") {
    px(6, 6, eye);
    px(9, 6, eye);
  } else if (dir === "left") {
    px(6, 6, eye);
  } else if (dir === "right") {
    px(9, 6, eye);
  }
}

export interface ProceduralSheet {
  canvas: HTMLCanvasElement;
  frameWidth: number;
  frameHeight: number;
  /** frame index by direction/frame: index = dirIndex*3 + frame */
}

export function buildCharacterSheet(palette: CharacterPalette): ProceduralSheet {
  const canvas = document.createElement("canvas");
  canvas.width = W * 3 * 4;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  DIRECTIONS.forEach((dir, di) => {
    for (let f = 0; f < 3; f++) {
      drawFrame(ctx, (di * 3 + f) * W, 0, dir, f, palette);
    }
  });
  return { canvas, frameWidth: W, frameHeight: H };
}

export function frameIndex(dir: Direction, frame: number): number {
  return DIRECTIONS.indexOf(dir) * 3 + frame;
}
