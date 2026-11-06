import { describe, expect, it } from 'vitest';
import { IllegalActionError, createGame, reduce } from './reducer';
import { CARDS } from './cards';
import {
  BOARD,
  HOTEL_LEVEL,
  JAIL_BAIL,
  JAIL_TILE,
  START_CASH,
  START_SALARY,
  groupTiles,
} from './board';
import {
  actorOf,
  canBuild,
  deedOf,
  mortgageValue,
  netWorth,
  rentOf,
  unmortgageCost,
} from './rules';
import { rollDice } from './rng';
import type { Action, GameState, PlayerId, TileId, WinCondition } from './types';

const CLASSIC = { mode: 'nextlevel', win: { type: 'lastStanding' } } as const;

function game(players = 2, win: WinCondition = CLASSIC.win): GameState {
  const setups = Array.from({ length: players }, (_, i) => ({ name: `H${i}` }));
  const s = createGame({ mode: 'nextlevel', win }, setups, 42);
  s.active = 0;
  s.firstPlayer = 0;
  // Tyhle testy řeší samotný nájem, honičku mají vlastní soubor.
  for (const p of s.players) p.nextChaseRound = 9999;
  return s;
}

/** Nastaví generátor tak, aby další hod padl přesně takhle. */
function forceDice(s: GameState, a: number, b: number): void {
  for (let seed = 0; seed < 1_000_000; seed++) {
    const probe = { rng: seed } as GameState;
    const dice = rollDice(probe);
    if (dice[0] === a && dice[1] === b) {
      s.rng = seed;
      return;
    }
  }
  throw new Error('Hod nenalezen');
}

function rollTo(s: GameState, a: number, b: number, player: PlayerId = s.active): GameState {
  forceDice(s, a, b);
  return reduce(s, { type: 'roll', player });
}

function give(s: GameState, player: PlayerId, ...tiles: TileId[]): void {
  for (const tile of tiles) deedOf(s, tile).owner = player;
}

function deck(s: GameState, which: 'tip' | 'urad', card: number): void {
  s.decks[which] = [card, ...s.decks[which].filter((c) => c !== card)];
}

describe('deska', () => {
  it('má 40 polí a 22 pozemků v 8 městech', () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD.filter((t) => t.kind === 'property')).toHaveLength(22);
    expect(BOARD.filter((t) => t.kind === 'station')).toHaveLength(4);
    expect(BOARD.filter((t) => t.kind === 'utility')).toHaveLength(2);
    expect(groupTiles('most')).toEqual([1, 3]);
    expect(groupTiles('praha')).toEqual([37, 39]);
  });
  it('má 16 karet v každém balíčku a jednu propustku', () => {
    for (const cards of [CARDS.tip, CARDS.urad]) {
      expect(cards).toHaveLength(16);
      expect(cards.filter((c) => c.kind === 'jailCard')).toHaveLength(1);
    }
  });
});

