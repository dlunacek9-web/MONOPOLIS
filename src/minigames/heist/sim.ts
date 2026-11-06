import type { HeistTarget } from '../../core';
import { YardNav } from '../breakout/nav';
import { randomFrom } from '../random';
import { clamp, distance, pushOut, rayLength, wrapAngle } from '../topdown';
import type { Point, Rect } from '../topdown';
import { HALF_X, HALF_Z, createHeistMap } from './map';
import type { HeistMap } from './map';

export interface HeistOutcome {
  escaped: boolean;
  bags: number;
}

export interface ThiefInput {
  /** -1 až 1, kladná hodnota jde doprava. */
  x: number;
  /** -1 až 1, kladná hodnota jde k obrazovce. */
  z: number;
  sprint: boolean;
  /** Trezor, zámek a pytel. Počítá se jen stisk, ne držení. */
  action: boolean;
  /** Odhození pytle. Počítá se jen stisk. */
  drop: boolean;
}

/** Ovládání lupiče. Člověk i testovací AI používají stejné rozhraní. */
export type ThiefController = (sim: HeistSim) => ThiefInput;

export interface Thief extends Point {
  yaw: number;
  speed: number;
  sprinting: boolean;
}

export interface Cop extends Point {
  yaw: number;
  speed: number;
}

export interface Camera extends Point {
  yaw: number;
}

export interface Bag extends Point {
  carried: boolean;
}

/** Běžící zámek trezoru: ručička obíhá a hráč ji chytá v zeleném výseku. */
export interface Dial {
  needle: number;
  center: number;
  half: number;
}

const FIXED_DT = 1 / 60;
/** Bez poplachu se po tomhle čase ostraha vystřídá a všimne si dodávky. */
export const CLEAN_TIME = 75;
export const ALARM_TIME: Record<HeistTarget, number> = { hotel: 26, bank: 30 };
const MAX_COPS: Record<HeistTarget, number> = { hotel: 4, bank: 6 };
const COP_DELAY = 6;
const COP_INTERVAL = 5;
const COP_SPEED = 5.2;
const COP_TURN = 8;
const COP_SPACING = 1.3;
const CATCH_DISTANCE = 1.25;
const WALK_SPEED = 8;
const SPRINT_FACTOR = 1.45;
/** O kolik zpomalí každý pytel. Čtyři pytle už bez sprintu před policií neutečou, šest ani se sprintem. */
export const BAG_SLOWDOWN = 0.09;
const STAMINA_DRAIN = 0.45;
const STAMINA_REFILL = 0.2;
const STAMINA_RESTART = 0.25;
const THIEF_RADIUS = 0.6;
const ACTION_RADIUS = 2.4;
const VAN_RADIUS = 5;
const GRAB_TIME = 0.35;
export const CAMERA_RANGE = 12;
export const CAMERA_HALF_ANGLE = 0.42;
const SUSPICION_RATE = 0.8;
const SUSPICION_DECAY = 0.25;
const MISS_SUSPICION = 0.25;
const NEEDLE_SPEEDS = [3.1, 4.1, 5.1];
const ARC_HALVES = [0.55, 0.45, 0.36];

/** Pravidla jednoho heistu. Nezná Three.js ani DOM, takže jde pustit i v testu. */
export class HeistSim {
  readonly map: HeistMap;
  readonly thief: Thief;
  readonly cops: Cop[] = [];
  readonly cameras: Camera[];
  readonly bags: Bag[];
  /** Kolik pytlů hráč nese. */
  carried = 0;
  alarm = false;
  vaultOpen = false;
  /** Kolik zámků už je otevřených. */
  opened = 0;
  /** Zámek, na kterém se právě pracuje. */
  dial: Dial | null = null;
  /** Čas do střídání ostrahy, po poplachu čas do uzavření ulice. */
  timeLeft = CLEAN_TIME;
  /** 0 až 1, při jedničce je poplach. */
  suspicion = 0;
  stamina = 1;
  seen = false;
  outcome: HeistOutcome | null = null;
  /** Jak dlouho ještě lupič nakládá pytel a stojí. */
  grabbing = 0;
  private readonly closedObstacles: readonly Rect[];
  private readonly navClosed: YardNav;
  private readonly navOpen: YardNav;
  private readonly random: () => number;
  private winded = false;
  private actionHeld = false;
  private dropHeld = false;
  private elapsed = 0;
  private accumulator = 0;
  private nextCop = 0;
  private copsSpawned = 0;

  constructor(
    target: HeistTarget,
    seed: number,
    private readonly controller: ThiefController,
  ) {
    this.map = createHeistMap(target, seed);
    this.random = randomFrom(seed ^ 0x51ed);
    const bounds = { halfX: HALF_X, halfZ: HALF_Z };
    this.navOpen = new YardNav(this.map.obstacles, bounds);
    this.closedObstacles = [...this.map.obstacles, this.map.door];
    this.navClosed = new YardNav(this.closedObstacles, bounds);
    this.thief = { ...this.map.start, yaw: 0, speed: 0, sprinting: false };
    this.cameras = this.map.cameras.map((path) => ({ x: path.x, z: path.z, yaw: path.yaw }));
    this.bags = this.map.bags.map((bag) => ({ ...bag, carried: false }));
    this.updateCameras();
  }

