import type RAPIER from '@dimforge/rapier3d-compat';
import { BLOCK, BOUND, GRID, PITCH, ROAD, createMap, nodePoint } from './map';
import type { ChaseMap, Point } from './map';

export type Rapier = typeof RAPIER;
export type CarKind = 'runner' | 'police' | 'traffic';
export type ChaseOutcome = 'escaped' | 'caught';

export interface CarInput {
  /** -1 až 1, záporná hodnota couvá. */
  throttle: number;
  /** -1 až 1, kladná hodnota zatáčí doleva. */
  steer: number;
  drift: boolean;
  nitro: boolean;
}

/** Ovládání auta. Člověk i AI používají stejné rozhraní a stejnou fyziku. */
export type CarController = (car: Car, sim: ChaseSim) => CarInput;

interface CarSpec {
  maxSpeed: number;
  accel: number;
  turn: number;
}

const SPECS: Record<CarKind, CarSpec> = {
  runner: { maxSpeed: 27, accel: 24, turn: 2.5 },
  police: { maxSpeed: 23.5, accel: 20, turn: 2.3 },
  traffic: { maxSpeed: 10, accel: 10, turn: 2 },
};

const FIXED_DT = 1 / 60;
export const TIME_LIMIT = 45;
const GOAL_RADIUS = 9;
const NITRO_SPEED = 41;
const NITRO_ACCEL = 42;
const NITRO_DRAIN = 1 / 3;
const NITRO_REFILL = 1 / 22;
/** Pokutová vzdálenost: policie daleko za hráčem na chvíli zrychlí, aby honička nevyšuměla. */
const CATCH_UP_DISTANCE = 70;
const CATCH_UP_SPEED = 29;
const ARREST_DISTANCE = 8.5;
const ARREST_MAX_SPEED = 9;
const ARREST_FILL = 1 / 1.4;
const ARREST_DECAY = 0.45;
/** Policie se neomráčí o hráče, kterého zrovna zastavuje. Jinak by strkáním nikdy nezatkla. */
const RAM_DISTANCE = 7;
const STUN_IMPACT = 11;
const STUN_TIME = 1.1;
const CRASH_IMPACT = 7;

export interface Car {
  id: number;
  kind: CarKind;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  drifting: boolean;
  boosting: boolean;
  stunned: number;
  body: RAPIER.RigidBody;
  controller: CarController;
}

export interface CrashEvent extends Point {
  force: number;
}

export interface ChaseSimOptions {
  rapier: Rapier;
  seed: number;
  runner: CarController;
  police: CarController;
  traffic: CarController;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Fyzika a pravidla jedné honičky. Nezná Three.js ani DOM, takže jde pustit i v testu. */
export class ChaseSim {
  readonly map: ChaseMap;
  readonly goal: Point;
  readonly cars: Car[] = [];
  readonly runner: Car;
  timeLeft = TIME_LIMIT;
  /** 0 až 1, při jedničce je hráč zatčený. */
  arrest = 0;
  nitro = 1;
  outcome: ChaseOutcome | null = null;
  /** Nárazy od posledního vyzvednutí, grafika z nich dělá efekty. */
  crashes: CrashEvent[] = [];
  private readonly world: RAPIER.World;
  private accumulator = 0;

  constructor(private readonly options: ChaseSimOptions) {
    const { rapier: R } = options;
    this.map = createMap(options.seed);
    this.goal = nodePoint(this.map.goal);
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = FIXED_DT;
    this.buildStatics();
    const start = nodePoint(this.map.start);
    this.runner = this.addCar('runner', start, 0, options.runner);
    for (const node of this.map.police) {
      this.addCar('police', nodePoint(node), Math.PI, options.police);
    }
    for (const node of this.map.traffic) {
      this.addCar('traffic', nodePoint(node), 0, options.traffic);
    }
  }

