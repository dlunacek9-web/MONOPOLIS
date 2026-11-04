import { describe, expect, it } from 'vitest';
import { canBribeBuild, canLaunder, launderNet } from './business';
import { JAIL_TILE, START_CASH } from './board';
import { IllegalActionError, createGame, reduce } from './reducer';
import { randomInt } from './rng';
import { buildCost, deedOf, liquidationValue, netWorth, rentOf } from './rules';
import type { Action, Archetype, GameState, PlayerId, TileId } from './types';

function game(archetypes: (Archetype | undefined)[] = []): GameState {
  const setups = [0, 1, 2].map((i) => ({ name: `H${i}`, archetype: archetypes[i] }));
  const s = createGame({ mode: 'nextlevel', win: { type: 'lastStanding' } }, setups, 42);
  s.active = 0;
  s.firstPlayer = 0;
  s.phase = 'awaitEnd';
  return s;
}

function give(s: GameState, player: PlayerId, ...tiles: TileId[]): void {
  for (const tile of tiles) deedOf(s, tile).owner = player;
}

/** Nastaví generátor tak, aby další hod na odhalení vyšel podle přání. */
function forceRisk(s: GameState, riskPct: number, caught: boolean): void {
  for (let seed = 0; seed < 100_000; seed++) {
    const probe = { rng: seed } as GameState;
    if (randomInt(probe, 100) < riskPct === caught) {
      s.rng = seed;
      return;
    }
  }
  throw new Error('Hod nenalezen');
}

function play(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce(reduce, s);
}

describe('nájem na ruku', () => {
  it('majitel dostane nájem v černých s přirážkou 50 %', () => {
    const s = game();
    give(s, 1, 3);
    deedOf(s, 3).offBooks = true;
    const base = rentOf(s, 3, 0);
    const landed = landOnThree(s);
    expect(landed.players[1]!.dirty).toBe(Math.floor(base * 1.5));
    expect(landed.players[1]!.cash).toBe(START_CASH);
    expect(landed.players[0]!.cash).toBe(START_CASH - base);
  });

  it('nájemník platí nejdřív černými, na zbytek bere bílé', () => {
    const s = game();
    give(s, 1, 3);
    deedOf(s, 3).offBooks = true;
    const base = rentOf(s, 3, 0);
    s.players[0]!.dirty = 1000;
    const landed = landOnThree(s);
    expect(landed.players[0]!.dirty).toBe(0);
    expect(landed.players[0]!.cash).toBe(START_CASH - (base - 1000));
  });

  it('přepnout jde jen vlastní pozemek', () => {
    const s = game();
    give(s, 1, 1);
    expect(() => reduce(s, { type: 'setOffBooks', player: 0, tile: 1, on: true })).toThrow(
      IllegalActionError,
    );
    give(s, 0, 3);
    const next = reduce(s, { type: 'setOffBooks', player: 0, tile: 3, on: true });
    expect(deedOf(next, 3).offBooks).toBe(true);
  });

  it('obchod nájem na ruku vypne', () => {
    const s = game();
    give(s, 0, 3);
    deedOf(s, 3).offBooks = true;
    const side = { tiles: [], cash: 0, jailCards: 0 };
    const next = play(
      s,
      {
        type: 'proposeTrade',
        player: 0,
        offer: { to: 1, give: { ...side, tiles: [3] }, get: side },
      },
      { type: 'acceptTrade', player: 1 },
    );
    expect(deedOf(next, 3).offBooks).toBe(false);
  });
});

/** Hráč 0 hodí ze startu 1 + 2 a dojede na pole 3. */
function landOnThree(s: GameState): GameState {
  s.phase = 'awaitRoll';
  for (let seed = 0; seed < 1_000_000; seed++) {
    const probe = { rng: seed } as GameState;
    if (randomInt(probe, 6) === 0 && randomInt(probe, 6) === 1) {
      s.rng = seed;
      return reduce(s, { type: 'roll', player: 0 });
    }
  }
  throw new Error('Hod nenalezen');
}

