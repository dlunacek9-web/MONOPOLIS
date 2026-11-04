import { NEXTLEVEL } from './sets/nextlevel';
import type { GroupId, Ruleset, Tile, TileId } from './types';

export const BOARD_SIZE = 40;
export const JAIL_TILE: TileId = 10;
export const MAX_JAIL_ATTEMPTS = 3;
export const HOTEL_LEVEL = 5;
export const MAX_TRADES_PER_TURN = 3;
export const MORTGAGE_INTEREST = 0.1;

/**
 * Aktivní sada pravidel. Hodnoty se přepínají jen přes `installRuleset` (viz `useRuleset`),
 * ostatní moduly je čtou jako živé importy.
 */
export let BOARD: readonly Tile[] = NEXTLEVEL.board;
export let MONEY_UNIT = NEXTLEVEL.moneyUnit;
export let START_CASH = NEXTLEVEL.startCash;
export let START_SALARY = NEXTLEVEL.startSalary;
export let JAIL_BAIL = NEXTLEVEL.jailBail;
export let MIN_BID_STEP = NEXTLEVEL.minBidStep;
export let STATION_RENTS: readonly number[] = NEXTLEVEL.stationRents;
export let UTILITY_RATE_ONE = NEXTLEVEL.utilityRateOne;
export let UTILITY_RATE_BOTH = NEXTLEVEL.utilityRateBoth;
export let TOTAL_HOUSES = NEXTLEVEL.totalHouses;
export let TOTAL_HOTELS = NEXTLEVEL.totalHotels;

export function installBoard(set: Ruleset): void {
  BOARD = set.board;
  MONEY_UNIT = set.moneyUnit;
  START_CASH = set.startCash;
  START_SALARY = set.startSalary;
  JAIL_BAIL = set.jailBail;
  MIN_BID_STEP = set.minBidStep;
  STATION_RENTS = set.stationRents;
  UTILITY_RATE_ONE = set.utilityRateOne;
  UTILITY_RATE_BOTH = set.utilityRateBoth;
  TOTAL_HOUSES = set.totalHouses;
  TOTAL_HOTELS = set.totalHotels;
}

export const GROUP_ORDER: readonly GroupId[] = [
  'most',
  'ostrava',
  'usti',
  'olomouc',
  'plzen',
  'brno',
  'vary',
  'praha',
];

export function tileAt(tile: TileId): Tile {
  const result = BOARD[tile];
  if (!result) throw new Error(`Neplatné políčko ${tile}`);
  return result;
}

export function groupTiles(group: GroupId): TileId[] {
  const result: TileId[] = [];
  BOARD.forEach((tile, id) => {
    if (tile.kind === 'property' && tile.group === group) result.push(id);
  });
  return result;
}

export function tilesOfKind(kind: 'station' | 'utility'): TileId[] {
  const result: TileId[] = [];
  BOARD.forEach((tile, id) => {
    if (tile.kind === kind) result.push(id);
  });
  return result;
}

export function ownablePrice(tile: TileId): number | null {
  const t = tileAt(tile);
  return t.kind === 'property' || t.kind === 'station' || t.kind === 'utility' ? t.price : null;
}
