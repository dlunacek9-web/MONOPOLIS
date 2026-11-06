import { describe, expect, it } from 'vitest';
import type { HeistTarget } from '../../core';
import { YardNav } from '../breakout/nav';
import { greedyController, idleController } from './ai';
import { HALF_X, HALF_Z, createHeistMap } from './map';
import { ALARM_TIME, BAG_SLOWDOWN, CLEAN_TIME, HeistSim } from './sim';
import type { ThiefController, ThiefInput } from './sim';

const SEEDS = Array.from({ length: 60 }, (_, index) => index * 97 + 11);
const BOUNDS = { halfX: HALF_X, halfZ: HALF_Z };
const IDLE: ThiefInput = { x: 0, z: 0, sprint: false, action: false, drop: false };

function play(target: HeistTarget, seed: number, controller: ThiefController): HeistSim {
  const sim = new HeistSim(target, seed, controller);
  const limit = CLEAN_TIME + ALARM_TIME[target] + 2;
  for (let t = 0; t < limit && !sim.outcome; t += 1 / 30) sim.advance(1 / 30);
  return sim;
}

function wins(target: HeistTarget, want: number, officesFirst = false): number {
  const controller = () => greedyController(want, officesFirst);
  return SEEDS.filter((seed) => play(target, seed, controller()).outcome?.escaped).length;
}

/** Simulace s otevřeným trezorem a hráčem u pytlů, řízená jedinou proměnnou. */
function opened(input: () => ThiefInput): HeistSim {
  const sim = new HeistSim('bank', 11, input);
  sim.vaultOpen = true;
  sim.opened = sim.map.tumblers;
  sim.alarm = true;
  sim.timeLeft = ALARM_TIME.bank;
  const bag = sim.bags[0]!;
  sim.thief.x = bag.x;
  sim.thief.z = bag.z + 1;
  return sim;
}

describe('budova', () => {
  it('stejný seed dá stejnou budovu', () => {
    expect(createHeistMap('bank', 5)).toEqual(createHeistMap('bank', 5));
  });

  it('počet pytlů odpovídá pravidlům', () => {
    expect(createHeistMap('bank', 5).bags).toHaveLength(6);
    expect(createHeistMap('hotel', 5).bags).toHaveLength(4);
  });

  it('trezor, všechny pytle i dodávka jdou vždycky dojít', () => {
    for (const target of ['bank', 'hotel'] as const) {
      for (const seed of SEEDS) {
        const map = createHeistMap(target, seed);
        const closed = new YardNav([...map.obstacles, map.door], BOUNDS);
        const open = new YardNav(map.obstacles, BOUNDS);
        expect(closed.distance(map.start, map.vaultSpot), `seed ${seed}`).not.toBeNull();
        for (const bag of map.bags) {
          expect(open.distance(map.vaultSpot, bag), `seed ${seed}`).not.toBeNull();
        }
        expect(open.distance(map.vaultSpot, map.van), `seed ${seed}`).not.toBeNull();
      }
    }
  });

  it('kamera nevidí hráče na startu, je za zdí', () => {
    for (const seed of SEEDS) {
      const sim = new HeistSim('bank', seed, idleController);
      sim.advance(1 / 30);
      expect(sim.seen, `seed ${seed}`).toBe(false);
    }
  });
});

describe('dostat se dovnitř', () => {
  it('bez poplachu dodávka neodjíždí', () => {
    const sim = new HeistSim('bank', 11, idleController);
    sim.thief.x = sim.map.van.x + 4;
    sim.thief.z = sim.map.van.z;
    sim.advance(1 / 30);
    expect(sim.outcome).toBeNull();
  });

  it('dlouhý pohled kamery spustí poplach, ale nic dalšího', () => {
    const sim = new HeistSim('bank', 11, idleController);
    const camera = sim.cameras[0]!;
    sim.suspicion = 0.99;
    sim.thief.x = camera.x + Math.sin(camera.yaw) * 3;
    sim.thief.z = camera.z + Math.cos(camera.yaw) * 3;
    sim.advance(1 / 30);
    expect(sim.alarm).toBe(true);
    expect(sim.outcome).toBeNull();
  });

  it('zeď zakrývá výhled kamery', () => {
    const sim = new HeistSim('bank', 11, idleController);
    const camera = { x: 0, z: 9, yaw: Math.PI };
    expect(sim.cameraSees(camera, { x: 0, z: 13 })).toBe(false);
  });

  it('kdo jen stojí, toho po čase prozradí střídání ostrahy a pak zavřou ulici', () => {
    const sim = play('bank', 11, idleController);
    expect(sim.alarm).toBe(true);
    expect(sim.outcome?.escaped).toBe(false);
  });
});

