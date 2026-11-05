import {
  BUSINESS,
  GROUP_ORDER,
  HOTEL_LEVEL,
  MAX_TRADES_PER_TURN,
  MIN_BID_STEP,
  MONEY_UNIT,
  MORTGAGE_INTEREST,
  STATION_RENTS,
  UTILITY_RATE_BOTH,
  UTILITY_RATE_ONE,
  groupTiles,
  ownablePrice,
  tileAt,
  tilesOfKind,
} from './board';
import type { Deed, GameState, PlayerId, TileId, TradeOffer, TradeSide } from './types';

export function deedOf(s: GameState, tile: TileId): Deed {
  const deed = s.deeds[tile];
  if (!deed) throw new Error(`Políčko ${tile} nejde vlastnit`);
  return deed;
}

export function playerOf(s: GameState, id: PlayerId) {
  const player = s.players[id];
  if (!player) throw new Error(`Neznámý hráč ${id}`);
  return player;
}

/**
 * Kdo musí teď jednat. Obchod má přednost před dluhem, dluh před dražbou a ta před tahem.
 * V živé dražbě není na řadě nikdo, přihazovat smí všichni najednou.
 */
export function actorOf(s: GameState): PlayerId | null {
  if (s.phase === 'gameOver') return null;
  if (s.trade) return s.trade.to;
  const debt = s.debts[0];
  if (debt) return debt.player;
  if (s.auction) return s.auction.live ? null : (s.auction.bidders[s.auction.index] ?? null);
  return s.active;
}

/** Spravovat majetek lze na vlastním tahu nebo během vlastního dluhu. */
export function canManage(s: GameState, player: PlayerId): boolean {
  if (s.trade || s.auction) return false;
  if (s.phase === 'gameOver' || s.phase === 'chase' || s.phase === 'breakout') return false;
  return actorOf(s) === player && !playerOf(s, player).bankrupt;
}

export function ownsWholeGroup(s: GameState, player: PlayerId, tile: TileId): boolean {
  const t = tileAt(tile);
  if (t.kind !== 'property') return false;
  return groupTiles(t.group).every((id) => deedOf(s, id).owner === player);
}

export function tilesOwnedBy(s: GameState, player: PlayerId): TileId[] {
  const result: TileId[] = [];
  s.deeds.forEach((deed, id) => {
    if (deed?.owner === player) result.push(id);
  });
  return result;
}

export function rentOf(s: GameState, tile: TileId, diceSum: number): number {
  const deed = deedOf(s, tile);
  if (deed.owner === null || deed.mortgaged) return 0;
  const t = tileAt(tile);
  const owner = deed.owner;
  if (t.kind === 'property') {
    const rent = t.rents[deed.level] ?? 0;
    return deed.level === 0 && ownsWholeGroup(s, owner, tile) ? rent * 2 : rent;
  }
  if (t.kind === 'station') {
    const count = tilesOfKind('station').filter((id) => deedOf(s, id).owner === owner).length;
    return STATION_RENTS[count - 1] ?? 0;
  }
  if (t.kind === 'utility') {
    const both = tilesOfKind('utility').every((id) => deedOf(s, id).owner === owner);
    return diceSum * (both ? UTILITY_RATE_BOTH : UTILITY_RATE_ONE);
  }
  return 0;
}

export function mortgageValue(tile: TileId): number {
  return Math.floor((ownablePrice(tile) ?? 0) / 2);
}

export function mortgageInterest(tile: TileId): number {
  return Math.ceil((mortgageValue(tile) * MORTGAGE_INTEREST) / MONEY_UNIT) * MONEY_UNIT;
}

export function unmortgageCost(tile: TileId): number {
  return mortgageValue(tile) + mortgageInterest(tile);
}

/** Cena domu pro konkrétního hráče. Developer staví levněji. */
export function buildCost(s: GameState, player: PlayerId, tile: TileId): number {
  const t = tileAt(tile);
  if (t.kind !== 'property') return 0;
  const archetype = playerOf(s, player).archetype;
  const discount = (archetype && BUSINESS?.perks[archetype].buildDiscountPct) || 0;
  return Math.ceil((t.houseCost * (100 - discount)) / 100 / MONEY_UNIT) * MONEY_UNIT;
}

/** Tržní hodnota všech akcií hráče. */
export function sharesValue(s: GameState, player: PlayerId): number {
  const { market } = s;
  if (!market) return 0;
  const p = playerOf(s, player);
  return GROUP_ORDER.reduce(
    (sum, group) => sum + (p.shares[group]?.count ?? 0) * market.prices[group],
    0,
  );
}

