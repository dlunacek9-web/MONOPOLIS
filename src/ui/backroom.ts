import {
  BUSINESS,
  canLaunder,
  canSetOffBooks,
  launderFeePct,
  launderLimit,
  launderNet,
  launderRiskPct,
  tilesOwnedBy,
} from '../core';
import type { GameState, PlayerId, TileId } from '../core';
import { cs, formatMoney, formatMoneyShort } from '../i18n/cs';
import { tileColor } from './board';
import { act } from './buttons';
import { character } from './characters';
import { closeButton, renderBalance } from './market';

function row(s: GameState, me: PlayerId, tile: TileId, amount: number): string {
  const deed = s.deeds[tile]!;
  const risk = launderRiskPct(s, me);
  const tip = cs.biz.launderTip(formatMoney(BUSINESS!.launderCap), launderFeePct(s, me), risk);
  const data = `data-tile-id="${tile}"`;
  let wash: string;
  if (deed.mortgaged) wash = `<span class="wash-note">${cs.biz.mortgaged}</span>`;
  else if (s.launderedTiles.includes(tile))
    wash = `<span class="wash-note">${cs.biz.laundered}</span>`;
  else if (amount === 0) wash = `<span class="wash-note">${cs.biz.noDirty}</span>`;
  else
    wash = act(cs.biz.launder(formatMoneyShort(amount)), 'launder', {
      kind: 'black',
      icon: 'wave',
      sub: cs.biz.launderSub(formatMoneyShort(launderNet(s, me, amount))),
      risk,
      tip,
      attrs: `${data} data-amount="${amount}"`,
      disabled: !canLaunder(s, me, tile, amount),
    });
  const toggle = canSetOffBooks(s, me, tile)
    ? act(deed.offBooks ? cs.biz.offBooksOn : cs.biz.offBooksOff, 'setOffBooks', {
        kind: 'plain',
        icon: 'coin',
        tip: cs.biz.offBooksTip,
        attrs: `${data} data-on="${deed.offBooks ? '' : '1'}"`,
      })
    : '';
  return `
    <div class="wash-row" style="--city:${tileColor(tile).bg}">
      <strong>${cs.tiles[tile]}</strong>
      ${toggle}
      ${wash}
    </div>`;
}

export function renderBackroom(s: GameState, me: PlayerId): string {
  const amount = launderLimit(s, me);
  const tiles = tilesOwnedBy(s, me);
  const body = tiles.length
    ? `<div class="wash-list">${tiles.map((tile) => row(s, me, tile, amount)).join('')}</div>`
    : '';
  return `
    <div class="overlay dark">
      <div class="dialog world backroom">
        <div class="bulb"></div>
        <header class="world-head">
          <div class="world-char">${character('washer')}</div>
          <div>
            <h2>${cs.biz.backroomTitle}</h2>
            <p class="bubble still">${tiles.length ? cs.biz.backroomBubble : cs.biz.backroomEmpty}</p>
          </div>
          ${renderBalance(s, me)}
          ${closeButton()}
        </header>
        ${body}
      </div>
    </div>`;
}
