import { REPLAY_SPEED, TICKS_PER_SECOND, playerOf } from '../core';
import type { GameState } from '../core';
import type { GameTransport } from '../net/transport';
import { chooseDefenseAction } from './defense';

/** Čas na stavbu před každou vlnou. Odpočet začne, až doběhne přehrávání předchozí vlny. */
export const DEFENSE_BUILD_MS = 45_000;
/** Bot staví po jedné věži, ať je vidět, co dělá. */
const BOT_STEP_MS = 450;

type Timer = ReturnType<typeof setTimeout>;

/** Jak dlouho minihra přehrává vlnu, kterou pravidla už spočítala. */
export function waveReplayMs(state: GameState): number {
  const last = state.defense?.last;
  return last ? (last.ticks * 1_000) / (TICKS_PER_SECOND * REPLAY_SPEED) + 2_000 : 0;
}

/**
 * Hodiny a boti Války gangů. Pravidla čas neznají, dostávají jen běžné akce:
 * stavby botů a konec času na stavbu. V multiplayeru běží jen u hostitele.
 */
export class DefenseRunner {
  private readonly unsubscribe: () => void;
  private timeout: Timer | null = null;
  private timeoutKey: string | null = null;
  private botTimer: Timer | null = null;

  constructor(
    private readonly transport: GameTransport,
    private readonly isBlocked: () => boolean = () => false,
  ) {
    this.unsubscribe = transport.subscribe(() => this.sync());
    this.sync();
  }

  stop(): void {
    this.unsubscribe();
    this.clear();
  }

  private clear(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    if (this.botTimer !== null) clearTimeout(this.botTimer);
    this.timeout = null;
    this.botTimer = null;
    this.timeoutKey = null;
  }

  private sync(): void {
    const state = this.transport.getState();
    const d = state.defense;
    if (state.phase !== 'defense' || !d) {
      this.clear();
      return;
    }
    const key = `${state.round}:${d.wave}`;
    if (key !== this.timeoutKey) {
      this.timeoutKey = key;
      if (this.timeout !== null) clearTimeout(this.timeout);
      this.armTimeout(key, DEFENSE_BUILD_MS + waveReplayMs(state));
    }
    if (this.botTimer === null) this.armBot();
  }

  private armTimeout(key: string, ms: number): void {
    this.timeout = setTimeout(() => {
      this.timeout = null;
      if (this.isBlocked()) {
        this.armTimeout(key, 1_000);
        return;
      }
      const d = this.transport.getState().defense;
      if (!d || this.timeoutKey !== key) return;
      this.transport.dispatch({ type: 'defenseTimeout', player: d.defenders[0]! });
    }, ms);
  }

  private armBot(): void {
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const state = this.transport.getState();
      const d = state.defense;
      if (state.phase !== 'defense' || !d) return;
      const bot = d.defenders.find((id) => playerOf(state, id).bot && !d.ready.includes(id));
      if (bot === undefined) return;
      if (!this.isBlocked()) this.transport.dispatch(chooseDefenseAction(state, bot));
      // Akce sama zavolá `sync`. Kdyby neprošla, další pokus přijde za chvíli.
      if (this.botTimer === null) this.armBot();
    }, BOT_STEP_MS);
  }
}
