import { describe, expect, it } from 'vitest';
import { GAVEL_KNOCKS, actorOf, deedOf, minBid } from './rules';
import { IllegalActionError, createGame, reduce } from './reducer';
import type { GameMode, GameState, PlayerSetup } from './types';

const BOT = { personality: 'vyvazeny', difficulty: 'normal' } as const;

/** Člověk 0 stojí na volném poli 3 a rozhoduje o koupi. */
function atBuy(setups: PlayerSetup[], mode: GameMode = 'nextlevel'): GameState {
  const s = createGame({ mode, win: { type: 'lastStanding' } }, setups, 42);
  s.active = 0;
  s.phase = 'awaitBuy';
  s.pendingBuy = 3;
  return s;
}

const human = (name: string): PlayerSetup => ({ name });
const bot = (name: string): PlayerSetup => ({ name, bot: BOT });

function live(setups = [human('A'), bot('B'), bot('C')]): GameState {
  return reduce(atBuy(setups), { type: 'decline', player: 0 });
}

function gavel(s: GameState): GameState {
  return reduce(s, { type: 'auctionGavel', player: s.auction!.bidders[0]! });
}

describe('živá dražba', () => {
  it('s člověkem v Next level je živá a nikdo není na řadě', () => {
    const s = live();
    expect(s.auction?.live).toBe(true);
    expect(actorOf(s)).toBeNull();
  });

  it('samotní boti a Klasika draží po řadě', () => {
    const bots = reduce(atBuy([bot('A'), bot('B')]), { type: 'decline', player: 0 });
    expect(bots.auction?.live).toBe(false);
    expect(actorOf(bots)).toBe(1);
    const classic = reduce(atBuy([human('A'), human('B')], 'classic'), {
      type: 'decline',
      player: 0,
    });
    expect(classic.auction?.live).toBe(false);
  });

  it('přihodit může kdokoli bez pořadí, ale ne sám na sebe a ne pod minimum', () => {
    let s = live();
    s = reduce(s, { type: 'bid', player: 2, amount: minBid(s) });
    expect(s.auction?.leader).toBe(2);
    expect(() => reduce(s, { type: 'bid', player: 2, amount: minBid(s) })).toThrow(
      IllegalActionError,
    );
    expect(() => reduce(s, { type: 'bid', player: 0, amount: s.auction!.bid })).toThrow(
      IllegalActionError,
    );
    s = reduce(s, { type: 'bid', player: 0, amount: minBid(s) });
    expect(s.auction?.leader).toBe(0);
  });

  it('kladívko po třech klepnutích prodá a příhoz ho vrací na začátek', () => {
    let s = live();
    s = reduce(s, { type: 'bid', player: 1, amount: 50_000 });
    s = gavel(gavel(s));
    expect(s.auction?.gavel).toBe(GAVEL_KNOCKS - 1);
    s = reduce(s, { type: 'bid', player: 0, amount: 60_000 });
    expect(s.auction?.gavel).toBe(0);
    const cash = s.players[0]!.cash;
    for (let i = 0; i < GAVEL_KNOCKS; i++) s = gavel(s);
    expect(s.auction).toBeNull();
    expect(deedOf(s, 3).owner).toBe(0);
    expect(s.players[0]!.cash).toBe(cash - 60_000);
    expect(s.phase).toBe('awaitEnd');
  });

  it('bez příhozu kladívko nechá pozemek bance', () => {
    let s = live();
    for (let i = 0; i < GAVEL_KNOCKS; i++) s = gavel(s);
    expect(s.auction).toBeNull();
    expect(deedOf(s, 3).owner).toBeNull();
  });

  it('kdo vede, nesmí pasovat, a kdo pasoval, už nepřihodí', () => {
    let s = live([human('A'), human('B'), bot('C')]);
    s = reduce(s, { type: 'bid', player: 0, amount: 50_000 });
    expect(() => reduce(s, { type: 'passBid', player: 0 })).toThrow(IllegalActionError);
    s = reduce(s, { type: 'passBid', player: 1 });
    expect(() => reduce(s, { type: 'bid', player: 1, amount: 60_000 })).toThrow(IllegalActionError);
    expect(s.auction?.live).toBe(true);
  });

  it('když zůstane jen vedoucí, je hned prodáno', () => {
    let s = live();
    s = reduce(s, { type: 'bid', player: 0, amount: 50_000 });
    s = reduce(s, { type: 'passBid', player: 1 });
    s = reduce(s, { type: 'passBid', player: 2 });
    expect(s.auction).toBeNull();
    expect(deedOf(s, 3).owner).toBe(0);
  });

  it('po pasu posledního člověka dohrají boti po řadě', () => {
    let s = live();
    s = reduce(s, { type: 'bid', player: 1, amount: 50_000 });
    s = reduce(s, { type: 'passBid', player: 0 });
    expect(s.auction?.live).toBe(false);
    // Na řadě je ten, kdo nevede: vedoucí by přihazoval sám na sebe.
    expect(actorOf(s)).toBe(2);
    s = reduce(s, { type: 'passBid', player: 2 });
    expect(deedOf(s, 3).owner).toBe(1);
  });

  it('kladívko nejde použít mimo živou dražbu', () => {
    const s = reduce(atBuy([bot('A'), bot('B')]), { type: 'decline', player: 0 });
    expect(() => reduce(s, { type: 'auctionGavel', player: 1 })).toThrow(IllegalActionError);
  });
});
