import type { Action, GameState, PlayerId } from '../core';

export type DispatchResult = { ok: true } | { ok: false; error: string };

/** Hra neví, jestli běží lokálně, nebo přes síť. */
export interface GameTransport {
  getState(): GameState;
  dispatch(action: Action): DispatchResult;
  subscribe(listener: (state: GameState) => void): () => void;
  /** Hráč odklikl svou scénu. `seq` je událost, ke které scéna patří. Pravidel se to netýká. */
  acknowledge(player: PlayerId, seq: number): void;
  /** Odkliknutí ostatních hráčů, podle nich se u nich drží scéna na obrazovce. */
  onAcknowledge(listener: (player: PlayerId, seq: number) => void): () => void;
}
