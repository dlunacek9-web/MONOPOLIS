import type { ActiveDefense, DefenseTower, PlayerId, TowerKind } from './types';

/**
 * Válka gangů: kooperativní tower defense celého stolu. Výklad je v `docs/GDD.md`.
 * Všechno počítá v celých číslech, aby vlna dopadla na každém počítači stejně.
 * Souřadnice jsou v tisícinách políčka, čas v tikách po 100 ms.
 */
export const DEFENSE_COLS = 20;
export const DEFENSE_ROWS = 12;
export const DEFENSE_WAVES = 3;
export const DEFENSE_LIVES = 20;
export const DEFENSE_START_BUDGET = 140;
export const DEFENSE_WAVE_INCOME = 60;
export const TICKS_PER_SECOND = 10;
/** Minihra přehrává vlnu rychleji než v reálném čase, ať se nečeká. */
export const REPLAY_SPEED = 1.5;
/** Pojistka: vlna nikdy nepoběží déle než tři minuty. */
const MAX_TICKS = 1_800;
const UNIT = 1_000;

/** Lomené body cesty gangu. Vede přes celou šířku třikrát, takže prochází dílem každého hráče. */
const WAYPOINTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [18, 1],
  [18, 5],
  [1, 5],
  [1, 9],
  [19, 9],
];

function buildPath(): number[] {
  const cells: number[] = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [x0, y0] = WAYPOINTS[i]!;
    const [x1, y1] = WAYPOINTS[i + 1]!;
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    if (i === 0) cells.push(y * DEFENSE_COLS + x);
    while (x !== x1 || y !== y1) {
      x += dx;
      y += dy;
      cells.push(y * DEFENSE_COLS + x);
    }
  }
  return cells;
}

/** Políčka cesty od vstupu gangu po radnici. */
export const DEFENSE_PATH: readonly number[] = buildPath();
const ON_PATH = new Set(DEFENSE_PATH);

export interface TowerStats {
  /** Cena za postavení, upgrade stojí cenu krát dosažená úroveň. */
  cost: number;
  /** Dosah na jednotlivých úrovních v tisícinách políčka. */
  range: readonly number[];
  damage: readonly number[];
  /** Tiků mezi výstřely. */
  cooldown: readonly number[];
  /** Zpomalení nepřátel v dosahu v procentech. */
  slowPct: readonly number[];
}

export const TOWER_KINDS: readonly TowerKind[] = ['bouncer', 'sniper', 'clerk'];
export const MAX_TOWER_LEVEL = 3;

export const TOWERS: Record<TowerKind, TowerStats> = {
  bouncer: {
    cost: 40,
    range: [1_600, 1_800, 2_000],
    damage: [4, 7, 11],
    cooldown: [5, 5, 4],
    slowPct: [0, 0, 0],
  },
  sniper: {
    cost: 70,
    range: [3_600, 4_200, 4_800],
    damage: [14, 24, 38],
    cooldown: [18, 16, 14],
    slowPct: [0, 0, 0],
  },
  clerk: {
    cost: 50,
    range: [1_800, 2_100, 2_400],
    damage: [1, 2, 3],
    cooldown: [10, 10, 10],
    slowPct: [35, 45, 55],
  },
};

export type EnemyKind = 'thug' | 'biker' | 'van' | 'boss';

export interface EnemyStats {
  /** Životy pro dva obránce. Na každého dalšího přibude polovina. */
  hp: number;
  /** Rychlost v tisícinách políčka za tik. */
  speed: number;
  bounty: number;
  /** Kolik životů města vezme, když dojde k radnici. */
  harm: number;
}

export const ENEMIES: Record<EnemyKind, EnemyStats> = {
  thug: { hp: 30, speed: 260, bounty: 4, harm: 1 },
  biker: { hp: 19, speed: 430, bounty: 4, harm: 1 },
  van: { hp: 170, speed: 170, bounty: 12, harm: 3 },
  boss: { hp: 500, speed: 140, bounty: 0, harm: 5 },
};

interface SpawnGroup {
  kind: EnemyKind;
  count: number;
  /** Tiků mezi dvěma nepřáteli skupiny. */
  gap: number;
}

