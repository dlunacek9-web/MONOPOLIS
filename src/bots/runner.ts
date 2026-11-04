import { actorOf, playerOf } from '../core';
import type { GameState } from '../core';
import type { GameTransport } from '../net/transport';
import { chooseBotAction } from './bot';

/** Hraje za boty přes stejný transport jako člověk. V multiplayeru poběží jen u hostitele. */
export class BotRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly transport: GameTransport,
    private readonly delayMs: (state: GameState) => number,
  ) {
    this.unsubscribe = transport.subscribe(() => this.schedule());
    this.schedule();
  }

  /** Znovu naplánuje další tah, třeba po změně rychlosti hry. */
  refresh(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.schedule();
  }

  stop(): void {
    this.unsubscribe();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const state = this.transport.getState();
    const actor = actorOf(state);
    if (actor === null || !playerOf(state, actor).bot) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const current = this.transport.getState();
      const currentActor = actorOf(current);
      if (currentActor === null || !playerOf(current, currentActor).bot) return;
      const result = this.transport.dispatch(chooseBotAction(current, currentActor));
      if (!result.ok) throw new Error(`Bot zahrál neplatnou akci: ${result.error}`);
    }, this.delayMs(state));
  }
}
