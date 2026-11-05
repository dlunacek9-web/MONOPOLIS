import {
  BUSINESS,
  GROUP_ORDER,
  HOTEL_LEVEL,
  JAIL_BAIL,
  MIN_BID_STEP,
  MONEY_UNIT,
  STATION_RENTS,
  actorOf,
  bribeCost,
  bribeRiskPct,
  buildCost,
  canBribeBuild,
  canBribeOfficial,
  canBribePolice,
  canBuild,
  canBuyShares,
  canLaunder,
  canMortgage,
  canProposeTrade,
  canPumpDump,
  canSellBuilding,
  canSellShares,
  canSetOffBooks,
  canUnmortgage,
  hasBuildingsInGroup,
  hasBusiness,
  holdingOf,
  isValidTrade,
  launderFeePct,
  launderLimit,
  launderNet,
  launderRiskPct,
  minBid,
  mortgageValue,
  netWorth,
  ownablePrice,
  ownsWholeGroup,
  pumpOn,
  sharePrice,
  groupTiles,
  tilesOfKind,
  tileAt,
  tilesOwnedBy,
  unmortgageCost,
} from '../core';
import type { Action, GameEvent, GameState, GroupId, PlayerId, TileId, TradeSide } from '../core';
import { cs, formatMoney } from '../i18n/cs';
import { BotRunner } from '../bots/runner';
import type { GameTransport } from '../net/transport';
import { publishGameEnd, summarizeGame } from '../profile/profile';
import { chaseMinigame } from '../minigames/chase';
import { CityView } from '../render/city-view';
import { footText } from '../render/tile-info';
import { PLAYER_COLORS, renderBoard, shortTileName, tileColor } from './board';
import { applyMode } from './mode';
import { escapeHtml } from './html';
import { formatEvent, quipFor } from './log';

interface TradeDraft {
  to: PlayerId;
  give: TradeSide;
  get: TradeSide;
  error: boolean;
}

