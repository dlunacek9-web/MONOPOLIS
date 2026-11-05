import type { BreakoutSim, PrisonerController, PrisonerInput } from './sim';

const LOOK_AHEAD = 2.2;
const MARGIN = 1;
const IDLE: PrisonerInput = { x: 0, z: 0, sprint: false };

function direction(sim: BreakoutSim): { x: number; z: number } {
  const goal = sim.hasKey ? sim.map.gate : sim.map.key;
  const next = sim.nav.nextStep(sim.prisoner, goal);
  const dx = next.x - sim.prisoner.x;
  const dz = next.z - sim.prisoner.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

export const idleController: PrisonerController = () => IDLE;

/** Běží nejkratší cestou a pořád sprintuje. Ukazuje, že hrr na ně se nevyplácí. */
export const recklessController: PrisonerController = (sim) => ({
  ...direction(sim),
  sprint: true,
});

/** Opatrný vězeň: počká, když je cesta před ním sledovaná, a sprintuje, jen když ho vidí. */
export const sneakyController: PrisonerController = (sim) => {
  const step = direction(sim);
  const p = sim.prisoner;
  const ahead = { x: p.x + step.x * LOOK_AHEAD, z: p.z + step.z * LOOK_AHEAD };
  if (sim.seen) return { ...step, sprint: true };
  if (sim.isWatched(ahead, MARGIN)) return IDLE;
  return { ...step, sprint: false };
};