describe('determinismus', () => {
  it('stejný seed a akce dají stejný stav a původní stav se nemění', () => {
    const a = createGame(CLASSIC, [{ name: 'A' }, { name: 'B' }], 7);
    const b = createGame(CLASSIC, [{ name: 'A' }, { name: 'B' }], 7);
    const snapshot = structuredClone(a);
    const roll: Action = { type: 'roll', player: a.active };
    expect(reduce(a, roll)).toEqual(reduce(b, roll));
    expect(a).toEqual(snapshot);
  });
  it('stav přežije převod na JSON', () => {
    const s = game();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('tah a pohyb', () => {
  it('odmítne akci hráče, který není na řadě', () => {
    expect(() => reduce(game(), { type: 'roll', player: 1 })).toThrow(IllegalActionError);
  });
  it('dá výplatu při průjezdu Startem', () => {
    const s = game();
    s.players[0]!.position = 38;
    const next = rollTo(s, 1, 2);
    expect(next.players[0]!.position).toBe(1);
    expect(next.players[0]!.cash).toBe(START_CASH + START_SALARY);
  });
  it('po dublu hraje stejný hráč a po normálním hodu další', () => {
    let s = game();
    s = rollTo(s, 2, 2); // pole 4, daň
    s = reduce(s, { type: 'payTax', player: 0 });
    s = reduce(s, { type: 'endTurn', player: 0 });
    expect(s.active).toBe(0);
    expect(s.phase).toBe('awaitRoll');
    s = rollTo(s, 4, 6); // pole 14
    s = reduce(s, { type: 'decline', player: 0 });
    s = reduce(s, { type: 'passBid', player: 1 });
    s = reduce(s, { type: 'passBid', player: 0 });
    s = reduce(s, { type: 'endTurn', player: 0 });
    expect(s.active).toBe(1);
  });
  it('třetí dubl posílá do vazby', () => {
    const s = game();
    s.players[0]!.doublesCount = 2;
    const next = rollTo(s, 3, 3);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.players[0]!.position).toBe(JAIL_TILE);
    expect(next.extraRoll).toBe(false);
  });
  it('počítá kola', () => {
    let s = game();
    s = reduce({ ...s, phase: 'awaitEnd' }, { type: 'endTurn', player: 0 });
    expect(s.round).toBe(1);
    s = reduce({ ...s, phase: 'awaitEnd' }, { type: 'endTurn', player: 1 });
    expect(s.round).toBe(2);
  });
});

describe('koupě, dražba, nájem', () => {
  it('koupí volný pozemek', () => {
    let s = rollTo(game(), 1, 2); // pole 3
    expect(s.phase).toBe('awaitBuy');
    s = reduce(s, { type: 'buy', player: 0 });
    expect(deedOf(s, 3).owner).toBe(0);
    expect(s.players[0]!.cash).toBe(START_CASH - 90_000);
    expect(s.phase).toBe('awaitEnd');
  });
  it('po odmítnutí se draží a vyhrává nejvyšší příhoz', () => {
    // Samotní boti draží po řadě, živou dražbu s lidmi pokrývá auction.test.ts.
    const bots = game(3);
    for (const p of bots.players) p.bot = { personality: 'vyvazeny', difficulty: 'normal' };
    let s = rollTo(bots, 1, 2);
    s = reduce(s, { type: 'decline', player: 0 });
    expect(actorOf(s)).toBe(1);
    expect(() => reduce(s, { type: 'bid', player: 1, amount: 5_000 })).toThrow(IllegalActionError);
    s = reduce(s, { type: 'bid', player: 1, amount: 50_000 });
    s = reduce(s, { type: 'passBid', player: 2 });
    s = reduce(s, { type: 'bid', player: 0, amount: 60_000 });
    s = reduce(s, { type: 'passBid', player: 1 });
    expect(s.auction).toBeNull();
    expect(deedOf(s, 3).owner).toBe(0);
    expect(s.players[0]!.cash).toBe(START_CASH - 60_000);
    expect(s.phase).toBe('awaitEnd');
  });
  it('když nikdo nepřihodí, pozemek zůstane bance', () => {
    let s = rollTo(game(), 1, 2);
    s = reduce(s, { type: 'decline', player: 0 });
    s = reduce(s, { type: 'passBid', player: 1 });
    s = reduce(s, { type: 'passBid', player: 0 });
    expect(deedOf(s, 3).owner).toBeNull();
  });
  it('nájem se platí, s celým městem bez budov dvojnásobný, se zástavou vůbec', () => {
    const s = game();
    give(s, 1, 3);
    expect(rollTo(s, 1, 2).players[0]!.cash).toBe(START_CASH - 5_000);
    give(s, 1, 1);
    const set = rollTo(s, 1, 2);
    expect(set.players[0]!.cash).toBe(START_CASH - 10_000);
    expect(set.players[1]!.cash).toBe(START_CASH + 10_000);
    deedOf(s, 3).mortgaged = true;
    expect(rollTo(s, 1, 2).players[0]!.cash).toBe(START_CASH);
  });
  it('nájem z domů, nádraží a podniků', () => {
    const s = game();
    give(s, 1, 1, 3);
    deedOf(s, 3).level = 2;
    expect(rentOf(s, 3, 0)).toBe(75_000);
    deedOf(s, 3).level = HOTEL_LEVEL;
    expect(rentOf(s, 3, 0)).toBe(450_000);
    give(s, 1, 5);
    expect(rentOf(s, 5, 0)).toBe(30_000);
    give(s, 1, 15, 25, 35);
    expect(rentOf(s, 5, 0)).toBe(240_000);
    give(s, 1, 12);
    expect(rentOf(s, 12, 7)).toBe(28_000);
    give(s, 1, 28);
    expect(rentOf(s, 12, 7)).toBe(70_000);
  });
});

describe('stavba a hypotéka', () => {
  it('vyžaduje celé město a rovnoměrnou stavbu', () => {
    let s = game();
    give(s, 0, 1);
    expect(canBuild(s, 0, 1)).toBe(false);
    give(s, 0, 3);
    s = reduce(s, { type: 'build', player: 0, tile: 1 });
    expect(s.housesLeft).toBe(31);
    expect(canBuild(s, 0, 1)).toBe(false);
    expect(canBuild(s, 0, 3)).toBe(true);
    expect(() => reduce(s, { type: 'sellBuilding', player: 0, tile: 3 })).toThrow();
  });
  it('hotel vrací 4 domy a prodej hotelu je zase bere', () => {
    let s = game();
    give(s, 0, 1, 3);
    deedOf(s, 1).level = 4;
    deedOf(s, 3).level = 4;
    s.housesLeft = 24;
    s = reduce(s, { type: 'build', player: 0, tile: 1 });
    expect(s.housesLeft).toBe(28);
    expect(s.hotelsLeft).toBe(11);
    s = reduce(s, { type: 'sellBuilding', player: 0, tile: 1 });
    expect(s.housesLeft).toBe(24);
    expect(s.hotelsLeft).toBe(12);
    expect(s.players[0]!.cash).toBe(START_CASH - 60_000 + 30_000);
  });
  it('hypotéka dá polovinu a splacení stojí 110 %', () => {
    let s = game();
    give(s, 0, 3);
    s = reduce(s, { type: 'mortgage', player: 0, tile: 3 });
    expect(s.players[0]!.cash).toBe(START_CASH + mortgageValue(3));
    s = reduce(s, { type: 'unmortgage', player: 0, tile: 3 });
    expect(unmortgageCost(3)).toBe(50_000);
    expect(s.players[0]!.cash).toBe(START_CASH + 45_000 - 50_000);
  });
  it('nejde zastavit, když ve městě stojí budova, ani stavět se zástavou', () => {
    const s = game();
    give(s, 0, 1, 3);
    deedOf(s, 3).level = 1;
    expect(() => reduce(s, { type: 'mortgage', player: 0, tile: 1 })).toThrow();
    deedOf(s, 3).level = 0;
    deedOf(s, 3).mortgaged = true;
    expect(canBuild(s, 0, 1)).toBe(false);
  });
});

describe('vazba', () => {
  function jailed(): GameState {
    const s = game();
    s.players[0]!.inJail = true;
    s.players[0]!.position = JAIL_TILE;
    return s;
  }
  it('pole Razie posílá do vazby bez výplaty', () => {
    const s = game();
    s.players[0]!.position = 27;
    const next = rollTo(s, 1, 2);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.players[0]!.cash).toBe(START_CASH);
  });
  it('kauce pustí hráče a může hodit', () => {
    let s = reduce(jailed(), { type: 'payBail', player: 0 });
    expect(s.players[0]!.inJail).toBe(false);
    expect(s.players[0]!.cash).toBe(START_CASH - JAIL_BAIL);
    s = rollTo(s, 1, 2);
    expect(s.players[0]!.position).toBe(13);
  });
  it('propustka se použije a vrátí do balíčku', () => {
    const s = jailed();
    s.players[0]!.jailCards = ['urad'];
    s.decks.urad = s.decks.urad.filter((c) => c !== 2);
    const next = reduce(s, { type: 'useJailCard', player: 0 });
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.decks.urad).toHaveLength(16);
    expect(next.decks.urad.at(-1)).toBe(2);
  });
  it('dubl pustí a nedává další hod', () => {
    const next = rollTo(jailed(), 2, 2);
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.players[0]!.position).toBe(14);
    expect(next.extraRoll).toBe(false);
  });
  it('po třetím neúspěchu se platí kauce a jede se', () => {
    const s = jailed();
    s.players[0]!.jailTurns = 2;
    const next = rollTo(s, 1, 2);
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.players[0]!.position).toBe(13);
    expect(next.players[0]!.cash).toBe(START_CASH - JAIL_BAIL);
  });
  it('neúspěch zatím jen počítá pokus', () => {
    const next = rollTo(jailed(), 1, 2);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.players[0]!.jailTurns).toBe(1);
    expect(next.phase).toBe('awaitEnd');
  });
});