export type GameRole = 'solo' | 'host' | 'guest';

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
  /** U hosta v multiplayeru boti neběží, hraje je hostitel. */
  private readonly bots: BotRunner | null;
  private readonly unsubscribe: () => void;
  private selectedTile: TileId | null = null;
  private draft: TradeDraft | null = null;
  private businessOpen = false;
  private speed: Speed = 'normal';
  private endPublished = false;
  /** Honička tohoto hráče právě běží, nebo se čeká, až hostitel potvrdí výsledek. */
  private chaseRunning = false;
  private readonly minigameAbort = new AbortController();
  private readonly lines: { text: string; cls: string; color: string }[] = [];
  private lastSeq = 0;
  /** `null` znamená 2D desku: režim Klasika, nebo prohlížeč bez WebGL. */
  private readonly view: CityView | null;
  private readonly ui: HTMLElement;
  private readonly tooltip: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly transport: GameTransport,
    private readonly me: PlayerId,
    private readonly callbacks: { onExit: () => void; onNewGame: () => void },
    private readonly role: GameRole = 'solo',
  ) {
    this.root.innerHTML = `
      <div class="scene-host"></div>
      <div class="tile-tooltip" hidden></div>
      <div class="ui"></div>`;
    this.ui = this.root.querySelector<HTMLElement>('.ui')!;
    this.tooltip = this.root.querySelector<HTMLElement>('.tile-tooltip')!;
    applyMode(transport.getState().settings.mode);
    this.view = this.createView(transport.getState());
    // Pořadí je důležité: město se musí překreslit dřív, než si bot spočítá čekání na auto.
    this.unsubscribe = this.transport.subscribe(() => this.render());
    this.bots = role === 'guest' ? null : new BotRunner(this.transport, (s) => this.delay(s));
    this.root.onclick = (event) => this.onClick(event);
    this.root.oninput = (event) => this.onInput(event);
    this.root.onsubmit = (event) => this.onSubmit(event);
    this.render();
  }

  stop(): void {
    this.minigameAbort.abort();
    this.unsubscribe();
    this.bots?.stop();
    this.view?.dispose();
    this.root.onclick = null;
    this.root.oninput = null;
    this.root.onsubmit = null;
  }

  private createView(state: GameState): CityView | null {
    const host = this.root.querySelector<HTMLElement>('.scene-host')!;
    // Klasika se hraje na ploché desce jako originál, 3D město patří režimu Next level.
    if (state.settings.mode === 'classic') {
      host.remove();
      return null;
    }
    try {
      return new CityView(host, state, {
        onTileClick: (tile) => this.toggleTile(tile),
        onHover: (tile, x, y) => this.showTooltip(tile, x, y),
        onIdle: () => this.render(),
      });
    } catch (error) {
      console.warn('3D město nejde spustit, hraje se na 2D desce.', error);
      host.remove();
      return null;
    }
  }

  private toggleTile(tile: TileId): void {
    this.selectedTile = this.selectedTile === tile ? null : tile;
    this.render();
  }

  private showTooltip(tile: TileId | null, x: number, y: number): void {
    if (tile === null) {
      this.tooltip.hidden = true;
      return;
    }
    const foot = footText(this.state, tile);
    const owner = this.state.deeds[tile]?.owner ?? null;
    const ownerName = owner === null ? '' : (this.state.players[owner]?.name ?? '');
    this.tooltip.innerHTML = `
      <strong>${cs.tiles[tile] ?? ''}</strong>
      ${foot ? `<small>${foot}</small>` : ''}
      ${ownerName ? `<small>${cs.tile.owner}: ${escapeHtml(ownerName)}</small>` : ''}`;
    this.tooltip.style.left = `${x + 14}px`;
    this.tooltip.style.top = `${y + 14}px`;
    this.tooltip.hidden = false;
  }

  private delay(s: GameState): number {
    const base = SPEED_MS[this.speed];
    const wait = s.auction || s.trade ? Math.ceil(base / 2) : base;
    return wait + (this.view?.remainingMs ?? 0);
  }

  private get state(): GameState {
    const state = this.transport.getState();
    applyMode(state.settings.mode);
    return state;
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
      const important = ['bankrupt', 'busted', 'gameOver', 'turnStart'].includes(event.type);
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
    this.view?.update(s, this.me, this.selectedTile);
    if (actorOf(s) !== this.me) this.businessOpen = false;
    const focus = this.ui.querySelector<HTMLElement>('.log')?.scrollTop ?? 0;
    const stage = this.view
      ? `<div class="hud">${this.renderCenter(s)}</div>`
      : renderBoard(s, this.me, this.renderCenter(s));
    this.ui.innerHTML = `
      <div class="game${this.view ? ' in-city' : ''}">
        ${stage}
        <aside class="side">
          ${this.renderPlayers(s)}
          <section class="panel actions">${this.renderActions(s)}</section>
          ${this.renderFooter()}
        </aside>
      </div>
      ${this.draft ? this.renderTradeDialog(s, this.draft) : ''}
      ${this.businessOpen ? this.renderBusinessDialog(s) : ''}
      ${s.phase === 'gameOver' ? this.renderResult(s) : ''}`;
    const log = this.ui.querySelector<HTMLElement>('.log');
    if (log) log.scrollTop = focus;
    this.syncChase(s);
  }

  /** Spustí honičku, když má ujíždět tento člověk a jeho auto už dojelo. */
  private syncChase(s: GameState): void {
    if (s.phase !== 'chase') {
      this.chaseRunning = false;
      return;
    }
    const mine = s.active === this.me && !s.players[this.me]?.bot;
    if (!mine || this.chaseRunning || this.view?.busy) return;
    this.chaseRunning = true;
    const input = {
      player: this.me,
      seed: (s.rng ^ s.turn) | 0,
      color: PLAYER_COLORS[this.me] ?? '#ffffff',
    };
    this.view?.setPaused(true);
    chaseMinigame
      .start({ host: this.root, input, signal: this.minigameAbort.signal })
      .then(
        (result) => chaseMinigame.resultAction(input, result),
        (error: unknown) => {
          console.warn('Honička nejde spustit, rozhodne náhoda.', error);
          return chaseMinigame.autoResolve(input);
        },
      )
      .then((action) => {
        if (this.minigameAbort.signal.aborted) return;
        this.view?.setPaused(false);
        this.send(action);
      })
      .catch((error: unknown) => console.warn('Výsledek honičky nejde zapsat.', error));
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
        ${this.view ? `<button class="chip" data-action="resetCamera">${cs.game.resetCamera}</button>` : ''}
      </div>
      ${banner}
      <div class="table">
        ${deck('tip', s.settings.mode === 'classic' ? '❓' : '🤫')}
        <div class="dice">${dice}</div>
        ${deck('urad', s.settings.mode === 'classic' ? '🧰' : '🏛️')}
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
          p.archetype ? cs.archetypes[p.archetype].name : '',
          p.dirty ? cs.biz.dirtyShort(formatMoney(p.dirty)) : '',
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
      const actorName = escapeHtml(s.players[actor ?? 0]!.name);
      if (s.phase === 'chase') return `<p class="waiting">${cs.chase.running(actorName)}</p>`;
      return `${s.auction ? this.renderAuctionInfo(s) : ''}<p class="waiting">${cs.game.waiting(actorName)}</p>`;
    }
    // Volby čekají, až auto dojede, ať je vidět, kde hráč vlastně stojí.
    if (this.view?.busy) return `<p class="waiting">${cs.game.driving}</p>`;
    if (s.trade) return this.renderIncomingTrade(s);
    const debt = s.debts[0];
    if (debt) {
      const creditor = debt.creditor === null ? cs.game.bank : s.players[debt.creditor]!.name;
      return `
        <h3>${cs.game.debtTitle}</h3>
        <p>${cs.game.debtText(formatMoney(debt.amount), escapeHtml(creditor))}</p>
        ${button(cs.game.pay(formatMoney(debt.amount)), 'settleDebt', me.cash < debt.amount ? 'disabled' : '', true)}
        ${this.businessButton(s)}
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
    if (s.phase === 'awaitTax' && s.pendingTax) return this.renderTax(s, s.pendingTax);
    if (s.phase === 'awaitRent' && s.pendingRent) return this.renderRent(s, s.pendingRent);
    if (s.phase === 'chase')
      return `<p class="waiting">${cs.chase.running(escapeHtml(me.name))}</p>`;
    if (s.phase === 'awaitRoll') {
      const jail = me.inJail
        ? `${button(cs.game.payBail(formatMoney(JAIL_BAIL)), 'payBail', me.cash < JAIL_BAIL ? 'disabled' : '')}
           ${me.jailCards.length ? button(cs.game.useJailCard, 'useJailCard') : ''}
           ${this.policeBribeButton(s)}`
        : '';
      const label = me.inJail ? cs.game.rollInJail : cs.game.roll;
      return `${button(label, 'roll', '', true)}${jail}${this.businessButton(s)}${this.tradeButton(s)}`;
    }
    const label = s.extraRoll && !me.inJail ? cs.game.rollAgain : cs.game.endTurn;
    return `${button(label, 'endTurn', '', true)}${this.businessButton(s)}${this.tradeButton(s)}`;
  }

  private businessButton(s: GameState): string {
    return hasBusiness(s) ? button(cs.biz.open, 'openBusiness') : '';
  }

  private policeBribeButton(s: GameState): string {
    if (!BUSINESS || !canBribePolice(s, this.me)) return '';
    const rules = BUSINESS.police;
    const label = cs.biz.bribePolice(
      formatMoney(bribeCost(s, this.me, rules)),
      bribeRiskPct(s, this.me, rules),
    );
    return button(label, 'bribePolice');
  }

  private renderRent(s: GameState, rent: NonNullable<GameState['pendingRent']>): string {
    const owner = escapeHtml(s.players[rent.owner]!.name);
    const factor = BUSINESS?.chase.caughtRentFactor ?? 2;
    return `
      <h3>${cs.chase.rentTitle}</h3>
      <p>${cs.chase.rentText(cs.tiles[rent.tile] ?? '', owner, formatMoney(rent.amount))}</p>
      ${button(cs.chase.payRent(formatMoney(rent.amount)), 'payRent', '', true)}
      ${button(cs.chase.flee(formatMoney(rent.amount * factor)), 'flee')}
      <small>${cs.chase.fleeNote(BUSINESS?.chase.cooldownRounds ?? 0)}</small>`;
  }

  private renderTax(s: GameState, tax: NonNullable<GameState['pendingTax']>): string {
    const amount = formatMoney(tax.amount);
    const bribe =
      BUSINESS && canBribeOfficial(s, this.me)
        ? button(
            cs.biz.bribeOfficial(
              formatMoney(bribeCost(s, this.me, BUSINESS.official)),
              bribeRiskPct(s, this.me, BUSINESS.official),
            ),
            'bribeOfficial',
          )
        : '';
    return `
      <h3>${cs.biz.taxTitle}</h3>
      <p>${cs.biz.taxText(cs.tiles[tax.tile] ?? '', amount)}</p>
      ${button(cs.biz.payTax(amount), 'payTax', '', true)}
      ${bribe}`;
  }

  private renderBusinessDialog(s: GameState): string {
    if (!BUSINESS) return '';
    const me = s.players[this.me]!;
    return `
      <div class="overlay">
        <div class="dialog business">
          <h2>${cs.biz.title}</h2>
          <p class="biz-balance">
            <span>${cs.biz.white}: <strong>${formatMoney(me.cash)}</strong></span>
            <span>${cs.biz.dirty}: <strong>${formatMoney(me.dirty)}</strong></span>
            ${me.archetype ? `<span>${cs.archetypes[me.archetype].name}: ${cs.archetypes[me.archetype].perk}</span>` : ''}
          </p>
          <p><small>${cs.biz.intro}</small></p>
          ${this.renderLaunderSection(s)}
          ${this.renderMarketSection(s)}
          <div class="row">${button(cs.biz.close, 'closeBusiness', '', true)}</div>
        </div>
      </div>`;
  }

  private renderLaunderSection(s: GameState): string {
    const amount = launderLimit(s, this.me);
    const rows = tilesOwnedBy(s, this.me)
      .map((tile) => {
        const deed = s.deeds[tile]!;
        const toggle = canSetOffBooks(s, this.me, tile)
          ? button(
              deed.offBooks ? cs.biz.offBooksOn : cs.biz.offBooksOff,
              'setOffBooks',
              `data-tile-id="${tile}" data-on="${deed.offBooks ? '' : '1'}"`,
            )
          : '';
        const net = formatMoney(launderNet(s, this.me, amount));
        const wash = deed.mortgaged
          ? cs.biz.mortgaged
          : s.launderedTiles.includes(tile)
            ? cs.biz.laundered
            : amount === 0
              ? ''
              : button(
                  cs.biz.launder(formatMoney(amount), net),
                  'launder',
                  `data-tile-id="${tile}" data-amount="${amount}" ${canLaunder(s, this.me, tile, amount) ? '' : 'disabled'}`,
                );
        return `<tr><td>${cs.tiles[tile]}</td><td>${toggle}</td><td>${wash}</td></tr>`;
      })
      .join('');
    const hint = cs.biz.launderHint(
      formatMoney(BUSINESS!.launderCap),
      launderFeePct(s, this.me),
      launderRiskPct(s, this.me),
    );
    return `
      <h3>${cs.biz.launderTitle}</h3>
      <p><small>${hint} ${cs.biz.offBooksHint}</small></p>
      ${rows ? `<div class="biz-scroll"><table class="biz-table">${rows}</table></div>` : `<p>${cs.biz.noTiles}</p>`}`;
  }

  private renderMarketSection(s: GameState): string {
    const { pump, stock } = BUSINESS!;
    const rows = GROUP_ORDER.map((group) => this.renderMarketRow(s, group)).join('');
    return `
      <h3>${cs.biz.marketTitle}</h3>
      <p><small>${cs.biz.marketHint(stock.maxShares, formatMoney(pump.cost), pump.riskPct)}</small></p>
      <table class="biz-table">
        <tr><th>${cs.biz.colFirm}</th><th>${cs.biz.colPrice}</th><th>${cs.biz.colHolding}</th><th></th></tr>
        ${rows}
      </table>`;
  }

  private renderMarketRow(s: GameState, group: GroupId): string {
    const lot = 5;
    const { count } = holdingOf(s, this.me, group);
    const data = `data-group="${group}"`;
    const buttons = [
      button(
        cs.biz.buy(lot),
        'buyShares',
        `${data} data-count="${lot}" ${canBuyShares(s, this.me, group, lot) ? '' : 'disabled'}`,
      ),
      button(
        cs.biz.sellAll,
        'sellShares',
        `${data} data-count="${count}" ${canSellShares(s, this.me, group, count) ? '' : 'disabled'}`,
      ),
      button(
        cs.biz.pump,
        'pumpDump',
        `${data} ${canPumpDump(s, this.me, group) ? '' : 'disabled'}`,
      ),
    ].join('');
    const pumping = pumpOn(s, group) ? ` <small>(${cs.biz.pumping})</small>` : '';
    return `<tr><td>${cs.groups[group]}${pumping}</td><td>${formatMoney(sharePrice(s, group))}</td><td>${count}</td><td class="row">${buttons}</td></tr>`;
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
    const quick = [min, min + 4 * MIN_BID_STEP, min + 9 * MIN_BID_STEP]
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
    // Rychlost je jen pro sólo: u společného stolu by ji jeden hráč vnutil ostatním.
    const speedRow = this.role === 'solo' ? `<span>${cs.game.speed}</span>${speeds}` : '';
    return `
      <section class="panel footer">
        <div class="row between">
          <div class="row">${speedRow}</div>
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
        row(
          cs.tile.houseCost,
          formatMoney(deed?.owner != null ? buildCost(s, deed.owner, id) : tile.houseCost),
        );
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
      if (deed.offBooks) row(cs.biz.offBooksDeed, cs.biz.yes);
    }
    const manage: string[] = [];
    if (withControls && deed?.owner === this.me) {
      if (tile.kind === 'property') {
        if (canBuild(s, this.me, id)) {
          manage.push(
            button(
              cs.tile.build(formatMoney(buildCost(s, this.me, id))),
              'build',
              `data-tile-id="${id}"`,
            ),
          );
        }
        if (BUSINESS && canBribeBuild(s, this.me, id)) {
          const rules = BUSINESS.build;
          const label = cs.biz.bribeBuild(
            formatMoney(bribeCost(s, this.me, rules)),
            bribeRiskPct(s, this.me, rules),
          );
          manage.push(button(label, 'bribeBuild', `data-tile-id="${id}"`));
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
          <input type="number" data-trade-cash="${side}" min="0" max="${p.cash}" step="${MONEY_UNIT}" value="${values.cash}" />
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
          ${this.renderResultButton()}
        </div>
      </div>`;
  }

  private renderResultButton(): string {
    if (this.role === 'guest') {
      return `<p class="waiting">${cs.mp.waitingHost}</p>${button(cs.mp.leave, 'quit')}`;
    }
    return button(this.role === 'host' ? cs.mp.backToLobby : cs.result.again, 'newGame', '', true);
  }

  private quitConfirmText(): string {
    if (this.role === 'host') return cs.mp.quitHostConfirm;
    if (this.role === 'guest') return cs.mp.quitGuestConfirm;
    return cs.game.quitConfirm;
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
    if (tileEl) this.toggleTile(Number(tileEl.dataset.tile));
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
      case 'payRent':
      case 'flee':
      case 'payTax':
      case 'bribeOfficial':
      case 'bribePolice':
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
      case 'bribeBuild':
        this.send({ type: action, player, tile });
        return;
      case 'setOffBooks':
        this.send({ type: action, player, tile, on: el.dataset.on === '1' });
        return;
      case 'launder':
        this.send({ type: action, player, tile, amount: Number(el.dataset.amount) });
        return;
      case 'buyShares':
      case 'sellShares':
        this.send({
          type: action,
          player,
          group: el.dataset.group as GroupId,
          count: Number(el.dataset.count),
        });
        return;
      case 'pumpDump':
        this.send({ type: action, player, group: el.dataset.group as GroupId });
        return;
      case 'openBusiness':
        this.businessOpen = true;
        break;
      case 'closeBusiness':
        this.businessOpen = false;
        break;
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
        this.view?.setSpeed(this.speed);
        this.bots?.refresh();
        break;
      case 'resetCamera':
        this.view?.resetCamera();
        return;
      case 'quit':
        if (this.state.phase === 'gameOver' || window.confirm(this.quitConfirmText())) {
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