describe('praní', () => {
  it('vypere s poplatkem 25 % a každý podnik jen jednou za tah', () => {
    const s = game();
    give(s, 0, 1, 3);
    s.players[0]!.dirty = 150_000;
    forceRisk(s, 10, false);
    const next = reduce(s, { type: 'launder', player: 0, tile: 1, amount: 100_000 });
    expect(next.players[0]!.dirty).toBe(50_000);
    expect(next.players[0]!.cash).toBe(START_CASH + 75_000);
    expect(canLaunder(next, 0, 1, 50_000)).toBe(false);
    expect(canLaunder(next, 0, 3, 50_000)).toBe(true);
  });

  it('dá se prát nejvýš 100 000 Kč a ne přes zastavený podnik', () => {
    const s = game();
    give(s, 0, 1, 3);
    deedOf(s, 3).mortgaged = true;
    s.players[0]!.dirty = 500_000;
    expect(canLaunder(s, 0, 1, 100_001)).toBe(false);
    expect(canLaunder(s, 0, 1, 100_000)).toBe(true);
    expect(canLaunder(s, 0, 3, 1000)).toBe(false);
  });

  it('odhalení: pokuta 50 %, vazba a zabavení půlky zbylých černých', () => {
    const s = game();
    give(s, 0, 1);
    s.players[0]!.dirty = 200_000;
    forceRisk(s, 10, true);
    const next = reduce(s, { type: 'launder', player: 0, tile: 1, amount: 100_000 });
    const p = next.players[0]!;
    expect(p.dirty).toBe(50_000);
    expect(p.cash).toBe(START_CASH - 50_000);
    expect(p.inJail).toBe(true);
    expect(p.position).toBe(JAIL_TILE);
  });

  it('z vazby se prát nedá', () => {
    const s = game();
    give(s, 0, 1);
    s.players[0]!.dirty = 100_000;
    s.players[0]!.inJail = true;
    expect(canLaunder(s, 0, 1, 100_000)).toBe(false);
  });

  it('Trafikant platí 15 % a riskuje jen 5 %', () => {
    const s = game(['trafikant']);
    expect(launderNet(s, 0, 100_000)).toBe(85_000);
    give(s, 0, 1);
    s.players[0]!.dirty = 100_000;
    forceRisk(s, 5, false);
    const next = reduce(s, { type: 'launder', player: 0, tile: 1, amount: 100_000 });
    expect(next.players[0]!.cash).toBe(START_CASH + 85_000);
  });
});

describe('úplatky', () => {
  function onTax(s: GameState): GameState {
    s.phase = 'awaitTax';
    s.pendingTax = { tile: 4, amount: 200_000 };
    s.players[0]!.position = 4;
    return s;
  }

  it('daň bez úplatku se platí celá', () => {
    const next = reduce(onTax(game()), { type: 'payTax', player: 0 });
    expect(next.players[0]!.cash).toBe(START_CASH - 200_000);
    expect(next.phase).toBe('awaitEnd');
  });

  it('s úplatkem jde půlka daně a tah bez čekání na daň nejde ukončit', () => {
    const s = onTax(game());
    expect(() => reduce(s, { type: 'endTurn', player: 0 })).toThrow(IllegalActionError);
    forceRisk(s, 15, false);
    const next = reduce(s, { type: 'bribeOfficial', player: 0 });
    expect(next.players[0]!.cash).toBe(START_CASH - 20_000 - 100_000);
  });

  it('úplatek se platí nejdřív černými', () => {
    const s = onTax(game());
    s.players[0]!.dirty = 15_000;
    forceRisk(s, 15, false);
    const next = reduce(s, { type: 'bribeOfficial', player: 0 });
    expect(next.players[0]!.dirty).toBe(0);
    expect(next.players[0]!.cash).toBe(START_CASH - 5_000 - 100_000);
  });

  it('odhalený úředník: celá daň, pokuta a vazba', () => {
    const s = onTax(game());
    forceRisk(s, 15, true);
    const next = reduce(s, { type: 'bribeOfficial', player: 0 });
    expect(next.players[0]!.cash).toBe(START_CASH - 20_000 - 200_000 - 100_000);
    expect(next.players[0]!.inJail).toBe(true);
  });

  it('policajt pustí z vazby a hráč může hned hodit', () => {
    const s = game();
    s.phase = 'awaitRoll';
    s.players[0]!.inJail = true;
    forceRisk(s, 20, false);
    const next = reduce(s, { type: 'bribePolice', player: 0 });
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.phase).toBe('awaitRoll');
    expect(next.players[0]!.cash).toBe(START_CASH - 40_000);
  });

  it('odhalený policajt: pokuta a tenhle tah se nehází', () => {
    const s = game();
    s.phase = 'awaitRoll';
    s.players[0]!.inJail = true;
    forceRisk(s, 20, true);
    const next = reduce(s, { type: 'bribePolice', player: 0 });
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.phase).toBe('awaitEnd');
    expect(next.players[0]!.cash).toBe(START_CASH - 40_000 - 100_000);
  });

  it('stavební úřad povolí stavbu mimo pořadí', () => {
    const s = game();
    give(s, 0, 1, 3);
    deedOf(s, 1).level = 1;
    expect(canBribeBuild(s, 0, 3)).toBe(false);
    expect(canBribeBuild(s, 0, 1)).toBe(true);
    forceRisk(s, 20, false);
    const next = reduce(s, { type: 'bribeBuild', player: 0, tile: 1 });
    expect(deedOf(next, 1).level).toBe(2);
    expect(next.players[0]!.cash).toBe(START_CASH - 60_000 - 50_000);
  });

  it('odhalená stavba se zbourá: peníze jsou pryč, přijde pokuta a vazba', () => {
    const s = game();
    give(s, 0, 1, 3);
    deedOf(s, 1).level = 1;
    forceRisk(s, 20, true);
    const next = reduce(s, { type: 'bribeBuild', player: 0, tile: 1 });
    expect(deedOf(next, 1).level).toBe(1);
    expect(next.players[0]!.cash).toBe(START_CASH - 60_000 - 50_000 - 150_000);
    expect(next.players[0]!.inJail).toBe(true);
  });

  it('Dotační baron platí o 30 % méně a riskuje o 5 bodů méně', () => {
    const s = game(['baron']);
    s.phase = 'awaitRoll';
    s.players[0]!.inJail = true;
    forceRisk(s, 15, false);
    const next = reduce(s, { type: 'bribePolice', player: 0 });
    expect(next.players[0]!.cash).toBe(START_CASH - 28_000);
  });
});

