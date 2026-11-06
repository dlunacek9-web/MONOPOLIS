import { describe, expect, it } from 'vitest';
import { BUSINESS, HOTEL_LEVEL, JAIL_TILE } from './board';
import { canHeist, heistHotels, heistLoot } from './business';
import { IllegalActionError, createGame, reduce } from './reducer';
import { canManage } from './rules';
import { randomInt } from './rng';
import type { GameState } from './types';

function game(mode: 'nextlevel' | 'classic' = 'nextlevel'): GameState {
  const s = createGame({ mode, win: { type: 'lastStanding' } }, [{ name: 'A' }, { name: 'B' }], 7);
  s.active = 0;
  s.firstPlayer = 0;
  return s;
}

function withHotel(owner: number, tile = 39): GameState {
  const s = game();
  s.deeds[tile]!.owner = owner;
  s.deeds[tile]!.level = HOTEL_LEVEL;
  return s;
}

/** Stav s generátorem, jehož příští hod padne pod, nebo nad zadanou šanci. */
function withRoll(s: GameState, pct: number, below: boolean): GameState {
  for (let seed = 0; seed < 1_000_000; seed++) {
    const probe = { rng: seed } as GameState;
    if (randomInt(probe, 100) < pct === below) return { ...s, rng: seed };
  }
  throw new Error('Hod nenalezen');
}

function startBank(s: GameState = game()): GameState {
  return reduce(s, { type: 'heist', player: 0, target: 'bank', tile: null });
}

describe('heist: spuštění', () => {
  it('banka jde vykrást kdykoli na svobodě, během heistu nejde spravovat majetek', () => {
    const s = startBank();
    expect(s.phase).toBe('heist');
    expect(s.heist).toEqual({ target: 'bank', tile: null, resume: 'awaitRoll' });
    expect(canManage(s, 0)).toBe(false);
    expect(() => reduce(s, { type: 'roll', player: 0 })).toThrow(IllegalActionError);
  });

  it('hotel musí stát a patřit soupeři', () => {
    expect(canHeist(game(), 0, 'hotel', 39)).toBe(false);
    expect(canHeist(withHotel(0), 0, 'hotel', 39)).toBe(false);
    expect(canHeist(withHotel(1), 0, 'hotel', 39)).toBe(true);
    expect(heistHotels(withHotel(1), 0)).toEqual([39]);
    const fourHouses = withHotel(1);
    fourHouses.deeds[39]!.level = HOTEL_LEVEL - 1;
    expect(canHeist(fourHouses, 0, 'hotel', 39)).toBe(false);
  });

  it('banka nemá pole a hotel bez pole neexistuje', () => {
    expect(canHeist(game(), 0, 'bank', 39)).toBe(false);
    expect(canHeist(withHotel(1), 0, 'hotel', null)).toBe(false);
  });

  it('nejde z vazby, cizího tahu ani v dluhu', () => {
    const jailed = game();
    jailed.players[0]!.inJail = true;
    jailed.players[0]!.position = JAIL_TILE;
    expect(canHeist(jailed, 0, 'bank', null)).toBe(false);
    expect(canHeist(game(), 1, 'bank', null)).toBe(false);
    const inDebt = game();
    inDebt.debts.push({ player: 0, creditor: null, amount: 1000 });
    expect(canHeist(inDebt, 0, 'bank', null)).toBe(false);
  });

  it('další heist jde až po odstupu kol', () => {
    const s = reduce(startBank(), { type: 'heistResult', player: 0, escaped: true, bags: 0 });
    expect(canHeist(s, 0, 'bank', null)).toBe(false);
    s.round += BUSINESS!.heist.cooldownRounds;
    expect(canHeist(s, 0, 'bank', null)).toBe(true);
  });
});

