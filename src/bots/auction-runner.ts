import { playerOf } from '../core';
import type { Action, GameState, PlayerId } from '../core';
import type { GameTransport } from '../net/transport';
import { chooseLiveMove } from './bot';

/** Čas na první příhoz: člověk si musí stihnout přečíst, co se draží. */
export const AUCTION_OPENING_MS = 5_000;
/** Pauza mezi klepnutími kladívka. Bot, který číhá, se musí vejít dovnitř. */
export const AUCTION_GAVEL_MS = 2_500;

type Timer = ReturnType<typeof setTimeout>;

/**
 * Hodiny živé dražby. Pravidla žádný čas neznají, jen dostávají běžné akce:
 * klepnutí kladívka a příhozy botů. V multiplayeru běží jen u hostitele.
 */
export class LiveAuctionRunner {
  private readonly unsubscribe: () => void;
  private gavelTimer: Timer | null = null;
  private gavelKey: string | null = null;
  private readonly botTimers: Timer[] = [];
  private botsKey: string | null = null;

  constructor(
    private readonly transport: GameTransport,
    /** Dokud se přehrávají scény, hodiny stojí: člověk dražbu ještě nevidí. */
    private readonly isBlocked: () => boolean = () => false,
  ) {
    this.unsubscribe = transport.subscribe(() => this.sync());
    this.sync();
  }

  stop(): void {
    this.unsubscribe();
    this.clearGavel();
    this.clearBots();
    this.gavelKey = null;
    this.botsKey = null;
  }

  private sync(): void {
    const state = this.transport.getState();
    const auction = state.auction;
    if (!auction?.live) {
      this.clearGavel();
      this.clearBots();
      this.gavelKey = null;
      this.botsKey = null;
      return;
    }
    const gavelKey = `${auction.tile}:${auction.bid}:${auction.gavel}`;
    if (gavelKey !== this.gavelKey) {
      this.gavelKey = gavelKey;
      this.clearGavel();
      const untouched = auction.leader === null && auction.gavel === 0;
      this.armGavel(untouched ? AUCTION_OPENING_MS : AUCTION_GAVEL_MS);
    }
    const botsKey = `${gavelKey}:${auction.bidders.map((id) => this.botTag(state, id)).join()}`;
    if (botsKey !== this.botsKey) {
      this.botsKey = botsKey;
      this.clearBots();
      this.planBots(state);
    }
  }

  private botTag(state: GameState, id: PlayerId): string {
    return `${id}${playerOf(state, id).bot ? 'b' : 'h'}`;
  }

  private armGavel(ms: number): void {
    this.gavelTimer = setTimeout(() => {
      this.gavelTimer = null;
      if (this.isBlocked()) {
        this.armGavel(ms);
        return;
      }
      const auction = this.transport.getState().auction;
      if (!auction?.live) return;
      this.transport.dispatch({ type: 'auctionGavel', player: auction.bidders[0]! });
    }, ms);
  }

  private planBots(state: GameState): void {
    for (const id of state.auction?.bidders ?? []) {
      if (!playerOf(state, id).bot) continue;
      const move = chooseLiveMove(state, id);
      if (move) this.armBot(move.action, move.delayMs);
    }
  }

  private armBot(action: Action, ms: number): void {
    const timer = setTimeout(() => {
      this.botTimers.splice(this.botTimers.indexOf(timer), 1);
      if (this.isBlocked()) {
        this.armBot(action, ms);
        return;
      }
      // Soupeř mohl být o chvilku rychlejší. Takový příhoz pravidla odmítnou a bot jede dál.
      this.transport.dispatch(action);
    }, ms);
    this.botTimers.push(timer);
  }

  private clearGavel(): void {
    if (this.gavelTimer !== null) clearTimeout(this.gavelTimer);
    this.gavelTimer = null;
  }

  private clearBots(): void {
    for (const timer of this.botTimers.splice(0)) clearTimeout(timer);
  }
}
