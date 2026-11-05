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
  canBreakout,
  canBribePolice,
  canBuild,
  canMortgage,
  canProposeTrade,
  canSellBuilding,
  canUnmortgage,
  hasBuildingsInGroup,
  hasBusiness,
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
import type { Action, GameState, GroupId, PlayerId, TileId, TradeSide } from '../core';
import { cs, formatMoney, formatMoneyShort } from '../i18n/cs';
import { BotRunner } from '../bots/runner';
import type { GameTransport } from '../net/transport';
import { publishGameEnd, summarizeGame } from '../profile/profile';
import { auctionMinigame } from '../minigames/auction';
import { breakoutMinigame } from '../minigames/breakout';
import { LiveAuctionRunner } from '../bots/auction-runner';
import { chaseMinigame } from '../minigames/chase';
import type { Minigame } from '../minigames/types';
import { CityView } from '../render/city-view';
import { footText } from '../render/tile-info';
import { renderBackroom } from './backroom';
import { beatWait, beatsFor } from './beats';
import type { Beat, BeatWait } from './beats';
import { PLAYER_COLORS, renderBoard, shortTileName, tileColor } from './board';
import { act } from './buttons';
import { character } from './characters';
import type { CharacterId } from './characters';
import { Director } from './director';
import { applyMode } from './mode';
import { escapeHtml } from './html';
import { icon } from './icons';
import { formatEvent } from './log';
import { PriceHistory, renderMarket } from './market';
import { Stage, dieFace } from './stage';
import type { StageFooter } from './stage';

interface TradeDraft {
  to: PlayerId;
  give: TradeSide;
  get: TradeSide;
  error: boolean;
}

export type GameRole = 'solo' | 'host' | 'guest';

type Speed = 'slow' | 'normal' | 'fast' | 'turbo';
type Panel = 'market' | 'backroom' | null;

/** Pauza bota před dalším tahem. Délku scén k tomu řídí režisér. */
const SPEED_MS: Record<Speed, number> = { slow: 1600, normal: 700, fast: 150, turbo: 15 };
const SPEED_FACTOR: Record<Speed, number> = { slow: 1.8, normal: 1, fast: 0.45, turbo: 0 };
/** Tak dlouho po začátku scény se klik ignoruje, ať ji hráč neodklikne omylem naslepo. */
const DISMISS_GUARD_MS = 300;
/** Pojistka, když odkliknutí jiného hráče nedorazí: výpadek sítě, jiná záložka. */
const OTHER_CLICK_LIMIT_MS = 30_000;
/** Scéna, kterou hráč odklikl dřív, než jsme se k ní dostali, se jen krátce mihne. */
const ALREADY_CLICKED_FACTOR = 0.4;
const SPEED_LABEL: Record<Speed, string> = {
  slow: cs.game.speedSlow,
  normal: cs.game.speedNormal,
  fast: cs.game.speedFast,
  turbo: cs.game.speedTurbo,
};
/** Tak dlouho má nová otázka třídu s animací příchodu. */
const ENTER_MS = 400;

