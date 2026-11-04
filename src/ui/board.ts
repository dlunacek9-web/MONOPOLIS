import { BOARD, HOTEL_LEVEL, actorOf, canBuild } from '../core';
import type { GameState, PlayerId, TileId } from '../core';
import { cs } from '../i18n/cs';
import { PLAYER_COLORS } from '../render/palette';
import { footText, iconFor, shortTileName, tileColor } from '../render/tile-info';
import { escapeHtml } from './html';
import { pawnSvg } from './pawns';

export { PLAYER_COLORS, shortTileName, tileColor };

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

function buildingPips(level: number): string {
  if (level === 0) return '';
  if (level === HOTEL_LEVEL) return '<i class="pip hotel"></i>';
  return '<i class="pip"></i>'.repeat(level);
}

function focusTile(s: GameState): TileId | null {
  if (s.auction) return s.auction.tile;
  return s.pendingBuy;
}

export function renderBoard(s: GameState, me: PlayerId, center: string): string {
  const actor = actorOf(s);
  const activeTile = actor === null ? null : s.players[actor]?.position;
  const focus = focusTile(s);
  const classic = s.settings.mode === 'classic';
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
      .map((p) =>
        classic
          ? `<i class="pawn${p.inJail ? ' jailed' : ''}" title="${escapeHtml(p.name)}">${pawnSvg(PLAYER_COLORS[p.id]!)}</i>`
          : `<i class="token${p.inJail ? ' jailed' : ''}" style="background:${PLAYER_COLORS[p.id]}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.charAt(0).toUpperCase())}</i>`,
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
  return `<div class="board${classic ? ' classic' : ''}">${tiles}<div class="center">${center}</div></div>`;
}
