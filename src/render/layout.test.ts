import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '../core';
import {
  LOT_OUTER,
  ROAD_CENTER,
  ROAD_WIDTH,
  TILE_PITCH,
  buildRect,
  drivePath,
  lanePoint,
  lotRect,
  plaqueRect,
  roadPoint,
} from './layout';
import type { Rect } from './layout';

const tiles = Array.from({ length: BOARD_SIZE }, (_, id) => id);

function inside(inner: Rect, outer: Rect): boolean {
  const eps = 1e-9;
  return (
    Math.abs(inner.x - outer.x) + inner.w / 2 <= outer.w / 2 + eps &&
    Math.abs(inner.z - outer.z) + inner.d / 2 <= outer.d / 2 + eps
  );
}

describe('půdorys města', () => {
  it('políčka tvoří uzavřený okruh se stejnými rozestupy', () => {
    for (const tile of tiles) {
      const a = roadPoint(tile);
      const b = roadPoint((tile + 1) % BOARD_SIZE);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(TILE_PITCH);
    }
    expect(new Set(tiles.map((t) => `${roadPoint(t).x},${roadPoint(t).z}`)).size).toBe(BOARD_SIZE);
  });

  it('Start je jihovýchodně a okruh jde stejným směrem jako 2D deska', () => {
    expect(roadPoint(0)).toEqual({ x: ROAD_CENTER, z: ROAD_CENTER });
    expect(roadPoint(10)).toEqual({ x: -ROAD_CENTER, z: ROAD_CENTER });
    expect(roadPoint(20)).toEqual({ x: -ROAD_CENTER, z: -ROAD_CENTER });
    expect(roadPoint(30)).toEqual({ x: ROAD_CENTER, z: -ROAD_CENTER });
  });

  it('běžná parcela leží vně silnice a na ostrově', () => {
    const roadEdge = ROAD_CENTER + ROAD_WIDTH / 2;
    for (const tile of tiles.filter((t) => t % 10 !== 0)) {
      const lot = lotRect(tile);
      const nearest = Math.max(
        Math.abs(lot.x) - lot.w / 2 + (lot.w > lot.d ? 0 : -Infinity),
        Math.abs(lot.z) - lot.d / 2 + (lot.d > lot.w ? 0 : -Infinity),
      );
      expect(nearest).toBeGreaterThanOrEqual(roadEdge - 1e-9);
      expect(Math.abs(lot.x) + lot.w / 2).toBeLessThanOrEqual(LOT_OUTER + 1e-9);
      expect(Math.abs(lot.z) + lot.d / 2).toBeLessThanOrEqual(LOT_OUTER + 1e-9);
    }
  });

  it('sousední běžné parcely se nepřekrývají', () => {
    for (const tile of tiles.filter((t) => t % 10 !== 0 && (t + 1) % 10 !== 0)) {
      const a = lotRect(tile);
      const b = lotRect(tile + 1);
      const apartX = Math.abs(a.x - b.x) >= (a.w + b.w) / 2;
      const apartZ = Math.abs(a.z - b.z) >= (a.d + b.d) / 2;
      expect(apartX || apartZ).toBe(true);
    }
  });

  it('štítek a stavba se vejdou na parcelu a nepřekrývají se', () => {
    for (const tile of tiles) {
      const lot = lotRect(tile);
      const plaque = plaqueRect(tile);
      const build = buildRect(tile);
      expect(inside(plaque, lot)).toBe(true);
      expect(inside(build, lot)).toBe(true);
      expect(plaque.z).toBeGreaterThan(build.z);
      expect(plaque.z - plaque.d / 2).toBeGreaterThanOrEqual(build.z + build.d / 2 - 1e-9);
    }
  });

  it('čtyři auta na stejném políčku mají různé pruhy na silnici', () => {
    for (const tile of tiles) {
      const points = [0, 1, 2, 3].map((p) => lanePoint(tile, p));
      expect(new Set(points.map((p) => `${p.x},${p.z}`)).size).toBe(4);
      for (const point of points) {
        expect(Math.max(Math.abs(point.x), Math.abs(point.z))).toBeLessThanOrEqual(
          ROAD_CENTER + ROAD_WIDTH / 2,
        );
      }
    }
  });
});

describe('trasa auta', () => {
  it('jede dopředu přes všechna políčka', () => {
    expect(drivePath(5, 9)).toEqual([6, 7, 8, 9]);
  });

  it('projede přes Start', () => {
    expect(drivePath(38, 2)).toEqual([39, 0, 1, 2]);
  });

  it('karta „o 3 pole zpět“ jede pozpátku', () => {
    expect(drivePath(7, 4)).toEqual([6, 5, 4]);
    expect(drivePath(1, 38)).toEqual([0, 39, 38]);
  });

  it('karta posílající o dvě pole níž jede celý okruh dopředu', () => {
    expect(drivePath(7, 5)).toHaveLength(38);
  });

  it('stání na místě nemá trasu', () => {
    expect(drivePath(12, 12)).toEqual([]);
  });
});
