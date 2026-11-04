import { BOARD_SIZE } from '../core';
import type { PlayerId, TileId } from '../core';

/** Půdorys města ve světových jednotkách. Osa +x je východ, +z jih (blíž ke kameře). */
export const ROAD_CENTER = 10;
export const TILE_PITCH = 2;
export const ROAD_WIDTH = 1.8;
export const LOT_DEPTH = 2.6;
export const LOT_OUTER = ROAD_CENTER + ROAD_WIDTH / 2 + LOT_DEPTH;
export const ISLAND_HALF = LOT_OUTER + 0.7;
const LANE_GAP = 0.42;
const BACK_STEPS = 3;

export type Side = 'south' | 'west' | 'north' | 'east';

export interface Point {
  x: number;
  z: number;
}

export interface Rect extends Point {
  /** Rozměr v ose x. */
  w: number;
  /** Rozměr v ose z. */
  d: number;
}

export function isCorner(tile: TileId): boolean {
  return tile % 10 === 0;
}

/** Strana okruhu. Rohy patří ke straně, která jimi začíná. Pořadí odpovídá 2D desce. */
export function sideOf(tile: TileId): Side {
  if (tile < 10) return 'south';
  if (tile < 20) return 'west';
  if (tile < 30) return 'north';
  return 'east';
}

/** Střed silnice u daného políčka. */
export function roadPoint(tile: TileId): Point {
  const offset = (tile % 10) * TILE_PITCH;
  switch (sideOf(tile)) {
    case 'south':
      return { x: ROAD_CENTER - offset, z: ROAD_CENTER };
    case 'west':
      return { x: -ROAD_CENTER, z: ROAD_CENTER - offset };
    case 'north':
      return { x: -ROAD_CENTER + offset, z: -ROAD_CENTER };
    case 'east':
      return { x: ROAD_CENTER, z: -ROAD_CENTER + offset };
  }
}

/** Vlastní jízdní pruh hráče, aby se auta na stejném políčku nepřekrývala. */
export function lanePoint(tile: TileId, player: PlayerId): Point {
  const lane = (player - 1.5) * LANE_GAP;
  const road = roadPoint(tile);
  if (isCorner(tile)) {
    return { x: road.x + Math.sign(road.x) * lane, z: road.z + Math.sign(road.z) * lane };
  }
  const side = sideOf(tile);
  if (side === 'south' || side === 'north') {
    return { x: road.x, z: road.z + Math.sign(road.z) * lane };
  }
  return { x: road.x + Math.sign(road.x) * lane, z: road.z };
}

/** Parcela políčka. Rohová parcela zasahuje pod křižovatku, silnice leží nad ní. */
export function lotRect(tile: TileId): Rect {
  const road = roadPoint(tile);
  const outerCenter = ROAD_CENTER + ROAD_WIDTH / 2 + LOT_DEPTH / 2;
  if (isCorner(tile)) {
    const inner = ROAD_CENTER - TILE_PITCH / 2;
    const center = (inner + LOT_OUTER) / 2;
    const size = LOT_OUTER - inner;
    return { x: Math.sign(road.x) * center, z: Math.sign(road.z) * center, w: size, d: size };
  }
  const width = TILE_PITCH - 0.12;
  const side = sideOf(tile);
  if (side === 'south' || side === 'north') {
    return { x: road.x, z: Math.sign(road.z) * outerCenter, w: width, d: LOT_DEPTH };
  }
  return { x: Math.sign(road.x) * outerCenter, z: road.z, w: LOT_DEPTH, d: width };
}

/**
 * Štítek leží vždy na jižní půlce parcely a budovy na severní.
 * Výchozí kamera se dívá od jihu, takže budova štítek nezakryje.
 */
export function plaqueRect(tile: TileId): Rect {
  const lot = lotRect(tile);
  if (isCorner(tile)) {
    const z = lot.z > 0 ? LOT_OUTER - 0.55 : -ROAD_CENTER - ROAD_WIDTH / 2 - 0.55;
    return { x: lot.x, z, w: 3.4, d: 0.95 };
  }
  if (lot.w < lot.d) return { x: lot.x, z: lot.z + lot.d / 2 - 0.62, w: lot.w - 0.06, d: 1.16 };
  return { x: lot.x, z: lot.z + lot.d / 2 - 0.42, w: lot.w - 0.08, d: 0.78 };
}

/** Plocha pro budovy a stavby na parcele. */
export function buildRect(tile: TileId): Rect {
  const lot = lotRect(tile);
  if (isCorner(tile)) {
    const z = lot.z > 0 ? ROAD_CENTER + ROAD_WIDTH / 2 + 0.7 : -LOT_OUTER + 0.75;
    return { x: lot.x, z, w: 3.6, d: 1.3 };
  }
  if (lot.w < lot.d) return { x: lot.x, z: lot.z - 0.66, w: lot.w - 0.14, d: 1.26 };
  return { x: lot.x, z: lot.z - 0.44, w: lot.w - 0.14, d: 0.92 };
}

/**
 * Políčka, kterými auto projede, bez výchozího. Jízda dozadu existuje jen u karty
 * „o 3 pole zpět“, všechno ostatní jede po směru okruhu.
 */
export function drivePath(from: TileId, to: TileId): TileId[] {
  const forward = (to - from + BOARD_SIZE) % BOARD_SIZE;
  const path: TileId[] = [];
  if (forward === BOARD_SIZE - BACK_STEPS) {
    for (let i = 1; i <= BACK_STEPS; i++) path.push((from - i + BOARD_SIZE) % BOARD_SIZE);
    return path;
  }
  for (let i = 1; i <= forward; i++) path.push((from + i) % BOARD_SIZE);
  return path;
}
