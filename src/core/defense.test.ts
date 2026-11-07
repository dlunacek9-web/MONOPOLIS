import { describe, expect, it } from 'vitest';
import { BUSINESS } from './board';
import {
  DEFENSE_COLS,
  DEFENSE_LIVES,
  DEFENSE_PATH,
  DEFENSE_START_BUDGET,
  TOWERS,
  isBuildable,
  runWave,
  sectorOfCell,
} from './defense';
import { IllegalActionError, createGame, reduce } from './reducer';
import { actorOf, canManage } from './rules';
import type { GameState } from './types';

function game(mode: 'nextlevel' | 'classic' = 'nextlevel'): GameState {
  const setups = [{ name: 'A' }, { name: 'B' }];
  const s = createGame({ mode, win: { type: 'lastStanding' } }, setups, 7);
  return { ...s, active: 1, firstPlayer: 0, phase: 'awaitEnd', round: 7 };
}

/** Konec tahu posledního hráče sedmého kola: začne osmé a s ním Válka gangů. */
function war(mode: 'nextlevel' | 'classic' = 'nextlevel'): GameState {
  return reduce(game(mode), { type: 'endTurn', player: 1 });
}

/** Volné pole v dílu hráče. */
function freeCell(s: GameState, player: number): number {
  const d = s.defense!;
  const sector = d.defenders.indexOf(player);
  for (let cell = 0; ; cell++) {
    if (!isBuildable(cell) || sectorOfCell(cell, d.defenders.length) !== sector) continue;
    if (!d.towers.some((t) => t.cell === cell)) return cell;
  }
}

function skipAll(s: GameState): GameState {
  let state = s;
  while (state.phase === 'defense') {
    state = reduce(state, { type: 'defenseTimeout', player: state.defense!.defenders[0]! });
  }
  return state;
}

describe('Válka gangů: spuštění', () => {
  it('přijde na začátku každého osmého kola, ještě před prvním tahem', () => {
    const s = war();
    expect(s.round).toBe(8);
    expect(s.phase).toBe('defense');
    expect(s.defense?.defenders).toEqual([0, 1]);
    expect(s.defense?.lives).toBe(DEFENSE_LIVES);
    expect(s.defense?.budgets).toEqual([DEFENSE_START_BUDGET, DEFENSE_START_BUDGET]);
    expect(s.events.at(-1)).toMatchObject({ type: 'defenseStart', round: 8 });
  });

  it('v Klasice ani v jiném kole nepřijde', () => {
    expect(war('classic').phase).toBe('awaitRoll');
    const early = reduce({ ...game(), round: 6 }, { type: 'endTurn', player: 1 });
    expect(early.phase).toBe('awaitRoll');
  });

  it('během obrany nikdo nehraje tah ani nespravuje majetek', () => {
    const s = war();
    expect(actorOf(s)).toBeNull();
    expect(canManage(s, 0)).toBe(false);
    expect(() => reduce(s, { type: 'roll', player: 0 })).toThrow(IllegalActionError);
  });
});

describe('Válka gangů: stavba', () => {
  it('každý staví jen ve svém dílu a za svůj rozpočet', () => {
    const s = war();
    const mine = freeCell(s, 0);
    const theirs = freeCell(s, 1);
    const built = reduce(s, { type: 'defenseBuild', player: 0, cell: mine, kind: 'bouncer' });
    expect(built.defense?.towers).toEqual([{ cell: mine, kind: 'bouncer', level: 1, owner: 0 }]);
    expect(built.defense?.budgets[0]).toBe(DEFENSE_START_BUDGET - TOWERS.bouncer.cost);
    expect(() =>
      reduce(s, { type: 'defenseBuild', player: 0, cell: theirs, kind: 'bouncer' }),
    ).toThrow(IllegalActionError);
    expect(() =>
      reduce(built, { type: 'defenseBuild', player: 0, cell: mine, kind: 'sniper' }),
    ).toThrow(IllegalActionError);
  });

  it('na cestu gangu se stavět nedá', () => {
    const s = war();
    const onPath = DEFENSE_PATH.find((cell) => sectorOfCell(cell, 2) === 0)!;
    expect(() =>
      reduce(s, { type: 'defenseBuild', player: 0, cell: onPath, kind: 'bouncer' }),
    ).toThrow(IllegalActionError);
  });

  it('vylepšení stojí cenu krát úroveň a končí na třetí úrovni', () => {
    let s = war();
    const cell = freeCell(s, 0);
    s = reduce(s, { type: 'defenseBuild', player: 0, cell, kind: 'bouncer' });
    s = reduce(s, { type: 'defenseUpgrade', player: 0, cell });
    expect(s.defense?.towers[0]?.level).toBe(2);
    expect(s.defense?.budgets[0]).toBe(DEFENSE_START_BUDGET - 2 * TOWERS.bouncer.cost);
    s.defense!.budgets[0] = 1_000;
    s = reduce(s, { type: 'defenseUpgrade', player: 0, cell });
    expect(() => reduce(s, { type: 'defenseUpgrade', player: 1, cell })).toThrow(
      IllegalActionError,
    );
    expect(() => reduce(s, { type: 'defenseUpgrade', player: 0, cell })).toThrow(
      IllegalActionError,
    );
  });

  it('kdo dostavěl, už nestaví. Vlna jde, až jsou hotoví všichni', () => {
    let s = reduce(war(), { type: 'defenseReady', player: 0 });
    expect(s.defense?.wave).toBe(1);
    expect(() =>
      reduce(s, { type: 'defenseBuild', player: 0, cell: freeCell(s, 0), kind: 'bouncer' }),
    ).toThrow(IllegalActionError);
    s = reduce(s, { type: 'defenseReady', player: 1 });
    expect(s.defense?.wave).toBe(2);
    expect(s.defense?.ready).toEqual([]);
    expect(s.defense?.last?.wave).toBe(1);
  });
});

describe('Válka gangů: vlny a konec', () => {
  it('vlna dopadne pokaždé stejně', () => {
    const s = war();
    expect(runWave(s.defense!)).toEqual(runWave(s.defense!));
  });

  it('bez obrany město padne a každý zaplatí, chudák do dluhu', () => {
    const s = war();
    s.players[1]!.cash = 1_000;
    const end = skipAll(s);
    const { penalty } = BUSINESS!.defense;
    expect(end.defense).toBeNull();
    expect(end.phase).toBe('awaitRoll');
    expect(end.players[0]!.cash).toBe(s.players[0]!.cash - penalty);
    expect(end.debts).toEqual([{ player: 1, creditor: null, amount: penalty }]);
    expect(end.events.some((e) => e.type === 'defenseEnd' && !e.held)).toBe(true);
  });

  it('díly mapy jsou svislé pruhy přes celou šířku', () => {
    expect(sectorOfCell(0, 4)).toBe(0);
    expect(sectorOfCell(DEFENSE_COLS - 1, 4)).toBe(3);
    for (let sector = 0; sector < 4; sector++) {
      expect(DEFENSE_PATH.some((cell) => sectorOfCell(cell, 4) === sector)).toBe(true);
    }
  });
});
