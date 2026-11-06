import { VAULT_X } from './map';
import type { HeistSim, ThiefController, ThiefInput } from './sim';

const DODGE_RANGE = 6;
const IDLE: ThiefInput = { x: 0, z: 0, sprint: false, action: false, drop: false };

function toward(sim: HeistSim, goal: { x: number; z: number }): { x: number; z: number } {
  const next = sim.nav.nextStep(sim.thief, goal);
  const dx = next.x - sim.thief.x;
  const dz = next.z - sim.thief.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** Směr k cíli s odklonem od blízkých policistů, tak jak by uhýbal člověk. */
function dodging(sim: HeistSim, goal: { x: number; z: number }): { x: number; z: number } {
  const way = toward(sim, goal);
  let x = way.x;
  let z = way.z;
  for (const cop of sim.cops) {
    const dx = sim.thief.x - cop.x;
    const dz = sim.thief.z - cop.z;
    const far = Math.hypot(dx, dz) || 1;
    if (far > DODGE_RANGE) continue;
    const force = (DODGE_RANGE - far) / far;
    x += (dx / far) * force + (-dz / far) * force;
    z += (dz / far) * force + (dx / far) * force;
  }
  return { x, z };
}

export const idleController: ThiefController = () => IDLE;

/**
 * Testovací lupič: jde k trezoru, nabere `want` pytlů a běží k dodávce.
 * S `officesFirst` vybere kanceláře ještě před poplachem, kdy tam nikdo není.
 */
export function greedyController(want: number, officesFirst = false): ThiefController {
  let pressedLast = false;
  const tap = (ready: boolean): boolean => {
    pressedLast = ready && !pressedLast;
    return pressedLast;
  };
  return (sim) => {
    if (sim.dial) return { ...IDLE, action: tap(sim.needleInArc) };
    if (!sim.vaultOpen) {
      const office = sim.bags.find((bag) => !bag.carried && Math.abs(bag.x) > VAULT_X);
      if (officesFirst && office) {
        if (sim.bagInReach) return { ...IDLE, action: tap(true) };
        return { ...IDLE, ...toward(sim, office) };
      }
      if (sim.atVault) return { ...IDLE, action: tap(true) };
      return { ...IDLE, ...toward(sim, sim.map.vaultSpot) };
    }
    if (sim.carried < want) {
      if (sim.bagInReach) return { ...IDLE, action: tap(true) };
      const free = sim.bags.filter((bag) => !bag.carried);
      const nearest = free
        .map((bag) => ({ bag, far: sim.nav.distance(sim.thief, bag) ?? Infinity }))
        .sort((a, b) => a.far - b.far)[0];
      if (nearest) return { ...IDLE, ...dodging(sim, nearest.bag), sprint: sim.stamina > 0.6 };
    }
    return { ...IDLE, ...dodging(sim, sim.map.van), sprint: true };
  };
}
