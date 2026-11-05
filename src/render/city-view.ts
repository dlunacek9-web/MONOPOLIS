import {
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Group, Material, Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BOARD_SIZE, JAIL_TILE, actorOf, canBuild } from '../core';
import type { GameEvent, GameState, PlayerId, TileId } from '../core';
import { drivePath, lanePoint, lotRect } from './layout';
import type { Point } from './layout';
import { carModel, turnChevron } from './models';
import { PALETTE, PLAYER_COLORS } from './palette';
import { skyTexture } from './textures';
import { TileVisual } from './tiles';
import type { Highlight } from './tiles';
import { buildWorld } from './world';

export type AnimationSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

const STEP_MS: Record<AnimationSpeed, number> = { slow: 320, normal: 170, fast: 45, turbo: 0 };
const HOP_MS: Record<AnimationSpeed, number> = { slow: 1300, normal: 720, fast: 180, turbo: 0 };
const MAX_DRIVE_MS: Record<AnimationSpeed, number> = {
  slow: 5500,
  normal: 2600,
  fast: 2600,
  turbo: 2600,
};
const HOP_HEIGHT = 5;
const CAR_Y = 0.14;
const FOLLOW_ZOOM = 0.5;
const FOLLOW_HOLD_MS = 650;
const CAMERA_FOV = 28;
const CAMERA_ELEVATION = (50 * Math.PI) / 180;
const CAMERA_AZIMUTH = 0.12;
const CLICK_TOLERANCE = 6;

/** Místo u rozhraní zleva a zprava. Scéna se do něj nesmí schovat. */
const HUD_LEFT = 300;
const HUD_RIGHT = 392;

interface Segment {
  from: Point;
  to: Point;
  start: number;
  end: number;
  hop: boolean;
}

interface Car {
  model: Group;
  segments: Segment[];
  /** Kde auto logicky stojí po dojetí všech naplánovaných úseků. */
  tile: TileId;
  jailed: boolean;
  point: Point;
  yaw: number;
}

export interface CityViewCallbacks {
  onTileClick: (tile: TileId) => void;
  onHover: (tile: TileId | null, x: number, y: number) => void;
  /** Všechna auta dojela, rozhraní může ukázat další volby. */
  onIdle: () => void;
}

/** Stání ve vazbě: dvůr za mřížemi, každý hráč má své místo. */
function jailPoint(player: PlayerId): Point {
  const lot = lotRect(JAIL_TILE);
  return { x: lot.x - 0.2 + player * 0.42, z: lot.z + 0.75 };
}

function disposeTree(root: Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material.dispose();
  });
}

