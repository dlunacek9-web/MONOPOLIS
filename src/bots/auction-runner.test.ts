import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, deedOf, ownablePrice, playerOf, reduce } from '../core';
import type { GameState, Personality, PlayerSetup } from '../core';
import { LocalTransport } from '../net/local';
import { AUCTION_GAVEL_MS, AUCTION_OPENING_MS, LiveAuctionRunner } from './auction-runner';
import { chooseLiveMove, tileValue } from './bot';

const TILE = 39;

function auctionOf(seed: number, personality: Personality = 'zralok'): GameState {
  const setups: PlayerSetup[] = [
    { name: 'Člověk' },
    { name: 'B1', bot: { personality, difficulty: 'normal' } },
    { name: 'B2', bot: { personality, difficulty: 'normal' } },
  ];
  const s = createGame({ mode: 'nextlevel', win: { type: 'lastStanding' } }, setups, seed);
  s.active = 0;
  s.phase = 'awaitBuy';
  s.pendingBuy = TILE;
  return reduce(s, { type: 'decline', player: 0 });
}

const SEEDS = Array.from({ length: 80 }, (_, i) => i * 31 + 7);

describe('bot v živé dražbě', () => {
  it('rozhodnutí závisí jen na stavu', () => {
    const s = auctionOf(5);
    expect(chooseLiveMove(s, 1)).toEqual(chooseLiveMove(s, 1));
  });

  it('nepřihazuje, když vede, a nikdy nad svou hotovost', () => {
    for (const seed of SEEDS) {
      let s = auctionOf(seed);
      const cash = playerOf(s, 1).cash;
      s = reduce(s, { type: 'bid', player: 1, amount: 10_000 });
      expect(chooseLiveMove(s, 1)).toBeNull();
      s = reduce(s, { type: 'bid', player: 0, amount: cash - 10_000 });
      const move = chooseLiveMove(s, 1);
      if (move?.action.type === 'bid') expect(move.action.amount).toBeLessThanOrEqual(cash);
    }
  });

  it('někteří blafují nad vlastní cenu, někteří mlčí a číhající čekají na kladívko', () => {
    let bluffs = 0;
    let silent = 0;
    let snipers = 0;
    for (const seed of SEEDS) {
      const s = auctionOf(seed);
      if (chooseLiveMove(s, 1) === null) snipers += 1;
      const worth = tileValue(s, 1, TILE) * 1.35;
      const above = reduce(s, { type: 'bid', player: 0, amount: Math.ceil(worth / 1000) * 1000 });
      const move = chooseLiveMove(above, 1);
      if (move === null) silent += 1;
      else if (move.action.type === 'bid') bluffs += 1;
    }
    expect(bluffs).toBeGreaterThan(0);
    expect(silent).toBeGreaterThan(0);
    expect(snipers).toBeGreaterThan(0);
  });

  it('když už nechce, část botů jasně pasuje', () => {
    const passes = SEEDS.filter((seed) => {
      const s = auctionOf(seed, 'lakomec');
      const high = (ownablePrice(TILE) ?? 0) * 3;
      const next = reduce(s, { type: 'bid', player: 0, amount: high });
      return chooseLiveMove(next, 1)?.action.type === 'passBid';
    }).length;
    expect(passes).toBeGreaterThan(0);
  });
});

describe('hodiny živé dražby', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dražba vždycky skončí, i když člověk nic neudělá', () => {
    for (const seed of SEEDS) {
      const transport = new LocalTransport(auctionOf(seed));
      const runner = new LiveAuctionRunner(transport);
      vi.advanceTimersByTime(10 * 60_000);
      expect(transport.getState().auction).toBeNull();
      runner.stop();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('člověk bez konkurence vyhraje po třech klepnutích', () => {
    const start = auctionOf(1, 'lakomec');
    const expensive = reduce(start, { type: 'bid', player: 0, amount: 1_000_000 });
    const transport = new LocalTransport(expensive);
    const runner = new LiveAuctionRunner(transport);
    vi.advanceTimersByTime(AUCTION_GAVEL_MS * 2 + 100);
    expect(transport.getState().auction?.gavel).toBe(2);
    vi.advanceTimersByTime(AUCTION_GAVEL_MS);
    expect(transport.getState().auction).toBeNull();
    expect(deedOf(transport.getState(), TILE).owner).toBe(0);
    runner.stop();
  });

  it('první klepnutí má delší čas a během scén hodiny stojí', () => {
    let blocked = true;
    const transport = new LocalTransport(auctionOf(1, 'lakomec'));
    const runner = new LiveAuctionRunner(transport, () => blocked);
    vi.advanceTimersByTime(AUCTION_OPENING_MS * 3);
    expect(transport.getState().auction?.gavel).toBe(0);
    expect(transport.getState().auction?.leader).toBeNull();
    blocked = false;
    vi.advanceTimersByTime(AUCTION_OPENING_MS);
    expect(transport.getState().auction).not.toBeNull();
    runner.stop();
  });

  it('kladívko nezačne mimo živou dražbu', () => {
    const s = createGame(
      { mode: 'nextlevel', win: { type: 'lastStanding' } },
      [{ name: 'A' }, { name: 'B' }],
      3,
    );
    const transport = new LocalTransport(s);
    const runner = new LiveAuctionRunner(transport);
    expect(vi.getTimerCount()).toBe(0);
    runner.stop();
  });
});
