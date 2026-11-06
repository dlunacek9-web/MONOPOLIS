import { clamp, distance, pushOut, rayLength, wrapAngle } from '../topdown';
import { HALF_X, HALF_Z, createYard } from './map';
import type { Point, YardMap } from './map';
import { YardNav } from './nav';

export type BreakoutOutcome = 'escaped' | 'caught';
export type GuardMode = 'patrol' | 'search' | 'chase';

export interface PrisonerInput {
  /** -1 až 1, kladná hodnota jde doprava. */
  x: number;
  /** -1 až 1, kladná hodnota jde k obrazovce. */
  z: number;
  sprint: boolean;
}

/** Ovládání vězně. Člověk i testovací AI používají stejné rozhraní. */
export type PrisonerController = (sim: BreakoutSim) => PrisonerInput;

export interface Prisoner extends Point {
  yaw: number;
  speed: number;
  sprinting: boolean;
}

export interface Guard extends Point {
  id: number;
  yaw: number;
  speed: number;
  mode: GuardMode;
  /** Kam jde při hledání nebo honbě. */
  target: Point | null;
  corners: Point[];
  corner: number;
  /** Jak dlouho ještě stojí a rozhlíží se. */
  wait: number;
  /** Fáze rozhlížení na zastávce. */
  scan: number;
}

export interface Spot extends Point {
  radius: number;
  tower: Point;
}

const FIXED_DT = 1 / 60;
export const TIME_LIMIT = 45;
const WALK_SPEED = 7;
const SPRINT_SPEED = 11.5;
const STAMINA_DRAIN = 1 / 2;
const STAMINA_REFILL = 1 / 5;
/** Vyčerpaný hráč musí chvíli popadnout dech, než může znovu sprintovat. */
const STAMINA_RESTART = 0.25;
const PRISONER_RADIUS = 0.6;
const GUARD_PATROL_SPEED = 4.6;
const GUARD_SEARCH_SPEED = 6;
const GUARD_CHASE_SPEED = 6.6;
const GUARD_TURN = 4;
const CORNER_WAIT = 0.55;
const SEARCH_WAIT = 1.6;
const SCAN_SPEED = 2.2;
export const VISION_RANGE = 12;
export const VISION_HALF_ANGLE = 0.58;
export const SPOT_RADIUS = 4.4;
const NOISE_RADIUS = 13;
const CATCH_DISTANCE = 1.4;
const KEY_RADIUS = 1.8;
const GATE_RADIUS = 2.6;
const ALARM_FROM_SPOT = 0.55;
const ALARM_FROM_GUARD_FAR = 0.55;
const ALARM_FROM_GUARD_NEAR = 1.3;
const ALARM_DECAY = 0.2;
/** Pravidla jednoho útěku přes dvůr. Nezná Three.js ani DOM, takže jde pustit i v testu. */
export class BreakoutSim {
  readonly map: YardMap;
  readonly nav: YardNav;
  readonly prisoner: Prisoner;
  readonly guards: Guard[];
  readonly spots: Spot[];
  timeLeft = TIME_LIMIT;
  /** 0 až 1, při jedničce je po útěku. */
  alarm = 0;
  stamina = 1;
  hasKey = false;
  /** Vidí teď hráče reflektor, nebo bachař. */
  seen = false;
  outcome: BreakoutOutcome | null = null;
  private winded = false;
  private elapsed = 0;
  private accumulator = 0;

  constructor(
    seed: number,
    private readonly controller: PrisonerController,
  ) {
    this.map = createYard(seed);
    this.nav = new YardNav(this.map.obstacles);
    this.prisoner = { ...this.map.start, yaw: Math.PI, speed: 0, sprinting: false };
    this.guards = this.map.patrols.map((patrol, id) => {
      const at =
        patrol.corners[(patrol.first + patrol.corners.length - 1) % patrol.corners.length]!;
      const next = patrol.corners[patrol.first]!;
      return {
        ...at,
        id,
        yaw: Math.atan2(next.x - at.x, next.z - at.z),
        speed: 0,
        mode: 'patrol',
        target: null,
        corners: patrol.corners,
        corner: patrol.first,
        wait: 0,
        scan: 0,
      };
    });
    this.spots = this.map.spots.map((path) => ({
      x: path.x,
      z: path.z,
      radius: SPOT_RADIUS,
      tower: path.tower,
    }));
    this.updateSpots();
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
    this.movePrisoner(this.controller(this));
    this.updateSpots();
    this.makeNoise();
    for (const guard of this.guards) this.moveGuard(guard);
    this.updateAlarm();
    this.timeLeft = Math.max(0, this.timeLeft - FIXED_DT);
    this.updateOutcome();
  }