/** 3D město. Jen zobrazuje stav hry, nic v něm neovlivňuje pravidla. */
export class CityView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 400);
  private readonly controls: OrbitControls;
  private readonly tiles: TileVisual[] = [];
  private readonly picks: Mesh[] = [];
  private readonly cars: Car[] = [];
  private readonly chevron = turnChevron();
  private readonly raycaster = new Raycaster();
  private readonly observer: ResizeObserver;
  private readonly disposables: { dispose(): void }[] = [];

  private speed: AnimationSpeed = 'normal';
  private lastSeq: number;
  private timelineEnd = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrame = performance.now();

  private readonly homeTarget = new Vector3(0, -2, 0);
  private readonly homePosition = new Vector3();
  private readonly goalTarget = new Vector3();
  private readonly goalPosition = new Vector3();
  private userMovedCamera = false;
  private dragging = false;
  private followUntil = 0;

  private pointerDown: { x: number; y: number } | null = null;
  private hoverPointer: { x: number; y: number } | null = null;
  private hoveredTile: TileId | null = null;
  private actor: PlayerId | null = null;

  constructor(
    private readonly host: HTMLElement,
    state: GameState,
    private readonly callbacks: CityViewCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = (80 * Math.PI) / 180;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 170;
    this.controls.addEventListener('start', () => {
      this.dragging = true;
      this.userMovedCamera = true;
      this.followUntil = 0;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
      // Kam si hráč kameru dal, tam se po jízdě auta zase vrátí.
      this.homePosition.copy(this.camera.position);
      this.homeTarget.copy(this.controls.target);
    });

    this.buildScene();
    this.lastSeq = state.eventSeq;
    this.createCars(state);
    this.update(state, 0, null);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get busy(): boolean {
    return performance.now() < this.timelineEnd;
  }

  /** Během minihry město nekreslí, ať se o výkon nedělí dvě 3D scény. */
  setPaused(paused: boolean): void {
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(paused ? null : () => this.frame());
  }

  /** Jak dlouho ještě auta pojedou. Boti s dalším tahem počkají. */
  get remainingMs(): number {
    return Math.max(0, this.timelineEnd - performance.now());
  }

  setSpeed(speed: AnimationSpeed): void {
    this.speed = speed;
  }

  resetCamera(): void {
    this.userMovedCamera = false;
    this.homeTarget.set(0, -2, 0);
    this.followUntil = 0;
    this.resize();
  }

  /**
   * Překreslí město podle stavu. Události po `upToSeq` zatím nechá ležet: auta vyjedou,
   * až na ně přijde řada v přehrávaných scénách.
   */
  update(
    state: GameState,
    me: PlayerId,
    selected: TileId | null,
    upToSeq = Number.POSITIVE_INFINITY,
  ): void {
    for (const event of state.events) {
      if (event.seq <= this.lastSeq) continue;
      if (event.seq > upToSeq) break;
      this.lastSeq = event.seq;
      this.applyEvent(event);
    }
    if (upToSeq >= state.eventSeq) this.reconcileCars(state);
    this.scheduleIdle();

    this.actor = actorOf(state);
    const actorTile = this.actor === null ? null : (state.players[this.actor]?.position ?? null);
    const focus = state.auction?.tile ?? state.pendingBuy;
    for (const tile of this.tiles) {
      let highlight: Highlight = 'none';
      if (tile.tile === selected) highlight = 'selected';
      else if (tile.tile === focus) highlight = 'focus';
      else if (state.deeds[tile.tile] && canBuild(state, me, tile.tile)) highlight = 'build';
      else if (tile.tile === actorTile) highlight = 'current';
      tile.update(state, highlight);
    }
    state.players.forEach((player, id) => {
      const car = this.cars[id];
      if (car) car.model.visible = !player.bankrupt;
    });
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.observer.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.controls.dispose();
    for (const tile of this.tiles) tile.dispose();
    for (const item of this.disposables) item.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  private buildScene(): void {
    const sky = skyTexture();
    this.disposables.push(sky);
    this.scene.background = sky;
    this.scene.fog = new Fog(PALETTE.fog, 75, 210);

    this.scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 2.1));
    const sun = new DirectionalLight(PALETTE.sun, 2.4);
    sun.position.set(-22, 34, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    this.disposables.push(...buildWorld(this.scene));
    for (let tile = 0; tile < BOARD_SIZE; tile++) {
      const visual = new TileVisual(tile);
      this.tiles.push(visual);
      this.picks.push(visual.pick);
      this.scene.add(visual.root);
    }
    this.scene.add(this.chevron);
  }

  private createCars(state: GameState): void {
    state.players.forEach((player, id) => {
      const model = carModel(id, PLAYER_COLORS[id]!);
      const point = player.inJail ? jailPoint(id) : lanePoint(player.position, id);
      model.position.set(point.x, CAR_Y, point.z);
      const yaw = headingAt(player.position);
      model.rotation.y = yaw;
      this.scene.add(model);
      this.cars.push({
        model,
        segments: [],
        tile: player.position,
        jailed: player.inJail,
        point,
        yaw,
      });
    });
  }

  private applyEvent(event: GameEvent): void {
    if (event.type === 'move') this.driveTo(event.player, event.tile);
    else if (event.type === 'jail') this.hopToJail(event.player);
    else if (event.type === 'jailOut') this.hopOutOfJail(event.player);
  }

  /** Když se auto s hrou rozejde (např. po vynechané události), srovná ho skokem. */
  private reconcileCars(state: GameState): void {
    state.players.forEach((player, id) => {
      const car = this.cars[id];
      if (!car || player.bankrupt) return;
      if (player.inJail && !car.jailed) this.hopToJail(id);
      else if (!player.inJail && car.jailed) this.hopOutOfJail(id);
      if (car.tile !== player.position) this.driveTo(id, player.position);
    });
  }

  private driveTo(player: PlayerId, tile: TileId): void {
    const car = this.cars[player];
    if (!car) return;
    if (car.jailed) this.hopOutOfJail(player);
    const path = drivePath(car.tile, tile);
    if (path.length === 0) return;
    const stepMs = Math.min(STEP_MS[this.speed], MAX_DRIVE_MS[this.speed] / path.length);
    let from = car.point;
    let start = this.nextStart();
    for (const step of path) {
      const to = lanePoint(step, player);
      this.addSegment(car, { from, to, start, end: start + stepMs, hop: false });
      from = to;
      start += stepMs;
    }
    car.point = from;
    car.tile = tile;
  }

  private hopToJail(player: PlayerId): void {
    const car = this.cars[player];
    if (!car || car.jailed) return;
    const to = jailPoint(player);
    this.addHop(car, to);
    car.point = to;
    car.tile = JAIL_TILE;
    car.jailed = true;
  }

  private hopOutOfJail(player: PlayerId): void {
    const car = this.cars[player];
    if (!car || !car.jailed) return;
    const to = lanePoint(JAIL_TILE, player);
    this.addHop(car, to);
    car.point = to;
    car.jailed = false;
  }

  private addHop(car: Car, to: Point): void {
    const start = this.nextStart();
    this.addSegment(car, {
      from: car.point,
      to,
      start,
      end: start + HOP_MS[this.speed],
      hop: true,
    });
  }

  private nextStart(): number {
    return Math.max(performance.now(), this.timelineEnd);
  }

  private addSegment(car: Car, segment: Segment): void {
    if (segment.end <= segment.start) {
      // Turbo: žádná animace, auto je hned v cíli.
      car.model.position.set(segment.to.x, CAR_Y, segment.to.z);
      return;
    }
    car.segments.push(segment);
    this.timelineEnd = Math.max(this.timelineEnd, segment.end);
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const remaining = this.remainingMs;
    if (remaining <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.callbacks.onIdle();
    }, remaining + 20);
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const moving = this.updateCars(now, dt);
    this.updateChevron(now);
    this.updateCamera(now, dt, moving);
    this.controls.update();
    this.animateProps(now);
    this.updateHover();
    this.renderer.render(this.scene, this.camera);
  }

  private updateCars(now: number, dt: number): Car | null {
    let moving: Car | null = null;
    for (const car of this.cars) {
      while (car.segments[0] && car.segments[0].end <= now) {
        const done = car.segments.shift()!;
        car.model.position.set(done.to.x, CAR_Y, done.to.z);
      }
      const segment = car.segments[0];
      if (!segment || segment.start > now) continue;
      const progress = (now - segment.start) / (segment.end - segment.start);
      const x = segment.from.x + (segment.to.x - segment.from.x) * progress;
      const z = segment.from.z + (segment.to.z - segment.from.z) * progress;
      const lift = segment.hop ? Math.sin(progress * Math.PI) * HOP_HEIGHT : 0;
      car.model.position.set(x, CAR_Y + lift, z);
      const dx = segment.to.x - segment.from.x;
      const dz = segment.to.z - segment.from.z;
      if (Math.hypot(dx, dz) > 1e-3) {
        car.yaw = turnTowards(car.yaw, Math.atan2(dx, dz), dt * 12);
        car.model.rotation.y = car.yaw;
      }
      moving = car;
    }
    return moving;
  }

  private updateChevron(now: number): void {
    const car = this.actor === null ? null : this.cars[this.actor];
    this.chevron.visible = Boolean(car?.model.visible);
    if (!car) return;
    const bob = Math.sin(now / 220) * 0.1;
    this.chevron.position.set(
      car.model.position.x,
      car.model.position.y + 1.05 + bob,
      car.model.position.z,
    );
    this.chevron.rotation.y = now / 500;
  }

  private updateCamera(now: number, dt: number, moving: Car | null): void {
    if (this.dragging) return;
    if (moving && this.speed === 'normal') {
      const follow = this.goalTarget;
      follow.copy(moving.model.position);
      follow.y = 0;
      const offset = this.homePosition.clone().sub(this.homeTarget).multiplyScalar(FOLLOW_ZOOM);
      this.goalPosition.copy(follow).add(offset);
      this.followUntil = now + FOLLOW_HOLD_MS;
    } else if (now >= this.followUntil) {
      this.goalTarget.copy(this.homeTarget);
      this.goalPosition.copy(this.homePosition);
    }
    const blend = 1 - Math.exp(-dt * 2.6);
    this.controls.target.lerp(this.goalTarget, blend);
    this.camera.position.lerp(this.goalPosition, blend);
  }

  private animateProps(now: number): void {
    const time = now / 1000;
    for (const tile of this.tiles) {
      tile.tick(time);
      if (tile.raid) {
        const on = Math.floor(time * 4) % 2 === 0;
        tile.raid.lights.red.color.set(on ? PALETTE.policeRed : PALETTE.darkMetal);
        tile.raid.lights.blue.color.set(on ? PALETTE.darkMetal : PALETTE.police);
      }
    }
  }

  /** Kamera vidí celý ostrov i v užší oblasti mezi panely rozhraní. */
  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    const shift = (HUD_RIGHT - HUD_LEFT) / 2;
    this.camera.setViewOffset(width, height, shift, 0, width, height);
    this.camera.updateProjectionMatrix();
    if (this.userMovedCamera) return;
    const visibleWidth = Math.max(320, width - HUD_LEFT - HUD_RIGHT + 180);
    const visibleAspect = visibleWidth / height;
    const halfHeight = 16.2;
    const halfWidth = 16;
    const tan = Math.tan((CAMERA_FOV * Math.PI) / 360);
    const distance = Math.max(halfHeight, halfWidth / visibleAspect) / tan;
    this.homePosition.set(
      this.homeTarget.x + distance * Math.sin(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION),
      this.homeTarget.y + distance * Math.sin(CAMERA_ELEVATION),
      this.homeTarget.z + distance * Math.cos(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION),
    );
    this.goalTarget.copy(this.homeTarget);
    this.goalPosition.copy(this.homePosition);
  }

  private tileAt(clientX: number, clientY: number): TileId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.picks, false)[0];
    return hit ? (hit.object.userData.tile as TileId) : null;
  }

  private updateHover(): void {
    const pointer = this.hoverPointer;
    if (!pointer || this.dragging) return;
    const tile = this.tileAt(pointer.x, pointer.y);
    this.renderer.domElement.style.cursor = tile === null ? 'grab' : 'pointer';
    if (tile === this.hoveredTile && tile === null) return;
    this.hoveredTile = tile;
    this.callbacks.onHover(tile, pointer.x, pointer.y);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE) return;
    const tile = this.tileAt(event.clientX, event.clientY);
    if (tile !== null) this.callbacks.onTileClick(tile);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.hoverPointer = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerLeave = (): void => {
    this.hoverPointer = null;
    this.hoveredTile = null;
    this.callbacks.onHover(null, 0, 0);
  };
}

/** Směr jízdy auta stojícího na políčku. */
function headingAt(tile: TileId): number {
  const here = lanePoint(tile, 0);
  const next = lanePoint((tile + 1) % BOARD_SIZE, 0);
  return Math.atan2(next.x - here.x, next.z - here.z);
}

function turnTowards(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, amount);
}