describe('trezor', () => {
  it('je zavřený, dokud se neotevřou všechny zámky, a otevření spustí poplach', () => {
    const sim = new HeistSim('bank', 11, greedyController(0));
    for (let t = 0; t < 60 && !sim.vaultOpen; t += 1 / 30) sim.advance(1 / 30);
    expect(sim.vaultOpen).toBe(true);
    expect(sim.opened).toBe(sim.map.tumblers);
    expect(sim.alarm).toBe(true);
  });

  it('zavřenými dveřmi se neprojde', () => {
    const sim = new HeistSim('bank', 11, () => ({ ...IDLE, z: -1, sprint: true }));
    sim.thief.x = 0;
    sim.thief.z = sim.map.door.z + 2;
    for (let t = 0; t < 2; t += 1 / 30) sim.advance(1 / 30);
    expect(sim.thief.z).toBeGreaterThan(sim.map.door.z);
  });

  it('stisk mimo zelenou zvedne podezření a nic neotevře', () => {
    let press = false;
    const sim = new HeistSim('bank', 11, () => ({ ...IDLE, action: press }));
    sim.thief.x = sim.map.vaultSpot.x;
    sim.thief.z = sim.map.vaultSpot.z;
    press = true;
    sim.advance(1 / 30);
    expect(sim.dial).not.toBeNull();
    press = false;
    sim.advance(1 / 30);
    // Ručička vyráží naproti zelené, takže další stisk je jistě vedle.
    const before = sim.suspicion;
    press = true;
    sim.advance(1 / 30);
    expect(sim.opened).toBe(0);
    expect(sim.suspicion).toBeGreaterThan(before);
  });

  it('pohyb od zámku práci přeruší', () => {
    let x = 0;
    const sim = new HeistSim('bank', 11, () => ({ ...IDLE, x, action: x === 0 }));
    sim.thief.x = sim.map.vaultSpot.x;
    sim.thief.z = sim.map.vaultSpot.z;
    sim.advance(1 / 30);
    expect(sim.dial).not.toBeNull();
    x = 1;
    sim.advance(1 / 30);
    expect(sim.dial).toBeNull();
  });
});

describe('útěk s lupem', () => {
  it('každý pytel zpomalí', () => {
    let press = true;
    const sim = opened(() => ({ ...IDLE, action: press }));
    expect(sim.load).toBe(1);
    sim.advance(1 / 30);
    press = false;
    expect(sim.carried).toBe(1);
    expect(sim.load).toBeCloseTo(1 - BAG_SLOWDOWN);
  });

  it('odhozený pytel zrychlí a jde znovu sebrat', () => {
    let action = true;
    let drop = false;
    const sim = opened(() => ({ ...IDLE, action, drop }));
    sim.advance(1 / 30);
    action = false;
    drop = true;
    sim.advance(1 / 30);
    expect(sim.carried).toBe(0);
    expect(sim.load).toBe(1);
    drop = false;
    // Nakládání chvíli trvá, teprve pak jde sebrat další.
    for (let t = 0; t < 0.5; t += 1 / 30) sim.advance(1 / 30);
    action = true;
    sim.advance(1 / 30);
    expect(sim.carried).toBe(1);
  });

  it('dodávka odveze hráče s tím, co donesl', () => {
    const sim = opened(() => IDLE);
    sim.carried = 2;
    sim.thief.x = sim.map.van.x + 4;
    sim.thief.z = sim.map.van.z;
    sim.advance(1 / 30);
    expect(sim.outcome).toEqual({ escaped: true, bags: 2 });
  });

  it('dotyk policisty znamená konec a lup je pryč', () => {
    const sim = opened(() => IDLE);
    sim.carried = 3;
    sim.cops.push({ x: sim.thief.x + 0.5, z: sim.thief.z, yaw: 0, speed: 0 });
    sim.advance(1 / 30);
    expect(sim.outcome).toEqual({ escaped: false, bags: 0 });
  });

  it('hráč neprojde překážkou ani zdí', () => {
    const sim = new HeistSim('bank', 11, () => ({ ...IDLE, x: 1, z: -1, sprint: true }));
    for (let t = 0; t < 12 && !sim.outcome; t += 1 / 30) {
      sim.advance(1 / 30);
      for (const o of sim.obstacles) {
        const inside = Math.abs(sim.thief.x - o.x) < o.hx && Math.abs(sim.thief.z - o.z) < o.hz;
        expect(inside).toBe(false);
      }
    }
  });

  it('stejný seed a ovládání dají stejný výsledek', () => {
    const first = play('bank', 11, greedyController(3));
    const second = play('bank', 11, greedyController(3));
    expect(first.outcome).toEqual(second.outcome);
    expect(first.timeLeft).toBe(second.timeLeft);
  });
});

describe('vyvážení', () => {
  for (const target of ['bank', 'hotel'] as const) {
    it(`${target}: rozumná chamtivost vyjde často`, () => {
      expect(wins(target, 2)).toBeGreaterThanOrEqual(SEEDS.length * 0.5);
    });

    it(`${target}: plný lup je výrazně těžší, ale s plánem jde`, () => {
      const all = createHeistMap(target, 1).bags.length;
      expect(wins(target, all)).toBeLessThan(wins(target, 2));
      expect(wins(target, all, true)).toBeGreaterThan(0);
    });
  }
});
