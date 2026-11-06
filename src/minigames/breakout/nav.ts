import { HALF_X, HALF_Z } from './map';
import type { Point, Rect } from '../topdown';

const CELL = 1;
/** Odstup středu postavy od překážek. */
const CLEARANCE = 0.9;
const MAX_CACHED_FIELDS = 96;
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Hledání cesty po mřížce dvora pro bachaře i pro testovacího hráče. */
export class YardNav {
  private readonly halfX: number;
  private readonly halfZ: number;
  private readonly width: number;
  private readonly height: number;
  private readonly blocked: Uint8Array;
  private readonly fields = new Map<number, Int16Array>();

  constructor(
    obstacles: readonly Rect[],
    bounds: { halfX: number; halfZ: number } = { halfX: HALF_X, halfZ: HALF_Z },
  ) {
    this.halfX = bounds.halfX;
    this.halfZ = bounds.halfZ;
    this.width = Math.floor((this.halfX * 2) / CELL);
    this.height = Math.floor((this.halfZ * 2) / CELL);
    this.blocked = new Uint8Array(this.width * this.height);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const { x, z } = this.center(col + row * this.width);
        const edge = Math.abs(x) > this.halfX - CLEARANCE || Math.abs(z) > this.halfZ - CLEARANCE;
        const inside = obstacles.some(
          (o) => Math.abs(x - o.x) < o.hx + CLEARANCE && Math.abs(z - o.z) < o.hz + CLEARANCE,
        );
        if (edge || inside) this.blocked[col + row * this.width] = 1;
      }
    }
  }

  private center(index: number): Point {
    const col = index % this.width;
    const row = Math.floor(index / this.width);
    return { x: (col + 0.5) * CELL - this.halfX, z: (row + 0.5) * CELL - this.halfZ };
  }

  /** Nejbližší průchozí políčko. Postava stojící těsně u zdi může být nad zablokovaným. */
  private cellAt(at: Point): number {
    const col = Math.max(0, Math.min(this.width - 1, Math.floor((at.x + this.halfX) / CELL)));
    const row = Math.max(0, Math.min(this.height - 1, Math.floor((at.z + this.halfZ) / CELL)));
    for (let radius = 0; radius <= 4; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= this.width || r >= this.height) continue;
          if (!this.blocked[c + r * this.width]) return c + r * this.width;
        }
      }
    }
    return col + row * this.width;
  }

  /** Vzdálenosti všech políček k cíli. Cíle se opakují, proto se pole pamatují. */
  private fieldTo(target: number): Int16Array {
    const cached = this.fields.get(target);
    if (cached) return cached;
    const field = new Int16Array(this.width * this.height).fill(-1);
    field[target] = 0;
    const queue = [target];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!;
      const col = current % this.width;
      const row = Math.floor(current / this.width);
      for (const [dc, dr] of NEIGHBORS.slice(0, 4) as [number, number][]) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= this.width || r >= this.height) continue;
        const next = c + r * this.width;
        if (this.blocked[next] || field[next] !== -1) continue;
        field[next] = field[current]! + 1;
        queue.push(next);
      }
    }
    if (this.fields.size >= MAX_CACHED_FIELDS) this.fields.clear();
    this.fields.set(target, field);
    return field;
  }

  /** Bod, ke kterému se má postava vydat, aby se dostala k cíli. */
  nextStep(from: Point, to: Point): Point {
    const field = this.fieldTo(this.cellAt(to));
    const here = this.cellAt(from);
    const col = here % this.width;
    const row = Math.floor(here / this.width);
    let best = here;
    let bestScore = field[here]! < 0 ? Infinity : field[here]!;
    for (const [dc, dr] of NEIGHBORS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= this.width || r >= this.height) continue;
      const next = c + r * this.width;
      if (this.blocked[next] || field[next]! < 0) continue;
      // Úhlopříčka nesmí řezat roh překážky.
      if (
        dc &&
        dr &&
        (this.blocked[col + dc + row * this.width] || this.blocked[col + (row + dr) * this.width])
      ) {
        continue;
      }
      const score = field[next]! + (dc && dr ? 0.4 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = next;
      }
    }
    return best === here ? to : this.center(best);
  }

  /** Délka cesty v políčkách, `null` když cesta není. */
  distance(from: Point, to: Point): number | null {
    const value = this.fieldTo(this.cellAt(to))[this.cellAt(from)]!;
    return value < 0 ? null : value;
  }
}
