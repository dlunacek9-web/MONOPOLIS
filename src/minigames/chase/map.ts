/** Čistá data honičky: mřížka ulic bez fyziky a grafiky. Stejný seed dá stejné město. */

export const GRID = 6;
export const PITCH = 36;
export const ROAD = 11;
export const BLOCK = PITCH - ROAD;
const SPAN = (GRID * PITCH) / 2;
export const BOUND = SPAN + ROAD / 2;

const NODE_COUNT = (GRID + 1) * (GRID + 1);
const BLOCKED_SHARE = 0.16;
const POLICE_COUNT = 4;
const TRAFFIC_COUNT = 6;

export type NodeId = number;

export interface Point {
  x: number;
  z: number;
}

export interface Barricade extends Point {
  /** Zátaras stojí napříč ulicí, která vede podél osy x. */
  alongX: boolean;
}

export interface ChaseMap {
  seed: number;
  start: NodeId;
  goal: NodeId;
  blocked: Set<string>;
  barricades: Barricade[];
  police: NodeId[];
  traffic: NodeId[];
}

export function randomFrom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nodeOf = (i: number, j: number): NodeId => j * (GRID + 1) + i;
const columnOf = (node: NodeId) => node % (GRID + 1);
const rowOf = (node: NodeId) => Math.floor(node / (GRID + 1));

export function nodePoint(node: NodeId): Point {
  return { x: columnOf(node) * PITCH - SPAN, z: rowOf(node) * PITCH - SPAN };
}

function edgeKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function neighbors(node: NodeId): NodeId[] {
  const i = columnOf(node);
  const j = rowOf(node);
  const result: NodeId[] = [];
  if (i > 0) result.push(nodeOf(i - 1, j));
  if (i < GRID) result.push(nodeOf(i + 1, j));
  if (j > 0) result.push(nodeOf(i, j - 1));
  if (j < GRID) result.push(nodeOf(i, j + 1));
  return result;
}

/** Vzdálenost všech křižovatek od cíle po průjezdných ulicích. */
export function distancesTo(blocked: ReadonlySet<string>, target: NodeId): number[] {
  const dist = new Array<number>(NODE_COUNT).fill(Infinity);
  dist[target] = 0;
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const next of neighbors(node)) {
      if (blocked.has(edgeKey(node, next)) || dist[next]! !== Infinity) continue;
      dist[next] = dist[node]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

function allEdges(): [NodeId, NodeId][] {
  const edges: [NodeId, NodeId][] = [];
  for (let node = 0; node < NODE_COUNT; node++) {
    for (const next of neighbors(node)) if (node < next) edges.push([node, next]);
  }
  return edges;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function createMap(seed: number): ChaseMap {
  const random = randomFrom(seed);
  const start = nodeOf(0, 0);
  const goal = nodeOf(GRID, GRID);
  const blocked = new Set<string>();
  const barricades: Barricade[] = [];
  const edges = shuffled(allEdges(), random);
  const wanted = Math.round(edges.length * BLOCKED_SHARE);
  for (const [a, b] of edges) {
    if (blocked.size >= wanted) break;
    // Hráč nesmí začínat ani končit u zátarasu a město musí zůstat celé průjezdné.
    if ([a, b].some((node) => node === start || node === goal)) continue;
    const key = edgeKey(a, b);
    blocked.add(key);
    if (distancesTo(blocked, goal).includes(Infinity)) {
      blocked.delete(key);
      continue;
    }
    const pa = nodePoint(a);
    const pb = nodePoint(b);
    barricades.push({ x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2, alongX: pa.z === pb.z });
  }
  const nodes = Array.from({ length: NODE_COUNT }, (_, node) => node);
  const fromStart = (node: NodeId) => columnOf(node) + rowOf(node);
  const police = shuffled(
    nodes.filter((node) => fromStart(node) >= 3 && fromStart(node) <= 9),
    random,
  ).slice(0, POLICE_COUNT);
  const traffic = shuffled(
    nodes.filter((node) => fromStart(node) >= 2 && node !== goal && !police.includes(node)),
    random,
  ).slice(0, TRAFFIC_COUNT);
  return { seed, start, goal, blocked, barricades, police, traffic };
}

/** Křižovatky na konci ulice, ve které auto právě je. Křižovatka je pak jen jedna. */
function nodesAround(x: number, z: number): NodeId[] {
  const u = Math.max(0, Math.min(GRID, (x + SPAN) / PITCH));
  const v = Math.max(0, Math.min(GRID, (z + SPAN) / PITCH));
  const onRow = Math.abs(v - Math.round(v)) * PITCH <= Math.abs(u - Math.round(u)) * PITCH;
  if (onRow) return [nodeOf(Math.floor(u), Math.round(v)), nodeOf(Math.ceil(u), Math.round(v))];
  return [nodeOf(Math.round(u), Math.floor(v)), nodeOf(Math.round(u), Math.ceil(v))];
}

export function nearestNode(x: number, z: number): NodeId {
  const u = Math.max(0, Math.min(GRID, Math.round((x + SPAN) / PITCH)));
  const v = Math.max(0, Math.min(GRID, Math.round((z + SPAN) / PITCH)));
  return nodeOf(u, v);
}

/** Další bod trasy pro auto na dané pozici. `dist` je výsledek `distancesTo`. */
export function nextWaypoint(
  map: Pick<ChaseMap, 'blocked'>,
  dist: readonly number[],
  x: number,
  z: number,
): Point {
  const [a, b] = nodesAround(x, z) as [NodeId, NodeId];
  const pa = nodePoint(a);
  const pb = nodePoint(b);
  const nearA = Math.hypot(pa.x - x, pa.z - z) <= Math.hypot(pb.x - x, pb.z - z);
  // Zátaras uprostřed ulice: zpátky se jede jen ke křižovatce na vlastní straně.
  const ahead = map.blocked.has(edgeKey(a, b)) ? (nearA ? a : b) : dist[a]! <= dist[b]! ? a : b;
  const point = nodePoint(ahead);
  if (Math.hypot(point.x - x, point.z - z) > ROAD * 0.7) return point;
  const options = neighbors(ahead).filter((next) => !map.blocked.has(edgeKey(ahead, next)));
  const best = options.reduce((left, right) => (dist[right]! < dist[left]! ? right : left));
  return dist[best]! < dist[ahead]! ? nodePoint(best) : point;
}

/** Sousední průjezdná křižovatka. Provoz podle toho bloudí po městě. */
export function randomNeighbor(
  map: Pick<ChaseMap, 'blocked'>,
  node: NodeId,
  random: () => number,
): NodeId {
  const options = neighbors(node).filter((next) => !map.blocked.has(edgeKey(node, next)));
  return options[Math.floor(random() * options.length)] ?? node;
}
