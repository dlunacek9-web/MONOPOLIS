import { BOARD, ownablePrice, rentOf } from '../core';
import type { GameState, TileId } from '../core';
import { cs, formatMoneyShort } from '../i18n/cs';
import { GROUP_COLORS } from './palette';

const STATION_COLOR = { bg: '#3a3f55', ink: '#fff' };
const UTILITY_COLOR = { bg: '#2aa7a7', ink: '#06201f' };
const NEUTRAL_COLOR = { bg: '#6b7088', ink: '#fff' };

const ICONS: Partial<Record<(typeof BOARD)[number]['kind'], string>> = {
  start: '💸',
  station: '🚆',
  tax: '🧾',
  jail: '🚓',
  parking: '🅿️',
  goToJail: '🚨',
};

export function tileColor(id: TileId): { bg: string; ink: string } {
  const tile = BOARD[id]!;
  if (tile.kind === 'property') return GROUP_COLORS[tile.group];
  if (tile.kind === 'station') return STATION_COLOR;
  if (tile.kind === 'utility') return UTILITY_COLOR;
  return NEUTRAL_COLOR;
}

/** Barva a pruh už říkají město, takže políčko ukazuje jen ulici. */
export function shortTileName(id: TileId): string {
  const name = cs.tiles[id] ?? '';
  if (BOARD[id]?.kind !== 'property') return name;
  return name.slice(name.indexOf(':') + 1).trim();
}

/** Město z názvu políčka, nebo prázdný text u políček, která žádné nemají. */
export function tileCity(id: TileId): string {
  const name = cs.tiles[id] ?? '';
  if (BOARD[id]?.kind !== 'property') return '';
  return name.slice(0, name.indexOf(':')).trim();
}

export function iconFor(id: TileId): string {
  const tile = BOARD[id]!;
  if (tile.kind === 'card') return tile.deck === 'tip' ? '🤫' : '🏛️';
  if (tile.kind === 'utility') return id === 12 ? '⚡' : '🚰';
  return ICONS[tile.kind] ?? '';
}

export function footText(s: GameState, id: TileId): string {
  const tile = BOARD[id]!;
  const deed = s.deeds[id];
  if (tile.kind === 'tax') return formatMoneyShort(tile.amount);
  if (tile.kind === 'start') return cs.tile.footSalary;
  if (!deed) return '';
  if (deed.mortgaged) return cs.tile.footMortgaged;
  if (deed.owner === null) return formatMoneyShort(ownablePrice(id) ?? 0);
  if (tile.kind === 'utility') return cs.tile.footUtility(formatMoneyShort(rentOf(s, id, 1)));
  return cs.tile.footRent(formatMoneyShort(rentOf(s, id, 0)));
}
