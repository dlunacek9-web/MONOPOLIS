import type { Action, GameState } from '../core';

export type DispatchResult = { ok: true } | { ok: false; error: string };

/** Hra neví, jestli běží lokálně, nebo přes síť. Trystero přibude ve Fázi 3. */
export interface GameTransport {
  getState(): GameState;
  dispatch(action: Action): DispatchResult;
  subscribe(listener: (state: GameState) => void): () => void;
}