export function canBuild(s: GameState, player: PlayerId, tile: TileId): boolean {
  if (!canManage(s, player) || s.debts.length > 0) return false;
  const t = tileAt(tile);
  if (t.kind !== 'property' || !ownsWholeGroup(s, player, tile)) return false;
  const group = groupTiles(t.group).map((id) => deedOf(s, id));
  if (group.some((deed) => deed.mortgaged)) return false;
  const level = deedOf(s, tile).level;
  if (level >= HOTEL_LEVEL || level > Math.min(...group.map((deed) => deed.level))) return false;
  if (playerOf(s, player).cash < buildCost(s, player, tile)) return false;
  return level === HOTEL_LEVEL - 1 ? s.hotelsLeft > 0 : s.housesLeft > 0;
}

export function canSellBuilding(s: GameState, player: PlayerId, tile: TileId): boolean {
  if (!canManage(s, player)) return false;
  const t = tileAt(tile);
  if (t.kind !== 'property') return false;
  const deed = deedOf(s, tile);
  if (deed.owner !== player || deed.level === 0) return false;
  const max = Math.max(...groupTiles(t.group).map((id) => deedOf(s, id).level));
  if (deed.level < max) return false;
  return deed.level < HOTEL_LEVEL || s.housesLeft >= HOTEL_LEVEL - 1;
}

export function hasBuildingsInGroup(s: GameState, tile: TileId): boolean {
  const t = tileAt(tile);
  return t.kind === 'property' && groupTiles(t.group).some((id) => deedOf(s, id).level > 0);
}

export function canMortgage(s: GameState, player: PlayerId, tile: TileId): boolean {
  if (!canManage(s, player) || ownablePrice(tile) === null) return false;
  const deed = deedOf(s, tile);
  return deed.owner === player && !deed.mortgaged && !hasBuildingsInGroup(s, tile);
}

export function canUnmortgage(s: GameState, player: PlayerId, tile: TileId): boolean {
  if (!canManage(s, player) || s.debts.length > 0 || ownablePrice(tile) === null) return false;
  const deed = deedOf(s, tile);
  return (
    deed.owner === player && deed.mortgaged && playerOf(s, player).cash >= unmortgageCost(tile)
  );
}

/** Po kolika klepnutích bez příhozu kladívko dražbu ukončí: poprvé, podruhé, potřetí. */
export const GAVEL_KNOCKS = 3;

export function minBid(s: GameState): number {
  return s.auction ? s.auction.bid + MIN_BID_STEP : MIN_BID_STEP;
}

function validSide(s: GameState, player: PlayerId, side: TradeSide): boolean {
  const p = playerOf(s, player);
  const integer = Number.isInteger(side.cash) && Number.isInteger(side.jailCards);
  if (!integer || side.cash < 0 || side.jailCards < 0) return false;
  if (side.cash > p.cash || side.jailCards > p.jailCards.length) return false;
  if (new Set(side.tiles).size !== side.tiles.length) return false;
  return side.tiles.every(
    (tile) =>
      ownablePrice(tile) !== null &&
      deedOf(s, tile).owner === player &&
      !hasBuildingsInGroup(s, tile),
  );
}

function isEmptySide(side: TradeSide): boolean {
  return side.tiles.length === 0 && side.cash === 0 && side.jailCards === 0;
}

export function isValidTrade(s: GameState, offer: TradeOffer): boolean {
  if (offer.from === offer.to) return false;
  const target = s.players[offer.to];
  if (!target || target.bankrupt) return false;
  if (isEmptySide(offer.give) && isEmptySide(offer.get)) return false;
  return validSide(s, offer.from, offer.give) && validSide(s, offer.to, offer.get);
}

export function canProposeTrade(s: GameState, player: PlayerId): boolean {
  // Během rozhodování o nájmu by obchod mohl změnit majitele pozemku, o který jde.
  if (s.phase === 'awaitRent') return false;
  return canManage(s, player) && s.tradesThisTurn < MAX_TRADES_PER_TURN;
}

/** Hotovost, akcie, černé po srážce a hodnota pozemků a budov. */
export function netWorth(s: GameState, player: PlayerId): number {
  const p = playerOf(s, player);
  if (p.bankrupt) return 0;
  const dirtyPct = BUSINESS?.dirtyWorthPct ?? 0;
  let total = p.cash + sharesValue(s, player) + Math.floor((p.dirty * dirtyPct) / 100);
  for (const tile of tilesOwnedBy(s, player)) {
    const deed = deedOf(s, tile);
    total += deed.mortgaged ? mortgageValue(tile) : (ownablePrice(tile) ?? 0);
    const t = tileAt(tile);
    if (t.kind === 'property') total += deed.level * t.houseCost;
  }
  return total;
}

/** Kolik by hráč maximálně získal prodejem akcií a budov a zastavením všeho. */
export function liquidationValue(s: GameState, player: PlayerId): number {
  let total = playerOf(s, player).cash + sharesValue(s, player);
  for (const tile of tilesOwnedBy(s, player)) {
    const deed = deedOf(s, tile);
    if (!deed.mortgaged) total += mortgageValue(tile);
    const t = tileAt(tile);
    if (t.kind === 'property') total += Math.floor((deed.level * t.houseCost) / 2);
  }
  return total;
}
