import {
  BUSINESS,
  canHeist,
  canLaunder,
  canSetOffBooks,
  heistCooldown,
  heistHotels,
  heistLoot,
  heistRules,
  launderFeePct,
  launderLimit,
  launderNet,
  launderRiskPct,
  tilesOwnedBy,
} from '../core';
import type { GameState, HeistTarget, PlayerId, TileId } from '../core';
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

function heistButton(
  s: GameState,
  me: PlayerId,
  target: HeistTarget,
  tile: TileId | null,
  label: string,
): string {
  const { maxBags, riskPct, fine } = heistRules(target);
  const data = tile === null ? '' : ` data-tile-id="${tile}"`;
  return act(label, 'heist', {
    kind: 'danger',
    icon: 'bars',
    sub: cs.heist.actionSub(
      formatMoneyShort(heistLoot(target, 1)),
      formatMoneyShort(heistLoot(target, maxBags)),
    ),
    risk: riskPct,
    tip: cs.heist.actionTip(formatMoney(fine)),
    attrs: `data-target="${target}"${data}`,
    disabled: !canHeist(s, me, target, tile),
  });
}

/** Velká práce: banka je pořád, hotely jen ty, které stojí a patří soupeřům. */
function renderHeists(s: GameState, me: PlayerId): string {
  const hotels = heistHotels(s, me).map((tile) =>
    heistButton(s, me, 'hotel', tile, cs.heist.hotel(cs.tiles[tile] ?? '')),
  );
  const cooldown = heistCooldown(s, me);
  return `
    <section class="heist-list">
      <h3>${cs.heist.sectionTitle}</h3>
      ${cooldown > 0 ? `<p class="wash-note">${cs.heist.cooldown(cooldown)}</p>` : ''}
      <div class="heist-buttons">
        ${heistButton(s, me, 'bank', null, cs.heist.bank)}
        ${hotels.join('')}
      </div>
    </section>`;
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
        ${renderHeists(s, me)}
        ${body}
      </div>
    </div>`;
}
