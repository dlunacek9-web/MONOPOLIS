import {
  JAIL_BAIL,
  MIN_BID_STEP,
  actorOf,
  canBuild,
  canMortgage,
  canProposeTrade,
  canSellBuilding,
  canUnmortgage,
  deedOf,
  groupTiles,
  hasBuildingsInGroup,
  hashToUnit,
  isValidTrade,
  liquidationValue,
  minBid,
  ownablePrice,
  playerOf,
  tileAt,
  tilesOfKind,
  tilesOwnedBy,
} from '../core';
import type {
  Action,
  Difficulty,
  GameState,
  Personality,
  PlayerId,
  TileId,
  TradeOffer,
} from '../core';

interface Traits {
  buyReserve: number;
  buildReserve: number;
  auctionFactor: number;
  acceptMargin: number;
}

const TRAITS: Record<Personality, Traits> = {
  zralok: { buyReserve: 30_000, buildReserve: 120_000, auctionFactor: 1.35, acceptMargin: 1.2 },
  lakomec: { buyReserve: 300_000, buildReserve: 600_000, auctionFactor: 0.75, acceptMargin: 1.0 },
  kriminalnik: { buyReserve: 0, buildReserve: 40_000, auctionFactor: 1.2, acceptMargin: 1.1 },
  vyvazeny: { buyReserve: 120_000, buildReserve: 220_000, auctionFactor: 1.0, acceptMargin: 1.1 },
};

interface Skill {
  setBonus: number;
  danger: number;
  tradeEvery: number;
}

const SKILLS: Record<Difficulty, Skill> = {
  easy: { setBonus: 0.5, danger: 0.7, tradeEvery: 5 },
  normal: { setBonus: 1, danger: 1, tradeEvery: 3 },
  hard: { setBonus: 1.5, danger: 1.25, tradeEvery: 2 },
};

const JAIL_CARD_VALUE = 40_000;
const CONSOLIDATE_CASH = 500_000;

function botOf(s: GameState, player: PlayerId) {
  const bot = playerOf(s, player).bot;
  return {
    traits: TRAITS[bot?.personality ?? 'vyvazeny'],
    skill: SKILLS[bot?.difficulty ?? 'normal'],
  };
}

function otherGroupTiles(tile: TileId): TileId[] {
  const t = tileAt(tile);
  return t.kind === 'property' ? groupTiles(t.group).filter((id) => id !== tile) : [];
}

function wouldComplete(s: GameState, player: PlayerId, tile: TileId): boolean {
  const others = otherGroupTiles(tile);
  return others.length > 0 && others.every((id) => deedOf(s, id).owner === player);
}

/** Kolik má pro hráče pozemek hodnotu podle toho, co už vlastní. */
export function tileValue(s: GameState, player: PlayerId, tile: TileId): number {
  const t = tileAt(tile);
  const price = ownablePrice(tile) ?? 0;
  const { skill } = botOf(s, player);
  let value = price;
  if (t.kind === 'property') {
    const mine = otherGroupTiles(tile).filter((id) => deedOf(s, id).owner === player).length;
    if (wouldComplete(s, player, tile)) value = price * (1.6 + skill.setBonus);
    else if (mine > 0) value = price * 1.35;
  } else {
    const kind = t.kind === 'station' ? 'station' : 'utility';
    const owned = tilesOfKind(kind).filter(
      (id) => id !== tile && deedOf(s, id).owner === player,
    ).length;
    value = price * (1 + 0.3 * owned);
  }
  return deedOf(s, tile).mortgaged ? value * 0.75 : value;
}

/** Přirážka za pozemek, který soupeři doplní město. S koly klesá, aby se partie nezasekla. */
function dangerPremium(s: GameState, player: PlayerId): number {
  return Math.max(1.2, (2.2 - 0.04 * s.round) * botOf(s, player).skill.danger);
}

