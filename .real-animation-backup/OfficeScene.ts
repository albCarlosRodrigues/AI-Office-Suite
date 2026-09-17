import Phaser from "phaser";
import type { Agent, AgentStatus, OfficeMap, OfficeZone, Workstation } from "@/types/domain";
import { MODERN_CHARACTERS, STATUS_VISUALS, TILE, resolveCharacterSprite } from "./registries";
import type { Direction } from "./procedural";
import { OfficeGrid, type Point } from "./grid";

export interface OfficeSceneData {
  map: OfficeMap;
  zones: OfficeZone[];
  workstations: Workstation[];
  agents: Agent[];
  onSelectAgent?: (agentId: string | null) => void;
  onReady?: (scene: OfficeScene) => void;
}

interface ImportedOfficeTile {
  id: string;
  x: number;
  y: number;
}

interface ImportedOfficeMap {
  mapWidth: number;
  mapHeight: number;
  layers: Array<{ name: string; tiles: ImportedOfficeTile[]; collider: boolean }>;
}

const OFFICE_MAP_KEY = "ai-office-default-map";
const OFFICE_TILES_KEY = "ai-office-default-tiles";
const OFFICE_WIDTH = 18;
const OFFICE_HEIGHT = 22;
const WALK_SPEED = 62;
const FONT = '"JetBrains Mono", monospace';

interface AgentSeat extends Point {
  facing: Direction;
}

// Priority order: executive brown chair, private-office chair, then the shared office.
const AGENT_SEATS: AgentSeat[] = [
  { x: 12, y: 8, facing: "left" },
  { x: 5, y: 3, facing: "down" },
  { x: 3, y: 20, facing: "up" },
  { x: 6, y: 20, facing: "up" },
  { x: 9, y: 20, facing: "up" },
  { x: 12, y: 20, facing: "up" },
  { x: 6, y: 16, facing: "up" },
  { x: 15, y: 16, facing: "up" },
];

const MEETING_SEATS: Point[] = [
  { x: 7, y: 7 },
  { x: 9, y: 7 },
  { x: 7, y: 9 },
  { x: 9, y: 9 },
];

const SOCIAL_SPOTS: Point[] = [
  { x: 3, y: 6 },
  { x: 4, y: 7 },
  { x: 5, y: 8 },
  { x: 9, y: 9 },
  { x: 3, y: 16 },
  { x: 14, y: 18 },
];

/**
 * Destinos usados EXCLUSIVAMENTE pelo painel de teste.
 *
 * São tiles, não pixels.
 * OfficeGrid/nearestFree continua sendo responsável
 * por impedir destino dentro de colisões.
 */
const DEBUG_SPOTS = {
  whiteboard: {
    point: { x: 3, y: 3 },
    facing: "up" as Direction,
  },

  water: {
    point: { x: 2, y: 12 },
    facing: "left" as Direction,
  },

  coffee: {
    point: { x: 3, y: 12 },
    facing: "up" as Direction,
  },

  sofa: {
    point: { x: 4, y: 7 },
    facing: "up" as Direction,
  },

  armchair: {
    point: { x: 14, y: 18 },
    facing: "up" as Direction,
  },

  supervisor: {
    point: { x: 11, y: 8 },
    facing: "right" as Direction,
  },
};

const IDLE_FRAME: Record<Direction, number> = { left: 0, up: 1, right: 2, down: 3 };
const RUN_START: Record<Direction, number> = { left: 0, up: 6, right: 12, down: 18 };

class AgentActor {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  speech: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Graphics;
  route: Phaser.GameObjects.Graphics;
  tile: Point;
  path: Point[] = [];
  facing: Direction = "down";
  status: AgentStatus;
  home: Point;
  homeFacing: Direction = "up";
  meetingSeat: Point | null = null;
  wanderUntil = 0;
  nextWanderCheck = 0;
  speechUntil = 0;
  bob = Math.random() * Math.PI * 2;
  seated = false;
  isReporting = false;

