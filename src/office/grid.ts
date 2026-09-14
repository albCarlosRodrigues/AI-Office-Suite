import type { OfficeZone, Workstation, ZoneProperties, FurnitureItem } from "@/types/domain";
import { FURNITURE } from "./registries";

export interface Point {
  x: number;
  y: number;
}

/**
 * Walkability grid with zone-aware doors.
 * Crossing a zone boundary is only allowed through door tiles.
 */
export class OfficeGrid {
  readonly width: number;
  readonly height: number;
  private blocked: Uint8Array;
  private zoneOf: Int16Array;
  private doors = new Set<string>();

  constructor(
    width: number,
    height: number,
    zones: OfficeZone[],
    workstations: Workstation[],
    furniture: FurnitureItem[],
  ) {
    this.width = width;
    this.height = height;
    this.blocked = new Uint8Array(width * height);
    this.zoneOf = new Int16Array(width * height).fill(-1);

    (Array.isArray(zones) ? zones : []).forEach((z, zi) => {
      const props = (z.properties ?? {}) as ZoneProperties;
      for (let y = z.y; y < z.y + z.height; y++) {
        for (let x = z.x; x < z.x + z.width; x++) {
          if (this.inBounds(x, y)) this.zoneOf[y * width + x] = zi;
        }
      }
      // top row is the wall face
      for (let x = z.x; x < z.x + z.width; x++) this.block(x, z.y);
      if (props.door) this.doors.add(`${props.door.x},${props.door.y}`);
      if (props.door2) this.doors.add(`${props.door2.x},${props.door2.y}`);
    });

    for (const f of Array.isArray(furniture) ? furniture : []) {
      const def = FURNITURE[f.kind];
      if (!def) {
        const width = Math.max(1, Math.round(f.width ?? 1));
        const height = Math.max(1, Math.round(f.height ?? 1));
        for (let dy = 0; dy < height; dy++)
          for (let dx = 0; dx < width; dx++) this.block(f.x + dx, f.y + dy);
        continue;
      }
      const [, , w, h] = def.rect;
      const fp = def.footprint ?? [0, 0, w * (def.repeat ?? 1), h];
      const [ox, oy] = def.offset ?? [0, 0];
      for (let dy = 0; dy < fp[3]; dy++)
        for (let dx = 0; dx < fp[2]; dx++) this.block(f.x + ox + fp[0] + dx, f.y + oy + fp[1] + dy);
    }

    for (const ws of Array.isArray(workstations) ? workstations : []) {
      // desk footprint: 2 wide, rows y-1..y+1 (see registry desk_computer offset)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = 0; dx < 2; dx++) this.block(ws.x + dx, ws.y + dy);
      this.unblock(ws.seat_x, ws.seat_y);
    }

    // map border
    for (let x = 0; x < width; x++) {
      this.block(x, 0);
      this.block(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      this.block(0, y);
      this.block(width - 1, y);
    }
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  block(x: number, y: number) {
    if (this.inBounds(x, y)) this.blocked[y * this.width + x] = 1;
  }
  unblock(x: number, y: number) {
    if (this.inBounds(x, y)) this.blocked[y * this.width + x] = 0;
  }
  isBlocked(x: number, y: number) {
    return !this.inBounds(x, y) || this.blocked[y * this.width + x] === 1;
  }
  zoneAt(x: number, y: number) {
    return this.inBounds(x, y) ? this.zoneOf[y * this.width + x]! : -1;
  }
  isDoor(x: number, y: number) {
    return this.doors.has(`${x},${y}`);
  }

  canStep(from: Point, to: Point) {
    if (this.isBlocked(to.x, to.y)) return false;
    const za = this.zoneAt(from.x, from.y);
    const zb = this.zoneAt(to.x, to.y);
    if (za === zb) return true;
    // crossing boundary: the tile inside the zone must be a door
    if (za !== -1 && !this.isDoor(from.x, from.y)) return false;
    if (zb !== -1 && !this.isDoor(to.x, to.y)) return false;
    return true;
  }

  /** BFS shortest path (4-neighbour). Returns [] if unreachable, excludes start. */
  findPath(start: Point, goal: Point): Point[] {
    if (start.x === goal.x && start.y === goal.y) return [];
    const key = (p: Point) => p.y * this.width + p.x;
    const prev = new Int32Array(this.width * this.height).fill(-1);
    const visited = new Uint8Array(this.width * this.height);
    const queue: Point[] = [start];
    visited[key(start)] = 1;
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    let found = false;
    while (queue.length && !found) {
      const cur = queue.shift()!;
      for (const d of dirs) {
        const nxt = { x: cur.x + d.x, y: cur.y + d.y };
        if (!this.inBounds(nxt.x, nxt.y)) continue;
        const k = key(nxt);
        if (visited[k]) continue;
        if (!this.canStep(cur, nxt)) continue;
        visited[k] = 1;
        prev[k] = key(cur);
        if (nxt.x === goal.x && nxt.y === goal.y) {
          found = true;
          break;
        }
        queue.push(nxt);
      }
    }
    if (!found) return [];
    const path: Point[] = [];
    let k = key(goal);
    while (k !== key(start) && k !== -1) {
      path.push({ x: k % this.width, y: Math.floor(k / this.width) });
      k = prev[k]!;
    }
    return path.reverse();
  }

  /** Nearest free tile to a point (spiral search). */
  nearestFree(p: Point, maxR = 6): Point {
    if (!this.isBlocked(p.x, p.y)) return p;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const q = { x: p.x + dx, y: p.y + dy };
          if (!this.isBlocked(q.x, q.y)) return q;
        }
      }
    }
    return p;
  }
}