describe('burza', () => {
  it('koupě a prodej za tržní cenu, limit 50 kusů na firmu', () => {
    const s = game();
    const bought = reduce(s, { type: 'buyShares', player: 0, group: 'most', count: 10 });
    expect(bought.players[0]!.cash).toBe(START_CASH - 100_000);
    expect(netWorth(bought, 0)).toBe(START_CASH);
    expect(() => reduce(s, { type: 'buyShares', player: 0, group: 'most', count: 51 })).toThrow(
      IllegalActionError,
    );
    const sold = reduce(bought, { type: 'sellShares', player: 0, group: 'most', count: 10 });
    expect(sold.players[0]!.cash).toBe(START_CASH);
    expect(sold.players[0]!.shares.most).toBeUndefined();
  });

  it('stavba ve městě zvedne cenu o 2 %', () => {
    const s = game();
    give(s, 0, 1, 3);
    const next = reduce(s, { type: 'build', player: 0, tile: 1 });
    expect(next.market!.prices.most).toBe(10_200);
  });

  it('šum na konci kola drží cenu v ±3 %', () => {
    let s = game();
    s = play(s, { type: 'endTurn', player: 0 }, { type: 'roll', player: 1 });
    s.phase = 'awaitEnd';
    s.debts = [];
    s.pendingBuy = null;
    s.pendingTax = null;
    s = reduce(s, { type: 'endTurn', player: 1 });
    s.phase = 'awaitEnd';
    s.debts = [];
    s.pendingBuy = null;
    s.pendingTax = null;
    s.extraRoll = false;
    s = reduce(s, { type: 'endTurn', player: 2 });
    expect(s.round).toBe(2);
    for (const price of Object.values(s.market!.prices)) {
      expect(price).toBeGreaterThanOrEqual(9_700);
      expect(price).toBeLessThanOrEqual(10_300);
    }
  });

  it('akcie jdou prodat na splacení dluhu a počítají se do likvidační hodnoty', () => {
    const s = game();
    const bought = reduce(s, { type: 'buyShares', player: 0, group: 'most', count: 10 });
    expect(liquidationValue(bought, 0)).toBe(START_CASH);
    bought.players[0]!.cash = 0;
    bought.debts = [{ player: 0, creditor: null, amount: 50_000 }];
    const sold = reduce(bought, { type: 'sellShares', player: 0, group: 'most', count: 10 });
    expect(sold.players[0]!.cash).toBe(100_000);
  });

  it('bankrot majitele srazí firmu o 15 % a akcie prodá', () => {
    const s = game();
    give(s, 0, 1);
    const bought = reduce(s, { type: 'buyShares', player: 0, group: 'ostrava', count: 10 });
    bought.players[0]!.cash = 0;
    bought.debts = [{ player: 0, creditor: 1, amount: 500_000 }];
    const next = reduce(bought, { type: 'declareBankruptcy', player: 0 });
    expect(next.market!.prices.most).toBe(8_500);
    expect(next.players[0]!.shares).toEqual({});
    expect(next.players[1]!.cash).toBe(START_CASH + 100_000);
  });

  it('Developer staví o 15 % levněji, Kryptobro bere 20 % navíc ze zisku', () => {
    const dev = game(['developer']);
    expect(buildCost(dev, 0, 1)).toBe(51_000);
    const s = game(['kryptobro']);
    const bought = reduce(s, { type: 'buyShares', player: 0, group: 'most', count: 10 });
    bought.market!.prices.most = 20_000;
    const sold = reduce(bought, { type: 'sellShares', player: 0, group: 'most', count: 10 });
    expect(sold.players[0]!.cash).toBe(START_CASH - 100_000 + 200_000 + 20_000);
  });
});

