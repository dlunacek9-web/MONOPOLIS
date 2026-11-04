import {
  HOTEL_LEVEL,
  JAIL_BAIL,
  MIN_BID_STEP,
  STATION_RENTS,
  actorOf,
  canBuild,
  canMortgage,
  canProposeTrade,
  canSellBuilding,
  canUnmortgage,
  hasBuildingsInGroup,
  isValidTrade,
  minBid,
  mortgageValue,
  netWorth,
  ownablePrice,
  tileAt,
  tilesOwnedBy,
  unmortgageCost,
} from '../core';
import type { Action, GameState, PlayerId, TileId, TradeSide } from '../core';
import { cs, formatMoney } from '../i18n/cs';
import { BotRunner } from '../bots/runner';
import { LocalTransport } from '../net/local';
import type { GameTransport } from '../net/transport';
import { publishGameEnd, summarizeGame } from '../profile/profile';
import { PLAYER_COLORS, groupColor, renderBoard } from './board';
import { escapeHtml } from './html';
import { formatEvent, quipFor } from './log';

interface TradeDraft {
  to: PlayerId;
  give: TradeSide;
  get: TradeSide;
  error: boolean;
}

type Speed = 'normal' | 'fast' | 'turbo';
const SPEED_MS: Record<Speed, number> = { normal: 750, fast: 200, turbo: 15 };

function emptySide(): TradeSide {
  return { tiles: [], cash: 0, jailCards: 0 };
}

function button(label: string, action: string, attrs = '', primary = false): string {
  const cls = primary ? 'btn primary' : 'btn';
  return `<button class="${cls}" data-action="${action}" ${attrs}${primary ? ' data-primary' : ''}>${label}</button>`;
}

export class GameScreen {
  private readonly transport: GameTransport;
  private readonly bots: BotRunner;
  private selectedTile: TileId | null = null;
  private draft: TradeDraft | null = null;
  private speed: Speed = 'normal';
  private endPublished = false;
  private readonly lines: { seq: number; text: string; cls: string }[] = [];
  private lastSeq = 0;

  constructor(
    private readonly root: HTMLElement,
    state: GameState,
    private readonly me: PlayerId,
    private readonly callbacks: { onExit: () => void; onNewGame: () => void },
  ) {
    this.transport = new LocalTransport(state);
    this.transport.subscribe(() => this.render());
    this.bots = new BotRunner(this.transport, (s) => this.delay(s));
    this.root.onclick = (event) => this.onClick(event);
    this.root.oninput = (event) => this.onInput(event);
    this.root.onsubmit = (event) => this.onSubmit(event);
    this.render();
  }

  stop(): void {
    this.bots.stop();
    this.root.onclick = null;
    this.root.oninput = null;
    this.root.onsubmit = null;
  }

  private delay(s: GameState): number {
    const base = SPEED_MS[this.speed];
    return s.auction || s.trade ? Math.ceil(base / 2) : base;
  }

  private get state(): GameState {
    return this.transport.getState();
  }

  private send(action: Action): void {
    this.transport.dispatch(action);
  }

  private collectLog(s: GameState): void {
    for (const event of s.events) {
      if (event.seq <= this.lastSeq) continue;
      this.lastSeq = event.seq;
      const important = ['bankrupt', 'gameOver', 'turnStart'].includes(event.type);
      this.lines.unshift({
        seq: event.seq,
        text: formatEvent(s, event),
        cls: important ? `log-${event.type}` : '',
      });
      const quip = quipFor(s, event);
      if (quip) this.lines.unshift({ seq: event.seq, text: quip, cls: 'log-quip' });
    }
    this.lines.length = Math.min(this.lines.length, 60);
  }

  private render(): void {
    const s = this.state;
    this.collectLog(s);
    if (s.phase === 'gameOver' && !this.endPublished) {
      this.endPublished = true;
      publishGameEnd(summarizeGame(s));
    }
    const focus = this.root.querySelector<HTMLElement>('.log')?.scrollTop ?? 0;
    this.root.innerHTML = `
      <div class="game">
        ${renderBoard(s, this.renderCenter(s))}
        <aside class="side">
          ${this.renderPlayers(s)}
          <section class="panel actions">${this.renderActions(s)}</section>
          ${this.renderFooter()}
        </aside>
      </div>
      ${this.draft ? this.renderTradeDialog(s, this.draft) : ''}
      ${s.phase === 'gameOver' ? this.renderResult(s) : ''}`;
    const log = this.root.querySelector<HTMLElement>('.log');
    if (log) log.scrollTop = focus;
  }