describe('heist: výsledek', () => {
  it('lup roste s pytli a drží se rozsahu z GDD', () => {
    const { hotel, bank } = BUSINESS!.heist;
    expect(heistLoot('hotel', 0)).toBe(0);
    expect(heistLoot('hotel', 1)).toBe(200_000);
    expect(heistLoot('hotel', hotel.maxBags)).toBe(500_000);
    expect(heistLoot('bank', 1)).toBe(500_000);
    expect(heistLoot('bank', bank.maxBags)).toBe(1_000_000);
  });

  it('ujetý hráč má lup v černých a hra pokračuje tam, kde byla', () => {
    const before = game();
    const cash = before.players[0]!.cash;
    const s = reduce(startBank(before), { type: 'heistResult', player: 0, escaped: true, bags: 3 });
    expect(s.players[0]!.dirty).toBe(700_000);
    expect(s.players[0]!.cash).toBe(cash);
    expect(s.phase).toBe('awaitRoll');
    expect(s.heist).toBeNull();
  });

  it('heist po hodu se vrátí ke konci tahu', () => {
    const before = game();
    before.phase = 'awaitEnd';
    const s = reduce(startBank(before), { type: 'heistResult', player: 0, escaped: true, bags: 1 });
    expect(s.phase).toBe('awaitEnd');
  });

  it('kdo ujede s prázdnou, nedostane nic a nic mu nehrozí', () => {
    const s = reduce(startBank(), { type: 'heistResult', player: 0, escaped: true, bags: 0 });
    expect(s.players[0]!.dirty).toBe(0);
    expect(s.players[0]!.inJail).toBe(false);
  });

  it('chycený a odhalený platí pokutu, přijde o půlku černých a jde do vazby', () => {
    const before = game();
    before.players[0]!.dirty = 100_000;
    const cash = before.players[0]!.cash;
    const started = startBank(before);
    const { riskPct, fine } = BUSINESS!.heist.bank;
    const s = reduce(withRoll(started, riskPct, true), {
      type: 'heistResult',
      player: 0,
      escaped: false,
      bags: 4,
    });
    expect(s.players[0]!.inJail).toBe(true);
    expect(s.players[0]!.cash).toBe(cash - fine);
    expect(s.players[0]!.dirty).toBe(50_000);
    expect(s.phase).toBe('awaitEnd');
  });

  it('chycený, ale neodhalený vyvázne bez lupu a bez trestu', () => {
    const before = game();
    const cash = before.players[0]!.cash;
    const started = startBank(before);
    const { riskPct } = BUSINESS!.heist.bank;
    const s = reduce(withRoll(started, riskPct, false), {
      type: 'heistResult',
      player: 0,
      escaped: false,
      bags: 4,
    });
    expect(s.players[0]!.inJail).toBe(false);
    expect(s.players[0]!.cash).toBe(cash);
    expect(s.players[0]!.dirty).toBe(0);
  });

  it('pokuta, na kterou hráč nemá, se stává dluhem', () => {
    const before = game();
    before.players[0]!.cash = 1000;
    const started = startBank(before);
    const s = reduce(withRoll(started, BUSINESS!.heist.bank.riskPct, true), {
      type: 'heistResult',
      player: 0,
      escaped: false,
      bags: 0,
    });
    expect(s.debts.some((debt) => debt.player === 0)).toBe(true);
  });

  it('výsledek jde zapsat jen během heistu, za sebe a s rozumným počtem pytlů', () => {
    const result = { type: 'heistResult', escaped: true } as const;
    expect(() => reduce(game(), { ...result, player: 0, bags: 1 })).toThrow(IllegalActionError);
    const s = startBank();
    expect(() => reduce(s, { ...result, player: 1, bags: 1 })).toThrow(IllegalActionError);
    expect(() => reduce(s, { ...result, player: 0, bags: 99 })).toThrow(IllegalActionError);
    expect(() => reduce(s, { ...result, player: 0, bags: -1 })).toThrow(IllegalActionError);
    expect(() => reduce(s, { ...result, player: 0, bags: 1.5 })).toThrow(IllegalActionError);
  });

  it('přeskočení rozhoduje generátor a nikdy nedá plný lup', () => {
    const { autoEscapePct, maxBags, baseLoot, bagLoot } = BUSINESS!.heist.bank;
    const started = startBank();
    const won = reduce(withRoll(started, autoEscapePct, true), { type: 'heistSkip', player: 0 });
    expect(won.players[0]!.dirty).toBeGreaterThanOrEqual(baseLoot);
    expect(won.players[0]!.dirty).toBeLessThanOrEqual(baseLoot + (maxBags - 2) * bagLoot);
    const lost = reduce(withRoll(started, autoEscapePct, false), { type: 'heistSkip', player: 0 });
    expect(lost.players[0]!.dirty).toBe(0);
  });

  it('stejný stav a seed dají stejný výsledek přeskočení', () => {
    const started = startBank();
    expect(reduce(started, { type: 'heistSkip', player: 0 })).toEqual(
      reduce(started, { type: 'heistSkip', player: 0 }),
    );
  });
});

// Musí být poslední: `createGame` s Klasikou přepne sadu pravidel pro celý soubor.
describe('heist v Klasice', () => {
  it('neexistuje', () => {
    expect(() => startBank(game('classic'))).toThrow(IllegalActionError);
  });
});