  /**
   * Impede que o refetch de agentes sobrescreva imediatamente
   * um estado visual acionado pelo painel de testes.
   */
  testOverride = false;

  /**
   * Guarda qual acao foi forcada pelo painel.
   *
   * Nao representa o estado real do agente.
   */
  debugAction: string | null = null;

  constructor(
    public scene: OfficeScene,
    public agent: Agent,
    public key: string,
    tile: Point,
    home: Point,
  ) {
    this.tile = tile;
    this.home = home;
    this.status = agent.status;
    const px = tile.x * TILE + TILE / 2;
    const py = tile.y * TILE + TILE;
    this.ring = scene.add.graphics();
    this.route = scene.add.graphics().setDepth(9000);
    this.sprite = scene.add.sprite(px, py, `${key}-idle`, IDLE_FRAME.down).setOrigin(0.5, 1);
    this.sprite.setInteractive({ useHandCursor: true });
    this.sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      scene.selectAgent(agent.id);
    });
    this.label = scene.add
      .text(px, py + 2, agent.name, {
        fontFamily: FONT,
        fontSize: "7px",
        color: "#f4f1ea",
        backgroundColor: "rgba(10,12,20,0.78)",
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0.5, 0)
      .setResolution(4)
      .setDepth(10000);
    this.bubble = scene.add
      .text(px, py - 32, "", {
        fontFamily: FONT,
        fontSize: "8px",
        color: "#0b0d14",
        backgroundColor: "#ffffff",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setDepth(10001)
      .setVisible(false);
    this.speech = scene.add
      .text(px, py - 42, "", {
        fontFamily: FONT,
        fontSize: "7px",
        color: "#f4f1ea",
        backgroundColor: "rgba(20,24,36,0.94)",
        padding: { x: 4, y: 3 },
        wordWrap: { width: 110 },
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setDepth(10002)
      .setVisible(false);
    this.applyStatusVisual();
  }

  setSelected(selected: boolean) {
    this.ring.clear();
    if (selected) {
      this.ring.lineStyle(1, 0xf2c14e, 1);
      this.ring.strokeEllipse(this.sprite.x, this.sprite.y - 1, 16, 8);
    }
  }

  say(value: string, ms = 4500) {
    this.speech.setText(value.length > 90 ? `${value.slice(0, 88)}…` : value);
    this.speech.setVisible(true);
    this.speechUntil = this.scene.time.now + ms;
  }

  applyStatusVisual() {
    const visual = STATUS_VISUALS[this.status];
    if (visual.bubble && visual.icon) {
      this.bubble.setText(visual.icon);
      this.bubble.setStyle({
        backgroundColor: `#${visual.hex.toString(16).padStart(6, "0")}`,
        color: "#0b0d14",
      });
      this.bubble.setVisible(true);
    } else {
      this.bubble.setVisible(false);
    }
    const dimmed = this.status === "OFFLINE" || this.status === "PAUSED" || this.agent.is_suspended;
    this.sprite.setAlpha(dimmed ? 0.45 : 1);
    if (this.scene.killSwitch) this.sprite.setTint(0x777777);
    else this.sprite.clearTint();
  }

  moveTo(target: Point) {
    const path = this.scene.grid.findPath(this.tile, target);
    if (!path.length && (target.x !== this.tile.x || target.y !== this.tile.y)) {
      this.path = this.scene.grid.findPath(this.tile, this.scene.grid.nearestFree(target));
    } else {
      this.path = path;
    }
    if (this.path.length) {
      this.seated = false;
      this.drawRoute([this.tile, ...this.path]);
    }
  }

  private drawRoute(points: Point[]) {
    this.route.clear().setAlpha(1);
    this.route.lineStyle(2, 0x6fc3e0, 0.82);
    this.route.beginPath();
    points.forEach((point, index) => {
      const x = point.x * TILE + TILE / 2;
      const y = point.y * TILE + TILE / 2;
      if (index === 0) this.route.moveTo(x, y);
      else this.route.lineTo(x, y);
    });
    this.route.strokePath();
    for (const point of points)
      this.route
        .fillStyle(0xf2c14e, 0.9)
        .fillCircle(point.x * TILE + TILE / 2, point.y * TILE + TILE / 2, 1.5);
  }

  update(time: number, delta: number) {
    const dt = delta / 1000;
    if (this.path.length) {
      const next = this.path[0]!;
      const tx = next.x * TILE + TILE / 2;
      const ty = next.y * TILE + TILE;
      const dx = tx - this.sprite.x;
      const dy = ty - this.sprite.y;
      const distance = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
      else this.facing = dy > 0 ? "down" : "up";
      if (distance <= step) {
        this.sprite.setPosition(tx, ty);
        this.tile = next;
        this.path.shift();
        if (!this.path.length) this.onArrive();
      } else {
        this.sprite.setPosition(
          this.sprite.x + (dx / distance) * step,
          this.sprite.y + (dy / distance) * step,
        );
      }
      const animation = `${this.key}-walk-${this.facing}`;
      if (this.sprite.texture.key !== `${this.key}-run`) this.sprite.setTexture(`${this.key}-run`);
      if (this.sprite.anims.currentAnim?.key !== animation) this.sprite.play(animation);
    } else {
      if (this.sprite.anims.isPlaying) this.sprite.stop();
      if (this.sprite.texture.key !== `${this.key}-idle`)
        this.sprite.setTexture(`${this.key}-idle`);
      const visual = STATUS_VISUALS[this.status];
      this.bob += dt * (visual.animation === "typing" ? 10 : visual.animation === "talk" ? 6 : 2);
      const bobY =
        visual.animation === "typing"
          ? Math.round(Math.sin(this.bob) * 0.5)
          : visual.animation === "talk"
            ? Math.round(Math.sin(this.bob))
            : 0;
      this.sprite.setFrame(IDLE_FRAME[this.facing]);
      this.sprite.y = this.tile.y * TILE + TILE + bobY;
      this.bubble.setAlpha(visual.animation === "alert" ? 0.6 + 0.4 * Math.sin(time / 120) : 1);
      if (this.status === "IDLE" && !this.testOverride && !this.scene.killSwitch && time > this.nextWanderCheck) {
        this.nextWanderCheck = time + 12000 + Math.random() * 15000;
        if (this.wanderUntil && time > this.wanderUntil) {
          this.wanderUntil = 0;
          this.moveTo(this.home);
        } else if (!this.wanderUntil && Math.random() < 0.35) {
          const spot = this.scene.randomSocialSpot();
          if (spot) {
            this.wanderUntil = time + 9000 + Math.random() * 8000;
            this.moveTo(spot);
          }
        }
      }
    }
    this.sprite.setDepth(this.sprite.y + 0.5);
    this.label.setPosition(this.sprite.x, this.sprite.y + 1);
    this.bubble.setPosition(this.sprite.x, this.sprite.y - 30);
    this.speech.setPosition(this.sprite.x, this.sprite.y - (this.bubble.visible ? 42 : 32));
    if (this.speech.visible && time > this.speechUntil) this.speech.setVisible(false);
    if (this.scene.selectedAgentId === this.agent.id) this.setSelected(true);
  }

  onArrive() {
    if (
      this.testOverride &&
      this.debugAction
    ) {
      this.scene.applyDebugArrivalPose(
        this,
      );
    }
    this.scene.tweens.add({
      targets: this.route,
      alpha: 0,
      duration: 1800,
      onComplete: () => this.route.clear().setAlpha(1),
    });
    if (this.isReporting && (this.tile.x !== this.home.x || this.tile.y !== this.home.y)) {
      this.say("Entrega concluída ao superior.", 2600);
      this.scene.time.delayedCall(1400, () => {
        this.isReporting = false;
        this.status = this.agent.status;
        this.applyStatusVisual();
        this.moveTo(this.home);
      });
      return;
    }
    if (
      this.meetingSeat &&
      this.tile.x === this.meetingSeat.x &&
      this.tile.y === this.meetingSeat.y
    ) {
      this.facing = this.scene.meetingFacing(this.tile);
      this.seated = true;
    } else if (this.tile.x === this.home.x && this.tile.y === this.home.y) {
      this.facing = this.homeFacing;
      this.seated = true;
    }
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
    this.bubble.destroy();
    this.speech.destroy();
    this.ring.destroy();
    this.route.destroy();
  }
}

export class OfficeScene extends Phaser.Scene {
  data_!: OfficeSceneData;
  grid!: OfficeGrid;
  actors = new Map<string, AgentActor>();
  selectedAgentId: string | null = null;
  killSwitch = false;
  private officeWidth = OFFICE_WIDTH;
  private officeHeight = OFFICE_HEIGHT;
  private killOverlay?: Phaser.GameObjects.Rectangle;
  private meetingSeatOwners = new Map<string, string>();
  private dragStart: { x: number; y: number; sx: number; sy: number } | null = null;

  constructor() {
    super("office");
  }

  init(data: OfficeSceneData) {
    this.data_ = data;
  }

  preload() {
    this.load.json(OFFICE_MAP_KEY, "/assets/ai-office-default/map.json");
    this.load.spritesheet(OFFICE_TILES_KEY, "/assets/ai-office-default/spritesheet.png", {
      frameWidth: 48,
      frameHeight: 48,
    });
    for (const character of MODERN_CHARACTERS) {
      this.load.spritesheet(`${character.id}-idle`, character.idleUrl, {
        frameWidth: character.frameWidth,
        frameHeight: character.frameHeight,
      });
      this.load.spritesheet(`${character.id}-run`, character.runUrl, {
        frameWidth: character.frameWidth,
        frameHeight: character.frameHeight,
      });
    }
  }

  create() {
    const imported = this.cache.json.get(OFFICE_MAP_KEY) as ImportedOfficeMap | undefined;
    this.officeWidth = imported?.mapWidth ?? OFFICE_WIDTH;
    this.officeHeight = imported?.mapHeight ?? OFFICE_HEIGHT;
    this.grid = new OfficeGrid(this.officeWidth, this.officeHeight, [], [], []);
    this.configureImportedCollisions(imported);
    this.drawImportedOffice(imported);
    this.createCharacterAnimations();

    const width = this.officeWidth * TILE;
    const height = this.officeHeight * TILE;
    const camera = this.cameras.main;
    camera.setBounds(-TILE * 2, -TILE * 2, width + TILE * 4, height + TILE * 4);
    camera.setRoundPixels(true);
    this.fitCamera();
    this.scale.on("resize", () => this.fitCamera());

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.dragStart = { x: pointer.x, y: pointer.y, sx: camera.scrollX, sy: camera.scrollY };
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.dragStart || !pointer.isDown) return;
      camera.scrollX = this.dragStart.sx - (pointer.x - this.dragStart.x) / camera.zoom;
      camera.scrollY = this.dragStart.sy - (pointer.y - this.dragStart.y) / camera.zoom;
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (
        this.dragStart &&
        Math.hypot(pointer.x - this.dragStart.x, pointer.y - this.dragStart.y) < 4
      )
        this.selectAgent(null);
      this.dragStart = null;
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.9 : 1.1), 1, 5));
      this.applyBounds();
    });

    this.killOverlay = this.add
      .rectangle(0, 0, 4000, 4000, 0xd04040, 0.12)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(20000)
      .setVisible(false);
    this.syncAgents(Array.isArray(this.data_.agents) ? this.data_.agents : []);
    this.data_.onReady?.(this);
  }

  private drawImportedOffice(map?: ImportedOfficeMap) {
    if (!map) return;
    const layers = [...map.layers].reverse();
    layers.forEach((layer, layerIndex) => {
      for (const tile of layer.tiles) {
        const frame = Number(tile.id);
        if (!Number.isInteger(frame)) continue;
        this.add
          .image(tile.x * TILE, tile.y * TILE, OFFICE_TILES_KEY, frame)
          .setOrigin(0)
          .setDisplaySize(TILE, TILE)
          .setDepth(tile.y * TILE + layerIndex / 100);
      }
    });
  }

  private configureImportedCollisions(map?: ImportedOfficeMap) {
    if (!map) return;

    // Start blocked so transparent/black cells outside the rooms can never be crossed.
    for (let y = 0; y < this.officeHeight; y++)
      for (let x = 0; x < this.officeWidth; x++) this.grid.block(x, y);

    const baseLayer = map.layers.find((layer) => layer.name === "Paredes/chão");
    // In this Sprite Fusion export, 140 and 145 are the two walkable floor tiles.
    for (const tile of baseLayer?.tiles ?? []) {
      const frame = Number(tile.id);
      if (frame === 140 || frame === 145) this.grid.unblock(tile.x, tile.y);
    }

    // Collider layers contain furniture and wall decorations. The base layer is
    // handled above because it mixes walkable floors with structural walls.
    for (const layer of map.layers) {
      if (!layer.collider || layer === baseLayer) continue;
      for (const tile of layer.tiles) this.grid.block(tile.x, tile.y);
    }

    // Chair foot cells are valid destinations even though their sprite layer collides.
    for (const seat of AGENT_SEATS) this.grid.unblock(seat.x, seat.y);
  }

  private createCharacterAnimations() {
    for (const character of MODERN_CHARACTERS) {
      for (const direction of ["down", "up", "left", "right"] as Direction[]) {
        const start = RUN_START[direction];
        const key = `${character.id}-walk-${direction}`;
        if (this.anims.exists(key)) continue;
        this.anims.create({
          key,
          frames: Array.from({ length: 6 }, (_, index) => ({
            key: `${character.id}-run`,
            frame: start + index,
          })),
          frameRate: 10,
          repeat: -1,
        });
      }
    }
  }

  fitCamera() {
    const camera = this.cameras.main;
    const width = this.officeWidth * TILE;
    const height = this.officeHeight * TILE;
    camera.setZoom(
      Phaser.Math.Clamp(
        Math.min(this.scale.width / (width + 32), this.scale.height / (height + 32)),
        1,
        4,
      ),
    );
    this.applyBounds();
    camera.centerOn(width / 2, height / 2);
  }

  private applyBounds() {
    const camera = this.cameras.main;
    const width = this.officeWidth * TILE;
    const height = this.officeHeight * TILE;
    const padX = Math.max(TILE * 2, (this.scale.width / camera.zoom - width) / 2);
    const padY = Math.max(TILE * 2, (this.scale.height / camera.zoom - height) / 2);
    camera.setBounds(-padX, -padY, width + padX * 2, height + padY * 2);
  }

  private hierarchyDepth(
    agent: Agent,
    agentsById: Map<string, Agent>,
    visited = new Set<string>(),
  ): number {
    if (!agent.manager_agent_id || visited.has(agent.id)) return 0;
    const manager = agentsById.get(agent.manager_agent_id);
    if (!manager) return 0;
    visited.add(agent.id);
    return 1 + this.hierarchyDepth(manager, agentsById, visited);
  }

  private assignedSeats(agents: Agent[]) {
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const ranked = [...agents].sort((left, right) => {
      const depthDifference =
        this.hierarchyDepth(left, agentsById) - this.hierarchyDepth(right, agentsById);
      if (depthDifference) return depthDifference;
      if (left.is_primary_controller !== right.is_primary_controller)
        return left.is_primary_controller ? -1 : 1;
      const autonomyDifference = right.autonomy_level - left.autonomy_level;
      return autonomyDifference || left.name.localeCompare(right.name);
    });
    return new Map(
      ranked.map((agent, index) => {
        const seat = AGENT_SEATS[index];
        if (seat) return [agent.id, seat] as const;
        const fallback = this.grid.nearestFree({
          x: 2 + ((index - AGENT_SEATS.length) % Math.max(1, this.officeWidth - 4)),
          y: 16,
        });
        return [agent.id, { ...fallback, facing: "up" as Direction }] as const;
      }),
    );
  }

  syncAgents(agents: Agent[]) {
    const seen = new Set<string>();
    const seats = this.assignedSeats(agents);
    agents.forEach((agent) => {
      seen.add(agent.id);
      const key = resolveCharacterSprite(agent.character_sprite_id || agent.id).id;
      const seat = seats.get(agent.id) ?? AGENT_SEATS[AGENT_SEATS.length - 1]!;
      const home = { x: seat.x, y: seat.y };
      let actor = this.actors.get(agent.id);
      if (!actor) {
        actor = new AgentActor(this, agent, key, home, home);
        actor.facing = seat.facing;
        actor.homeFacing = seat.facing;
        this.actors.set(agent.id, actor);
        this.applyStatus(actor, agent.status, true);
      } else {
        const previousStatus = actor.status;
        actor.agent = agent;
        actor.label.setText(agent.name);
        actor.homeFacing = seat.facing;
        if (actor.key !== key) {
          actor.key = key;
          actor.sprite.setTexture(`${key}-idle`, IDLE_FRAME[actor.facing]);
        }
        if (home.x !== actor.home.x || home.y !== actor.home.y) {
          actor.home = home;
          actor.homeFacing = seat.facing;
          if (!actor.testOverride && agent.status !== "MEETING") actor.moveTo(home);
        }
        if (
          !actor.testOverride &&
          !actor.isReporting &&
          previousStatus !== agent.status
        )
          this.applyStatus(actor, agent.status, false);
        else actor.applyStatusVisual();
      }
    });
    for (const [id, actor] of this.actors) {
      if (!seen.has(id)) {
        actor.destroy();
        this.actors.delete(id);
        this.releaseMeetingSeat(id);
      }
    }
  }

  setAgentStatus(
    agentId: string,
    status: AgentStatus,
  ) {
    const actor =
      this.actors.get(agentId);

    if (
      actor &&
      !actor.testOverride &&
      actor.status !== status
    ) {
      this.applyStatus(
        actor,
        status,
        false,
      );
    }
  }

  private applyStatus(actor: AgentActor, status: AgentStatus, initial: boolean) {
    const previous = actor.status;
    actor.status = status;
    actor.agent = { ...actor.agent, status };
    actor.applyStatusVisual();
    actor.wanderUntil = 0;
    if (status === "MEETING") {
      const seat = this.claimMeetingSeat(actor.agent.id);
      if (seat) {
        actor.meetingSeat = seat;
        actor.moveTo(seat);
      }
      return;
    }
    if (previous === "MEETING") this.releaseMeetingSeat(actor.agent.id);
    actor.meetingSeat = null;
    if (!initial && (actor.tile.x !== actor.home.x || actor.tile.y !== actor.home.y))
      actor.moveTo(actor.home);
    if (status === "DELEGATING") {
      const subordinate = [...this.actors.values()].find(
        (other) => other.agent.manager_agent_id === actor.agent.id && other.status !== "OFFLINE",
      );
      if (subordinate) actor.say(`→ ${subordinate.agent.name}`, 3000);
    }
  }

  private claimMeetingSeat(agentId: string): Point | null {
    const existing = [...this.meetingSeatOwners.entries()].find(([, owner]) => owner === agentId);
    if (existing) {
      const [x, y] = existing[0].split(",").map(Number) as [number, number];
      return { x, y };
    }
    for (const seat of MEETING_SEATS) {
      const key = `${seat.x},${seat.y}`;
      if (!this.meetingSeatOwners.has(key)) {
        this.meetingSeatOwners.set(key, agentId);
        return seat;
      }
    }
    return null;
  }

  private releaseMeetingSeat(agentId: string) {
    for (const [key, owner] of this.meetingSeatOwners)
      if (owner === agentId) this.meetingSeatOwners.delete(key);
  }

  meetingFacing(seat: Point): Direction {
    if (Math.abs(seat.y - 8) > 1) return seat.y < 8 ? "down" : "up";
    return seat.x < 8 ? "right" : "left";
  }

  randomSocialSpot(): Point | null {
    const available = SOCIAL_SPOTS.filter((spot) => !this.grid.isBlocked(spot.x, spot.y));
    return available[Math.floor(Math.random() * available.length)] ?? null;
  }

  /**
   * Executa apenas comportamentos visuais para desenvolvimento.
   *
   * Nenhum destes comandos altera Supabase, tarefa, missao ou
   * estado real do agente.
   */
  applyDebugArrivalPose(
    actor: AgentActor,
  ) {
    switch (
      actor.debugAction
    ) {
      case "whiteboard":
        actor.status =
          "THINKING";

        actor.facing =
          DEBUG_SPOTS
            .whiteboard
            .facing;

        actor.applyStatusVisual();

        actor.say(
          "[TESTE] Pensando no quadro",
          2600,
        );

        break;

      case "water":
        actor.status =
          "IDLE";

        actor.facing =
          DEBUG_SPOTS
            .water
            .facing;

        actor.applyStatusVisual();

        actor.say(
          "[TESTE] Bebendo água",
          2300,
        );

        break;

      case "coffee":
        actor.status =
          "IDLE";

        actor.facing =
          DEBUG_SPOTS
            .coffee
            .facing;

        actor.applyStatusVisual();

        actor.say(
          "[TESTE] Bebendo café",
          2300,
        );

        break;

      case "sofa":
        actor.status =
          "IDLE";

        actor.facing =
          DEBUG_SPOTS
            .sofa
            .facing;

        actor.seated =
          true;

        actor.applyStatusVisual();

        actor.say(
          "[TESTE] Sofá",
          2000,
        );

        break;

      case "armchair":
        actor.status =
          "IDLE";

        actor.facing =
          DEBUG_SPOTS
            .armchair
            .facing;

        actor.seated =
          true;

        actor.applyStatusVisual();

        actor.say(
          "[TESTE] Poltrona",
          2000,
        );

        break;

      case "supervisor":
        actor.status =
          "IDLE";

        actor.applyStatusVisual();

        actor.say(
          "[TESTE] Informando o superior",
          2600,
        );

        break;

      case "home":
        actor.status =
          "IDLE";

        actor.facing =
          actor.homeFacing;

        actor.seated =
          true;

        actor.applyStatusVisual();

        break;
    }
  }

  testAnimation(agentId: string, action: string) {
    const actor = this.actors.get(agentId);

    if (!actor) return;

    if (action === "reset") {
      if (actor.meetingSeat) {
        this.releaseMeetingSeat(agentId);
      }

      actor.testOverride = false;
      actor.isReporting = false;
      actor.meetingSeat = null;
      actor.wanderUntil = 0;
      actor.nextWanderCheck = 0;

      actor.status = actor.agent.status;
      actor.applyStatusVisual();

      actor.say("Modo de teste encerrado.", 1800);
      actor.moveTo(actor.home);

      return;
    }

    actor.testOverride = true;
    actor.wanderUntil = 0;

    // Durante o teste o IDLE nao deve iniciar um passeio aleatorio.
    actor.nextWanderCheck = Number.POSITIVE_INFINITY;

    if (action !== "supervisor") {
      actor.isReporting = false;
    }

    if (action !== "meeting" && actor.meetingSeat) {
      this.releaseMeetingSeat(agentId);
      actor.meetingSeat = null;
      actor.seated = false;
    }

    const setVisualStatus = (status: AgentStatus) => {
      actor.status = status;
      actor.applyStatusVisual();
    };

    const move = (
      point: Point,
      message: string,
      status: AgentStatus = "IDLE",
    ) => {
      setVisualStatus(status);

      actor.say(`[TESTE] ${message}`, 2600);

      actor.moveTo(
        this.grid.nearestFree(point),
      );
    };

    switch (action) {
      case "idle":
        setVisualStatus("IDLE");
        actor.say("[TESTE] Idle", 1800);
        actor.moveTo(actor.home);
        return;

      case "thinking":
        setVisualStatus("THINKING");
        actor.say("[TESTE] Pensando na mesa", 2200);
        actor.moveTo(actor.home);
        return;

      case "working":
        setVisualStatus("WORKING");
        actor.say("[TESTE] Trabalhando", 2200);
        actor.moveTo(actor.home);
        return;

      case "meeting": {
        setVisualStatus("MEETING");

        const seat = this.claimMeetingSeat(agentId);

        if (seat) {
          actor.meetingSeat = seat;
          actor.say("[TESTE] Indo para reunião", 2200);
          actor.moveTo(seat);
        } else {
          actor.say("[TESTE] Sem assento livre", 2200);
        }

        return;
      }

      /*
       * Estes pontos sao deliberadamente centralizados em areas
       * aproximadas do mapa atual.
       *
       * nearestFree() corrige automaticamente um ponto ocupado.
       *
       * Depois do teste visual podemos ajustar cada coordenada
       * exatamente ao mapa desenhado.
       */

      case "whiteboard":
        move(
          { x: 3, y: 3 },
          "Indo ao quadro",
          "THINKING",
        );
        return;

      case "water":
        move(
          { x: 2, y: 12 },
          "Pegando água",
          "IDLE",
        );
        return;

      case "coffee":
        move(
          { x: 3, y: 12 },
          "Pegando café",
          "IDLE",
        );
        return;

      case "sofa":
        move(
          { x: 4, y: 7 },
          "Indo ao sofá",
          "IDLE",
        );
        return;

      case "armchair":
        move(
          { x: 14, y: 18 },
          "Indo à poltrona",
          "IDLE",
        );
        return;

      case "home":
        actor.say("[TESTE] Voltando à mesa", 2000);
        actor.moveTo(actor.home);
        return;

      case "talk":
        actor.say(
          "Teste de balão de fala e animação.",
          4500,
        );
        return;

      case "supervisor": {
        const managerId =
          actor.agent.manager_agent_id;

        if (
          managerId &&
          this.actors.has(managerId)
        ) {
          this.reportToManager(
            agentId,
            managerId,
            "[TESTE] Entregando resultado ao superior.",
          );

          return;
        }

        /*
         * Fallback para agentes sem manager configurado:
         * aproxima-se da area executiva.
         */
        move(
          { x: 11, y: 8 },
          "Indo ao superior",
          "WALKING",
        );

        return;
      }
    }
  }

  say(agentId: string, value: string) {
    this.actors.get(agentId)?.say(value);
  }

  reportToManager(agentId: string, managerId?: string | null, message?: string) {
    const actor = this.actors.get(agentId);
    const manager = this.actors.get(managerId ?? actor?.agent.manager_agent_id ?? "");
    if (!actor || !manager || actor === manager) return;
    const approaches = [
      { x: manager.tile.x - 1, y: manager.tile.y },
      { x: manager.tile.x + 1, y: manager.tile.y },
      { x: manager.tile.x, y: manager.tile.y - 1 },
      { x: manager.tile.x, y: manager.tile.y + 1 },
    ];
    const target = approaches.find(
      (point) =>
        !this.grid.isBlocked(point.x, point.y) && this.grid.findPath(actor.tile, point).length,
    );
    if (!target) return;
    actor.isReporting = true;
    actor.status = "WALKING";
    actor.applyStatusVisual();
    actor.say(message ?? `Entregando resultado a ${manager.agent.name}.`, 5000);
    actor.moveTo(target);
  }

  selectAgent(id: string | null) {
    for (const actor of this.actors.values()) actor.setSelected(false);
    this.selectedAgentId = id;
    this.data_.onSelectAgent?.(id);
    const actor = id ? this.actors.get(id) : null;
    if (actor) this.cameras.main.pan(actor.sprite.x, actor.sprite.y, 400, "Sine.easeInOut");
  }

  setKillSwitch(active: boolean) {
    this.killSwitch = active;
    this.killOverlay?.setVisible(active);
    for (const actor of this.actors.values()) {
      actor.applyStatusVisual();
      if (active) {
        actor.path = [];
        actor.route.clear();
      }
    }
  }

  override update(time: number, delta: number) {
    for (const actor of this.actors.values()) actor.update(time, delta);
  }
}