  private renderCenter(s: GameState): string {
    const dice = s.lastRoll
      ? `<div class="dice"><b>${s.lastRoll[0]}</b><b>${s.lastRoll[1]}</b></div>`
      : '<div class="dice"></div>';
    const detail = this.selectedTile === null ? '' : this.renderTileDetail(s, this.selectedTile);
    return `
      <div class="center-head">
        <h1 class="logo small">${cs.title}</h1>
        <span>${cs.game.round(s.round)}</span>
        ${dice}
      </div>
      ${detail}
      <h3 class="log-title">${cs.game.log}</h3>
      <div class="log">
        ${this.lines.map((line) => `<p class="${line.cls}">${escapeHtml(line.text)}</p>`).join('')}
      </div>`;
  }

  private renderPlayers(s: GameState): string {
    const actor = actorOf(s);
    const rows = s.players
      .map((p) => {
        const flags = [
          p.id === this.me ? cs.game.you : p.bot ? cs.personality[p.bot.personality] : '',
          p.inJail ? cs.game.inJail : '',
          p.bankrupt ? cs.game.isBankrupt : '',
          p.jailCards.length ? cs.game.jailCardsCount(p.jailCards.length) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `
          <div class="player${p.id === actor ? ' active' : ''}${p.bankrupt ? ' out' : ''}" style="--color:${PLAYER_COLORS[p.id]}">
            <div class="player-head"><strong>${escapeHtml(p.name)}</strong><span>${formatMoney(p.cash)}</span></div>
            <small>${flags}</small>
          </div>`;
      })
      .join('');
    return `<section class="panel players">${rows}</section>`;
  }

  private renderActions(s: GameState): string {
    const me = s.players[this.me]!;
    if (s.phase === 'gameOver') return '';
    if (me.bankrupt) return `<p>${cs.game.youBankrupt}</p>`;
    const actor = actorOf(s);
    if (s.trade?.from === this.me) {
      return `<p>${cs.game.tradeWaiting(escapeHtml(s.players[s.trade.to]!.name))}</p>`;
    }
    if (actor !== this.me) {
      return `${s.auction ? this.renderAuctionInfo(s) : ''}<p class="waiting">${cs.game.waiting(escapeHtml(s.players[actor ?? 0]!.name))}</p>`;
    }
    if (s.trade) return this.renderIncomingTrade(s);
    const debt = s.debts[0];
    if (debt) {
      const creditor = debt.creditor === null ? cs.game.bank : s.players[debt.creditor]!.name;
      return `
        <h3>${cs.game.debtTitle}</h3>
        <p>${cs.game.debtText(formatMoney(debt.amount), escapeHtml(creditor))}</p>
        ${button(cs.game.pay(formatMoney(debt.amount)), 'settleDebt', me.cash < debt.amount ? 'disabled' : '', true)}
        ${this.tradeButton(s)}
        ${button(cs.game.bankrupt, 'declareBankruptcy', 'data-danger')}`;
    }
    if (s.auction) return this.renderAuction(s);
    if (s.phase === 'awaitBuy' && s.pendingBuy !== null) {
      const price = ownablePrice(s.pendingBuy) ?? 0;
      const affordable = me.cash >= price;
      return `
        <h3>${cs.tiles[s.pendingBuy]}</h3>
        ${button(cs.game.buy(formatMoney(price)), 'buy', affordable ? '' : 'disabled', affordable)}
        ${button(cs.game.decline, 'decline', '', !affordable)}
        ${this.tradeButton(s)}`;
    }
    if (s.phase === 'awaitRoll') {
      const jail = me.inJail
        ? `${button(cs.game.payBail(formatMoney(JAIL_BAIL)), 'payBail', me.cash < JAIL_BAIL ? 'disabled' : '')}
           ${me.jailCards.length ? button(cs.game.useJailCard, 'useJailCard') : ''}`
        : '';
      const label = me.inJail ? cs.game.rollInJail : cs.game.roll;
      return `${button(label, 'roll', '', true)}${jail}${this.tradeButton(s)}`;
    }
    const label = s.extraRoll && !me.inJail ? cs.game.rollAgain : cs.game.endTurn;
    return `${button(label, 'endTurn', '', true)}${this.tradeButton(s)}`;
  }

  private tradeButton(s: GameState): string {
    if (!canProposeTrade(s, this.me)) return `<small>${cs.game.tradeLimit}</small>`;
    return button(cs.game.tradeOpen, 'openTrade');
  }

  private renderAuctionInfo(s: GameState): string {
    const auction = s.auction!;
    const status =
      auction.leader === null
        ? cs.game.auctionNoBid
        : cs.game.auctionBid(formatMoney(auction.bid), escapeHtml(s.players[auction.leader]!.name));
    return `<h3>${cs.game.auctionInfo(cs.tiles[auction.tile] ?? '')}</h3><p>${status}</p>`;
  }

  private renderAuction(s: GameState): string {
    const cash = s.players[this.me]!.cash;
    const min = minBid(s);
    const quick = [min, min + 40_000, min + 90_000]
      .filter((amount) => amount <= cash)
      .map((amount, i) =>
        button(cs.game.bid(formatMoney(amount)), 'bid', `data-amount="${amount}"`, i === 0),
      )
      .join('');
    const custom =
      min <= cash
        ? `<form class="row" data-form="bid">
             <input name="amount" type="number" min="${min}" max="${cash}" step="${MIN_BID_STEP}" value="${min}" aria-label="${cs.game.customBid}" />
             <button class="btn" type="submit">${cs.game.customBid}</button>
           </form>`
        : '';
    return `${this.renderAuctionInfo(s)}${quick}${custom}${button(cs.game.passBid, 'passBid', '', quick === '')}`;
  }

  private describeSide(side: TradeSide): string {
    const parts = [
      ...side.tiles.map((tile) => cs.tiles[tile] ?? ''),
      ...(side.cash ? [formatMoney(side.cash)] : []),
      ...(side.jailCards ? [cs.game.jailCardsCount(side.jailCards)] : []),
    ];
    return parts.length
      ? `<ul>${parts.map((part) => `<li>${part}</li>`).join('')}</ul>`
      : `<p>${cs.game.tradeNothing}</p>`;
  }

  private renderIncomingTrade(s: GameState): string {
    const offer = s.trade!;
    return `
      <h3>${cs.game.tradeIncoming(escapeHtml(s.players[offer.from]!.name))}</h3>
      <div class="trade-summary">
        <div><strong>${cs.game.tradeYouGet}</strong>${this.describeSide(offer.give)}</div>
        <div><strong>${cs.game.tradeYouGive}</strong>${this.describeSide(offer.get)}</div>
      </div>
      ${button(cs.game.tradeAccept, 'acceptTrade')}
      ${button(cs.game.tradeReject, 'rejectTrade', '', true)}`;
  }

  private renderFooter(): string {
    const speeds = (['normal', 'fast', 'turbo'] as const)
      .map(
        (speed) =>
          `<button class="chip${speed === this.speed ? ' on' : ''}" data-action="speed" data-speed="${speed}">${
            speed === 'normal'
              ? cs.game.speedNormal
              : speed === 'fast'
                ? cs.game.speedFast
                : cs.game.speedTurbo
          }</button>`,
      )
      .join('');
    return `
      <section class="panel footer">
        <div class="row"><span>${cs.game.speed}</span>${speeds}</div>
        <small>${cs.game.hints}</small>
        ${button(cs.game.quit, 'quit')}
      </section>`;
  }

  private renderTileDetail(s: GameState, id: TileId): string {
    const tile = tileAt(id);
    const rows: string[] = [];
    const row = (label: string, value: string) =>
      rows.push(`<tr><td>${label}</td><td>${value}</td></tr>`);
    const deed = s.deeds[id];
    if (deed) {
      const owner = deed.owner === null ? cs.tile.noOwner : escapeHtml(s.players[deed.owner]!.name);
      row(cs.tile.owner, owner);
      row(cs.tile.price, formatMoney(ownablePrice(id) ?? 0));
      row(cs.tile.mortgageValue, formatMoney(mortgageValue(id)));
    }
    let strip = '';
    let description = '';
    switch (tile.kind) {
      case 'property':
        strip = `style="border-top:6px solid ${groupColor(tile.group)}"`;
        row(cs.tile.group, cs.groups[tile.group]);
        row(cs.tile.rentBase, formatMoney(tile.rents[0]!));
        row(cs.tile.rentSet, formatMoney(tile.rents[0]! * 2));
        for (let n = 1; n < HOTEL_LEVEL; n++)
          row(cs.tile.rentHouses(n), formatMoney(tile.rents[n]!));
        row(cs.tile.rentHotel, formatMoney(tile.rents[HOTEL_LEVEL]!));
        row(cs.tile.houseCost, formatMoney(tile.houseCost));
        break;
      case 'station':
        STATION_RENTS.forEach((rent, i) => row(cs.tile.stationRents(i + 1), formatMoney(rent)));
        break;
      case 'utility':
        description = `${cs.tile.utilityOne}<br>${cs.tile.utilityBoth}`;
        break;
      case 'tax':
        row(cs.tile.tax, formatMoney(tile.amount));
        break;
      case 'card':
        description = cs.tile.description.card;
        break;
      case 'start':
      case 'jail':
      case 'parking':
      case 'goToJail':
        description = cs.tile.description[tile.kind];
        break;
    }
    const manage: string[] = [];
    if (deed?.owner === this.me) {
      if (tile.kind === 'property') {
        if (canBuild(s, this.me, id)) {
          manage.push(
            button(cs.tile.build(formatMoney(tile.houseCost)), 'build', `data-tile-id="${id}"`),
          );
        }
        if (canSellBuilding(s, this.me, id)) {
          const value = formatMoney(Math.floor(tile.houseCost / 2));
          manage.push(button(cs.tile.sell(value), 'sellBuilding', `data-tile-id="${id}"`));
        }
      }
      if (canMortgage(s, this.me, id)) {
        manage.push(
          button(
            cs.tile.mortgage(formatMoney(mortgageValue(id))),
            'mortgage',
            `data-tile-id="${id}"`,
          ),
        );
      }
      if (canUnmortgage(s, this.me, id)) {
        manage.push(
          button(
            cs.tile.unmortgage(formatMoney(unmortgageCost(id))),
            'unmortgage',
            `data-tile-id="${id}"`,
          ),
        );
      }
    }
    return `
      <div class="tile-detail" ${strip}>
        <div class="row between"><h3>${cs.tiles[id]}</h3>${button(cs.game.close, 'closeTile', 'data-close')}</div>
        ${description ? `<p>${description}</p>` : ''}
        ${rows.length ? `<table>${rows.join('')}</table>` : ''}
        ${manage.length ? `<div class="manage">${manage.join('')}</div>` : ''}
      </div>`;
  }

  private tradeTileChoices(
    s: GameState,
    owner: PlayerId,
    side: 'give' | 'get',
    draft: TradeDraft,
  ): string {
    const chosen = draft[side].tiles;
    const rows = tilesOwnedBy(s, owner)
      .map((tile) => {
        const locked = hasBuildingsInGroup(s, tile);
        const checked = chosen.includes(tile) ? 'checked' : '';
        return `<label class="check${locked ? ' locked' : ''}">
          <input type="checkbox" data-trade-tile="${side}" value="${tile}" ${checked} ${locked ? 'disabled' : ''} />
          ${cs.tiles[tile]}
        </label>`;
      })
      .join('');
    return rows || `<p>${cs.game.tradeNothing}</p>`;
  }

  private renderTradeSide(
    s: GameState,
    owner: PlayerId,
    side: 'give' | 'get',
    draft: TradeDraft,
  ): string {
    const p = s.players[owner]!;
    const values = draft[side];
    return `
      <div class="trade-col">
        <h4>${side === 'give' ? cs.game.tradeGive : cs.game.tradeGet} (${escapeHtml(p.name)})</h4>
        <div class="trade-tiles">${this.tradeTileChoices(s, owner, side, draft)}</div>
        <label>${cs.game.tradeCash}
          <input type="number" data-trade-cash="${side}" min="0" max="${p.cash}" step="1000" value="${values.cash}" />
        </label>
        <label>${cs.game.tradeJailCards}
          <input type="number" data-trade-jail="${side}" min="0" max="${p.jailCards.length}" value="${values.jailCards}" />
        </label>
      </div>`;
  }

  private renderTradeDialog(s: GameState, draft: TradeDraft): string {
    const targets = s.players
      .filter((p) => !p.bankrupt && p.id !== this.me)
      .map(
        (p) =>
          `<option value="${p.id}"${p.id === draft.to ? ' selected' : ''}>${escapeHtml(p.name)}</option>`,
      )
      .join('');
    return `
      <div class="overlay">
        <form class="dialog trade" data-form="trade">
          <h2>${cs.game.tradeTitle}</h2>
          <label>${cs.game.tradeWith} <select data-trade-target>${targets}</select></label>
          <div class="trade-cols">
            ${this.renderTradeSide(s, this.me, 'give', draft)}
            ${this.renderTradeSide(s, draft.to, 'get', draft)}
          </div>
          ${draft.error ? `<p class="error">${cs.game.tradeInvalid}</p>` : ''}
          <div class="row">
            ${button(cs.game.tradeCancel, 'cancelTrade', 'type="button"')}
            <button class="btn primary" type="submit">${cs.game.tradeSend}</button>
          </div>
        </form>
      </div>`;
  }

  private renderResult(s: GameState): string {
    const summary = summarizeGame(s);
    const rows = summary.standings
      .map(
        (row) =>
          `<tr><td>${escapeHtml(s.players[row.player]!.name)}</td><td>${formatMoney(netWorth(s, row.player))}</td></tr>`,
      )
      .join('');
    const biggest = summary.biggestRent
      ? `<p>${cs.result.biggestRent(escapeHtml(s.players[summary.biggestRent.player]!.name), formatMoney(summary.biggestRent.amount))}</p>`
      : '';
    return `
      <div class="overlay">
        <div class="dialog result">
          <h1 class="logo small">${cs.result.title(escapeHtml(s.players[summary.winner]!.name))}</h1>
          <p>${cs.result.rounds(summary.rounds)}</p>
          ${biggest}
          <h3>${cs.result.standings}</h3>
          <table>${rows}</table>
          ${button(cs.result.again, 'newGame', '', true)}
        </div>
      </div>`;
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl) {
      if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;
      this.handleAction(actionEl);
      return;
    }
    const tileEl = target.closest<HTMLElement>('[data-tile]');
    if (tileEl) {
      const id = Number(tileEl.dataset.tile);
      this.selectedTile = this.selectedTile === id ? null : id;
      this.render();
    }
  }

