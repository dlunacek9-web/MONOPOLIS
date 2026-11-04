import { describe, expect, it } from 'vitest';
import { actorOf, createGame, deedOf, reduce } from '../core';
import type { Difficulty, GameState, Personality, PlayerSetup, WinCondition } from '../core';
import { LocalTransport } from '../net/local';
import { acceptsTrade, chooseBotAction } from './bot';

/** Hlídá, že se boti nedostanou do patu, kdy peníze jen rostou a nikdo nekrachuje. */
const MAX_ROUNDS = 1000;
const PERSONALITIES: Personality[] = ['zralok', 'lakomec', 'kriminalnik', 'vyvazeny'];

function setups(count: number, seed: number, difficulty: Difficulty): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Bot${i}`,
    bot: { personality: PERSONALITIES[(i + seed) % 4]!, difficulty },
  }));
}

function playOut(state: GameState, maxActions = 60_000): { state: GameState; actions: number } {
  let s = state;
  let actions = 0;
  while (s.phase !== 'gameOver' && actions < maxActions) {
    s = reduce(s, chooseBotAction(s, actorOf(s)!));
    actions += 1;
    const cashOk = s.players.every((p) => p.cash >= 0);
    if (!cashOk) throw new Error('Záporná hotovost');
    if (s.housesLeft < 0 || s.hotelsLeft < 0) throw new Error('Záporná zásoba budov');
  }
  return { state: s, actions };
}

describe('celé partie botů', () => {
  const lastStanding: WinCondition = { type: 'lastStanding' };
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (const count of [2, 3, 4]) {
      it(`${count} boti, ${difficulty}: partie dojde do konce jen s legálními akcemi`, () => {
        for (let seed = 1; seed <= 25; seed++) {
          const game = createGame(
            { mode: 'classic', win: lastStanding },
            setups(count, seed, difficulty),
            seed * 1000 + count,
          );
          const { state } = playOut(game);
          expect(state.phase, `seed ${seed}`).toBe('gameOver');
          expect(state.round, `seed ${seed}`).toBeLessThan(MAX_ROUNDS);
          expect(state.winner).not.toBeNull();
          expect(state.players.filter((p) => !p.bankrupt)).toHaveLength(1);
        }
      });
    }
  }
  it('ostatní podmínky výhry také končí', () => {
    const rounds = playOut(
      createGame(
        { mode: 'classic', win: { type: 'richestAfterRounds', rounds: 15 } },
        setups(3, 1, 'normal'),
        5,
      ),
    );
    expect(rounds.state.phase).toBe('gameOver');
    expect(rounds.state.round).toBe(16);
    const money = playOut(
      createGame(
        { mode: 'classic', win: { type: 'firstToMoney', amount: 3_000_000 } },
        setups(4, 2, 'hard'),
        6,
      ),
    );
    expect(money.state.phase).toBe('gameOver');
  });
  it('stejný seed dá stejnou partii', () => {
    const make = () =>
      createGame({ mode: 'classic', win: lastStanding }, setups(3, 2, 'normal'), 99);
    expect(playOut(make()).state).toEqual(playOut(make()).state);
  });
});

describe('rozhodnutí botů', () => {
  const none = { tiles: [], cash: 0, jailCards: 0 };
  function duel(): GameState {
    const s = createGame(
      { mode: 'classic', win: { type: 'lastStanding' } },
      setups(2, 3, 'normal'),
      1,
    );
    return s;
  }
  it('nedá soupeři poslední kus města za hubičku', () => {
    const s = duel();
    deedOf(s, 1).owner = 0;
    deedOf(s, 3).owner = 1;
    const cheap = { from: 0, to: 1, give: { ...none, cash: 90_000 }, get: { ...none, tiles: [3] } };
    expect(acceptsTrade(s, 1, cheap)).toBe(false);
    const rich = { ...cheap, give: { ...none, cash: 600_000 } };
    expect(acceptsTrade(s, 1, rich)).toBe(true);
  });
  it('s dluhem zastavuje a bez možností krachuje', () => {
    const s = duel();
    s.debts = [{ player: s.active, creditor: null, amount: 5_000 }];
    s.players[s.active]!.cash = 0;
    expect(chooseBotAction(s, s.active).type).toBe('declareBankruptcy');
    deedOf(s, 39).owner = s.active;
    expect(chooseBotAction(s, s.active)).toEqual({ type: 'mortgage', player: s.active, tile: 39 });
    s.players[s.active]!.cash = 5_000;
    expect(chooseBotAction(s, s.active).type).toBe('settleDebt');
  });
});

describe('LocalTransport', () => {
  it('pošle nový stav odběratelům a neplatnou akci odmítne', () => {
    const game = createGame(
      { mode: 'classic', win: { type: 'lastStanding' } },
      setups(2, 0, 'easy'),
      3,
    );
    const transport = new LocalTransport(game);
    let updates = 0;
    const off = transport.subscribe(() => (updates += 1));
    const other = game.active === 0 ? 1 : 0;
    expect(transport.dispatch({ type: 'roll', player: other }).ok).toBe(false);
    expect(updates).toBe(0);
    expect(transport.dispatch({ type: 'roll', player: game.active }).ok).toBe(true);
    expect(updates).toBe(1);
    off();
    transport.dispatch(chooseBotAction(transport.getState(), actorOf(transport.getState())!));
    expect(updates).toBe(1);
  });
});