export function acceptsTrade(s: GameState, me: PlayerId, offer: TradeOffer): boolean {
  const other = offer.from === me ? offer.to : offer.from;
  const received = offer.from === me ? offer.get : offer.give;
  const given = offer.from === me ? offer.give : offer.get;
  let gain = received.cash + received.jailCards * JAIL_CARD_VALUE;
  for (const tile of received.tiles) gain += tileValue(s, me, tile);
  let loss = given.cash + given.jailCards * JAIL_CARD_VALUE;
  for (const tile of given.tiles) {
    const value = tileValue(s, me, tile);
    loss += wouldComplete(s, other, tile) ? value * dangerPremium(s, me) : value;
  }
  return gain >= loss * botOf(s, me).traits.acceptMargin;
}

function raiseCash(s: GameState, me: PlayerId, amount: number): Action {
  if (liquidationValue(s, me) < amount) return { type: 'declareBankruptcy', player: me };
  const owned = tilesOwnedBy(s, me);
  const byPrice = (a: TileId, b: TileId) => (ownablePrice(a) ?? 0) - (ownablePrice(b) ?? 0);
  const cheapFirst = [...owned].sort(byPrice);
  const loose = cheapFirst.find((tile) => canMortgage(s, me, tile) && !wouldComplete(s, me, tile));
  if (loose !== undefined) return { type: 'mortgage', player: me, tile: loose };
  const building = cheapFirst.find((tile) => canSellBuilding(s, me, tile));
  if (building !== undefined) return { type: 'sellBuilding', player: me, tile: building };
  const any = cheapFirst.find((tile) => canMortgage(s, me, tile));
  if (any !== undefined) return { type: 'mortgage', player: me, tile: any };
  return { type: 'declareBankruptcy', player: me };
}

function chooseBid(s: GameState, me: PlayerId): Action {
  const auction = s.auction!;
  const p = playerOf(s, me);
  const { traits } = botOf(s, me);
  const worth = tileValue(s, me, auction.tile) * traits.auctionFactor;
  const limit = Math.floor(Math.min(p.cash - traits.buyReserve / 2, worth) / 1000) * 1000;
  const needed = minBid(s);
  if (needed > limit) return { type: 'passBid', player: me };
  const bump = Math.floor(((ownablePrice(auction.tile) ?? 0) * 0.15) / 5000) * 5000;
  const amount = Math.min(limit, Math.max(needed, auction.bid + Math.max(bump, MIN_BID_STEP)));
  return { type: 'bid', player: me, amount };
}

function manage(s: GameState, me: PlayerId): Action | null {
  const p = playerOf(s, me);
  const { traits } = botOf(s, me);
  const owned = tilesOwnedBy(s, me);
  const mortgaged = owned.find(
    (tile) =>
      canUnmortgage(s, me, tile) && p.cash - (ownablePrice(tile) ?? 0) >= traits.buildReserve,
  );
  if (mortgaged !== undefined) return { type: 'unmortgage', player: me, tile: mortgaged };
  const buildable = owned
    .filter((tile) => canBuild(s, me, tile))
    .filter((tile) => {
      const t = tileAt(tile);
      return t.kind === 'property' && p.cash - t.houseCost >= traits.buildReserve;
    })
    .sort(
      // Nejdřív dotáhnout rozestavěné město: hotely vrací domy do banky a brání jejich nedostatku.
      (a, b) =>
        deedOf(s, b).level - deedOf(s, a).level || (ownablePrice(b) ?? 0) - (ownablePrice(a) ?? 0),
    );
  const target = buildable[0];
  return target === undefined ? null : { type: 'build', player: me, tile: target };
}

function emptySide() {
  return { tiles: [] as TileId[], cash: 0, jailCards: 0 };
}

