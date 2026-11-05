import { describe, expect, it } from 'vitest';
import { canBreakout } from './business';
import { BUSINESS, JAIL_TILE, MAX_JAIL_ATTEMPTS } from './board';
import { IllegalActionError, createGame, reduce } from './reducer';
import { canManage } from './rules';
import { randomInt } from './rng';
import type { GameState } from './types';

function jailed(mode: 'nextlevel' | 'classic' = 'nextlevel'): GameState {
  const s = createGame({ mode, win: { type: 'lastStanding' } }, [{ name: 'A' }, { name: 'B' }], 7);
  s.active = 0;
  s.firstPlayer = 0;
  const p = s.players[0]!;
  p.inJail = true;
  p.position = JAIL_TILE;
  return s;
}

/** Stav s generátorem, který příště padne pod, nebo nad šanci na útěk. */
function withRoll(s: GameState, below: boolean): GameState {
  const pct = BUSINESS!.breakout.autoEscapePct;
  for (let seed = 0; seed < 1_000_000; seed++) {
    const probe = { rng: seed } as GameState;
    if (randomInt(probe, 100) < pct === below) return { ...s, rng: seed };
  }
  throw new Error('Hod nenalezen');
}

describe('útěk z vězení', () => {
  it('jde zkusit jen ve vazbě a před hodem', () => {
    const s = jailed();
    expect(canBreakout(s, 0)).toBe(true);
    expect(canBreakout(s, 1)).toBe(false);
    const free = jailed();
    free.players[0]!.inJail = false;
    expect(() => reduce(free, { type: 'breakout', player: 0 })).toThrow(IllegalActionError);
  });

  it('úspěch pustí hráče zdarma a ten hned hází', () => {
    const before = jailed();
    const cash = before.players[0]!.cash;
    let s = reduce(before, { type: 'breakout', player: 0 });
    expect(s.phase).toBe('breakout');
    s = reduce(s, { type: 'breakoutResult', player: 0, escaped: true });
    expect(s.phase).toBe('awaitRoll');
    expect(s.players[0]!.inJail).toBe(false);
    expect(s.players[0]!.cash).toBe(cash);
  });

  it('nezdar stojí pokutu, hráč sedí dál a tah končí', () => {
    const before = jailed();
    const cash = before.players[0]!.cash;
    let s = reduce(before, { type: 'breakout', player: 0 });
    s = reduce(s, { type: 'breakoutResult', player: 0, escaped: false });
    expect(s.phase).toBe('awaitEnd');
    expect(s.players[0]!.inJail).toBe(true);
    expect(s.players[0]!.jailTurns).toBe(1);
    expect(s.players[0]!.cash).toBe(cash - BUSINESS!.breakout.fine);
  });

  it('nezdar nikdy nepřekročí poslední pokus, ten řeší až hod', () => {
    const before = jailed();
    before.players[0]!.jailTurns = MAX_JAIL_ATTEMPTS - 1;
    let s = reduce(before, { type: 'breakout', player: 0 });
    s = reduce(s, { type: 'breakoutResult', player: 0, escaped: false });
    expect(s.players[0]!.jailTurns).toBe(MAX_JAIL_ATTEMPTS - 1);
    expect(s.players[0]!.inJail).toBe(true);
  });

  it('pokuta, na kterou hráč nemá, se stává dluhem', () => {
    const before = jailed();
    before.players[0]!.cash = 1000;
    let s = reduce(before, { type: 'breakout', player: 0 });
    s = reduce(s, { type: 'breakoutResult', player: 0, escaped: false });
    expect(s.debts.some((debt) => debt.player === 0)).toBe(true);
  });

  it('přeskočení rozhoduje seedovaný generátor', () => {
    const started = reduce(jailed(), { type: 'breakout', player: 0 });
    const won = reduce(withRoll(started, true), { type: 'breakoutSkip', player: 0 });
    const lost = reduce(withRoll(started, false), { type: 'breakoutSkip', player: 0 });
    expect(won.players[0]!.inJail).toBe(false);
    expect(lost.players[0]!.inJail).toBe(true);
  });

  it('během útěku nejde hodit ani spravovat majetek', () => {
    const s = reduce(jailed(), { type: 'breakout', player: 0 });
    expect(canManage(s, 0)).toBe(false);
    expect(() => reduce(s, { type: 'roll', player: 0 })).toThrow(IllegalActionError);
  });

  it('výsledek jde zapsat jen během útěku a jen za sebe', () => {
    const s = jailed();
    expect(() => reduce(s, { type: 'breakoutResult', player: 0, escaped: true })).toThrow(
      IllegalActionError,
    );
    const started = reduce(s, { type: 'breakout', player: 0 });
    expect(() => reduce(started, { type: 'breakoutResult', player: 1, escaped: true })).toThrow(
      IllegalActionError,
    );
  });

  it('v režimu Klasika útěk neexistuje', () => {
    const s = jailed('classic');
    expect(canBreakout(s, 0)).toBe(false);
    expect(() => reduce(s, { type: 'breakout', player: 0 })).toThrow(IllegalActionError);
  });
});