describe('karty', () => {
  function drawAt(s: GameState, position: TileId, a: number, b: number): GameState {
    s.players[0]!.position = position;
    return rollTo(s, a, b);
  }
  it('peníze od všech a všem', () => {
    const s = game(3);
    deck(s, 'urad', 10);
    const next = drawAt(s, 0, 1, 1); // pole 2
    expect(next.players[0]!.cash).toBe(START_CASH + 80_000);
    expect(next.players[1]!.cash).toBe(START_CASH - 40_000);
    const payer = game(3);
    deck(payer, 'tip', 14);
    const paid = drawAt(payer, 0, 3, 4); // pole 7
    expect(paid.players[0]!.cash).toBe(START_CASH - 80_000);
  });
  it('nejbližší nádraží platí dvojnásobek', () => {
    const s = game();
    give(s, 1, 15);
    deck(s, 'tip', 5);
    const next = drawAt(s, 0, 3, 4);
    expect(next.players[0]!.position).toBe(15);
    expect(next.players[0]!.cash).toBe(START_CASH - 60_000);
  });
  it('nejbližší nádraží přes Start dá výplatu', () => {
    const s = game();
    give(s, 1, 5);
    deck(s, 'tip', 6);
    const next = drawAt(s, 34, 1, 1);
    expect(next.players[0]!.position).toBe(5);
    expect(next.players[0]!.cash).toBe(START_CASH + START_SALARY - 60_000);
  });
  it('tři pole zpět a vazba', () => {
    const s = game();
    deck(s, 'tip', 8);
    const next = drawAt(s, 0, 3, 4);
    expect(next.players[0]!.position).toBe(4);
    expect(next.phase).toBe('awaitTax');
    const paid = reduce(next, { type: 'payTax', player: 0 });
    expect(paid.players[0]!.cash).toBe(START_CASH - 200_000);
    const jail = game();
    deck(jail, 'tip', 9);
    expect(drawAt(jail, 0, 3, 4).players[0]!.inJail).toBe(true);
  });
  it('propustka se nechá v ruce a chybí v balíčku', () => {
    const s = game();
    deck(s, 'tip', 10);
    const next = drawAt(s, 0, 3, 4);
    expect(next.players[0]!.jailCards).toEqual(['tip']);
    expect(next.decks.tip).toHaveLength(15);
    expect(next.decks.tip).not.toContain(10);
  });
  it('opravy počítají domy a hotely', () => {
    const s = game();
    give(s, 0, 1, 3);
    deedOf(s, 1).level = 2;
    deedOf(s, 3).level = HOTEL_LEVEL;
    deck(s, 'tip', 15);
    const next = drawAt(s, 0, 3, 4);
    expect(next.players[0]!.cash).toBe(START_CASH - 2 * 25_000 - 90_000);
  });
  it('karta se po použití vrací dospod', () => {
    const s = game();
    deck(s, 'tip', 12);
    const next = drawAt(s, 0, 3, 4);
    expect(next.decks.tip.at(-1)).toBe(12);
    expect(next.decks.tip).toHaveLength(16);
  });
});

