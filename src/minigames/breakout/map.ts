import { randomFrom } from '../random';
import type { Point, Rect } from '../topdown';

export type { Point };

export type ObstacleKind = 'wall' | 'crates' | 'van' | 'shed';

export interface Obstacle extends Rect {
  kind: ObstacleKind;
}

export interface Patrol {
  corners: Point[];
  /** Index rohu, ke kterému bachař vyráží. */
  first: number;
}

export interface SpotPath extends Point {
  ax: number;
  az: number;
  fx: number;
  fz: number;
  phase: number;
  /** Rohová věž, ze které reflektor svítí. */
  tower: Point;
}

export interface YardMap {
  seed: number;
  start: Point;
  key: Point;
  gate: Point;
  obstacles: Obstacle[];
  patrols: Patrol[];
  spots: SpotPath[];
}

export const COLS = 5;
export const ROWS = 4;
export const CELL_X = 12;
export const CELL_Z = 11;
export const HALF_X = (COLS * CELL_X) / 2;
export const HALF_Z = (ROWS * CELL_Z) / 2;
export const GATE_WIDTH = 6;
/** Bachaři chodí kousek od zdi, ať je vidět celá postava. */
const WALL_MARGIN = 1.3;
const MIN_GUARD_START_DISTANCE = 12;
const OBSTACLE_CHANCE = 0.8;

export function cellCenter(col: number, row: number): Point {
  return { x: (col + 0.5) * CELL_X - HALF_X, z: (row + 0.5) * CELL_Z - HALF_Z };
}

/** Křižovatka uliček mezi překážkami. Uličky jsou volné z konstrukce, takže dvůr jde vždy projít. */
function node(col: number, row: number): Point {
  const x = col * CELL_X - HALF_X;
  const z = row * CELL_Z - HALF_Z;
  return {
    x: Math.max(-HALF_X + WALL_MARGIN, Math.min(HALF_X - WALL_MARGIN, x)),
    z: Math.max(-HALF_Z + WALL_MARGIN, Math.min(HALF_Z - WALL_MARGIN, z)),
  };
}

function createObstacle(cell: Point, random: () => number): Obstacle {
  const roll = random();
  const across = random() < 0.5;
  if (roll < 0.34) {
    return { ...cell, kind: 'wall', ...(across ? { hx: 4.2, hz: 0.6 } : { hx: 0.6, hz: 3.8 }) };
  }
  if (roll < 0.58) return { ...cell, kind: 'crates', hx: 2.2, hz: 2.2 };
  if (roll < 0.8) {
    return { ...cell, kind: 'van', ...(across ? { hx: 3.4, hz: 1.7 } : { hx: 1.7, hz: 3.4 }) };
  }
  return { ...cell, kind: 'shed', hx: 3, hz: 2.5 };
}

/** Každý ze tří bachařů obchází svůj blok uliček. */
function createPatrols(start: Point, random: () => number): Patrol[] {
  // Střední bachař hlídá spodek dvora, krajní horní část s klíčem a bránou.
  const blocks = [
    { left: 0, top: 0 },
    { left: 1, top: 2 },
    { left: 3, top: 0 },
  ];
  return blocks.map(({ left, top }) => {
    const bottom = top + 1 + Math.floor(random() * (ROWS - top - 1));
    const right = left + 2 + (left === 1 ? 1 : 0);
    const corners = [node(left, top), node(right, top), node(right, bottom), node(left, bottom)];
    if (random() < 0.5) corners.reverse();
    // Začíná v rohu dál od startu, ať hráč není vidět hned po odpočtu.
    const options = corners
      .map((corner, index) => ({ index, far: Math.hypot(corner.x - start.x, corner.z - start.z) }))
      .filter((option) => option.far >= MIN_GUARD_START_DISTANCE);
    const standing = options[Math.floor(random() * options.length)]?.index ?? 0;
    return { corners, first: (standing + 1) % corners.length };
  });
}

function createSpots(random: () => number): SpotPath[] {
  const towers = [
    { x: -HALF_X, z: -HALF_Z },
    { x: HALF_X, z: -HALF_Z },
  ];
  return towers.map((tower, index) => ({
    x: (index === 0 ? -1 : 1) * (HALF_X / 2),
    // Střed je posunutý nahoru, ať reflektor nečeká hráče přímo u dveří cely.
    z: -5,
    ax: HALF_X / 2 - 2,
    az: HALF_Z - 9,
    fx: 0.42 + random() * 0.14,
    fz: 0.61 + random() * 0.14,
    phase: random() * Math.PI * 2,
    tower,
  }));
}

/** Dvůr věznice. Klíč a brána jsou vždy na opačných stranách, takže přes dvůr musíš celý. */
export function createYard(seed: number): YardMap {
  const random = randomFrom(seed);
  const start = { x: 0, z: HALF_Z - 2 };
  const startCell = { col: Math.floor(COLS / 2), row: ROWS - 1 };
  const keyOnLeft = random() < 0.5;
  const keyCol = keyOnLeft ? Math.floor(random() * 2) : COLS - 1 - Math.floor(random() * 2);
  const keyRow = Math.floor(random() * 2);
  const gateCol = keyOnLeft ? COLS - 1 - Math.floor(random() * 2) : Math.floor(random() * 2);
  const gateCell = cellCenter(gateCol, 0);

  const obstacles: Obstacle[] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const free =
        (col === startCell.col && row === startCell.row) ||
        (col === keyCol && row === keyRow) ||
        (col === gateCol && row === 0);
      const place = random() < OBSTACLE_CHANCE;
      const obstacle = createObstacle(cellCenter(col, row), random);
      if (!free && place) obstacles.push(obstacle);
    }
  }
  return {
    seed,
    start,
    key: cellCenter(keyCol, keyRow),
    gate: { x: gateCell.x, z: -HALF_Z + 1 },
    obstacles,
    patrols: createPatrols(start, random),
    spots: createSpots(random),
  };
}