  private handleAction(el: HTMLElement): void {
    const action = el.dataset.action!;
    const player = this.me;
    const tile = Number(el.dataset.tileId);
    switch (action) {
      case 'roll':
      case 'payBail':
      case 'useJailCard':
      case 'buy':
      case 'decline':
      case 'passBid':
      case 'acceptTrade':
      case 'rejectTrade':
      case 'settleDebt':
      case 'endTurn':
        this.send({ type: action, player });
        return;
      case 'declareBankruptcy':
        this.send({ type: action, player });
        return;
      case 'bid':
        this.send({ type: 'bid', player, amount: Number(el.dataset.amount) });
        return;
      case 'build':
      case 'sellBuilding':
      case 'mortgage':
      case 'unmortgage':
        this.send({ type: action, player, tile });
        return;
      case 'closeTile':
        this.selectedTile = null;
        break;
      case 'openTrade': {
        const to = this.state.players.find((p) => !p.bankrupt && p.id !== this.me)!.id;
        this.draft = { to, give: emptySide(), get: emptySide(), error: false };
        break;
      }
      case 'cancelTrade':
        this.draft = null;
        break;
      case 'speed':
        this.speed = el.dataset.speed as Speed;
        this.bots.refresh();
        break;
      case 'quit':
        if (this.state.phase === 'gameOver' || window.confirm(cs.game.quitConfirm)) {
          this.callbacks.onExit();
        }
        return;
      case 'newGame':
        this.callbacks.onNewGame();
        return;
    }
    this.render();
  }