const WAVES: readonly (readonly SpawnGroup[])[] = [
  [{ kind: 'thug', count: 10, gap: 8 }],
  [
    { kind: 'thug', count: 10, gap: 6 },
    { kind: 'biker', count: 6, gap: 5 },
    { kind: 'van', count: 2, gap: 20 },
  ],
  [
    { kind: 'thug', count: 12, gap: 5 },
    { kind: 'biker', count: 8, gap: 4 },
    { kind: 'van', count: 4, gap: 14 },
    { kind: 'boss', count: 1, gap: 1 },
  ],
];

export function cellXY(cell: number): [number, number] {
  return [cell % DEFENSE_COLS, Math.floor(cell / DEFENSE_COLS)];
}

/** Díl mapy podle sloupce: svislé pruhy stejné šířky, jeden na obránce. */
export function sectorOfCell(cell: number, defenders: number): number {
  const [x] = cellXY(cell);
  return Math.floor((x * defenders) / DEFENSE_COLS);
}

export function sectorOf(d: ActiveDefense, player: PlayerId): number {
  return d.defenders.indexOf(player);
}

export function isBuildable(cell: number): boolean {
  return (
    Number.isInteger(cell) && cell >= 0 && cell < DEFENSE_COLS * DEFENSE_ROWS && !ON_PATH.has(cell)
  );
}

export function towerAt(d: ActiveDefense, cell: number): DefenseTower | undefined {
  return d.towers.find((t) => t.cell === cell);
}

export function upgradeCost(tower: DefenseTower): number {
  return TOWERS[tower.kind].cost * tower.level;
}

export function canDefenseBuild(
  d: ActiveDefense,
  player: PlayerId,
  cell: number,
  kind: TowerKind,
): boolean {
  const sector = sectorOf(d, player);
  if (sector < 0 || d.ready.includes(player) || !TOWERS[kind]) return false;
  if (!isBuildable(cell) || towerAt(d, cell)) return false;
  if (sectorOfCell(cell, d.defenders.length) !== sector) return false;
  return (d.budgets[sector] ?? 0) >= TOWERS[kind].cost;
}

export function canDefenseUpgrade(d: ActiveDefense, player: PlayerId, cell: number): boolean {
  const sector = sectorOf(d, player);
  const tower = towerAt(d, cell);
  if (sector < 0 || d.ready.includes(player) || !tower || tower.owner !== player) return false;
  if (tower.level >= MAX_TOWER_LEVEL) return false;
  return (d.budgets[sector] ?? 0) >= upgradeCost(tower);
}

export function createDefense(defenders: PlayerId[]): ActiveDefense {
  return {
    wave: 1,
    lives: DEFENSE_LIVES,
    defenders,
    budgets: defenders.map(() => DEFENSE_START_BUDGET),
    towers: [],
    ready: [],
    last: null,
  };
}

/** Bod cesty: střed políčka plus posun k dalšímu. */
function pathPoint(progress: number): [number, number] {
  const index = Math.min(Math.floor(progress / UNIT), DEFENSE_PATH.length - 1);
  const frac = progress - index * UNIT;
  const [x, y] = cellXY(DEFENSE_PATH[index]!);
  const next = DEFENSE_PATH[index + 1];
  const [nx, ny] = next === undefined ? [x, y] : cellXY(next);
  return [x * UNIT + UNIT / 2 + (nx - x) * frac, y * UNIT + UNIT / 2 + (ny - y) * frac];
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  /** Ušlá cesta v tisícinách políčka. */
  progress: number;
  x: number;
  y: number;
  slowed: boolean;
}

export interface Shot {
  tower: number;
  enemy: number;
}

export interface WaveResult {
  leaked: number;
  kills: number;
  /** Odměny za sestřelené nepřátele podle dílu. */
  bounties: number[];
  ticks: number;
}

/**
 * Jedna vlna krok za krokem. Pravidla ji projedou naráz, minihra ji přehrává
 * stejnými kroky v reálném čase, takže obě vidí totéž.
 */
export class WaveSim {
  readonly enemies: Enemy[] = [];
  /** Výstřely z posledního tiku pro vykreslení. */
  shots: Shot[] = [];
  tick = 0;
  leaked = 0;
  kills = 0;
  readonly bounties: number[];
  private readonly queue: { kind: EnemyKind; at: number }[] = [];
  private readonly cooldowns: number[];
  private nextId = 0;
  private readonly hpScale: number;
  private readonly end = (DEFENSE_PATH.length - 1) * UNIT;

