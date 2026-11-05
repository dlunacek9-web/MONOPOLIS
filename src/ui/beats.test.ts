import { describe, expect, it } from 'vitest';
import { createGame } from '../core';
import type { GameEvent, GameState } from '../core';
import { beatsFor } from './beats';

function game(mode: 'classic' | 'nextlevel' = 'nextlevel'): GameState {
  return createGame(
    { mode, win: { type: 'lastStanding' } },
    [{ name: 'A' }, { name: 'B', bot: { personality: 'vyvazeny', difficulty: 'normal' } }],
    1,
  );
}

const events = (...bodies: object[]) =>
  bodies.map((body, i) => ({ ...body, seq: i + 1000 })) as GameEvent[];

describe('scény z událostí', () => {
  it('hod a pohyb jsou dvě scény, ale jeden řádek historie', () => {
    const beats = beatsFor(
      game(),
      events({ type: 'roll', player: 0, dice: [2, 3] }, { type: 'move', player: 0, tile: 5 }),
      0,
    );
    expect(beats.map((b) => b.kind)).toEqual(['dice', 'drive']);
    expect(beats[0]!.text).toContain('2 + 3');
    expect(beats[1]!.text).toBe('');
  });

  it('úplatek bez odhalení končí razítkem a dvěma bublinami', () => {
    const [beat] = beatsFor(
      game(),
      events({ type: 'bribe', player: 0, kind: 'official', cost: 1 }),
      0,
    );
    expect(beat).toMatchObject({ kind: 'scene', character: 'clerk', prop: 'envelope' });
    expect(beat!.kind === 'scene' && beat!.lines.length).toBe(2);
    expect(beat!.kind === 'scene' && beat!.stamp?.good).toBe(true);
  });

  it('odhalený úplatek razítko nedostane, přijde až scéna odhalení', () => {
    const beats = beatsFor(
      game(),
      events(
        { type: 'bribe', player: 0, kind: 'police', cost: 1 },
        { type: 'busted', player: 0, reason: 'police', fine: 1, seized: 0 },
      ),
      0,
    );
    expect(beats[0]!.kind === 'scene' && beats[0]!.stamp).toBeNull();
    expect(beats[1]).toMatchObject({ kind: 'scene', tone: 'bust' });
  });

  it('honička bota se ukáže scénou, vlastní jen oznámením', () => {
    const body = { type: 'chaseEnd', player: 1, owner: 0, tile: 1, escaped: true };
    expect(beatsFor(game(), events(body), 0)[0]).toMatchObject({ kind: 'scene', character: 'cop' });
    expect(beatsFor(game(), events(body), 1)[0]).toMatchObject({ kind: 'toast' });
  });

  it('Klasika postavy nepoužívá', () => {
    const beats = beatsFor(
      game('classic'),
      events(
        { type: 'jail', player: 0 },
        { type: 'auctionStart', tile: 1 },
        { type: 'bankrupt', player: 0, creditor: null },
      ),
      0,
    );
    expect(beats.some((b) => b.kind === 'scene')).toBe(false);
  });

  it('každá událost dá aspoň jednu scénu, kromě žádné', () => {
    const beats = beatsFor(game(), events({ type: 'passStart', player: 0, amount: 200 }), 0);
    expect(beats[0]).toMatchObject({ kind: 'toast', amount: 200 });
  });
});