describe('dluh a bankrot', () => {
  function indebted(): GameState {
    const s = game(3);
    give(s, 1, 3);
    deedOf(s, 3).level = 0;
    s.players[0]!.cash = 1_000;
    return rollTo(s, 1, 2);
  }
  it('bez hotovosti vznikne dluh a dluhař je na řadě', () => {
    const s = indebted();
    expect(s.debts).toEqual([{ player: 0, creditor: 1, amount: 5_000 }]);
    expect(actorOf(s)).toBe(0);
    expect(() => reduce(s, { type: 'settleDebt', player: 0 })).toThrow();
    expect(() => reduce(s, { type: 'endTurn', player: 0 })).toThrow();
  });
  it('zástavou se získá hotovost a dluh jde zaplatit', () => {
    const s = indebted();
    give(s, 0, 39);
    let next = reduce(s, { type: 'mortgage', player: 0, tile: 39 });
    next = reduce(next, { type: 'settleDebt', player: 0 });
    expect(next.debts).toEqual([]);
    expect(next.players[1]!.cash).toBe(START_CASH + 5_000);
    expect(next.players[0]!.cash).toBe(1_000 + 210_000 - 5_000);
  });
  it('bankrot vůči hráči předá majetek a platí 10 % ze zástav', () => {
    const s = indebted();
    give(s, 0, 39, 1);
    deedOf(s, 39).mortgaged = true;
    const next = reduce(s, { type: 'declareBankruptcy', player: 0 });
    expect(next.players[0]!.bankrupt).toBe(true);
    expect(deedOf(next, 39).owner).toBe(1);
    expect(deedOf(next, 39).mortgaged).toBe(true);
    expect(deedOf(next, 1).owner).toBe(1);
    expect(next.players[1]!.cash).toBe(START_CASH + 1_000 - 21_000);
    expect(next.active).toBe(1);
  });
  it('bankrot vůči bance vydraží pozemky', () => {
    const s = game(3);
    s.players[0]!.cash = 1_000;
    give(s, 0, 1, 3);
    deedOf(s, 1).mortgaged = true;
    s.players[0]!.position = 1;
    let next = rollTo(s, 1, 2); // daň na poli 4
    next = reduce(next, { type: 'payTax', player: 0 });
    expect(next.debts[0]!.creditor).toBeNull();
    next = reduce(next, { type: 'declareBankruptcy', player: 0 });
    expect(next.auction?.tile).toBe(1);
    expect(deedOf(next, 1).mortgaged).toBe(false);
    expect(next.pendingAuctions).toEqual([3]);
    next = reduce(next, { type: 'passBid', player: 1 });
    next = reduce(next, { type: 'passBid', player: 2 });
    expect(next.auction?.tile).toBe(3);
    next = reduce(next, { type: 'bid', player: 1, amount: 10_000 });
    next = reduce(next, { type: 'passBid', player: 2 });
    expect(deedOf(next, 3).owner).toBe(1);
    expect(next.active).toBe(1);
    expect(next.phase).toBe('awaitRoll');
  });
  it('poslední hráč vyhrává', () => {
    const s = game(2);
    give(s, 1, 3);
    s.players[0]!.cash = 0;
    let next = rollTo(s, 1, 2);
    next = reduce(next, { type: 'declareBankruptcy', player: 0 });
    expect(next.phase).toBe('gameOver');
    expect(next.winner).toBe(1);
    expect(actorOf(next)).toBeNull();
  });
});

