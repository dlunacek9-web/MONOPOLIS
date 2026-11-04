import type { GroupId, Tile, TileId } from './types';

export const BOARD_SIZE = 40;
export const JAIL_TILE: TileId = 10;
export const START_CASH = 1_500_000;
export const START_SALARY = 200_000;
export const JAIL_BAIL = 50_000;
export const MAX_JAIL_ATTEMPTS = 3;
export const MIN_BID_STEP = 10_000;
export const TOTAL_HOUSES = 32;
export const TOTAL_HOTELS = 12;
export const HOTEL_LEVEL = 5;
export const MAX_TRADES_PER_TURN = 3;
export const MORTGAGE_INTEREST = 0.1;
export const STATION_RENTS: readonly number[] = [30_000, 60_000, 120_000, 240_000];
export const UTILITY_RATE_ONE = 4_000;
export const UTILITY_RATE_BOTH = 10_000;

const GROUP_INFO: Record<GroupId, { houseCost: number; multipliers: readonly number[] }> = {
  most: { houseCost: 60_000, multipliers: [5, 15, 40, 65, 90] },
  ostrava: { houseCost: 60_000, multipliers: [5, 15, 40, 58, 78] },
  usti: { houseCost: 110_000, multipliers: [5, 14, 40, 55, 70] },
  olomouc: { houseCost: 110_000, multipliers: [5, 14, 38, 50, 62] },
  plzen: { houseCost: 160_000, multipliers: [5, 14, 36, 46, 56] },
  brno: { houseCost: 160_000, multipliers: [5, 14, 34, 42, 50] },
  vary: { houseCost: 210_000, multipliers: [5, 13, 32, 39, 46] },
  praha: { houseCost: 210_000, multipliers: [4, 12, 28, 34, 40] },
};

function property(group: GroupId, price: number, baseRent: number): Tile {
  const { houseCost, multipliers } = GROUP_INFO[group];
  const rents = [baseRent, ...multipliers.map((m) => Math.round((baseRent * m) / 1000) * 1000)];
  return { kind: 'property', group, price, rents, houseCost };
}

const tipCard: Tile = { kind: 'card', deck: 'tip' };
const uradCard: Tile = { kind: 'card', deck: 'urad' };
const station: Tile = { kind: 'station', price: 200_000 };
const utility: Tile = { kind: 'utility', price: 150_000 };

/** Názvy políček jsou v `src/i18n/cs.ts` podle stejného indexu. */
export const BOARD: readonly Tile[] = [
  { kind: 'start' },
  property('most', 70_000, 3_000),
  uradCard,
  property('most', 90_000, 5_000),
  { kind: 'tax', amount: 200_000 },
  station,
  property('ostrava', 110_000, 7_000),
  tipCard,
  property('ostrava', 110_000, 7_000),
  property('ostrava', 130_000, 9_000),
  { kind: 'jail' },
  property('usti', 150_000, 11_000),
  utility,
  property('usti', 150_000, 11_000),
  property('usti', 170_000, 13_000),
  station,
  property('olomouc', 190_000, 15_000),
  uradCard,
  property('olomouc', 190_000, 15_000),
  property('olomouc', 210_000, 17_000),
  { kind: 'parking' },
  property('plzen', 230_000, 19_000),
  tipCard,
  property('plzen', 230_000, 19_000),
  property('plzen', 250_000, 21_000),
  station,
  property('brno', 270_000, 23_000),
  property('brno', 270_000, 23_000),
  utility,
  property('brno', 290_000, 25_000),
  { kind: 'goToJail' },
  property('vary', 310_000, 27_000),
  property('vary', 310_000, 27_000),
  uradCard,
  property('vary', 330_000, 30_000),
  station,
  tipCard,
  property('praha', 370_000, 36_000),
  { kind: 'tax', amount: 100_000 },
  property('praha', 420_000, 52_000),
];

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
