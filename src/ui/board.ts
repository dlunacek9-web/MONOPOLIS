import { BOARD, HOTEL_LEVEL, actorOf, canBuild, ownablePrice, rentOf } from '../core';
import type { GameState, GroupId, PlayerId, TileId } from '../core';
import { cs, formatMoneyShort } from '../i18n/cs';
import { escapeHtml } from './html';

export const PLAYER_COLORS = ['#e6195f', '#0a84d6', '#e08a00', '#17a34a'];

const GROUP_COLORS: Record<GroupId, { bg: string; ink: string }> = {
  most: { bg: '#7a4a2b', ink: '#fff' },
  ostrava: { bg: '#8fd8f5', ink: '#10202b' },
  usti: { bg: '#d9379f', ink: '#fff' },
  olomouc: { bg: '#f28c28', ink: '#1d1205' },
  plzen: { bg: '#d92b2b', ink: '#fff' },
  brno: { bg: '#f7d531', ink: '#201b02' },
  vary: { bg: '#1f9d55', ink: '#fff' },
  praha: { bg: '#2347c5', ink: '#fff' },
};

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

/** Pozice políčka v mřížce 11 × 11: Start vpravo dole, pak po směru hodinových ručiček. */
export function gridPosition(tile: TileId): { row: number; col: number } {
  if (tile <= 10) return { row: 11, col: 11 - tile };
  if (tile <= 20) return { row: 21 - tile, col: 1 };
  if (tile <= 30) return { row: 1, col: tile - 19 };
  return { row: tile - 29, col: 11 };
}

function sideClass(tile: TileId): string {
  if (tile % 10 === 0) return 'corner';
  if (tile < 10) return 'bottom';
  if (tile < 20) return 'left';
  if (tile < 30) return 'top';
  return 'right';
}

function iconFor(id: TileId): string {
  const tile = BOARD[id]!;
  if (tile.kind === 'card') return tile.deck === 'tip' ? '🤫' : '🏛️';
  if (tile.kind === 'utility') return id === 12 ? '⚡' : '🚰';
  return ICONS[tile.kind] ?? '';
}

function buildingPips(level: number): string {
  if (level === 0) return '';
  if (level === HOTEL_LEVEL) return '<i class="pip hotel"></i>';
  return '<i class="pip"></i>'.repeat(level);
}

function footText(s: GameState, id: TileId): string {
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

function focusTile(s: GameState): TileId | null {
  if (s.auction) return s.auction.tile;
  return s.pendingBuy;
}

export function renderBoard(s: GameState, me: PlayerId, center: string): string {
  const actor = actorOf(s);
  const activeTile = actor === null ? null : s.players[actor]?.position;
  const focus = focusTile(s);
  const tiles = BOARD.map((tile, id) => {
    const { row, col } = gridPosition(id);
    const deed = s.deeds[id];
    const owner = deed?.owner ?? null;
    const classes = [
      'tile',
      sideClass(id),
      owner === null ? '' : 'owned',
      deed?.mortgaged ? 'mortgaged' : '',
      id === activeTile ? 'current' : '',
      id === focus ? 'focus' : '',
      deed && canBuild(s, me, id) ? 'can-build' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const ownerStyle = owner === null ? '' : `--owner:${PLAYER_COLORS[owner]};`;
    const tokens = s.players
      .filter((p) => !p.bankrupt && p.position === id)
      .map(
        (p) =>
          `<i class="token${p.inJail ? ' jailed' : ''}" style="background:${PLAYER_COLORS[p.id]}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.charAt(0).toUpperCase())}</i>`,
      )
      .join('');
    const bar =
      tile.kind === 'property'
        ? `<span class="bar" style="background:${tileColor(id).bg}">${buildingPips(deed?.level ?? 0)}</span>`
        : '';
    const icon = iconFor(id);
    const foot = footText(s, id);
    return `
      <button class="${classes}" data-tile="${id}" style="grid-row:${row};grid-column:${col};${ownerStyle}" aria-label="${escapeHtml(cs.tiles[id] ?? '')}">
        ${bar}
        <span class="tile-body">
          ${icon ? `<span class="tile-icon">${icon}</span>` : ''}
          <span class="tile-name">${shortTileName(id)}</span>
          ${foot ? `<span class="tile-foot">${foot}</span>` : ''}
        </span>
        <span class="tokens">${tokens}</span>
      </button>`;
  }).join('');
  return `<div class="board">${tiles}<div class="center">${center}</div></div>`;
}
