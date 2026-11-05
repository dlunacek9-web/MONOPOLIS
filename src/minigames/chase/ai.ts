import {
  ROAD,
  distancesTo,
  nearestNode,
  nextWaypoint,
  nodePoint,
  randomFrom,
  randomNeighbor,
} from './map';
import type { ChaseMap, NodeId, Point } from './map';
import type { Car, CarController, CarInput } from './sim';

const STUCK_SPEED = 2;
const STUCK_AFTER = 0.7;
const REVERSE_FOR = 0.8;
const STEP = 1 / 60;
const ROUTE_REFRESH = 0.4;

function angleTo(car: Car, target: Point): number {
  const wanted = Math.atan2(target.x - car.x, target.z - car.z);
  return Math.atan2(Math.sin(wanted - car.yaw), Math.cos(wanted - car.yaw));
}

/** Řízení k bodu. Když auto uvízne, chvíli couvá s protočeným volantem. */
function pilot(): (car: Car, target: Point, cruise: number) => CarInput {
  let stuck = 0;
  let reversing = 0;
  return (car, target, cruise) => {
    const angle = angleTo(car, target);
    if (reversing > 0) {
      reversing -= STEP;
      return { throttle: -1, steer: -Math.sign(angle), drift: false, nitro: false };
    }
    stuck = car.speed < STUCK_SPEED ? stuck + STEP : 0;
    if (stuck > STUCK_AFTER) {
      stuck = 0;
      reversing = REVERSE_FOR;
    }
    const sharp = Math.abs(angle) > 0.7;
    const throttle = sharp && car.speed > cruise * 0.55 ? 0 : 1;
    return {
      throttle,
      steer: Math.max(-1, Math.min(1, angle * 2.8)),
      drift: sharp && car.speed > 15,
      nitro: false,
    };
  };
}

/** Každé auto dostane vlastní řidiče, který si pamatuje trasu a couvání. */
export function perCar(create: () => CarController): CarController {
  const drivers = new Map<number, CarController>();
  return (car, sim) => {
    let driver = drivers.get(car.id);
    if (!driver) {
      driver = create();
      drivers.set(car.id, driver);
    }
    return driver(car, sim);
  };
}

/** Policie jede po ulicích za hráčem a z blízka míří přímo na něj s předstihem. */
export function policeController(): CarController {
  const drive = pilot();
  let refresh = 0;
  let dist: number[] = [];
  return (car, sim) => {
    refresh -= STEP;
    const { runner, map } = sim;
    if (refresh <= 0 || dist.length === 0) {
      refresh = ROUTE_REFRESH;
      dist = distancesTo(map.blocked, nearestNode(runner.x, runner.z));
    }
    const distance = Math.hypot(runner.x - car.x, runner.z - car.z);
    const sameStreet =
      Math.abs(runner.x - car.x) < ROAD * 0.45 || Math.abs(runner.z - car.z) < ROAD * 0.45;
    if (distance < 14 || (sameStreet && distance < 34)) {
      const lead = Math.min(distance / 30, 0.6);
      const velocity = runner.body.linvel();
      const target = { x: runner.x + velocity.x * lead, z: runner.z + velocity.z * lead };
      return drive(car, target, 40);
    }
    return drive(car, nextWaypoint(map, dist, car.x, car.z), 23);
  };
}

/** AI ujíždějícího: nejkratší trasa k dálnici a nitro na rovinkách. */
export function runnerController(): CarController {
  const drive = pilot();
  let dist: number[] | null = null;
  return (car, sim) => {
    dist ??= distancesTo(sim.map.blocked, sim.map.goal);
    const target = nextWaypoint(sim.map, dist, car.x, car.z);
    const input = drive(car, target, 27);
    const straight = Math.abs(angleTo(car, target)) < 0.2;
    return { ...input, nitro: straight && car.speed > 14 };
  };
}

/** Běžný provoz bloudí po městě a do honičky se plete jen jako překážka. */
export function trafficController(map: ChaseMap, seed: number): CarController {
  const random = randomFrom(seed);
  return perCar(() => {
    const drive = pilot();
    let node: NodeId | null = null;
    return (car) => {
      node ??= randomNeighbor(map, nearestNode(car.x, car.z), random);
      let point = nodePoint(node);
      if (Math.hypot(point.x - car.x, point.z - car.z) < ROAD * 0.6) {
        node = randomNeighbor(map, node, random);
        point = nodePoint(node);
      }
      return drive(car, point, 10);
    };
  });
}

/** Řidič, který nedělá nic. V testech ověřuje, že stojícího hráče policie opravdu zatkne. */
export function idleController(): CarController {
  return () => ({ throttle: 0, steer: 0, drift: false, nitro: false });
}
