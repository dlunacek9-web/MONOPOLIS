import { describe, expect, it } from 'vitest';
import { BUSINESS, createGame, reduce } from '../core';
import type { Difficulty, GameState } from '../core';
import { chooseDefenseAction } from './defense';

/** Partie samých botů těsně před osmým kolem, kdy přijde Válka gangů. */
function war(players: number, difficulty: Difficulty): GameState {
  const setups = Array.from({ length: players }, (_, i) => ({
    name: `Bot ${i}`,
    bot: { personality: 'vyvazeny' as const, difficulty },
  }));
  const s = createGame({ mode: 'nextlevel', win: { type: 'lastStanding' } }, setups, 3);
  const last = players - 1;
  return reduce(
    { ...s, round: 7, active: last, firstPlayer: 0, phase: 'awaitEnd' },
    { type: 'endTurn', player: last },
  );
}

function playOut(start: GameState): GameState {
  let s = start;
  for (let guard = 0; s.phase === 'defense' && guard < 3_000; guard++) {
    const d = s.defense!;
    const me = d.defenders.find((id) => !d.ready.includes(id))!;
    s = reduce(s, chooseDefenseAction(s, me));
  }
  return s;
}

describe('boti ve Válce gangů', () => {
  for (const players of [2, 3, 4]) {
    it(`${players} boti město ubrání a dostanou odměnu`, () => {
      const start = war(players, 'normal');
      const end = playOut(start);
      expect(end.phase).toBe('awaitRoll');
      expect(end.events.some((e) => e.type === 'defenseEnd' && e.held)).toBe(true);
      const reward = BUSINESS!.defense.reward;
      expect(end.players.map((p) => p.cash)).toEqual(start.players.map((p) => p.cash + reward));
    });
  }

  it('staví jen tam, kde smí, a nakonec vždy dostaví', () => {
    const s = war(3, 'easy');
    const action = chooseDefenseAction(s, 1);
    expect(action.type).toBe('defenseBuild');
    expect(() => reduce(s, action)).not.toThrow();
  });
});