describe('obchody', () => {
  const none = { tiles: [], cash: 0, jailCards: 0 };
  it('vymění pozemky, hotovost a propustky', () => {
    let s = game();
    give(s, 0, 1);
    give(s, 1, 3);
    s.players[1]!.jailCards = ['tip'];
    s = reduce(s, {
      type: 'proposeTrade',
      player: 0,
      offer: {
        to: 1,
        give: { tiles: [1], cash: 100_000, jailCards: 0 },
        get: { tiles: [3], cash: 0, jailCards: 1 },
      },
    });
    expect(actorOf(s)).toBe(1);
    s = reduce(s, { type: 'acceptTrade', player: 1 });
    expect(deedOf(s, 1).owner).toBe(1);
    expect(deedOf(s, 3).owner).toBe(0);
    expect(s.players[0]!.cash).toBe(START_CASH - 100_000);
    expect(s.players[0]!.jailCards).toEqual(['tip']);
    expect(actorOf(s)).toBe(0);
  });
  it('odmítnutí nic nezmění', () => {
    let s = game();
    give(s, 1, 3);
    s = reduce(s, {
      type: 'proposeTrade',
      player: 0,
      offer: { to: 1, give: { ...none, cash: 1_000 }, get: { ...none, tiles: [3] } },
    });
    s = reduce(s, { type: 'rejectTrade', player: 1 });
    expect(deedOf(s, 3).owner).toBe(1);
    expect(s.trade).toBeNull();
    expect(s.tradesThisTurn).toBe(1);
  });
  it('nedovolí cizí pozemek, budovy v městě, moc peněz ani prázdnou nabídku', () => {
    const s = game();
    give(s, 0, 1, 3);
    give(s, 1, 5);
    const propose = (give_: typeof none, get: typeof none) => () =>
      reduce(s, { type: 'proposeTrade', player: 0, offer: { to: 1, give: give_, get } });
    expect(propose(none, none)).toThrow();
    expect(propose({ ...none, tiles: [5] as never[] }, none)).toThrow();
    expect(propose({ ...none, cash: START_CASH + 1 }, none)).toThrow();
    deedOf(s, 3).level = 1;
    expect(propose({ ...none, tiles: [1] as never[] }, none)).toThrow();
  });
  it('limit nabídek na tah', () => {
    let s = game();
    const action: Action = {
      type: 'proposeTrade',
      player: 0,
      offer: { to: 1, give: { ...none, cash: 1_000 }, get: none },
    };
    for (let i = 0; i < 3; i++) {
      s = reduce(s, action);
      s = reduce(s, { type: 'rejectTrade', player: 1 });
    }
    expect(() => reduce(s, action)).toThrow();
  });
  it('nový majitel zastaveného pozemku platí 10 %', () => {
    let s = game();
    give(s, 0, 39);
    deedOf(s, 39).mortgaged = true;
    s = reduce(s, {
      type: 'proposeTrade',
      player: 0,
      offer: { to: 1, give: { ...none, tiles: [39] as never[] }, get: none },
    });
    s = reduce(s, { type: 'acceptTrade', player: 1 });
    expect(s.players[1]!.cash).toBe(START_CASH - 21_000);
  });

  describe('protinabídka', () => {
    function offered(): GameState {
      const s = game();
      give(s, 1, 3);
      return reduce(s, {
        type: 'proposeTrade',
        player: 0,
        offer: { to: 1, give: { ...none, cash: 1_000 }, get: { ...none, tiles: [3] } },
      });
    }
    const counter = (player: PlayerId, to: PlayerId, cash: number): Action => {
      const tiles = player === 1 ? { give: [3], get: [] } : { give: [], get: [3] };
      return {
        type: 'counterTrade',
        player,
        offer: {
          to,
          give: { ...none, tiles: tiles.give, cash: player === 0 ? cash : 0 },
          get: { ...none, tiles: tiles.get, cash: player === 1 ? cash : 0 },
        },
      };
    };

    it('předá rozhodnutí navrhovateli, který ji může přijmout', () => {
      let s = reduce(offered(), counter(1, 0, 5_000));
      expect(actorOf(s)).toBe(0);
      expect(s.trade?.from).toBe(1);
      expect(s.tradeCounters).toBe(1);
      expect(s.tradesThisTurn).toBe(1);
      s = reduce(s, { type: 'acceptTrade', player: 0 });
      expect(deedOf(s, 3).owner).toBe(0);
      expect(s.players[0]!.cash).toBe(START_CASH - 5_000);
      expect(s.players[1]!.cash).toBe(START_CASH + 5_000);
      expect(s.trade).toBeNull();
    });
    it('smí ji poslat jen ten, kdo je na řadě, a musí něco změnit', () => {
      const s = offered();
      expect(() => reduce(s, counter(0, 1, 5_000))).toThrow(IllegalActionError);
      expect(() => reduce(s, counter(1, 0, 1_000))).toThrow(IllegalActionError);
      expect(() => reduce(s, counter(1, 0, START_CASH + 1))).toThrow(IllegalActionError);
    });
    it('po třech protinabídkách už jde jen přijmout, nebo odmítnout', () => {
      let s = offered();
      s = reduce(s, counter(1, 0, 5_000));
      s = reduce(s, counter(0, 1, 2_000));
      s = reduce(s, counter(1, 0, 4_000));
      expect(s.tradeCounters).toBe(3);
      expect(() => reduce(s, counter(0, 1, 3_000))).toThrow(IllegalActionError);
      s = reduce(s, { type: 'rejectTrade', player: 0 });
      expect(s.trade).toBeNull();
      expect(actorOf(s)).toBe(0);
    });
    it('nová nabídka začíná počítat protinabídky znovu', () => {
      let s = reduce(offered(), counter(1, 0, 5_000));
      s = reduce(s, { type: 'rejectTrade', player: 0 });
      s = reduce(s, {
        type: 'proposeTrade',
        player: 0,
        offer: { to: 1, give: { ...none, cash: 2_000 }, get: { ...none, tiles: [3] } },
      });
      expect(s.tradeCounters).toBe(0);
      expect(s.tradesThisTurn).toBe(2);
    });
  });
});