  get nav(): YardNav {
    return this.vaultOpen ? this.navOpen : this.navClosed;
  }

  /** Překážky včetně dveří trezoru, dokud jsou zavřené. */
  get obstacles(): readonly Rect[] {
    return this.vaultOpen ? this.map.obstacles : this.closedObstacles;
  }

  get maxBags(): number {
    return this.bags.length;
  }

  /** Rychlost podle nákladu jako podíl plné rychlosti. */
  get load(): number {
    return 1 - this.carried * BAG_SLOWDOWN;
  }

  /** Stojí teď hráč tak, aby mohl začít otevírat trezor? */
  get atVault(): boolean {
    return !this.vaultOpen && distance(this.thief, this.map.vaultSpot) < ACTION_RADIUS;
  }

  /** Pytel, který by hráč teď sebral. */
  get bagInReach(): Bag | null {
    let best: Bag | null = null;
    for (const bag of this.bags) {
      if (bag.carried || distance(bag, this.thief) >= ACTION_RADIUS) continue;
      if (!best || distance(bag, this.thief) < distance(best, this.thief)) best = bag;
    }
    return best;
  }

  /** Je ručička v zeleném výseku? */
  get needleInArc(): boolean {
    const dial = this.dial;
    return dial !== null && Math.abs(wrapAngle(dial.needle - dial.center)) <= dial.half;
  }

