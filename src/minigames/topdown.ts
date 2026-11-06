/** Společná geometrie miniher s pohledem shora: postavy jako kruhy, překážky jako obdélníky. */
export interface Point {
  x: number;
  z: number;
}

/** Obdélník se středem a polovičními rozměry. */
export interface Rect extends Point {
  hx: number;
  hz: number;
}

/** Krok paprsku při zjišťování, jestli překážka zakrývá výhled. */
const RAY_STEP = 0.25;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Vytlačí postavu z překážek. Kruh proti obdélníku, postava po zdi klouže. */
export function pushOut(p: Point, rects: readonly Rect[], radius: number): void {
  for (const o of rects) {
    const dx = p.x - clamp(p.x, o.x - o.hx, o.x + o.hx);
    const dz = p.z - clamp(p.z, o.z - o.hz, o.z + o.hz);
    const gap = Math.hypot(dx, dz);
    if (gap >= radius) continue;
    if (gap > 0) {
      p.x += (dx / gap) * (radius - gap);
      p.z += (dz / gap) * (radius - gap);
    } else {
      // Střed je uvnitř: ven nejkratší stranou.
      const toX = o.hx - Math.abs(p.x - o.x);
      const toZ = o.hz - Math.abs(p.z - o.z);
      if (toX < toZ) p.x += Math.sign(p.x - o.x || 1) * (toX + radius);
      else p.z += Math.sign(p.z - o.z || 1) * (toZ + radius);
    }
  }
}

/** Jak daleko dohlédne paprsek, než narazí na překážku. */
export function rayLength(
  rects: readonly Rect[],
  from: Point,
  angle: number,
  limit: number,
): number {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  for (let d = RAY_STEP; d < limit; d += RAY_STEP) {
    const x = from.x + dx * d;
    const z = from.z + dz * d;
    for (const o of rects) {
      if (Math.abs(x - o.x) < o.hx && Math.abs(z - o.z) < o.hz) return d;
    }
  }
  return limit;
}