  private onInput(event: Event): void {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    const draft = this.draft;
    if (!draft) return;
    if (el.dataset.tradeTarget !== undefined) {
      this.draft = { to: Number(el.value), give: draft.give, get: emptySide(), error: false };
      this.render();
      return;
    }
    const tileSide = el.dataset.tradeTile as 'give' | 'get' | undefined;
    if (tileSide && el instanceof HTMLInputElement) {
      const tile = Number(el.value);
      const tiles = draft[tileSide].tiles;
      draft[tileSide].tiles = el.checked ? [...tiles, tile] : tiles.filter((t) => t !== tile);
      return;
    }
    const cashSide = el.dataset.tradeCash as 'give' | 'get' | undefined;
    if (cashSide) draft[cashSide].cash = Math.max(0, Math.floor(Number(el.value) || 0));
    const jailSide = el.dataset.tradeJail as 'give' | 'get' | undefined;
    if (jailSide) draft[jailSide].jailCards = Math.max(0, Math.floor(Number(el.value) || 0));
  }

  private onSubmit(event: Event): void {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    if (form.dataset.form === 'bid') {
      const amount = Number(new FormData(form).get('amount'));
      this.send({ type: 'bid', player: this.me, amount });
      return;
    }
    if (form.dataset.form === 'trade' && this.draft) {
      const { to, give, get } = this.draft;
      if (!isValidTrade(this.state, { from: this.me, to, give, get })) {
        this.draft.error = true;
        this.render();
        return;
      }
      this.draft = null;
      this.send({ type: 'proposeTrade', player: this.me, offer: { to, give, get } });
    }
  }
}