describe('pump & dump', () => {
  function pumped(archetypes: (Archetype | undefined)[] = []): GameState {
    const s = game(archetypes);
    s.players[0]!.dirty = 50_000;
    return play(
      s,
      { type: 'buyShares', player: 0, group: 'most', count: 10 },
      { type: 'pumpDump', player: 0, group: 'most' },
    );
  }

  /** Doběhne dvě kola až k začátku tahu viníka, kdy se pumpa zhroutí. */
  function runToDump(start: GameState, caught: boolean): GameState {
    let s = start;
    for (let i = 0; i < 6; i++) {
      s = structuredClone(s);
      s.phase = 'awaitEnd';
      s.pendingBuy = null;
      s.pendingTax = null;
      s.debts = [];
      s.extraRoll = false;
      if (i === 5) forceDumpRisk(s, caught);
      s = reduce(s, { type: 'endTurn', player: s.active });
    }
    return s;
  }

  /** Poslední tah před dumpem: šum kola bere 8 hodů, pak se losuje odhalení. */
  function forceDumpRisk(s: GameState, caught: boolean): void {
    for (let seed = 0; seed < 1_000_000; seed++) {
      const probe = { rng: seed } as GameState;
      for (let i = 0; i < 8; i++) randomInt(probe, 7);
      if (randomInt(probe, 100) < 25 === caught) {
        s.rng = seed;
        return;
      }
    }
    throw new Error('Hod nenalezen');
  }

  it('stojí černé a zvedne cenu o 30 %, bílými ho zaplatit nejde', () => {
    const s = game();
    expect(() => reduce(s, { type: 'pumpDump', player: 0, group: 'most' })).toThrow(
      IllegalActionError,
    );
    const next = pumped();
    expect(next.players[0]!.dirty).toBe(0);
    expect(next.market!.prices.most).toBe(13_000);
  });

  it('po dvou tazích viníka cena spadne o 40 %', () => {
    const next = runToDump(pumped(), false);
    expect(next.market!.pumps).toHaveLength(0);
    expect(next.market!.prices.most).toBeLessThan(9_000);
    expect(next.players[0]!.inJail).toBe(false);
  });

  it('odhalení: zisk propadne, pokuta a vazba', () => {
    const s = reduce(pumped(), { type: 'sellShares', player: 0, group: 'most', count: 10 });
    const cash = s.players[0]!.cash;
    expect(s.market!.pumps[0]!.profit).toBe(30_000);
    const next = runToDump(s, true);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.players[0]!.cash).toBe(cash - 200_000 - 30_000);
  });

  it('Kryptobro má o polovinu větší výkyv', () => {
    expect(pumped(['kryptobro']).market!.prices.most).toBe(14_500);
  });
});

describe('Klasika', () => {
  it('byznysovou vrstvu nemá', () => {
    const s = createGame(
      { mode: 'classic', win: { type: 'lastStanding' } },
      [{ name: 'A', archetype: 'developer' }, { name: 'B' }],
      1,
    );
    expect(s.market).toBeNull();
    expect(s.players[0]!.archetype).toBeNull();
    s.phase = 'awaitEnd';
    deedOf(s, 1).owner = s.active;
    expect(() => reduce(s, { type: 'setOffBooks', player: s.active, tile: 1, on: true })).toThrow(
      IllegalActionError,
    );
  });
});