function proposeTrade(s: GameState, me: PlayerId): Action | null {
  const p = playerOf(s, me);
  const { skill, traits } = botOf(s, me);
  if (!canProposeTrade(s, me) || s.tradesThisTurn > 0) return null;
  // Hash místo modula: při modulu by někteří boti podle počtu hráčů nenabídli obchod nikdy.
  if (hashToUnit(s.turn, me) >= 1 / skill.tradeEvery) return null;
  const offers: Omit<TradeOffer, 'from'>[] = [];
  for (const [tile, deed] of s.deeds.entries()) {
    if (!deed || deed.owner === null || deed.owner === me) continue;
    if (tileAt(tile).kind !== 'property' || hasBuildingsInGroup(s, tile)) continue;
    const owner = deed.owner;
    const get = { ...emptySide(), tiles: [tile] };
    const price = ownablePrice(tile) ?? 0;
    if (wouldComplete(s, me, tile)) {
      for (const mine of tilesOwnedBy(s, me)) {
        if (!wouldComplete(s, owner, mine) || hasBuildingsInGroup(s, mine)) continue;
        // Výměna kusů téhož města nikomu nic nedá a boti by ji opakovali donekonečna.
        if (otherGroupTiles(tile).includes(mine)) continue;
        const cash = Math.max(0, price - (ownablePrice(mine) ?? 0));
        offers.push({ to: owner, give: { ...emptySide(), tiles: [mine], cash }, get });
      }
      const premium = dangerPremium(s, owner) * 1.15 * botOf(s, owner).traits.acceptMargin;
      const cash = Math.ceil((tileValue(s, owner, tile) * premium) / 1000) * 1000;
      if (p.cash - cash >= traits.buyReserve / 2) {
        offers.push({ to: owner, give: { ...emptySide(), cash }, get });
      }
    } else if (p.cash >= CONSOLIDATE_CASH) {
      const others = otherGroupTiles(tile);
      const iOwnSome = others.some((id) => deedOf(s, id).owner === me);
      const ownerHasOnlyThis = others.every((id) => deedOf(s, id).owner !== owner);
      if (iOwnSome && ownerHasOnlyThis) {
        const cash = Math.ceil((price * 1.4) / 1000) * 1000;
        offers.push({ to: owner, give: { ...emptySide(), cash }, get });
      }
    }
  }
  for (const offer of offers) {
    const full = { ...offer, from: me };
    if (!isValidTrade(s, full)) continue;
    const target = playerOf(s, offer.to);
    if (target.bot && !acceptsTrade(s, offer.to, full)) continue;
    return { type: 'proposeTrade', player: me, offer };
  }
  return null;
}

function wantsOutOfJail(s: GameState): boolean {
  const unowned = s.deeds.filter((deed) => deed && deed.owner === null).length;
  const buildings = s.deeds.some((deed) => deed && deed.level > 0);
  return unowned > 5 || !buildings;
}

function chooseRollPhase(s: GameState, me: PlayerId): Action {
  const p = playerOf(s, me);
  const managed = manage(s, me);
  if (managed) return managed;
  const trade = proposeTrade(s, me);
  if (trade) return trade;
  if (p.inJail && wantsOutOfJail(s)) {
    if (p.jailCards.length > 0) return { type: 'useJailCard', player: me };
    if (p.cash >= JAIL_BAIL + botOf(s, me).traits.buyReserve) {
      return { type: 'payBail', player: me };
    }
  }
  return { type: 'roll', player: me };
}

function chooseBuy(s: GameState, me: PlayerId): Action {
  const tile = s.pendingBuy!;
  const price = ownablePrice(tile) ?? 0;
  const p = playerOf(s, me);
  const { traits } = botOf(s, me);
  if (p.cash < price) return { type: 'decline', player: me };
  const valuable = wouldComplete(s, me, tile) || tileValue(s, me, tile) > price;
  const reserve = valuable ? traits.buyReserve / 2 : traits.buyReserve;
  return p.cash - price >= reserve ? { type: 'buy', player: me } : { type: 'decline', player: me };
}

/** Vrátí jednu legální akci bota, který je právě na řadě. Rozhodnutí závisí jen na stavu. */
export function chooseBotAction(s: GameState, me: PlayerId): Action {
  if (actorOf(s) !== me) throw new Error('Bot není na řadě');
  if (s.trade) {
    return acceptsTrade(s, me, s.trade)
      ? { type: 'acceptTrade', player: me }
      : { type: 'rejectTrade', player: me };
  }
  const debt = s.debts[0];
  if (debt) {
    return playerOf(s, me).cash >= debt.amount
      ? { type: 'settleDebt', player: me }
      : raiseCash(s, me, debt.amount);
  }
  if (s.auction) return chooseBid(s, me);
  if (s.phase === 'awaitBuy') return chooseBuy(s, me);
  if (s.phase === 'awaitRoll') return chooseRollPhase(s, me);
  return manage(s, me) ?? { type: 'endTurn', player: me };
}