  /** Posune simulaci o reálný čas. Uvnitř běží pevným krokem, aby nezávisela na FPS. */
  advance(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * 6);
    while (this.accumulator >= FIXED_DT && !this.outcome) {
      this.accumulator -= FIXED_DT;
      this.step();
    }
  }

  private step(): void {
    this.elapsed += FIXED_DT;
    const input = this.controller(this);
    const pressed = input.action && !this.actionHeld;
    const dropped = input.drop && !this.dropHeld;
    this.actionHeld = input.action;
    this.dropHeld = input.drop;
    if (dropped) this.dropBag();
    if (pressed) this.act();
    this.moveThief(input);
    if (this.dial) {
      const speed = NEEDLE_SPEEDS[this.opened] ?? NEEDLE_SPEEDS[0]!;
      this.dial.needle = wrapAngle(this.dial.needle + speed * FIXED_DT);
    }
    this.updateCameras();
    this.updateSuspicion();
    if (this.alarm) this.updateCops();
    this.timeLeft = Math.max(0, this.timeLeft - FIXED_DT);
    if (this.timeLeft <= 0 && !this.alarm) this.startAlarm();
    this.updateOutcome();
  }

  /** E dělá to, co dává smysl tam, kde hráč stojí. */
  private act(): void {
    if (this.dial) {
      if (this.needleInArc) this.openTumbler();
      else this.missTumbler();
      return;
    }
    if (this.atVault) {
      this.newDial();
      return;
    }
    const bag = this.bagInReach;
    if (bag && this.grabbing <= 0) {
      bag.carried = true;
      this.carried += 1;
      this.grabbing = GRAB_TIME;
    }
  }

  private dropBag(): void {
    const bag = this.bags.find((one) => one.carried);
    if (!bag) return;
    bag.carried = false;
    bag.x = this.thief.x;
    bag.z = this.thief.z;
    this.carried -= 1;
  }

  private newDial(): void {
    const half = ARC_HALVES[this.opened] ?? ARC_HALVES[0]!;
    const center = (this.random() * 2 - 1) * Math.PI;
    // Ručička vyráží na opačné straně, ať se dá zelený výsek v klidu najít.
    this.dial = { needle: wrapAngle(center + Math.PI), center, half };
  }

  private openTumbler(): void {
    this.opened += 1;
    if (this.opened < this.map.tumblers) {
      this.newDial();
      return;
    }
    this.dial = null;
    this.vaultOpen = true;
    this.startAlarm();
  }

  /** Vedle znamená hluk: podezření vyskočí a zámek se přehodí. */
  private missTumbler(): void {
    this.suspicion = Math.min(1, this.suspicion + MISS_SUSPICION);
    this.newDial();
  }

  private startAlarm(): void {
    if (this.alarm) return;
    this.alarm = true;
    this.suspicion = 1;
    this.timeLeft = ALARM_TIME[this.map.target];
    this.nextCop = COP_DELAY;
  }

  private moveThief(input: ThiefInput): void {
    const p = this.thief;
    const length = Math.hypot(input.x, input.z);
    let moving = length > 0.01;
    if (moving && this.dial) this.dial = null;
    if (this.grabbing > 0) {
      this.grabbing -= FIXED_DT;
      moving = false;
    }
    if (this.stamina >= STAMINA_RESTART) this.winded = false;
    p.sprinting = moving && input.sprint && !this.winded && this.stamina > 0;
    const change = p.sprinting ? -STAMINA_DRAIN : STAMINA_REFILL;
    this.stamina = clamp(this.stamina + change * FIXED_DT, 0, 1);
    if (this.stamina <= 0) this.winded = true;
    p.speed = moving ? WALK_SPEED * this.load * (p.sprinting ? SPRINT_FACTOR : 1) : 0;
    if (!moving) return;
    const scale = Math.min(1, length) / length;
    const vx = input.x * scale * p.speed;
    const vz = input.z * scale * p.speed;
    p.yaw = Math.atan2(vx, vz);
    p.x += vx * FIXED_DT;
    p.z += vz * FIXED_DT;
    pushOut(p, this.obstacles, THIEF_RADIUS);
    p.x = clamp(p.x, -HALF_X + THIEF_RADIUS, HALF_X - THIEF_RADIUS);
    p.z = clamp(p.z, -HALF_Z + THIEF_RADIUS, HALF_Z - THIEF_RADIUS);
  }

  private updateCameras(): void {
    this.map.cameras.forEach((path, index) => {
      this.cameras[index]!.yaw =
        path.yaw + Math.sin(this.elapsed * path.speed + path.phase) * path.sweep;
    });
  }

  private updateSuspicion(): void {
    this.seen = !this.alarm && this.cameras.some((camera) => this.cameraSees(camera, this.thief));
    if (this.alarm) return;
    const rate = this.seen ? SUSPICION_RATE : -SUSPICION_DECAY;
    this.suspicion = clamp(this.suspicion + rate * FIXED_DT, 0, 1);
    if (this.suspicion >= 1) this.startAlarm();
  }

  cameraSees(camera: Camera, at: Point): boolean {
    const d = distance(camera, at);
    if (d > CAMERA_RANGE) return false;
    const angle = Math.atan2(at.x - camera.x, at.z - camera.z);
    if (Math.abs(wrapAngle(angle - camera.yaw)) > CAMERA_HALF_ANGLE) return false;
    return rayLength(this.obstacles, camera, angle, d) >= d;
  }

  /** Jak daleko kamera dohlédne daným směrem. Pro vykreslení kuželu. */
  cameraReach(camera: Camera, angle: number): number {
    return rayLength(this.obstacles, camera, angle, CAMERA_RANGE);
  }

  private updateCops(): void {
    this.nextCop -= FIXED_DT;
    if (this.nextCop <= 0 && this.copsSpawned < MAX_COPS[this.map.target]) {
      const spawn = this.map.copSpawns[this.copsSpawned % this.map.copSpawns.length]!;
      this.cops.push({ ...spawn, yaw: 0, speed: COP_SPEED });
      this.copsSpawned += 1;
      this.nextCop = COP_INTERVAL;
    }
    for (const cop of this.cops) this.moveCop(cop);
    // Policisté se rozestoupí, jinak by běželi v jednom bodě a stačilo by uhnout jednomu.
    for (let i = 0; i < this.cops.length; i++) {
      for (let j = i + 1; j < this.cops.length; j++) {
        this.spreadCops(this.cops[i]!, this.cops[j]!);
      }
    }
  }

  private moveCop(cop: Cop): void {
    const to = this.nav.nextStep(cop, this.thief);
    const dx = to.x - cop.x;
    const dz = to.z - cop.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return;
    const step = Math.min(length, COP_SPEED * FIXED_DT);
    cop.x += (dx / length) * step;
    cop.z += (dz / length) * step;
    const delta = wrapAngle(Math.atan2(dx, dz) - cop.yaw);
    cop.yaw = wrapAngle(cop.yaw + clamp(delta, -COP_TURN * FIXED_DT, COP_TURN * FIXED_DT));
  }

  private spreadCops(a: Cop, b: Cop): void {
    const d = distance(a, b);
    if (d >= COP_SPACING || d === 0) return;
    const push = (COP_SPACING - d) / 2 / d;
    const dx = (a.x - b.x) * push;
    const dz = (a.z - b.z) * push;
    a.x += dx;
    a.z += dz;
    b.x -= dx;
    b.z -= dz;
    pushOut(a, this.obstacles, THIEF_RADIUS);
    pushOut(b, this.obstacles, THIEF_RADIUS);
  }

  private updateOutcome(): void {
    if (this.alarm && distance(this.thief, this.map.van) < VAN_RADIUS) {
      this.outcome = { escaped: true, bags: this.carried };
      return;
    }
    const caught = this.cops.some((cop) => distance(cop, this.thief) < CATCH_DISTANCE);
    if (caught || (this.alarm && this.timeLeft <= 0)) {
      this.outcome = { escaped: false, bags: 0 };
    }
  }
}