  private movePrisoner(input: PrisonerInput): void {
    const p = this.prisoner;
    const length = Math.hypot(input.x, input.z);
    const moving = length > 0.01;
    if (this.stamina >= STAMINA_RESTART) this.winded = false;
    p.sprinting = moving && input.sprint && !this.winded && this.stamina > 0;
    const change = p.sprinting ? -STAMINA_DRAIN : STAMINA_REFILL;
    this.stamina = clamp(this.stamina + change * FIXED_DT, 0, 1);
    if (this.stamina <= 0) this.winded = true;
    p.speed = moving ? (p.sprinting ? SPRINT_SPEED : WALK_SPEED) : 0;
    if (!moving) return;
    const scale = Math.min(1, length) / length;
    const vx = input.x * scale * p.speed;
    const vz = input.z * scale * p.speed;
    p.yaw = Math.atan2(vx, vz);
    p.x += vx * FIXED_DT;
    p.z += vz * FIXED_DT;
    this.pushOut(p);
    if (!this.hasKey && distance(p, this.map.key) < KEY_RADIUS) this.hasKey = true;
  }

  /** Vytlačí hráče z překážek a zdí. */
  private pushOut(p: Prisoner): void {
    pushOut(p, this.map.obstacles, PRISONER_RADIUS);
    p.x = clamp(p.x, -HALF_X + PRISONER_RADIUS, HALF_X - PRISONER_RADIUS);
    p.z = clamp(p.z, -HALF_Z + PRISONER_RADIUS, HALF_Z - PRISONER_RADIUS);
  }

  private updateSpots(): void {
    this.map.spots.forEach((path, index) => {
      const spot = this.spots[index]!;
      const t = this.elapsed;
      spot.x = path.x + path.ax * Math.sin(t * path.fx + path.phase);
      spot.z = path.z + path.az * Math.sin(t * path.fz + path.phase * 1.7);
    });
  }

  /** Sprint slyší všichni v okruhu, i přes překážky. */
  private makeNoise(): void {
    const p = this.prisoner;
    if (!p.sprinting) return;
    for (const guard of this.guards) {
      if (guard.mode !== 'chase' && distance(guard, p) < NOISE_RADIUS) {
        guard.mode = 'search';
        guard.target = { x: p.x, z: p.z };
        guard.wait = 0;
      }
    }
  }

  private moveGuard(guard: Guard): void {
    if (this.canSee(guard, this.prisoner)) {
      guard.mode = 'chase';
      guard.target = { x: this.prisoner.x, z: this.prisoner.z };
      guard.wait = 0;
    } else if (guard.mode === 'chase') {
      // Ztratil ho z očí: dojde na poslední známé místo a rozhlédne se.
      guard.mode = 'search';
    }
    if (guard.wait > 0) {
      guard.wait -= FIXED_DT;
      guard.scan += SCAN_SPEED * FIXED_DT;
      guard.yaw = wrapAngle(guard.yaw + Math.sin(guard.scan * 2) * SCAN_SPEED * FIXED_DT);
      guard.speed = 0;
      if (guard.wait <= 0 && guard.mode === 'search') {
        guard.mode = 'patrol';
        guard.target = null;
      }
      return;
    }
    if (guard.mode === 'patrol') this.walkPatrol(guard);
    else this.walkToTarget(guard);
  }

  private walkPatrol(guard: Guard): void {
    const corner = guard.corners[guard.corner]!;
    if (distance(guard, corner) < 0.4) {
      guard.corner = (guard.corner + 1) % guard.corners.length;
      guard.wait = CORNER_WAIT;
      return;
    }
    this.walk(guard, this.nav.nextStep(guard, corner), GUARD_PATROL_SPEED);
  }

