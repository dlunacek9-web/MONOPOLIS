import { describe, expect, it } from 'vitest';
import { canBuild, canProposeTrade, deedOf } from './rules';
import { BUSINESS, JAIL_TILE } from './board';
import { IllegalActionError, createGame, reduce } from './reducer';
import { randomInt } from './rng';
import type { GameState } from './types';

const TILE = 3;

function game(mode: 'nextlevel' | 'classic' = 'nextlevel'): GameState {
  const s = createGame({ mode, win: { type: 'lastStanding' } }, [{ name: 'A' }, { name: 'B' }], 7);
  s.active = 0;
  s.firstPlayer = 0;
  return s;
}

/** Hráč 0 hodí ze startu 1 + 2 a dojede na pole 3, které patří hráči 1. */
function land(s: GameState): GameState {
  deedOf(s, TILE).owner = 1;
  for (let seed = 0; seed < 1_000_000; seed++) {
    const probe = { rng: seed } as GameState;
    if (randomInt(probe, 6) === 0 && randomInt(probe, 6) === 1) {
      s.rng = seed;
      return reduce(s, { type: 'roll', player: 0 });
    }
  }
  throw new Error('Hod nenalezen');
}

/** Stav s generátorem, který příště padne pod, nebo nad zadanou hranici ze 100. */
function withRoll(s: GameState, below: boolean): GameState {
  const pct = BUSINESS!.chase.autoEscapePct;
  for (let seed = 0; seed < 1_000_000; seed++) {
    const probe = { rng: seed } as GameState;
    if (randomInt(probe, 100) < pct === below) return { ...s, rng: seed };
  }
  throw new Error('Hod nenalezen');
}

describe('honička: rozhodnutí o nájmu', () => {
  it('na cizím pozemku hráč čeká na volbu a zatím neplatí', () => {
    const s = land(game());
    expect(s.phase).toBe('awaitRent');
    expect(s.pendingRent?.owner).toBe(1);
    expect(s.players[0]!.cash).toBe(game().players[0]!.cash);
  });

  it('zaplacení nájmu proběhne jako dřív', () => {
    const s = land(game());
    const amount = s.pendingRent!.amount;
    const next = reduce(s, { type: 'payRent', player: 0 });
    expect(next.phase).toBe('awaitEnd');
    expect(next.pendingRent).toBeNull();
    expect(next.players[0]!.cash).toBe(s.players[0]!.cash - amount);
    expect(next.players[1]!.cash).toBe(s.players[1]!.cash + amount);
  });

  it('po útěku se 3 kola platí hned a bez volby', () => {
    const start = game();
    start.players[0]!.nextChaseRound = start.round + 1;
    const s = land(start);
    expect(s.phase).toBe('awaitEnd');
    expect(s.events.some((e) => e.type === 'rent')).toBe(true);
    const fled = reduce(land(game()), { type: 'flee', player: 0 });
    expect(fled.players[0]!.nextChaseRound).toBe(fled.round + BUSINESS!.chase.cooldownRounds);
  });

  it('v Klasice se neujíždí', () => {
    const s = land(game('classic'));
    expect(s.phase).toBe('awaitEnd');
    expect(s.pendingRent).toBeNull();
  });

  it('během volby o nájmu nejde obchodovat', () => {
    expect(canProposeTrade(land(game()), 0)).toBe(false);
  });
});

describe('honička: výsledek', () => {
  function chasing(): GameState {
    return reduce(land(game()), { type: 'flee', player: 0 });
  }

  it('za běhu nejde spravovat majetek ani platit', () => {
    const s = chasing();
    expect(s.phase).toBe('chase');
    expect(canBuild(s, 0, 1)).toBe(false);
    expect(canProposeTrade(s, 0)).toBe(false);
    expect(() => reduce(s, { type: 'payRent', player: 0 })).toThrow(IllegalActionError);
    expect(() => reduce(s, { type: 'endTurn', player: 0 })).toThrow(IllegalActionError);
  });

  it('kdo ujede, neplatí a zůstává na svobodě', () => {
    const s = chasing();
    const next = reduce(s, { type: 'chaseResult', player: 0, escaped: true });
    expect(next.phase).toBe('awaitEnd');
    expect(next.players[0]!.cash).toBe(s.players[0]!.cash);
    expect(next.players[0]!.inJail).toBe(false);
  });

  it('koho chytí, platí dvojnásobek a jde do vazby', () => {
    const s = chasing();
    const amount = s.pendingRent!.amount;
    const next = reduce(s, { type: 'chaseResult', player: 0, escaped: false });
    expect(next.players[0]!.cash).toBe(s.players[0]!.cash - amount * 2);
    expect(next.players[1]!.cash).toBe(s.players[1]!.cash + amount * 2);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.players[0]!.position).toBe(JAIL_TILE);
  });

  it('chycený bez peněz si nese dluh a sedí', () => {
    const s = chasing();
    s.players[0]!.cash = 0;
    const next = reduce(s, { type: 'chaseResult', player: 0, escaped: false });
    expect(next.debts[0]?.amount).toBe(s.pendingRent!.amount * 2);
    expect(next.players[0]!.inJail).toBe(true);
  });

  it('nájem na ruku platí chycený v černých majiteli', () => {
    const s = chasing();
    deedOf(s, TILE).offBooks = true;
    const amount = s.pendingRent!.amount;
    const next = reduce(s, { type: 'chaseResult', player: 0, escaped: false });
    expect(next.players[1]!.dirty).toBe(Math.floor(amount * 2 * 1.5));
    expect(next.players[1]!.cash).toBe(s.players[1]!.cash);
  });

  it('přeskočení rozhodne seedovaný generátor', () => {
    const s = chasing();
    const free = reduce(withRoll(s, true), { type: 'chaseSkip', player: 0 });
    expect(free.players[0]!.inJail).toBe(false);
    const jailed = reduce(withRoll(s, false), { type: 'chaseSkip', player: 0 });
    expect(jailed.players[0]!.inJail).toBe(true);
    const again = reduce(withRoll(s, true), { type: 'chaseSkip', player: 0 });
    expect(again).toEqual(free);
  });

  it('výsledek nesmí poslat nikdo jiný než ujíždějící', () => {
    expect(() => reduce(chasing(), { type: 'chaseResult', player: 1, escaped: true })).toThrow(
      IllegalActionError,
    );
  });
});