  private wall(x: number, z: number, hx: number, hz: number): void {
    const R = this.options.rapier;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, 1, z));
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, 2, hz).setRestitution(0.25).setFriction(0.05),
      body,
    );
  }

  private buildStatics(): void {
    const half = BLOCK / 2;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = (i + 0.5) * PITCH - (GRID * PITCH) / 2;
        const z = (j + 0.5) * PITCH - (GRID * PITCH) / 2;
        this.wall(x, z, half, half);
      }
    }
    const edge = BOUND + 1;
    this.wall(0, edge, edge + 1, 1);
    this.wall(0, -edge, edge + 1, 1);
    this.wall(edge, 0, 1, edge + 1);
    this.wall(-edge, 0, 1, edge + 1);
    for (const barricade of this.map.barricades) {
      const [hx, hz] = barricade.alongX ? [1, ROAD / 2] : [ROAD / 2, 1];
      this.wall(barricade.x, barricade.z, hx, hz);
    }
  }

  private addCar(kind: CarKind, at: Point, yaw: number, controller: CarController): Car {
    const R = this.options.rapier;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(at.x, 1, at.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .enabledTranslations(true, false, true)
        .enabledRotations(false, true, false)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      R.ColliderDesc.cuboid(1.05, 0.7, 2.1)
        .setRestitution(0.35)
        .setFriction(0.05)
        .setDensity(kind === 'traffic' ? 0.5 : 1),
      body,
    );
    const car: Car = {
      id: this.cars.length,
      kind,
      x: at.x,
      z: at.z,
      yaw,
      speed: 0,
      drifting: false,
      boosting: false,
      stunned: 0,
      body,
      controller,
    };
    this.cars.push(car);
    return car;
  }

  /** Posune simulaci o reálný čas. Uvnitř běží pevným krokem, aby fyzika nezávisela na FPS. */
  advance(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * 6);
    while (this.accumulator >= FIXED_DT && !this.outcome) {
      this.accumulator -= FIXED_DT;
      this.step();
    }
  }

  private step(): void {
    for (const car of this.cars) {
      car.stunned = Math.max(0, car.stunned - FIXED_DT);
      this.drive(car, car.controller(car, this));
    }
    const before = this.cars.map((car) => car.body.linvel());
    this.world.step();
    this.cars.forEach((car, index) => this.afterStep(car, before[index]!));
    this.timeLeft = Math.max(0, this.timeLeft - FIXED_DT);
    this.updateArrest();
    this.updateOutcome();
  }

  private maxSpeedOf(car: Car, boosting: boolean): number {
    if (boosting) return NITRO_SPEED;
    const spec = SPECS[car.kind];
    if (car.kind !== 'police') return spec.maxSpeed;
    const far = Math.hypot(car.x - this.runner.x, car.z - this.runner.z) > CATCH_UP_DISTANCE;
    return far ? CATCH_UP_SPEED : spec.maxSpeed;
  }

  private drive(car: Car, rawInput: CarInput): void {
    const spec = SPECS[car.kind];
    const input =
      car.stunned > 0 ? { throttle: 0, steer: 0, drift: false, nitro: false } : rawInput;
    const boosting = car.kind === 'runner' && input.nitro && input.throttle > 0 && this.nitro > 0;
    if (car.kind === 'runner') {
      const change = boosting ? -NITRO_DRAIN : NITRO_REFILL;
      this.nitro = clamp(this.nitro + change * FIXED_DT, 0, 1);
    }
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const v = car.body.linvel();
    let forward = v.x * fx + v.z * fz;
    const side = v.x * fz - v.z * fx;

    const accel = boosting ? NITRO_ACCEL : spec.accel;
    forward += clamp(input.throttle, -1, 1) * accel * FIXED_DT;
    if (input.throttle === 0) forward *= Math.exp(-0.8 * FIXED_DT);
    const limit = this.maxSpeedOf(car, boosting);
    // Nad limit se nezastřihuje natvrdo, po nitru auto plynule zpomalí.
    if (forward > limit) forward -= Math.min(forward - limit, 30 * FIXED_DT);
    forward = Math.max(forward, -limit * 0.45);

    const grip = input.drift ? 1.3 : 7;
    const lateral = side * Math.exp(-grip * FIXED_DT);
    car.body.setLinvel(
      { x: fx * forward + fz * lateral, y: 0, z: fz * forward - fx * lateral },
      true,
    );
    const authority = clamp(Math.abs(forward) / 7, 0, 1) * Math.sign(forward || 1);
    const turn = spec.turn * (input.drift ? 1.4 : 1);
    car.body.setAngvel({ x: 0, y: clamp(input.steer, -1, 1) * turn * authority, z: 0 }, true);
    car.drifting = input.drift && Math.abs(side) > 3;
    car.boosting = boosting;
  }

  private afterStep(car: Car, before: { x: number; z: number }): void {
    const position = car.body.translation();
    const rotation = car.body.rotation();
    const velocity = car.body.linvel();
    car.x = position.x;
    car.z = position.z;
    car.yaw = 2 * Math.atan2(rotation.y, rotation.w);
    car.speed = Math.hypot(velocity.x, velocity.z);
    const impact = Math.hypot(velocity.x - before.x, velocity.z - before.z);
    if (impact > CRASH_IMPACT) this.crashes.push({ x: car.x, z: car.z, force: impact });
    const ramming = Math.hypot(car.x - this.runner.x, car.z - this.runner.z) < RAM_DISTANCE;
    if (car.kind === 'police' && impact > STUN_IMPACT && !ramming) car.stunned = STUN_TIME;
  }

  private updateArrest(): void {
    const { runner } = this;
    const pinned =
      runner.speed < ARREST_MAX_SPEED &&
      this.cars.some(
        (car) =>
          car.kind === 'police' &&
          car.stunned === 0 &&
          Math.hypot(car.x - runner.x, car.z - runner.z) < ARREST_DISTANCE,
      );
    const change = pinned ? ARREST_FILL : -ARREST_DECAY;
    this.arrest = clamp(this.arrest + change * FIXED_DT, 0, 1);
  }

  private updateOutcome(): void {
    const toGoal = Math.hypot(this.runner.x - this.goal.x, this.runner.z - this.goal.z);
    if (toGoal < GOAL_RADIUS) this.outcome = 'escaped';
    else if (this.arrest >= 1 || this.timeLeft <= 0) this.outcome = 'caught';
  }

  takeCrashes(): CrashEvent[] {
    const crashes = this.crashes;
    this.crashes = [];
    return crashes;
  }

  free(): void {
    this.world.free();
  }
}
