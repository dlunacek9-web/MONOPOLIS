import { describe, expect, it } from 'vitest';
import { actorOf, createGame, deedOf, reduce } from '../core';
import type { Difficulty, GameState, Personality, PlayerSetup, WinCondition } from '../core';
import { LocalTransport } from '../net/local';
import type { Action } from '../core';
import { acceptsTrade, chooseBotAction, tileValue } from './bot';
import { chooseDefenseAction } from './defense';

/** Hlídá, že se boti nedostanou do patu, kdy peníze jen rostou a nikdo nekrachuje. */
const MAX_ROUNDS = 1000;
const PERSONALITIES: Personality[] = ['zralok', 'lakomec', 'kriminalnik', 'vyvazeny'];

function setups(count: number, seed: number, difficulty: Difficulty): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Bot${i}`,
    bot: { personality: PERSONALITIES[(i + seed) % 4]!, difficulty },
  }));
}

/** Další tah botů. Ve Válce gangů staví ten, kdo ještě nedostavěl. */
function botStep(s: GameState): Action {
  const d = s.defense;
  if (!d) return chooseBotAction(s, actorOf(s)!);
  return chooseDefenseAction(
    s,
    d.defenders.find((id) => !d.ready.includes(id))!,
  );
}

function playOut(state: GameState, maxActions = 60_000): { state: GameState; actions: number } {
  let s = state;
  let actions = 0;
  while (s.phase !== 'gameOver' && actions < maxActions) {
    s = reduce(s, botStep(s));
    actions += 1;
    const cashOk = s.players.every((p) => p.cash >= 0 && p.dirty >= 0);
    if (!cashOk) throw new Error('Záporná hotovost');
    if (s.housesLeft < 0 || s.hotelsLeft < 0) throw new Error('Záporná zásoba budov');
  }
  return { state: s, actions };
}

describe('byznysová vrstva u botů', () => {
  it('boti používají všechno, co vrstva nabízí, a partie dál končí', () => {
    const seen = new Set<string>();
    const rounds: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      let s = createGame(
        { mode: 'nextlevel', win: { type: 'lastStanding' } },
        setups(4, seed, 'normal').map((setup, i) => ({
          ...setup,
          archetype: (['developer', 'kryptobro', 'baron', 'trafikant'] as const)[i],
        })),
        seed * 31,
      );
      for (let i = 0; i < 60_000 && s.phase !== 'gameOver'; i++) {
        const action = botStep(s);
        seen.add(action.type);
        s = reduce(s, action);
      }
      expect(s.phase, `seed ${seed}`).toBe('gameOver');
      rounds.push(s.round);
    }
    for (const type of [
      'setOffBooks',
      'launder',
      'payTax',
      'bribeOfficial',
      'bribePolice',
      'buyShares',
      'sellShares',
      'payRent',
      'flee',
      'chaseSkip',
      'breakout',
      'breakoutSkip',
      'heist',
      'heistSkip',
    ]) {
      expect(seen, type).toContain(type);
    }
    const average = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    expect(average).toBeLessThan(150);
  }, 30_000);
});

describe('pump & dump u botů', () => {
  it('zločinec s akciemi, černými a rezervou na pokutu pumpuje', () => {
    const s = createGame(
      { mode: 'nextlevel', win: { type: 'lastStanding' } },
      [
        { name: 'A', bot: { personality: 'kriminalnik', difficulty: 'normal' } },
        { name: 'B', bot: { personality: 'kriminalnik', difficulty: 'normal' } },
      ],
      5,
    );
    const me = s.active;
    const p = s.players[me]!;
    p.dirty = 100_000;
    p.cash = 1_000_000;
    p.shares.most = { count: 10, cost: 100_000 };
    const types = new Set<string>();
    for (let turn = 1; turn <= 200; turn++) {
      types.add(chooseBotAction({ ...s, turn }, me).type);
    }
    expect(types).toContain('pumpDump');
  });
});

describe('celé partie botů', () => {
  const lastStanding: WinCondition = { type: 'lastStanding' };
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (const count of [2, 3, 4]) {
      it(`${count} boti, ${difficulty}: partie dojde do konce jen s legálními akcemi`, () => {
        for (let seed = 1; seed <= 25; seed++) {
          const game = createGame(
            { mode: 'nextlevel', win: lastStanding },
            setups(count, seed, difficulty),
            seed * 1000 + count,
          );
          const { state } = playOut(game);
          expect(state.phase, `seed ${seed}`).toBe('gameOver');
          expect(state.round, `seed ${seed}`).toBeLessThan(MAX_ROUNDS);
          expect(state.winner).not.toBeNull();
          expect(state.players.filter((p) => !p.bankrupt)).toHaveLength(1);
        }
        // 25 celých partií je na pomalém stroji CI kolem pěti sekund.
      }, 20_000);
    }
  }
  it('ostatní podmínky výhry také končí', () => {
    const rounds = playOut(
      createGame(
        { mode: 'nextlevel', win: { type: 'richestAfterRounds', rounds: 15 } },
        setups(3, 1, 'normal'),
        5,
      ),
    );
    expect(rounds.state.phase).toBe('gameOver');
    expect(rounds.state.round).toBe(16);
    const money = playOut(
      createGame(
        { mode: 'nextlevel', win: { type: 'firstToMoney', amount: 3_000_000 } },
        setups(4, 2, 'hard'),
        6,
      ),
    );
    expect(money.state.phase).toBe('gameOver');
  });
  it('stejný seed dá stejnou partii', () => {
    const make = () =>
      createGame({ mode: 'nextlevel', win: lastStanding }, setups(3, 2, 'normal'), 99);
    expect(playOut(make()).state).toEqual(playOut(make()).state);
  });
});

describe('rozhodnutí botů', () => {
  const none = { tiles: [], cash: 0, jailCards: 0 };
  function duel(): GameState {
    const s = createGame(
      { mode: 'nextlevel', win: { type: 'lastStanding' } },
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
  describe('protinabídky', () => {
    /** Hráč 0 nabízí hotovost za volný pozemek hráče 1. */
    function haggling(cash: number): GameState {
      const s = duel();
      deedOf(s, 39).owner = 1;
      s.trade = { from: 0, to: 1, give: { ...none, cash }, get: { ...none, tiles: [39] } };
      return s;
    }
    const worth = () => tileValue(duel(), 1, 39);

    it('slabá nabídka dostane protinabídku, která se botovi vyplatí', () => {
      const s = haggling(Math.floor(worth() * 0.8));
      const action = chooseBotAction(s, 1);
      if (action.type !== 'counterTrade') throw new Error(action.type);
      const counter = { from: 1, ...action.offer };
      expect(counter.to).toBe(0);
      expect(counter.give.tiles).toEqual([39]);
      expect(counter.get.cash).toBeGreaterThan(s.trade!.give.cash);
      expect(acceptsTrade(s, 1, counter)).toBe(true);
      expect(() => reduce(s, action)).not.toThrow();
    });
    it('urážlivou nabídku odmítne', () => {
      expect(chooseBotAction(haggling(1_000), 1).type).toBe('rejectTrade');
    });
    it('po vyčerpaných protinabídkách už jen odmítne', () => {
      const s = haggling(Math.floor(worth() * 0.8));
      s.tradeCounters = 3;
      expect(chooseBotAction(s, 1).type).toBe('rejectTrade');
    });
    it('s vyjednáváním slevuje na přirážce', () => {
      const asked = (round: number) => {
        const s = haggling(Math.floor(worth() * 0.8));
        s.tradeCounters = round;
        const action = chooseBotAction(s, 1);
        if (action.type !== 'counterTrade') throw new Error(action.type);
        return action.offer.get.cash;
      };
      expect(asked(0)).toBeGreaterThan(asked(2));
    });
    it('když protistrana nemá na doplatek, protinabídku neposílá', () => {
      const s = haggling(Math.floor(worth() * 0.8));
      s.players[0]!.cash = s.trade!.give.cash;
      expect(chooseBotAction(s, 1).type).toBe('rejectTrade');
    });
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
      { mode: 'nextlevel', win: { type: 'lastStanding' } },
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
