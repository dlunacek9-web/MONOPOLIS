import {
  GROUP_ORDER,
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
  ownsWholeGroup,
  groupTiles,
  tilesOfKind,
  tileAt,
  tilesOwnedBy,
  unmortgageCost,
} from '../core';
import type { Action, GameEvent, GameState, PlayerId, TileId, TradeSide } from '../core';
import { cs, formatMoney } from '../i18n/cs';
import { BotRunner } from '../bots/runner';
import { LocalTransport } from '../net/local';
import type { GameTransport } from '../net/transport';
import { publishGameEnd, summarizeGame } from '../profile/profile';
import { PLAYER_COLORS, renderBoard, shortTileName, tileColor } from './board';
import { escapeHtml } from './html';
import { formatEvent, quipFor } from './log';

interface TradeDraft {
  to: PlayerId;
  give: TradeSide;
  get: TradeSide;
  error: boolean;
}

type Speed = 'normal' | 'fast' | 'turbo';
const SPEED_MS: Record<Speed, number> = { normal: 900, fast: 200, turbo: 15 };

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
  private readonly lines: { text: string; cls: string; color: string }[] = [];
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

  private addLine(text: string, cls: string, player: PlayerId | null): void {
    const color = player === null ? 'transparent' : (PLAYER_COLORS[player] ?? 'transparent');
    this.lines.unshift({ text, cls, color });
  }

  private collectLog(s: GameState): void {
    let pendingRoll: Extract<GameEvent, { type: 'roll' }> | null = null;
    const flushRoll = () => {
      if (pendingRoll) this.addLine(formatEvent(s, pendingRoll), '', pendingRoll.player);
      pendingRoll = null;
    };
    for (const event of s.events) {
      if (event.seq <= this.lastSeq) continue;
      this.lastSeq = event.seq;
      if (event.type === 'roll') {
        flushRoll();
        pendingRoll = event;
        continue;
      }
      if (event.type === 'move') {
        // Hod a pohyb patří k sobě, takže ve výpisu tvoří jeden řádek.
        if (pendingRoll?.player === event.player) {
          const [a, b] = pendingRoll.dice;
          const name = s.players[event.player]?.name ?? '';
          this.addLine(cs.log.rollMove(name, a, b, cs.tiles[event.tile] ?? ''), '', event.player);
          pendingRoll = null;
        } else {
          flushRoll();
          this.addLine(formatEvent(s, event), '', event.player);
        }
        continue;
      }
      if (event.type !== 'passStart') flushRoll();
      const important = ['bankrupt', 'gameOver', 'turnStart'].includes(event.type);
      const player = 'player' in event ? event.player : 'from' in event ? event.from : null;
      this.addLine(formatEvent(s, event), important ? `log-${event.type}` : '', player);
      const quip = quipFor(s, event);
      if (quip) this.addLine(quip, 'log-quip', event.type === 'rent' ? event.owner : player);
    }
    flushRoll();
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
        ${renderBoard(s, this.me, this.renderCenter(s))}
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

  private renderDie(value: number): string {
    const pips: Record<number, number[]> = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    };
    const cells = Array.from(
      { length: 9 },
      (_, i) => `<span class="${pips[value]?.includes(i) ? 'dot' : ''}"></span>`,
    ).join('');
    return `<div class="die" aria-label="${value}">${cells}</div>`;
  }

  /** Karta vytažená v tomto tahu. Zůstává ve středu, dokud nezačne další tah. */
  private currentCard(s: GameState): Extract<GameEvent, { type: 'card' }> | null {
    for (let i = s.events.length - 1; i >= 0; i--) {
      const event = s.events[i]!;
      if (event.type === 'turnStart') return null;
      if (event.type === 'card') return event;
    }
    return null;
  }

  private renderCenter(s: GameState): string {
    const actor = actorOf(s);
    const banner =
      actor === null
        ? ''
        : `<div class="turn-banner${actor === this.me ? ' mine' : ''}" style="--c:${PLAYER_COLORS[actor]}">
             ${actor === this.me ? cs.game.yourTurn : cs.game.onTurn(escapeHtml(s.players[actor]!.name))}
           </div>`;
    const dice = s.lastRoll
      ? `${this.renderDie(s.lastRoll[0])}${this.renderDie(s.lastRoll[1])}`
      : `${this.renderDie(1)}${this.renderDie(1)}`;
    const card = this.currentCard(s);
    const deck = (id: 'tip' | 'urad', icon: string) =>
      `<div class="deck deck-${id}${card?.deck === id ? ' drawn' : ''}"><span>${icon}</span><small>${cs.decks[id]}</small></div>`;
    const cardView = card
      ? `<div class="drawn-card deck-${card.deck}">
           <strong>${cs.decks[card.deck]} · ${escapeHtml(s.players[card.player]?.name ?? '')}</strong>
           <p>${cs.cards[card.deck][card.card] ?? ''}</p>
         </div>`
      : '';
    const detail =
      this.selectedTile === null
        ? ''
        : `<div class="tile-detail">${this.renderDeed(s, this.selectedTile, true)}</div>`;
    return `
      <div class="center-head">
        <h1 class="logo small">${cs.title}</h1>
        <span class="round">${cs.game.round(s.round)}</span>
      </div>
      ${banner}
      <div class="table">
        ${deck('tip', '🤫')}
        <div class="dice">${dice}</div>
        ${deck('urad', '🏛️')}
      </div>
      ${cardView}
      ${detail}
      <h3 class="log-title">${cs.game.log}</h3>
      <div class="log">
        ${this.lines
          .map(
            (line) =>
              `<p class="${line.cls}" style="--c:${line.color}">${escapeHtml(line.text)}</p>`,
          )
          .join('')}
      </div>`;
  }

  /** Čtverečky všech pozemků: hned je vidět, co hráč má a co mu do města chybí. */
  private renderHoldings(s: GameState, player: PlayerId): string {
    const groups = [
      ...GROUP_ORDER.map((group) => groupTiles(group)),
      tilesOfKind('station'),
      tilesOfKind('utility'),
    ];
    return groups
      .map((tiles) => {
        const cells = tiles
          .map((tile) => {
            const deed = s.deeds[tile];
            const owned = deed?.owner === player;
            const cls = `${owned ? 'has' : ''}${owned && deed?.mortgaged ? ' mort' : ''}`;
            return `<button class="holding ${cls}" style="--c:${tileColor(tile).bg}" data-tile="${tile}" title="${cs.tiles[tile]}"></button>`;
          })
          .join('');
        return `<span class="holding-group">${cells}</span>`;
      })
      .join('');
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
            <div class="player-head">
              <i class="token" style="background:${PLAYER_COLORS[p.id]}">${escapeHtml(p.name.charAt(0).toUpperCase())}</i>
              <strong>${escapeHtml(p.name)}</strong>
              <span class="cash">${formatMoney(p.cash)}</span>
            </div>
            <small>${flags}</small>
            <div class="holdings">${this.renderHoldings(s, p.id)}</div>
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
        ${this.renderDeed(s, s.pendingBuy, false)}
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
    return `<h3>${cs.game.auctionTitle}</h3>${this.renderDeed(s, auction.tile, false)}<p class="auction-status">${status}</p>`;
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
        <div class="row between">
          <div class="row"><span>${cs.game.speed}</span>${speeds}</div>
          <button class="chip" data-action="quit">${cs.game.quit}</button>
        </div>
        <small>${cs.game.hints}</small>
      </section>`;
  }

  /** Karta pozemku: záhlaví v barvě města, nájmy a u vlastních pozemků správa. */
  private renderDeed(s: GameState, id: TileId, withControls: boolean): string {
    const tile = tileAt(id);
    const rows: string[] = [];
    const row = (label: string, value: string, now = false) =>
      rows.push(`<tr${now ? ' class="now"' : ''}><td>${label}</td><td>${value}</td></tr>`);
    const deed = s.deeds[id];
    let description = '';
    let kicker = '';
    switch (tile.kind) {
      case 'property': {
        kicker = cs.groups[tile.group];
        const level = deed?.level ?? 0;
        const whole = deed?.owner != null && ownsWholeGroup(s, deed.owner, id);
        const owned = deed?.owner != null && !deed.mortgaged;
        row(cs.tile.rentBase, formatMoney(tile.rents[0]!), owned && level === 0 && !whole);
        row(cs.tile.rentSet, formatMoney(tile.rents[0]! * 2), owned && level === 0 && whole);
        for (let n = 1; n < HOTEL_LEVEL; n++) {
          row(cs.tile.rentHouses(n), formatMoney(tile.rents[n]!), owned && level === n);
        }
        row(
          cs.tile.rentHotel,
          formatMoney(tile.rents[HOTEL_LEVEL]!),
          owned && level === HOTEL_LEVEL,
        );
        row(cs.tile.houseCost, formatMoney(tile.houseCost));
        break;
      }
      case 'station': {
        const count =
          deed?.owner == null
            ? 0
            : tilesOfKind('station').filter((t) => s.deeds[t]?.owner === deed.owner).length;
        STATION_RENTS.forEach((rent, i) =>
          row(cs.tile.stationRents(i + 1), formatMoney(rent), !deed?.mortgaged && count === i + 1),
        );
        break;
      }
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
    if (deed && withControls) {
      const owner = deed.owner === null ? cs.tile.noOwner : escapeHtml(s.players[deed.owner]!.name);
      row(cs.tile.price, formatMoney(ownablePrice(id) ?? 0));
      row(cs.tile.mortgageValue, formatMoney(mortgageValue(id)));
      row(cs.tile.owner, deed.mortgaged ? `${owner} (${cs.tile.mortgaged})` : owner);
    }
    const manage: string[] = [];
    if (withControls && deed?.owner === this.me) {
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
    const color = tileColor(id);
    return `
      <div class="deed">
        <header style="background:${color.bg};color:${color.ink}">
          <div>
            ${kicker ? `<small>${kicker}</small>` : ''}
            <strong>${shortTileName(id)}</strong>
          </div>
          ${withControls ? `<button class="deed-close" data-action="closeTile" aria-label="${cs.game.close}">×</button>` : ''}
        </header>
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