describe('výhra', () => {
  it('nejbohatší po počtu kol', () => {
    let s = game(2, { type: 'richestAfterRounds', rounds: 1 });
    s.players[1]!.cash += 1_000;
    s = reduce({ ...s, phase: 'awaitEnd' }, { type: 'endTurn', player: 0 });
    expect(s.phase).toBe('awaitRoll');
    s = reduce({ ...s, phase: 'awaitEnd' }, { type: 'endTurn', player: 1 });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(1);
  });
  it('první na cílové částce čistého jmění', () => {
    const s = game(2, { type: 'firstToMoney', amount: START_CASH + 100_000 });
    s.players[0]!.position = 1;
    deck(s, 'urad', 3); // Pole 2 dá 180 000 Kč.
    s.players[0]!.position = 0;
    const next = rollTo(s, 1, 1);
    expect(next.phase).toBe('gameOver');
    expect(next.winner).toBe(0);
  });
  it('čisté jmění počítá pozemky, budovy a zástavy', () => {
    const s = game();
    give(s, 0, 1, 3);
    deedOf(s, 3).mortgaged = true;
    expect(netWorth(s, 0)).toBe(START_CASH + 70_000 + 45_000);
    deedOf(s, 3).mortgaged = false;
    deedOf(s, 1).level = 2;
    expect(netWorth(s, 0)).toBe(START_CASH + 70_000 + 90_000 + 120_000);
  });
});
