import {
  BUSINESS,
  GROUP_ORDER,
  canBuyShares,
  canPumpDump,
  canSellShares,
  holdingOf,
  pumpOn,
  sharePrice,
} from '../core';
import type { GameState, GroupId, PlayerId } from '../core';
import { cs, formatMoney, formatMoneyShort } from '../i18n/cs';
import { GROUP_COLORS } from '../render/palette';
import { act } from './buttons';
import { character } from './characters';

const LOT = 5;
const HISTORY = 14;

/** Vývoj cen vidí jen rozhraní: pravidla historii nepotřebují. */
export class PriceHistory {
  private readonly prices = new Map<GroupId, number[]>();

  record(s: GameState): void {
    if (!s.market) return;
    for (const group of GROUP_ORDER) {
      const list = this.prices.get(group) ?? [];
      const price = sharePrice(s, group);
      if (list.at(-1) !== price) list.push(price);
      if (list.length > HISTORY) list.shift();
      this.prices.set(group, list);
    }
  }

  of(group: GroupId): number[] {
    return this.prices.get(group) ?? [];
  }
}

function sparkline(points: number[]): string {
  if (points.length < 2)
    return '<svg class="spark" viewBox="0 0 100 30"><path d="M0 15H100"/></svg>';
  const min = Math.min(...points);
  const range = Math.max(1, Math.max(...points) - min);
  const step = 100 / (points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(27 - ((p - min) / range) * 24).toFixed(1)}`,
    )
    .join('');
  return `<svg class="spark" viewBox="0 0 100 30"><path d="${path}"/></svg>`;
}

function stockCard(s: GameState, me: PlayerId, group: GroupId, history: PriceHistory): string {
  const pump = BUSINESS!.pump;
  const { count } = holdingOf(s, me, group);
  const price = sharePrice(s, group);
  const points = history.of(group);
  const previous = points.at(-2) ?? price;
  const trend = price > previous ? 'up' : price < previous ? 'down' : '';
  const data = `data-group="${group}"`;
  return `
    <article class="stock ${trend}" style="--city:${GROUP_COLORS[group].bg}">
      <header>
        <strong>${cs.groups[group]}</strong>
        ${pumpOn(s, group) ? `<em>${cs.biz.pumping}</em>` : ''}
      </header>
      <div class="stock-price"><b>${formatMoney(price)}</b>${sparkline(points)}</div>
      <small>${cs.biz.holding(count)}</small>
      <div class="stock-acts">
        ${act(cs.biz.buy(LOT), 'buyShares', {
          kind: 'market',
          sub: cs.biz.buySub(formatMoneyShort(price * LOT)),
          attrs: `${data} data-count="${LOT}"`,
          disabled: !canBuyShares(s, me, group, LOT),
        })}
        ${act(cs.biz.sellAll, 'sellShares', {
          kind: 'market',
          attrs: `${data} data-count="${count}"`,
          disabled: !canSellShares(s, me, group, count),
        })}
        ${act(cs.biz.pump, 'pumpDump', {
          kind: 'black',
          icon: 'envelope',
          sub: cs.biz.pumpSub(formatMoneyShort(pump.cost)),
          risk: pump.riskPct,
          tip: cs.biz.pumpTip(pump.riskPct),
          attrs: data,
          disabled: !canPumpDump(s, me, group),
        })}
      </div>
    </article>`;
}

function balance(s: GameState, me: PlayerId): string {
  const p = s.players[me]!;
  return `
    <div class="panel-balance">
      <span data-tip="${cs.biz.whiteTip}"><small>${cs.biz.white}</small><b>${formatMoney(p.cash)}</b></span>
      <span class="dirty" data-tip="${cs.biz.dirtyTip}"><small>${cs.biz.dirty}</small><b>${formatMoney(p.dirty)}</b></span>
    </div>`;
}

export function renderMarket(s: GameState, me: PlayerId, history: PriceHistory): string {
  const cards = GROUP_ORDER.map((group) => stockCard(s, me, group, history)).join('');
  return `
    <div class="overlay">
      <div class="dialog world market">
        <header class="world-head">
          <div class="world-char">${character('broker')}</div>
          <div>
            <h2>${cs.biz.marketTitle}</h2>
            <p class="bubble still" data-tip="${cs.biz.marketTip(BUSINESS!.stock.maxShares)}">${cs.biz.marketBubble}</p>
          </div>
          ${balance(s, me)}
          ${closeButton()}
        </header>
        <div class="stock-grid">${cards}</div>
      </div>
    </div>`;
}

export function closeButton(): string {
  return `<button class="world-close" data-action="closePanel" data-primary aria-label="${cs.game.close}">×</button>`;
}

export { balance as renderBalance };
