import { describe, expect, it } from 'vitest';
import {
  BOARD,
  CARDS,
  JAIL_BAIL,
  START_CASH,
  START_SALARY,
  createGame,
  currentMode,
  deedOf,
  groupTiles,
  mortgageValue,
  rentOf,
  unmortgageCost,
} from './index';
import type { GameState, PlayerSetup, Tile } from './index';

const WIN = { type: 'lastStanding' } as const;

function classic(players = 2): GameState {
  const setups: PlayerSetup[] = Array.from({ length: players }, (_, i) => ({ name: `H${i}` }));
  return createGame({ mode: 'classic', win: WIN }, setups, 42);
}

function property(tile: number): Extract<Tile, { kind: 'property' }> {
  const t = BOARD[tile];
  if (t?.kind !== 'property') throw new Error('Není pozemek');
  return t;
}

describe('režim Klasika', () => {
  it('používá čísla originální hry', () => {
    const s = classic();
    expect(currentMode()).toBe('classic');
    expect(START_CASH).toBe(1500);
    expect(START_SALARY).toBe(200);
    expect(JAIL_BAIL).toBe(50);
    expect(s.players.every((p) => p.cash === 1500)).toBe(true);
    expect(s.housesLeft).toBe(32);
    expect(s.hotelsLeft).toBe(12);
  });

  it('deska má 28 vlastnitelných polí a skupiny 2+3+3+3+3+3+3+2', () => {
    classic();
    expect(BOARD).toHaveLength(40);
    const kinds = (kind: Tile['kind']) => BOARD.filter((t) => t.kind === kind).length;
    expect(kinds('property')).toBe(22);
    expect(kinds('station')).toBe(4);
    expect(kinds('utility')).toBe(2);
    expect(kinds('card')).toBe(6);
    const sizes = (
      ['most', 'ostrava', 'usti', 'olomouc', 'plzen', 'brno', 'vary', 'praha'] as const
    ).map((g) => groupTiles(g).length);
    expect(sizes).toEqual([2, 3, 3, 3, 3, 3, 3, 2]);
  });

  it('součet cen pozemků sedí na originál (4 590 + 800 + 300)', () => {
    classic();
    const sum = BOARD.reduce(
      (total, t) =>
        total +
        (t.kind === 'property' || t.kind === 'station' || t.kind === 'utility' ? t.price : 0),
      0,
    );
    expect(sum).toBe(4590 + 800 + 300);
  });

  it('balíčky mají po 16 kartách a po jedné propustce', () => {
    classic();
    for (const deck of ['tip', 'urad'] as const) {
      expect(CARDS[deck]).toHaveLength(16);
      expect(CARDS[deck].filter((c) => c.kind === 'jailCard')).toHaveLength(1);
    }
  });

  it('nájmy: Promenáda s hotelem 2 000, celá hnědá bez domů dvojnásobek', () => {
    const s = classic();
    deedOf(s, 39).owner = 0;
    deedOf(s, 39).level = 5;
    expect(property(39).rents[5]).toBe(2000);
    expect(rentOf(s, 39, 7)).toBe(2000);
    deedOf(s, 1).owner = 1;
    expect(rentOf(s, 1, 7)).toBe(2);
    deedOf(s, 3).owner = 1;
    expect(rentOf(s, 1, 7)).toBe(4);
  });

  it('nádraží 25/50/100/200 a podniky 4× a 10× hod', () => {
    const s = classic();
    for (const [i, id] of [5, 15, 25, 35].entries()) {
      deedOf(s, id).owner = 0;
      expect(rentOf(s, 5, 7)).toBe([25, 50, 100, 200][i]);
    }
    deedOf(s, 12).owner = 0;
    expect(rentOf(s, 12, 7)).toBe(28);
    deedOf(s, 28).owner = 0;
    expect(rentOf(s, 12, 7)).toBe(70);
  });

  it('hypotéka: zástava půl ceny, splacení +10 % (Středomořská 30 → 33)', () => {
    classic();
    expect(mortgageValue(1)).toBe(30);
    expect(unmortgageCost(1)).toBe(33);
    expect(unmortgageCost(39)).toBe(220);
  });

  it('po přepnutí zpět na Next level platí jeho čísla', () => {
    classic();
    const n = createGame({ mode: 'nextlevel', win: WIN }, [{ name: 'A' }, { name: 'B' }], 1);
    expect(currentMode()).toBe('nextlevel');
    expect(n.players[0]!.cash).toBe(1_500_000);
    expect(property(39).price).toBe(420_000);
  });
});
