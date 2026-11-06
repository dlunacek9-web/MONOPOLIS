import type { HeistTarget } from '../../core';
import { randomFrom } from '../random';
import type { Point, Rect } from '../topdown';

export type ObstacleKind = 'wall' | 'pillar' | 'counter' | 'desk' | 'shelf' | 'van';

export interface Obstacle extends Rect {
  kind: ObstacleKind;
}

export interface CameraPath extends Point {
  /** Směr, kam kamera kouká uprostřed svého kývání. */
  yaw: number;
  sweep: number;
  speed: number;
  phase: number;
}

export interface HeistMap {
  seed: number;
  target: HeistTarget;
  start: Point;
  /** Kde se nastupuje do dodávky. */
  van: Point;
  /** Kde se stojí při otevírání trezoru. */
  vaultSpot: Point;
  door: Rect;
  obstacles: Obstacle[];
  cameras: CameraPath[];
  bags: Point[];
  /** Odkud po poplachu přichází policie, v tomhle pořadí. */
  copSpawns: Point[];
  tumblers: number;
}

export const HALF_X = 26;
export const HALF_Z = 20;
/** Jižní zeď budovy. Před ní je ulice s dodávkou. */
export const FRONT_Z = 11;
/** Zeď mezi halou a zadními místnostmi. */
export const BACK_Z = -2;
/** Boční zdi trezoru. */
export const VAULT_X = 9;
const WALL = 0.5;
const SIDE_DOOR_X = 17;
const SIDE_DOOR_HALF = 2;
const FRONT_DOOR_X = 16;
const FRONT_DOOR_HALF = 2.5;
const VAULT_DOOR_HALF = 2.5;

function wall(fromX: number, toX: number, fromZ: number, toZ: number): Obstacle {
  return {
    kind: 'wall',
    x: (fromX + toX) / 2,
    z: (fromZ + toZ) / 2,
    hx: (toX - fromX) / 2,
    hz: (toZ - fromZ) / 2,
  };
}

function horizontalWall(z: number, gaps: readonly [number, number][]): Obstacle[] {
  const result: Obstacle[] = [];
  let from = -HALF_X;
  for (const [gapFrom, gapTo] of gaps) {
    result.push(wall(from, gapFrom, z - WALL, z + WALL));
    from = gapTo;
  }
  result.push(wall(from, HALF_X, z - WALL, z + WALL));
  return result;
}

function walls(): Obstacle[] {
  return [
    ...horizontalWall(FRONT_Z, [
      [-FRONT_DOOR_X - FRONT_DOOR_HALF, -FRONT_DOOR_X + FRONT_DOOR_HALF],
      [FRONT_DOOR_X - FRONT_DOOR_HALF, FRONT_DOOR_X + FRONT_DOOR_HALF],
    ]),
    ...horizontalWall(BACK_Z, [
      [-SIDE_DOOR_X - SIDE_DOOR_HALF, -SIDE_DOOR_X + SIDE_DOOR_HALF],
      [-VAULT_DOOR_HALF, VAULT_DOOR_HALF],
      [SIDE_DOOR_X - SIDE_DOOR_HALF, SIDE_DOOR_X + SIDE_DOOR_HALF],
    ]),
    wall(-VAULT_X - WALL, -VAULT_X + WALL, -HALF_Z, BACK_Z),
    wall(VAULT_X - WALL, VAULT_X + WALL, -HALF_Z, BACK_Z),
  ];
}

function furniture(random: () => number): Obstacle[] {
  const result: Obstacle[] = [
    { kind: 'counter', x: 0, z: 6, hx: 6, hz: 0.8 },
    { kind: 'van', x: 0, z: 16, hx: 3.4, hz: 1.7 },
    // Regály v trezoru svírají cestu k pytlům.
    { kind: 'shelf', x: -6.5, z: -8, hx: 0.8, hz: 3.2 },
    { kind: 'shelf', x: 6.5, z: -8, hx: 0.8, hz: 3.2 },
  ];
  // Sloupy kryjí před kamerami a po poplachu se kolem nich dá kličkovat.
  for (const x of [-21, -10.5, 10.5, 21]) {
    for (const z of [1.8, 7.4]) {
      if (random() < 0.8) result.push({ kind: 'pillar', x, z, hx: 0.9, hz: 0.9 });
    }
  }
  for (const side of [-1, 1]) {
    result.push({ kind: 'desk', x: side * 14, z: -8, hx: 1, hz: 2.4 });
    result.push({ kind: 'desk', x: side * 22, z: -11, hx: 1, hz: 2.4 });
  }
  return result;
}

function createCameras(target: HeistTarget, random: () => number): CameraPath[] {
  // Kamery visí na zdech haly a koukají dovnitř: zezadu k obrazovce, zepředu od ní.
  const fromBack = 0;
  const fromFront = Math.PI;
  const places = [
    { x: -9, z: BACK_Z + 0.7, yaw: fromBack },
    { x: 9, z: BACK_Z + 0.7, yaw: fromBack },
    { x: -5, z: FRONT_Z - 0.7, yaw: fromFront },
    { x: 5, z: FRONT_Z - 0.7, yaw: fromFront },
  ];
  const count = target === 'bank' ? 4 : 2;
  return places.slice(0, count).map((place) => ({
    ...place,
    sweep: 0.75 + random() * 0.25,
    speed: 0.8 + random() * 0.35,
    phase: random() * Math.PI * 2,
  }));
}

/** Pytle: většina v trezoru, po jednom v kancelářích. Pro ty se musí odbočit. */
function createBags(target: HeistTarget, random: () => number): Point[] {
  const inVault = target === 'bank' ? 4 : 2;
  const vault: Point[] = [];
  for (let i = 0; i < inVault; i++) {
    const column = i - (inVault - 1) / 2;
    vault.push({ x: column * 2.2, z: -15 + (i % 2) * 1.6 });
  }
  const office = (side: number): Point => ({
    x: side * (17 + random() * 6),
    z: -15.5 - random() * 2,
  });
  return [...vault, office(-1), office(1)];
}

/** Budova na jedné mapě pro banku i hotel. Stejný seed dá stejné rozestavění. */
export function createHeistMap(target: HeistTarget, seed: number): HeistMap {
  const random = randomFrom(seed);
  const side = random() < 0.5 ? -1 : 1;
  return {
    seed,
    target,
    start: { x: side * 7, z: 15.5 },
    van: { x: 0, z: 16 },
    vaultSpot: { x: 0, z: BACK_Z + 1.3 },
    door: { x: 0, z: BACK_Z, hx: VAULT_DOOR_HALF, hz: WALL },
    obstacles: [...walls(), ...furniture(random)],
    cameras: createCameras(target, random),
    bags: createBags(target, random),
    // První dva přijdou zadem a dohánějí, až později přijede hlídka z ulice a zavře cestu.
    copSpawns: [
      { x: -HALF_X + 2, z: -HALF_Z + 1.5 },
      { x: HALF_X - 2, z: -HALF_Z + 1.5 },
      { x: -HALF_X + 1.5, z: 16 },
      { x: HALF_X - 1.5, z: 16 },
    ],
    tumblers: target === 'bank' ? 3 : 2,
  };
}