/** Jedna otázka na hráče: co se ptá, kdo se ptá a jaké má možnosti. */
interface Decision {
  /** Změna klíče znamená novou otázku, jen tehdy se panel animuje. */
  key: string;
  prompt?: string;
  tip?: string;
  tone?: 'wait';
  character?: CharacterId;
  deed?: TileId;
  actions: string[];
  /** Jestli jsou teď přístupné Burza, Zadní místnost a Obchod. */
  doors: boolean;
}

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
  private readonly director: Director<GameState, Beat>;
  private readonly stage: Stage;
  private readonly prices = new PriceHistory();
  /** Stav, který hráč právě vidí. Skutečný stav ho dožene, až doběhnou scény. */
  private shown: GameState;
  /** Do které události už smí město dojet. */
  private revealedSeq: number;
  private rolling = false;
  private beatStartedAt = 0;
  private currentBeat: { beat: Beat; wait: BeatWait } | null = null;
  private otherLimit: ReturnType<typeof setTimeout> | null = null;
  /** Poslední odkliknutá událost každého hráče. */
  private readonly acks = new Map<PlayerId, number>();
  private readonly unsubscribeAck: () => void;
  private selectedTile: TileId | null = null;
  private draft: TradeDraft | null = null;
  private panel: Panel = null;
  private historyOpen = false;
  private speed: Speed = 'normal';
  private endPublished = false;
  private minigameRunning = false;
  private liveAuctionOpen = false;
  private readonly liveAuctions: LiveAuctionRunner | null;
  private readonly minigameAbort = new AbortController();
  private readonly lines: { text: string; color: string }[] = [];
  private headline: { text: string; color: string } = { text: '', color: 'transparent' };
  private lastSeq: number;
  private lastDecision = '';
  private decisionAt = 0;
  private readonly lastCash = new Map<PlayerId, number>();
  /** `null` znamená 2D desku: režim Klasika, nebo prohlížeč bez WebGL. */
  private readonly view: CityView | null;
  private readonly ui: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly slots: Record<'main' | 'players' | 'dock' | 'overlays', HTMLElement>;
  private readonly painted = new WeakMap<HTMLElement, string>();
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);

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
      <div class="ui"></div>
      <div class="stage"></div>
      <div class="ui-tip" hidden></div>`;
    this.ui = this.root.querySelector<HTMLElement>('.ui')!;
    this.tooltip = this.root.querySelector<HTMLElement>('.tile-tooltip')!;
    this.hint = this.root.querySelector<HTMLElement>('.ui-tip')!;
    this.stage = new Stage(this.root.querySelector<HTMLElement>('.stage')!);

    const initial = transport.getState();
    applyMode(initial.settings.mode);
    this.shown = initial;
    this.lastSeq = initial.eventSeq;
    this.revealedSeq = initial.eventSeq;
    this.prices.record(initial);
    this.view = this.createView(initial);

    this.ui.innerHTML = `
      <div class="game${this.view ? ' in-city' : ''}">
        <div class="slot-main"></div>
        <aside class="side">
          <section class="players"></section>
          <div class="slot-dock"></div>
        </aside>
      </div>
      <div class="slot-overlays"></div>`;
    this.slots = {
      main: this.ui.querySelector<HTMLElement>('.slot-main')!,
      players: this.ui.querySelector<HTMLElement>('.players')!,
      dock: this.ui.querySelector<HTMLElement>('.slot-dock')!,
      overlays: this.ui.querySelector<HTMLElement>('.slot-overlays')!,
    };

    this.director = new Director<GameState, Beat>({
      play: (beat) => this.playBeat(beat),
      duration: (beat, backlog) => this.beatMs(beat, backlog),
      settle: (state) => {
        this.shown = state;
      },
      idle: () => {
        this.currentBeat = null;
        this.stage.clear();
        this.rolling = false;
        this.revealedSeq = Number.POSITIVE_INFINITY;
        this.render();
      },
    });

    // Pořadí je důležité: scény se musí zařadit dřív, než se bot rozhodne, jestli smí hrát.
    this.unsubscribe = this.transport.subscribe(() => this.onState());
    this.unsubscribeAck = this.transport.onAcknowledge((player, seq) => this.onAck(player, seq));
    this.bots =
      role === 'guest'
        ? null
        : new BotRunner(
            this.transport,
            (s) => this.delay(s),
            () => this.director.busy || (this.view?.busy ?? false),
          );
    this.liveAuctions =
      role === 'guest'
        ? null
        : new LiveAuctionRunner(
            this.transport,
            () => this.director.busy || (this.view?.busy ?? false),
          );
    this.root.onclick = (event) => this.onClick(event);
    this.root.oninput = (event) => this.onInput(event);
    this.root.onsubmit = (event) => this.onSubmit(event);
    this.root.onmouseover = (event) => this.onHoverTip(event);
    document.addEventListener('keydown', this.onKey, true);

    // Partie začíná jedním oznámením, kdo je na tahu. Starší události jen do historie.
    for (const event of initial.events) {
      const text = formatEvent(initial, event);
      if (text) this.addLine(text, 'player' in event ? event.player : null);
    }
    const turn = [...initial.events].reverse().find((event) => event.type === 'turnStart');
    this.director.enqueue(initial, turn ? beatsFor(initial, [turn], this.me) : []);
    this.render();
  }

  stop(): void {
    this.minigameAbort.abort();
    this.unsubscribe();
    this.unsubscribeAck();
    this.clearOtherLimit();
    this.bots?.stop();
    this.liveAuctions?.stop();
    this.director.stop();
    this.view?.dispose();
    document.removeEventListener('keydown', this.onKey, true);
    this.root.onclick = null;
    this.root.oninput = null;
    this.root.onsubmit = null;
    this.root.onmouseover = null;
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
    const foot = footText(this.shown, tile);
    const owner = this.shown.deeds[tile]?.owner ?? null;
    const ownerName = owner === null ? '' : (this.shown.players[owner]?.name ?? '');
    this.tooltip.innerHTML = `
      <strong>${cs.tiles[tile] ?? ''}</strong>
      ${foot ? `<small>${foot}</small>` : ''}
      ${ownerName ? `<small>${cs.tile.owner}: ${escapeHtml(ownerName)}</small>` : ''}`;
    this.tooltip.style.left = `${x + 14}px`;
    this.tooltip.style.top = `${y + 14}px`;
    this.tooltip.hidden = false;
  }

  /** Popisek tlačítka: jedna věta navíc jen tomu, kdo se zeptá najetím myši. */
  private onHoverTip(event: MouseEvent): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    const tip = el?.dataset.tip;
    if (!el || !tip) {
      this.hint.hidden = true;
      return;
    }
    this.hint.textContent = tip;
    this.hint.hidden = false;
    const box = el.getBoundingClientRect();
    const width = this.hint.offsetWidth;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2),
    );
    this.hint.style.left = `${left}px`;
    const above = box.top - this.hint.offsetHeight - 8;
    this.hint.style.top = `${above > 8 ? above : box.bottom + 8}px`;
  }

  private delay(s: GameState): number {
    const base = SPEED_MS[this.speed];
    return s.auction || s.trade ? Math.ceil(base / 2) : base;
  }

  private get state(): GameState {
    const state = this.transport.getState();
    applyMode(state.settings.mode);
    return state;
  }

  private send(action: Action): void {
    this.transport.dispatch(action);
  }

  private addLine(text: string, player: PlayerId | null): void {
    const color = player === null ? 'transparent' : (PLAYER_COLORS[player] ?? 'transparent');
    this.lines.unshift({ text, color });
    this.lines.length = Math.min(this.lines.length, 80);
    this.headline = { text, color };
  }

  /** Pravidla něco udělala: přeložit na scény a zařadit do fronty. */
  private onState(): void {
    const s = this.state;
    const fresh = s.events.filter((event) => event.seq > this.lastSeq);
    this.lastSeq = s.eventSeq;
    this.prices.record(s);
    this.releaseIfBot(s);
    if (this.revealedSeq === Number.POSITIVE_INFINITY)
      this.revealedSeq = fresh[0]?.seq ?? s.eventSeq;
    this.director.enqueue(s, beatsFor(s, fresh, this.me));
    this.render();
  }

  private playBeat(beat: Beat): void {
    this.clearOtherLimit();
    this.revealedSeq = beat.seq;
    if (beat.text) this.addLine(beat.text, beat.player);
    this.rolling = beat.kind === 'dice';
    if (beat.kind === 'toast') {
      this.stage.show(beat, 1);
    } else {
      const wait = beatWait(beat, this.me, this.transport.getState().players);
      this.currentBeat = { beat, wait };
      this.beatStartedAt = performance.now();
      this.stage.show(beat, this.scaled('ms' in beat ? beat.ms : 0), this.footerFor(wait, beat));
    }
    this.render();
  }

  private footerFor(wait: BeatWait, beat: Beat): StageFooter {
    if (wait.kind === 'mine') return { kind: 'click' };
    if (wait.kind === 'other' && !this.clickedAlready(wait.player, beat)) {
      return { kind: 'waiting', name: this.transport.getState().players[wait.player]?.name ?? '' };
    }
    return { kind: 'skip' };
  }

  private clickedAlready(player: PlayerId, beat: Beat): boolean {
    return (this.acks.get(player) ?? -1) >= beat.seq;
  }

  private scaled(ms: number): number {
    return Math.round(ms * SPEED_FACTOR[this.speed]);
  }

  private beatMs(beat: Beat, backlog: number): number | 'hold' {
    if (beat.kind === 'drive') {
      if (this.speed === 'turbo') return 0;
      return this.view ? this.view.remainingMs + 150 : this.scaled(450);
    }
    if (!('ms' in beat) || this.speed === 'turbo') return 0;
    const wait = this.currentBeat?.wait;
    if (wait?.kind === 'mine') return 'hold';
    if (wait?.kind === 'other') {
      if (this.clickedAlready(wait.player, beat)) {
        return Math.round(this.scaled(beat.ms) * ALREADY_CLICKED_FACTOR);
      }
      this.otherLimit = setTimeout(() => this.director.skip(), OTHER_CLICK_LIMIT_MS);
      return 'hold';
    }
    // Když se fronta plní rychleji, než se přehrává, scény se zkracují, ať hra neutíká.
    return Math.round(this.scaled(beat.ms) * (backlog > 1 ? 0.5 : 1));
  }

  private clearOtherLimit(): void {
    if (this.otherLimit !== null) clearTimeout(this.otherLimit);
    this.otherLimit = null;
  }

  /** Klik nebo mezerník. Cizí scénu zavře jen její majitel, ostatní jen přeskočí boty. */
  private dismissBeat(): void {
    if (performance.now() - this.beatStartedAt < DISMISS_GUARD_MS) return;
    const current = this.currentBeat;
    if (current?.wait.kind === 'other' && !this.clickedAlready(current.wait.player, current.beat)) {
      return;
    }
    if (current?.wait.kind === 'mine') this.transport.acknowledge(this.me, current.beat.seq);
    this.director.skip();
  }

  /** Jiný hráč odklikl svoji scénu. Když ji máme zrovna na obrazovce, zmizí i u nás. */
  private onAck(player: PlayerId, seq: number): void {
    if (player === this.me) return;
    this.acks.set(player, Math.max(this.acks.get(player) ?? -1, seq));
    const current = this.currentBeat;
    if (
      current?.wait.kind === 'other' &&
      current.wait.player === player &&
      current.beat.seq <= seq
    ) {
      this.director.skip();
    }
  }

  /** Člověka mezitím převzal bot (výpadek): na jeho kliknutí už se nečeká. */
  private releaseIfBot(s: GameState): void {
    const wait = this.currentBeat?.wait;
    if (wait?.kind === 'other' && s.players[wait.player]?.bot) this.director.skip();
  }

  private patch(el: HTMLElement, html: string): void {
    if (this.painted.get(el) === html) return;
    this.painted.set(el, html);
    el.innerHTML = html;
  }

  private render(): void {
    const s = this.shown;
    applyMode(s.settings.mode);
    if (s.phase === 'gameOver' && !this.director.busy && !this.endPublished) {
      this.endPublished = true;
      publishGameEnd(summarizeGame(s));
    }
    this.view?.update(
      this.director.currentState ?? s,
      this.me,
      this.selectedTile,
      this.revealedSeq,
    );
    if (actorOf(s) !== this.me) this.panel = null;
    this.patch(
      this.slots.main,
      this.view
        ? `<div class="hud">${this.renderHud(s)}</div>`
        : renderBoard(s, this.me, this.renderHud(s)),
    );
    this.patchPlayers(s);
    this.patch(this.slots.dock, this.renderDock(s));
    this.patch(this.slots.overlays, this.renderOverlays(s));
    this.syncMinigame();
  }

  private renderOverlays(s: GameState): string {
    return [
      this.draft ? this.renderTradeDialog(s, this.draft) : '',
      this.panel === 'market' ? renderMarket(s, this.me, this.prices) : '',
      this.panel === 'backroom' ? renderBackroom(s, this.me) : '',
      this.historyOpen ? this.renderHistory() : '',
      s.phase === 'gameOver' && !this.director.busy ? this.renderResult(s) : '',
    ].join('');
  }

  /** Spustí minihru, když ji má hrát tento člověk a scény i auto už doběhly. */
  private syncMinigame(): void {
    const s = this.state;
    if (this.liveAuctionOpen) return;
    if (s.auction?.live) {
      this.syncLiveAuction(s);
      return;
    }
    const mine = s.active === this.me && !s.players[this.me]?.bot;
    if (s.phase !== 'chase' && s.phase !== 'breakout') {
      this.minigameRunning = false;
      return;
    }
    if (!mine || this.minigameRunning || this.director.busy || this.view?.busy) return;
    const input = {
      player: this.me,
      seed: (s.rng ^ s.turn) | 0,
      color: PLAYER_COLORS[this.me] ?? '#ffffff',
    };
    if (s.phase === 'chase') void this.runMinigame(chaseMinigame, input);
    else void this.runMinigame(breakoutMinigame, input);
  }

  /** Živou dražbu vidí každý člověk u stolu, ne jen ten, kdo je na tahu. */
  private syncLiveAuction(s: GameState): void {
    const me = s.players[this.me];
    if (!me || me.bot || me.bankrupt) return;
    if (this.director.busy || this.view?.busy) return;
    this.liveAuctionOpen = true;
    void this.runMinigame(auctionMinigame, {
      player: this.me,
      transport: this.transport,
    }).then(() => {
      this.liveAuctionOpen = false;
      this.minigameRunning = false;
      this.render();
    });
  }

  /** Společné spuštění všech miniher: pauza města, hra, zápis výsledku běžnou akcí. */
  private runMinigame<Input, Result>(game: Minigame<Input, Result>, input: Input): Promise<void> {
    this.minigameRunning = true;
    this.hint.hidden = true;
    this.view?.setPaused(true);
    return game
      .start({ host: this.root, input, signal: this.minigameAbort.signal })
      .then(
        (result) => game.resultAction(input, result),
        (error: unknown) => {
          console.warn('Minihra nejde spustit, rozhodne náhoda.', error);
          return game.autoResolve(input);
        },
      )
      .then((action) => {
        if (this.minigameAbort.signal.aborted) return;
        this.view?.setPaused(false);
        if (action) this.send(action);
      })
      .catch((error: unknown) => console.warn('Výsledek minihry nejde zapsat.', error));
  }

  private renderHud(s: GameState): string {
    const dice = s.lastRoll ?? [1, 1];
    const detail =
      this.selectedTile === null
        ? ''
        : `<div class="tile-detail">${this.renderDeed(s, this.selectedTile, true)}</div>`;
    const speeds = (['slow', 'normal', 'fast', 'turbo'] as const)
      .map(
        (speed) =>
          `<button class="chip${speed === this.speed ? ' on' : ''}" data-action="speed" data-speed="${speed}">${SPEED_LABEL[speed]}</button>`,
      )
      .join('');
    // Tempo je jen pro sólo: u společného stolu by ho jeden hráč vnutil ostatním.
    const tempo =
      this.role === 'solo'
        ? `<div class="chip-row" data-tip="${cs.game.speed}">${speeds}</div>`
        : '';
    return `
      <div class="center-head">
        <h1 class="logo small">${cs.title}</h1>
        <span class="round">${cs.game.round(s.round)}</span>
      </div>
      <div class="chip-row">
        ${this.view ? `<button class="chip" data-action="resetCamera">${cs.game.resetCamera}</button>` : ''}
        <button class="chip" data-action="openHistory">${icon('history')}${cs.game.history}</button>
        <button class="chip" data-tip="${cs.game.hints}">${icon('info')}${cs.game.help}</button>
        <button class="chip" data-action="quit">${cs.game.quit}</button>
      </div>
      ${tempo}
      <div class="dice-tray${this.rolling ? ' empty' : ''}">${dieFace(dice[0])}${dieFace(dice[1])}</div>
      <button class="ticker" data-action="openHistory" style="--c:${this.headline.color}">${escapeHtml(this.headline.text)}</button>
      ${detail}`;
  }

  private renderHistory(): string {
    const rows = this.lines
      .map((line) => `<p style="--c:${line.color}">${escapeHtml(line.text)}</p>`)
      .join('');
    return `
      <div class="overlay">
        <div class="dialog history">
          <header class="row between">
            <h2>${cs.game.log}</h2>
            <button class="world-close" data-action="closeHistory" data-primary aria-label="${cs.game.close}">×</button>
          </header>
          <div class="log">${rows}</div>
        </div>
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
            return `<button class="holding ${cls}" style="--c:${tileColor(tile).bg}" data-tile="${tile}" data-tip="${cs.tiles[tile]}"></button>`;
          })
          .join('');
        return `<span class="holding-group">${cells}</span>`;
      })
      .join('');
  }

  /** Každý hráč se překresluje zvlášť, aby změna peněz bliknula jen u něj. */
  private patchPlayers(s: GameState): void {
    const host = this.slots.players;
    while (host.children.length < s.players.length) {
      host.append(document.createElement('div'));
    }
    const actor = actorOf(s);
    s.players.forEach((p, i) => {
      const flags = [
        p.inJail ? `<i class="flag bad" data-tip="${cs.game.inJail}">${icon('bars')}</i>` : '',
        p.jailCards.length
          ? `<i class="flag" data-tip="${cs.game.jailCardsCount(p.jailCards.length)}">${icon('key')}</i>`
          : '',
      ].join('');
      const previous = this.lastCash.get(p.id) ?? p.cash;
      const bump = p.cash > previous ? ' up' : p.cash < previous ? ' down' : '';
      const role = p.id === this.me ? cs.game.you : p.bot ? cs.personality[p.bot.personality] : '';
      const archetype = p.archetype ? cs.archetypes[p.archetype] : null;
      const html = `
        <div class="player${p.id === actor ? ' active' : ''}${p.bankrupt ? ' out' : ''}${p.id === this.me ? ' me' : ''}" style="--color:${PLAYER_COLORS[p.id]}">
          <div class="player-head">
            <i class="token" style="background:${PLAYER_COLORS[p.id]}">${escapeHtml(p.name.charAt(0).toUpperCase())}</i>
            <strong>${escapeHtml(p.name)}</strong>
            ${flags}
          </div>
          <div class="player-money">
            <span class="cash${bump}" data-cash="${p.cash}" data-tip="${cs.biz.whiteTip}">${formatMoney(p.cash)}</span>
            ${p.dirty ? `<span class="cash-dirty" data-tip="${cs.biz.dirtyTip}">${formatMoney(p.dirty)}</span>` : ''}
          </div>
          <small${archetype ? ` data-tip="${archetype.perk}"` : ''}>${[role, archetype?.name].filter(Boolean).join(' · ')}</small>
          <div class="holdings">${this.renderHoldings(s, p.id)}</div>
        </div>`;
      this.patch(host.children[i] as HTMLElement, html);
      this.lastCash.set(p.id, p.cash);
    });
  }

  /** Spodní lišta: co se teď rozhoduje, peníze a tři dveře. */
  private renderDock(s: GameState): string {
    const me = s.players[this.me]!;
    const decision = this.director.busy ? this.waitingDecision(s) : this.decide(s);
    if (decision.key !== this.lastDecision) {
      this.lastDecision = decision.key;
      this.decisionAt = performance.now();
    }
    const fresh = performance.now() - this.decisionAt < ENTER_MS;
    const top =
      decision.deed !== undefined || decision.character || decision.prompt
        ? `<div class="decision${fresh ? ' enter' : ''}">
             ${decision.character ? `<div class="decision-char">${character(decision.character)}</div>` : ''}
             ${decision.prompt ? `<div class="bubble still${decision.tone === 'wait' ? ' quiet' : ''}"${decision.tip ? ` data-tip="${decision.tip}"` : ''}>${decision.prompt}</div>` : ''}
             ${decision.deed !== undefined ? this.renderDeed(s, decision.deed, false) : ''}
           </div>`
        : '';
    return `
      <div class="dock">
        ${top}
        <div class="dock-bar">
          ${this.renderWallet(s, me.id)}
          <div class="dock-actions">${decision.actions.join('')}</div>
          ${this.renderDoors(s, decision.doors)}
        </div>
      </div>`;
  }

  private renderWallet(s: GameState, id: PlayerId): string {
    const p = s.players[id]!;
    const dirty = hasBusiness(s)
      ? `<span class="wallet-dirty" data-tip="${cs.biz.dirtyTip}"><small>${cs.biz.dirty}</small><b>${formatMoney(p.dirty)}</b></span>`
      : '';
    return `
      <div class="wallet">
        <span data-tip="${cs.biz.whiteTip}"><small>${cs.biz.white}</small><b>${formatMoney(p.cash)}</b></span>
        ${dirty}
      </div>`;
  }

  private renderDoors(s: GameState, open: boolean): string {
    const d = cs.game.doors;
    const closed = open ? '' : d.closed;
    const tradeOk = open && canProposeTrade(s, this.me);
    const business = hasBusiness(s)
      ? `
        <button class="door door-market" data-action="openMarket" data-tip="${closed || d.marketTip}"${open ? '' : ' disabled'}>
          ${icon('chart')}<span>${d.market}</span>
        </button>
        <button class="door door-back" data-action="openBackroom" data-tip="${closed || d.backroomTip}"${open ? '' : ' disabled'}>
          ${icon('door')}<span>${d.backroom}</span>
        </button>`
      : '';
    return `
      <div class="doors">
        ${business}
        <button class="door door-trade" data-action="openTrade" data-tip="${closed || (tradeOk ? d.tradeTip : cs.game.tradeLimit)}"${tradeOk ? '' : ' disabled'}>
          ${icon('hands')}<span>${d.trade}</span>
        </button>
      </div>`;
  }

  private waitingDecision(s: GameState): Decision {
    const actor = actorOf(s);
    const name = actor === null ? '' : escapeHtml(s.players[actor]!.name);
    return {
      key: 'wait',
      prompt: actor === null || actor === this.me ? '' : cs.game.waiting(name),
      tone: 'wait',
      actions: [],
      doors: false,
    };
  }

  /** Co má hráč právě teď udělat. Vždy jedna otázka a jedna hlavní volba. */
  private decide(s: GameState): Decision {
    const me = s.players[this.me]!;
    const t = cs.game;
    const none: Decision = { key: 'none', actions: [], doors: false };
    if (s.phase === 'gameOver') return none;
    if (me.bankrupt) return { ...none, key: 'out', prompt: t.youBankrupt, tone: 'wait' };
    if (s.auction?.live) {
      return { ...none, key: 'auctionLive', prompt: t.prompt.auction, tone: 'wait', deed: s.auction.tile };
    }
    const actor = actorOf(s);
    if (s.trade?.from === this.me) {
      return {
        ...none,
        key: 'tradeWait',
        prompt: t.tradeWaiting(escapeHtml(s.players[s.trade.to]!.name)),
        tone: 'wait',
      };
    }
    if (actor !== this.me) {
      const name = escapeHtml(s.players[actor ?? 0]!.name);
      return {
        ...none,
        key: `wait${actor}`,
        prompt: this.waitingPrompt(s, name),
        tone: 'wait',
        deed: s.auction?.tile,
      };
    }
    if (s.trade) return this.decideTrade(s);
    const debt = s.debts[0];
    if (debt) {
      const creditor = debt.creditor === null ? t.bank : s.players[debt.creditor]!.name;
      return {
        key: 'debt',
        prompt: t.debtPrompt(formatMoney(debt.amount), escapeHtml(creditor)),
        tip: t.debtTip,
        character: hasBusiness(s) ? 'bailiff' : undefined,
        actions: [
          act(t.pay, 'settleDebt', {
            kind: 'go',
            icon: 'coin',
            sub: formatMoney(debt.amount),
            disabled: me.cash < debt.amount,
            primary: me.cash >= debt.amount,
          }),
          act(t.bankrupt, 'declareBankruptcy', { kind: 'danger', icon: 'skull' }),
        ],
        doors: true,
      };
    }
    if (s.auction) return this.decideAuction(s);
    if (s.phase === 'awaitBuy' && s.pendingBuy !== null) {
      const price = ownablePrice(s.pendingBuy) ?? 0;
      const affordable = me.cash >= price;
      return {
        key: `buy${s.pendingBuy}`,
        prompt: t.prompt.buy,
        deed: s.pendingBuy,
        actions: [
          act(t.buy, 'buy', {
            kind: 'go',
            icon: 'stamp',
            sub: formatMoney(price),
            disabled: !affordable,
            primary: affordable,
          }),
          act(t.decline, 'decline', {
            kind: 'legal',
            icon: 'x',
            sub: t.declineSub,
            primary: !affordable,
          }),
        ],
        doors: true,
      };
    }
    if (s.phase === 'awaitTax' && s.pendingTax) return this.decideTax(s, s.pendingTax);
    if (s.phase === 'awaitRent' && s.pendingRent) return this.decideRent(s, s.pendingRent);
    if (s.phase === 'chase' || s.phase === 'breakout') {
      const prompt = this.waitingPrompt(s, escapeHtml(me.name));
      return { ...none, key: s.phase, prompt, tone: 'wait' };
    }
    if (s.phase === 'awaitRoll') return this.decideRoll(s);
    const again = s.extraRoll && !me.inJail;
    return {
      key: `end${s.turn}`,
      prompt: again ? t.prompt.again : t.prompt.end,
      actions: [
        act(again ? t.rollAgain : t.endTurn, 'endTurn', {
          kind: 'go',
          icon: again ? 'dice' : 'stop',
          primary: true,
        }),
      ],
      doors: true,
    };
  }

  private waitingPrompt(s: GameState, name: string): string {
    if (s.phase === 'chase') return cs.chase.running(name);
    if (s.phase === 'breakout') return cs.breakout.running(name);
    return cs.game.waiting(name);
  }

  private decideRoll(s: GameState): Decision {
    const me = s.players[this.me]!;
    const t = cs.game;
    if (!me.inJail) {
      return {
        key: `roll${s.turn}`,
        prompt: t.prompt.roll,
        actions: [
          act(t.roll, 'roll', { kind: 'go', icon: 'dice', primary: true, attrs: 'data-wiggle' }),
        ],
        doors: true,
      };
    }
    const actions = [
      act(t.rollInJail, 'roll', { kind: 'go', icon: 'dice', primary: true }),
      act(t.payBail, 'payBail', {
        kind: 'legal',
        icon: 'coin',
        sub: formatMoney(JAIL_BAIL),
        disabled: me.cash < JAIL_BAIL,
      }),
    ];
    if (me.jailCards.length)
      actions.push(act(t.useJailCard, 'useJailCard', { kind: 'legal', icon: 'key' }));
    if (BUSINESS && canBribePolice(s, this.me)) {
      const rules = BUSINESS.police;
      actions.push(
        act(cs.biz.bribePolice, 'bribePolice', {
          kind: 'black',
          icon: 'envelope',
          sub: cs.biz.bribeSub(formatMoneyShort(bribeCost(s, this.me, rules))),
          risk: bribeRiskPct(s, this.me, rules),
        }),
      );
    }
    if (BUSINESS && canBreakout(s, this.me)) {
      actions.push(
        act(cs.breakout.action, 'breakout', {
          kind: 'danger',
          icon: 'bars',
          sub: cs.breakout.actionSub(formatMoneyShort(BUSINESS.breakout.fine)),
          tip: cs.breakout.actionTip,
        }),
      );
    }
    return {
      key: `jail${s.turn}`,
      prompt: t.prompt.jail,
      character: hasBusiness(s) ? 'cop' : undefined,
      actions,
      doors: true,
    };
  }

  private decideRent(s: GameState, rent: NonNullable<GameState['pendingRent']>): Decision {
    const factor = BUSINESS?.chase.caughtRentFactor ?? 2;
    return {
      key: `rent${rent.tile}`,
      prompt: cs.chase.rentPrompt(escapeHtml(s.players[rent.owner]!.name)),
      deed: rent.tile,
      actions: [
        act(cs.chase.payRent, 'payRent', {
          kind: 'go',
          icon: 'coin',
          sub: formatMoney(rent.amount),
          primary: true,
        }),
        act(cs.chase.flee, 'flee', {
          kind: 'danger',
          icon: 'car',
          sub: cs.chase.fleeSub(formatMoneyShort(rent.amount * factor)),
          tip: cs.chase.fleeTip(BUSINESS?.chase.cooldownRounds ?? 0),
        }),
      ],
      doors: false,
    };
  }

  private decideTax(s: GameState, tax: NonNullable<GameState['pendingTax']>): Decision {
    const actions = [
      act(cs.biz.payTax, 'payTax', {
        kind: 'go',
        icon: 'coin',
        sub: formatMoney(tax.amount),
        primary: true,
      }),
    ];
    if (BUSINESS && canBribeOfficial(s, this.me)) {
      const rules = BUSINESS.official;
      actions.push(
        act(cs.biz.bribeOfficial, 'bribeOfficial', {
          kind: 'black',
          icon: 'envelope',
          sub: cs.biz.bribeOfficialSub(formatMoneyShort(bribeCost(s, this.me, rules))),
          risk: bribeRiskPct(s, this.me, rules),
        }),
      );
    }
    return {
      key: `tax${tax.tile}`,
      prompt: cs.biz.taxPrompt(cs.tiles[tax.tile] ?? ''),
      character: 'clerk',
      actions,
      doors: false,
    };
  }

  private decideAuction(s: GameState): Decision {
    const auction = s.auction!;
    const t = cs.game;
    const cash = s.players[this.me]!.cash;
    const min = minBid(s);
    const amounts = [min, min + 4 * MIN_BID_STEP, min + 9 * MIN_BID_STEP].filter((a) => a <= cash);
    const bids = amounts.map((amount, i) =>
      act(t.bid, 'bid', {
        kind: i === 0 ? 'go' : 'legal',
        icon: 'hammer',
        sub: formatMoney(amount),
        attrs: `data-amount="${amount}"`,
        primary: i === 0,
      }),
    );
    const custom =
      min <= cash
        ? `<form class="bid-form" data-form="bid">
             <input name="amount" type="number" min="${min}" max="${cash}" step="${MIN_BID_STEP}" value="${min}" aria-label="${t.customBid}" />
             <button class="btn" type="submit">${t.customBid}</button>
           </form>`
        : '';
    const status =
      auction.leader === null
        ? t.auctionNoBid
        : t.auctionBid(formatMoney(auction.bid), escapeHtml(s.players[auction.leader]!.name));
    return {
      key: `auction${auction.tile}`,
      prompt: `${t.prompt.auction} ${status}`,
      character: hasBusiness(s) ? 'auctioneer' : undefined,
      deed: auction.tile,
      actions: [
        ...bids,
        custom,
        act(t.passBid, 'passBid', { kind: 'plain', icon: 'x', primary: bids.length === 0 }),
      ],
      doors: false,
    };
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

  private decideTrade(s: GameState): Decision {
    const offer = s.trade!;
    return {
      key: `trade${offer.from}`,
      prompt: `${cs.game.tradeIncoming(escapeHtml(s.players[offer.from]!.name))}
        <div class="trade-summary">
          <div><strong>${cs.game.tradeYouGet}</strong>${this.describeSide(offer.give)}</div>
          <div><strong>${cs.game.tradeYouGive}</strong>${this.describeSide(offer.get)}</div>
        </div>`,
      actions: [
        act(cs.game.tradeAccept, 'acceptTrade', { kind: 'go', icon: 'check' }),
        act(cs.game.tradeReject, 'rejectTrade', { kind: 'plain', icon: 'x', primary: true }),
      ],
      doors: false,
    };
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
        // Při rozhodování stačí dvě čísla, celý ceník je po kliknutí na políčko.
        if (!withControls) {
          row(cs.tile.rentBase, formatMoney(tile.rents[0]!));
          row(cs.tile.rentHotel, formatMoney(tile.rents[HOTEL_LEVEL]!));
          break;
        }
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
      const data = `data-tile-id="${id}"`;
      if (tile.kind === 'property') {
        if (canBuild(s, this.me, id)) {
          manage.push(
            act(cs.tile.build(formatMoney(buildCost(s, this.me, id))), 'build', {
              kind: 'go',
              icon: 'hammer',
              attrs: data,
            }),
          );
        }
        if (BUSINESS && canBribeBuild(s, this.me, id)) {
          const rules = BUSINESS.build;
          manage.push(
            act(cs.biz.bribeBuild, 'bribeBuild', {
              kind: 'black',
              icon: 'envelope',
              sub: cs.biz.bribeSub(formatMoneyShort(bribeCost(s, this.me, rules))),
              risk: bribeRiskPct(s, this.me, rules),
              tip: cs.biz.bribeBuildTip,
              attrs: data,
            }),
          );
        }
        if (canSellBuilding(s, this.me, id)) {
          const value = formatMoney(Math.floor(tile.houseCost / 2));
          manage.push(act(cs.tile.sell(value), 'sellBuilding', { kind: 'legal', attrs: data }));
        }
      }
      if (canMortgage(s, this.me, id)) {
        manage.push(
          act(cs.tile.mortgage(formatMoney(mortgageValue(id))), 'mortgage', {
            kind: 'legal',
            attrs: data,
          }),
        );
      }
      if (canUnmortgage(s, this.me, id)) {
        manage.push(
          act(cs.tile.unmortgage(formatMoney(unmortgageCost(id))), 'unmortgage', {
            kind: 'legal',
            attrs: data,
          }),
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

  /** Mezerník přeskočí scénu, Esc zavře okno. V minihře patří klávesy jí. */
  private handleKey(event: KeyboardEvent): void {
    if (this.minigameRunning) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea')) return;
    if (event.key === 'Escape') {
      if (this.panel) this.panel = null;
      else if (this.historyOpen) this.historyOpen = false;
      else if (this.draft) this.draft = null;
      else if (this.selectedTile !== null) this.selectedTile = null;
      else return;
      this.render();
      return;
    }
    if (event.key !== ' ' && event.key !== 'Enter') return;
    // Podržená klávesa nesmí omylem zahrát další tah.
    const skipping = this.director.busy;
    if (skipping || event.repeat) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (skipping && !event.repeat) this.dismissBeat();
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
      case 'breakout':
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
      case 'skipBeat':
        this.dismissBeat();
        return;
      case 'openMarket':
        this.panel = 'market';
        break;
      case 'openBackroom':
        this.panel = 'backroom';
        break;
      case 'closePanel':
        this.panel = null;
        break;
      case 'openHistory':
        this.historyOpen = true;
        break;
      case 'closeHistory':
        this.historyOpen = false;
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
