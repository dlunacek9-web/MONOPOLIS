import {
  DEFENSE_COLS,
  DEFENSE_ROWS,
  MAX_TOWER_LEVEL,
  TOWERS,
  TOWER_KINDS,
  canDefenseBuild,
  canDefenseUpgrade,
  hashToUnit,
  isBuildable,
  pathCoverage,
  sectorOf,
  sectorOfCell,
  towerAt,
  upgradeCost,
} from '../core';
import type { Action, ActiveDefense, Difficulty, GameState, PlayerId, TowerKind } from '../core';

/** Poškození za sekundu na úrovni věže. Úředník počítá zdržení jako poškození navíc. */
function power(kind: TowerKind, level: number): number {
  const t = TOWERS[kind];
  const i = level - 1;
  const dps = ((t.damage[i] ?? 0) * 10) / (t.cooldown[i] ?? 1);
  return dps + (t.slowPct[i] ?? 0) / 8;
}

/** Jak moc bot kouká na nejlepší tah. Lehký bot staví víc nazdařbůh. */
const NOISE: Record<Difficulty, number> = { easy: 0.8, normal: 0.25, hard: 0 };

interface Move {
  action: Action;
  score: number;
}

function movesFor(d: ActiveDefense, me: PlayerId): Move[] {
  const moves: Move[] = [];
  const sector = sectorOf(d, me);
  const mine = d.towers.filter((t) => t.owner === me);
  const damageTowers = mine.filter((t) => t.kind !== 'clerk').length;
  const clerks = mine.filter((t) => t.kind === 'clerk').length;
  for (let cell = 0; cell < DEFENSE_COLS * DEFENSE_ROWS; cell++) {
    if (!isBuildable(cell) || sectorOfCell(cell, d.defenders.length) !== sector) continue;
    const tower = towerAt(d, cell);
    if (tower) {
      if (tower.owner !== me || tower.level >= MAX_TOWER_LEVEL) continue;
      if (!canDefenseUpgrade(d, me, cell)) continue;
      const gain = power(tower.kind, tower.level + 1) - power(tower.kind, tower.level);
      moves.push({
        action: { type: 'defenseUpgrade', player: me, cell },
        score: (pathCoverage(cell, tower.kind) * gain) / upgradeCost(tower),
      });
      continue;
    }
    for (const kind of TOWER_KINDS) {
      if (!canDefenseBuild(d, me, cell, kind)) continue;
      let value = pathCoverage(cell, kind) * power(kind, 1);
      // Úředník se vyplatí, až je koho zdržovat pod palbou. Dva stačí.
      if (kind === 'clerk') value *= clerks >= 2 ? 0.2 : Math.min(1, damageTowers / 3);
      moves.push({
        action: { type: 'defenseBuild', player: me, cell, kind },
        score: value / TOWERS[kind].cost,
      });
    }
  }
  return moves;
}

/** Další krok bota ve Válce gangů: stavba, vylepšení, nebo hotovo. */
export function chooseDefenseAction(s: GameState, me: PlayerId): Action {
  const d = s.defense;
  if (!d) throw new Error('Neběží Válka gangů');
  const difficulty = s.players[me]?.bot?.difficulty ?? 'normal';
  const noise = NOISE[difficulty];
  const salt = d.towers.length * 31 + d.wave * 7 + me;
  let best: Move | null = null;
  let bestScore = -1;
  movesFor(d, me).forEach((move, i) => {
    const score = move.score * (1 - noise * hashToUnit(salt, i));
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  });
  return best ? (best as Move).action : { type: 'defenseReady', player: me };
}