  constructor(
    private readonly towers: readonly DefenseTower[],
    private readonly defenders: readonly PlayerId[],
    wave: number,
  ) {
    this.bounties = defenders.map(() => 0);
    this.cooldowns = towers.map(() => 0);
    // Dva obránci jsou základ, každý další přidá polovinu životů navíc.
    this.hpScale = Math.max(2, defenders.length);
    let at = 0;
    for (const group of WAVES[wave - 1] ?? []) {
      for (let i = 0; i < group.count; i++) {
        this.queue.push({ kind: group.kind, at });
        at += group.gap;
      }
      at += 15;
    }
  }

  /** Pole věží v pořadí, na které ukazuje `Shot.tower`. */
  get towerCells(): number[] {
    return this.towers.map((t) => t.cell);
  }

  get done(): boolean {
    return (this.queue.length === 0 && this.enemies.length === 0) || this.tick >= MAX_TICKS;
  }

  step(): void {
    if (this.done) return;
    this.tick += 1;
    while (this.queue[0] && this.queue[0].at < this.tick) {
      const { kind } = this.queue.shift()!;
      const hp = Math.ceil((ENEMIES[kind].hp * this.hpScale) / 2);
      const [x, y] = pathPoint(0);
      this.enemies.push({
        id: this.nextId++,
        kind,
        hp,
        maxHp: hp,
        progress: 0,
        x,
        y,
        slowed: false,
      });
    }
    for (const enemy of this.enemies) {
      let slow = 0;
      for (const tower of this.towers) {
        const pct = TOWERS[tower.kind].slowPct[tower.level - 1] ?? 0;
        if (pct > slow && this.inRange(tower, enemy)) slow = pct;
      }
      enemy.slowed = slow > 0;
      enemy.progress += Math.floor((ENEMIES[enemy.kind].speed * (100 - slow)) / 100);
      [enemy.x, enemy.y] = pathPoint(enemy.progress);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]!;
      if (enemy.progress < this.end) continue;
      this.leaked += ENEMIES[enemy.kind].harm;
      this.enemies.splice(i, 1);
    }
    this.shots = [];
    this.towers.forEach((tower, index) => {
      if (this.cooldowns[index]! > 0) {
        this.cooldowns[index]! -= 1;
        return;
      }
      // Věž míří na toho, kdo je nejblíž radnici.
      let target: Enemy | null = null;
      for (const enemy of this.enemies) {
        if (enemy.hp > 0 && this.inRange(tower, enemy)) {
          if (!target || enemy.progress > target.progress) target = enemy;
        }
      }
      if (!target) return;
      const stats = TOWERS[tower.kind];
      target.hp -= stats.damage[tower.level - 1] ?? 0;
      this.cooldowns[index] = stats.cooldown[tower.level - 1] ?? 1;
      this.shots.push({ tower: index, enemy: target.id });
      if (target.hp <= 0) {
        this.kills += 1;
        const sector = this.defenders.indexOf(tower.owner);
        if (sector >= 0) this.bounties[sector]! += ENEMIES[target.kind].bounty;
      }
    });
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i]!.hp <= 0) this.enemies.splice(i, 1);
    }
  }

  private inRange(tower: DefenseTower, enemy: Enemy): boolean {
    const [tx, ty] = cellXY(tower.cell);
    const dx = tx * UNIT + UNIT / 2 - enemy.x;
    const dy = ty * UNIT + UNIT / 2 - enemy.y;
    const range = TOWERS[tower.kind].range[tower.level - 1] ?? 0;
    return dx * dx + dy * dy <= range * range;
  }

  result(): WaveResult {
    return {
      leaked: this.leaked,
      kills: this.kills,
      bounties: [...this.bounties],
      ticks: this.tick,
    };
  }
}

/** Celá vlna naráz. */
export function runWave(d: ActiveDefense): WaveResult {
  const sim = new WaveSim(d.towers, d.defenders, d.wave);
  while (!sim.done) sim.step();
  return sim.result();
}

/** Kolik políček cesty pokryje věž daného druhu na poli. Slouží botům i nápovědě. */
export function pathCoverage(cell: number, kind: TowerKind): number {
  const [x, y] = cellXY(cell);
  const range = TOWERS[kind].range[0]!;
  let count = 0;
  for (const p of DEFENSE_PATH) {
    const [px, py] = cellXY(p);
    const dx = (px - x) * UNIT;
    const dy = (py - y) * UNIT;
    if (dx * dx + dy * dy <= range * range) count += 1;
  }
  return count;
}
