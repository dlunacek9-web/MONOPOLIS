import { BOARD, HOTEL_LEVEL, ownablePrice } from '../core';
import type { GameState, GroupId, TileId } from '../core';
import { cs, formatMoney } from '../i18n/cs';
import { escapeHtml } from './html';

export const PLAYER_COLORS = ['#ff3d7f', '#27d7ff', '#ffc53d', '#7dff6b'];

const GROUP_COLORS: Record<GroupId, string> = {
  most: '#8d5a3b',
  ostrava: '#7fd1f0',
  usti: '#e44fb0',
  olomouc: '#f28c28',
  plzen: '#e23b3b',
  brno: '#f5d33f',
  vary: '#2fae66',
  praha: '#2c55d6',
};

const ICONS: Partial<Record<(typeof BOARD)[number]['kind'], string>> = {
  start: '💸',
  station: '🚆',
  utility: '⚡',
  tax: '🧾',
  jail: '🚓',
  parking: '🅿️',
  goToJail: '🚨',
};

/** Pozice políčka v mřížce 11 × 11: Start vpravo dole, pak po směru hodinových ručiček. */
export function gridPosition(tile: TileId): { row: number; col: number } {
  if (tile <= 10) return { row: 11, col: 11 - tile };
  if (tile <= 20) return { row: 21 - tile, col: 1 };
  if (tile <= 30) return { row: 1, col: tile - 19 };
  return { row: tile - 29, col: 11 };
}

function side(tile: TileId): string {
  if (tile % 10 === 0) return 'corner';
  if (tile < 10) return 'bottom';
  if (tile < 20) return 'left';
  if (tile < 30) return 'top';
  return 'right';
}

function iconFor(id: TileId): string {
  const tile = BOARD[id]!;
  if (tile.kind === 'card') return tile.deck === 'tip' ? '🤫' : '🏛️';
  return ICONS[tile.kind] ?? '';
}

function buildings(level: number): string {
  if (level === 0) return '';
  if (level === HOTEL_LEVEL) return '<span class="buildings">🏨</span>';
  return `<span class="buildings">${'🏠'.repeat(level)}</span>`;
}

export function renderBoard(s: GameState, center: string): string {
  const tiles = BOARD.map((tile, id) => {
    const { row, col } = gridPosition(id);
    const deed = s.deeds[id];
    const price = ownablePrice(id);
    const color = tile.kind === 'property' ? GROUP_COLORS[tile.group] : '';
    const owner = deed?.owner ?? null;
    const ownerStyle = owner === null ? '' : `--owner:${PLAYER_COLORS[owner]};`;
    const tokens = s.players
      .filter((p) => !p.bankrupt && p.position === id)
      .map(
        (p) =>
          `<i class="token${p.inJail ? ' jailed' : ''}" style="background:${PLAYER_COLORS[p.id]}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.charAt(0))}</i>`,
      )
      .join('');
    return `
      <button class="tile ${side(id)}${owner === null ? '' : ' owned'}${deed?.mortgaged ? ' mortgaged' : ''}"
        data-tile="${id}" style="grid-row:${row};grid-column:${col};${ownerStyle}" aria-label="${escapeHtml(cs.tiles[id] ?? '')}">
        ${color ? `<span class="strip" style="background:${color}"></span>` : ''}
        <span class="tile-name">${iconFor(id)} ${cs.tiles[id]}</span>
        ${deed ? buildings(deed.level) : ''}
        ${price !== null && owner === null ? `<span class="tile-price">${formatMoney(price)}</span>` : ''}
        ${deed?.mortgaged ? `<span class="tile-price">${cs.tile.mortgaged}</span>` : ''}
        <span class="tokens">${tokens}</span>
      </button>`;
  }).join('');
  return `<div class="board">${tiles}<div class="center">${center}</div></div>`;
}

export function groupColor(group: GroupId): string {
  return GROUP_COLORS[group];
}
