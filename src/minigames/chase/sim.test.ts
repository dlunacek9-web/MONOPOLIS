import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  idleController,
  perCar,
  policeController,
  runnerController,
  trafficController,
} from './ai';
import { createMap, distancesTo } from './map';
import { ChaseSim, TIME_LIMIT } from './sim';
import type { CarController } from './sim';

beforeAll(async () => {
  await RAPIER.init();
});

function play(seed: number, runner: CarController): ChaseSim {
  const map = createMap(seed);
  const sim = new ChaseSim({
    rapier: RAPIER,
    seed,
    runner,
    police: perCar(policeController),
    traffic: trafficController(map, seed),
  });
  for (let i = 0; i < (TIME_LIMIT + 2) * 60 && !sim.outcome; i++) sim.advance(1 / 60);
  return sim;
}

describe('mapa honičky', () => {
  it('stejný seed dá stejné město a z každé křižovatky se dá dojet k dálnici', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const map = createMap(seed);
      expect([...map.blocked]).toEqual([...createMap(seed).blocked]);
      expect(map.barricades.length).toBeGreaterThan(0);
      expect(distancesTo(map.blocked, map.goal)).not.toContain(Infinity);
    }
  });
});

describe('simulace honičky', () => {
  it('kdo stojí, toho policie zatkne dřív, než vyprší čas', () => {
    const sim = play(3, idleController());
    expect(sim.outcome).toBe('caught');
    expect(sim.arrest).toBe(1);
    // Policie musí stihnout dojet a zastavit, ale ne to, aby zatčení trvalo celou honičku.
    expect(sim.timeLeft).toBeGreaterThan(20);
    sim.free();
  });

  it('honička je vyrovnaná: AI řidič někdy ujede a někdy ho chytí', () => {
    const results: string[] = [];
    for (let seed = 1; seed <= 24; seed++) {
      const sim = play(seed, runnerController());
      results.push(sim.outcome ?? 'none');
      sim.free();
    }
    const escaped = results.filter((result) => result === 'escaped').length;
    expect(results).not.toContain('none');
    expect(escaped).toBeGreaterThanOrEqual(6);
    expect(escaped).toBeLessThanOrEqual(21);
  });

  it('stejný seed a stejné řízení dají stejný výsledek', () => {
    const a = play(5, runnerController());
    const b = play(5, runnerController());
    expect(a.outcome).toBe(b.outcome);
    expect(a.timeLeft).toBeCloseTo(b.timeLeft, 5);
    a.free();
    b.free();
  });
});