  private walkToTarget(guard: Guard): void {
    const target = guard.target!;
    if (distance(guard, target) < 0.8) {
      guard.wait = guard.mode === 'search' ? SEARCH_WAIT : 0;
      return;
    }
    const speed = guard.mode === 'chase' ? GUARD_CHASE_SPEED : GUARD_SEARCH_SPEED;
    this.walk(guard, this.nav.nextStep(guard, target), speed);
  }

  private walk(guard: Guard, to: Point, speed: number): void {
    const dx = to.x - guard.x;
    const dz = to.z - guard.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return;
    const step = Math.min(length, speed * FIXED_DT);
    guard.x += (dx / length) * step;
    guard.z += (dz / length) * step;
    guard.speed = speed;
    const delta = wrapAngle(Math.atan2(dx, dz) - guard.yaw);
    guard.yaw = wrapAngle(guard.yaw + clamp(delta, -GUARD_TURN * FIXED_DT, GUARD_TURN * FIXED_DT));
  }

  private updateAlarm(): void {
    const p = this.prisoner;
    let rate = 0;
    for (const spot of this.spots) {
      if (distance(spot, p) < spot.radius) {
        rate = Math.max(rate, ALARM_FROM_SPOT);
        this.callNearestGuard();
      }
    }
    for (const guard of this.guards) {
      if (!this.canSee(guard, p)) continue;
      const closeness = 1 - distance(guard, p) / VISION_RANGE;
      rate = Math.max(
        rate,
        ALARM_FROM_GUARD_FAR + (ALARM_FROM_GUARD_NEAR - ALARM_FROM_GUARD_FAR) * closeness,
      );
    }
    this.seen = rate > 0;
    this.alarm = clamp(this.alarm + (this.seen ? rate : -ALARM_DECAY) * FIXED_DT, 0, 1);
  }

  /** Reflektor nechytá, jen ukáže nejbližšímu bachaři, kam jít. */
  private callNearestGuard(): void {
    const p = this.prisoner;
    let nearest: Guard | null = null;
    for (const guard of this.guards) {
      if (guard.mode === 'chase') return;
      if (!nearest || distance(guard, p) < distance(nearest, p)) nearest = guard;
    }
    if (!nearest) return;
    nearest.mode = 'search';
    nearest.target = { x: p.x, z: p.z };
    nearest.wait = 0;
  }

  private updateOutcome(): void {
    const p = this.prisoner;
    if (this.hasKey && distance(p, this.map.gate) < GATE_RADIUS) {
      this.outcome = 'escaped';
      return;
    }
    const grabbed = this.guards.some((guard) => distance(guard, p) < CATCH_DISTANCE);
    if (grabbed) this.alarm = 1;
    if (this.alarm >= 1 || this.timeLeft <= 0) this.outcome = 'caught';
  }

  canSee(guard: Guard, at: Point): boolean {
    const d = distance(guard, at);
    if (d > VISION_RANGE) return false;
    const angle = wrapAngle(Math.atan2(at.x - guard.x, at.z - guard.z) - guard.yaw);
    return Math.abs(angle) <= VISION_HALF_ANGLE && this.lineIsClear(guard, at);
  }

  /** Vidí tohle místo teď někdo? Pro plánování testovacího hráče. */
  isWatched(at: Point, margin = 0): boolean {
    if (this.spots.some((spot) => distance(spot, at) < spot.radius + margin)) return true;
    return this.guards.some((guard) => {
      if (distance(guard, at) < CATCH_DISTANCE + margin) return true;
      if (distance(guard, at) > VISION_RANGE + margin) return false;
      const angle = wrapAngle(Math.atan2(at.x - guard.x, at.z - guard.z) - guard.yaw);
      return Math.abs(angle) <= VISION_HALF_ANGLE + margin * 0.05 && this.lineIsClear(guard, at);
    });
  }

  lineIsClear(from: Point, to: Point): boolean {
    return (
      this.rayLength(from, Math.atan2(to.x - from.x, to.z - from.z), distance(from, to)) >=
      distance(from, to)
    );
  }

  /** Jak daleko dohlédne paprsek, než narazí na překážku. */
  rayLength(from: Point, angle: number, limit: number): number {
    return rayLength(this.map.obstacles, from, angle, limit);
  }
}
