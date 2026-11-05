import { describe, expect, it } from 'vitest';
import { idleController, recklessController, sneakyController } from './ai';
import { HALF_X, HALF_Z, createYard } from './map';
import { YardNav } from './nav';
import { BreakoutSim, TIME_LIMIT } from './sim';
import type { PrisonerController } from './sim';

const SEEDS = Array.from({ length: 60 }, (_, index) => index * 97 + 11);

function play(seed: number, controller: PrisonerController): BreakoutSim {
  const sim = new BreakoutSim(seed, controller);
  for (let t = 0; t < TIME_LIMIT + 2 && !sim.outcome; t += 1 / 30) sim.advance(1 / 30);
  return sim;
}

function wins(controller: PrisonerController): number {
  return SEEDS.filter((seed) => play(seed, controller).outcome === 'escaped').length;
}

describe('dvůr', () => {
  it('stejný seed dá stejný dvůr', () => {
    expect(createYard(5)).toEqual(createYard(5));
  });

  it('klíč i bránu jde vždycky dojít', () => {
    for (const seed of SEEDS) {
      const map = createYard(seed);
      const nav = new YardNav(map.obstacles);
      expect(nav.distance(map.start, map.key), `seed ${seed}`).not.toBeNull();
      expect(nav.distance(map.key, map.gate), `seed ${seed}`).not.toBeNull();
    }
  });

  it('klíč a brána jsou na opačných stranách', () => {
    for (const seed of SEEDS) {
      const map = createYard(seed);
      expect(Math.sign(map.key.x)).not.toBe(Math.sign(map.gate.x));
    }
  });

  it('bachař nevidí hráče hned na startu', () => {
    for (const seed of SEEDS) {
      const sim = new BreakoutSim(seed, idleController);
      sim.advance(1 / 30);
      expect(sim.seen, `seed ${seed}`).toBe(false);
    }
  });
});

describe('útěk', () => {
  it('kdo stojí v cele, tomu vyprší čas', () => {
    const sim = play(11, idleController);
    expect(sim.outcome).toBe('caught');
  });

  it('bez klíče brána nepustí', () => {
    const sim = new BreakoutSim(11, idleController);
    sim.prisoner.x = sim.map.gate.x;
    sim.prisoner.z = sim.map.gate.z;
    sim.advance(1 / 30);
    expect(sim.outcome).not.toBe('escaped');
  });

  it('s klíčem brána pustí', () => {
    const sim = new BreakoutSim(11, idleController);
    sim.hasKey = true;
    sim.prisoner.x = sim.map.gate.x;
    sim.prisoner.z = sim.map.gate.z;
    sim.advance(1 / 30);
    expect(sim.outcome).toBe('escaped');
  });

  it('klíč se sebere dotykem', () => {
    const sim = new BreakoutSim(11, (s) => {
      const toKey = s.nav.nextStep(s.prisoner, s.map.key);
      return { x: toKey.x - s.prisoner.x, z: toKey.z - s.prisoner.z, sprint: false };
    });
    for (let t = 0; t < 20 && !sim.hasKey && !sim.outcome; t += 1 / 30) sim.advance(1 / 30);
    expect(sim.hasKey || sim.outcome === 'caught').toBe(true);
  });

  it('sprint je slyšet, bachař v okruhu jde za zvukem', () => {
    const sim = new BreakoutSim(11, () => ({ x: 1, z: 0, sprint: true }));
    const guard = sim.guards[0]!;
    guard.x = sim.prisoner.x + 8;
    guard.z = sim.prisoner.z;
    guard.yaw = Math.PI / 2 + Math.PI;
    sim.advance(1 / 30);
    expect(guard.mode).not.toBe('patrol');
  });

  it('překážka zakrývá výhled', () => {
    const sim = new BreakoutSim(11, idleController);
    const wall = sim.map.obstacles[0]!;
    const guard = sim.guards[0]!;
    guard.x = wall.x - wall.hx - 2;
    guard.z = wall.z;
    guard.yaw = Math.PI / 2;
    expect(sim.canSee(guard, { x: wall.x + wall.hx + 2, z: wall.z })).toBe(false);
  });

  it('dotyk bachaře útěk ukončí', () => {
    const sim = new BreakoutSim(11, idleController);
    const guard = sim.guards[0]!;
    guard.x = sim.prisoner.x + 0.5;
    guard.z = sim.prisoner.z;
    sim.advance(1 / 30);
    expect(sim.outcome).toBe('caught');
  });

  it('hráč neprojde překážkou ani zdí', () => {
    const sim = new BreakoutSim(11, () => ({ x: 1, z: -1, sprint: true }));
    for (let t = 0; t < 12 && !sim.outcome; t += 1 / 30) {
      sim.advance(1 / 30);
      const p = sim.prisoner;
      expect(Math.abs(p.x)).toBeLessThanOrEqual(HALF_X);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(HALF_Z);
      for (const o of sim.map.obstacles) {
        expect(Math.abs(p.x - o.x) < o.hx && Math.abs(p.z - o.z) < o.hz).toBe(false);
      }
    }
  });
});

describe('vyvážení', () => {
  it('opatrný vězeň utíká často, ale ne pokaždé', () => {
    const won = wins(sneakyController);
    expect(won).toBeGreaterThanOrEqual(SEEDS.length * 0.3);
    expect(won).toBeLessThan(SEEDS.length);
  });

  it('hrr na ně se vyplácí méně než opatrnost', () => {
    const reckless = wins(recklessController);
    expect(reckless).toBeLessThan(wins(sneakyController));
  });
});
