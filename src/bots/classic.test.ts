import { describe, expect, it } from 'vitest';
import { actorOf, createGame, reduce } from '../core';
import { chooseBotAction } from './bot';

const WIN = { type: 'lastStanding' } as const;

describe('boti v režimu Klasika', () => {
  for (const count of [2, 3, 4]) {
    it(`${count} boti dohrají celou partii Klasiky`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const personalities = ['zralok', 'lakomec', 'kriminalnik', 'vyvazeny'] as const;
        let s = createGame(
          { mode: 'classic', win: WIN },
          Array.from({ length: count }, (_, i) => ({
            name: `B${i}`,
            bot: { personality: personalities[(i + seed) % 4]!, difficulty: 'normal' as const },
          })),
          seed * 77,
        );
        let actions = 0;
        while (s.phase !== 'gameOver' && actions < 60_000) {
          s = reduce(s, chooseBotAction(s, actorOf(s)!));
          actions += 1;
          if (s.players.some((p) => p.cash < 0)) throw new Error('Záporná hotovost');
        }
        expect(s.phase, `seed ${seed}`).toBe('gameOver');
        expect(s.round).toBeLessThan(1000);
      }
    });
  }
});
