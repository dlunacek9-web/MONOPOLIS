import { IllegalActionError, reduce } from '../core';
import type { Action, GameState } from '../core';
import type { DispatchResult, GameTransport } from './transport';

/** Sólo: pravidla běží přímo v prohlížeči, bez sítě. */
export class LocalTransport implements GameTransport {
  private readonly listeners = new Set<(state: GameState) => void>();

  constructor(private state: GameState) {}

  getState(): GameState {
    return this.state;
  }

  dispatch(action: Action): DispatchResult {
    try {
      this.state = reduce(this.state, action);
    } catch (error) {
      if (error instanceof IllegalActionError) return { ok: false, error: error.message };
      throw error;
    }
    for (const listener of this.listeners) listener(this.state);
    return { ok: true };
  }

  subscribe(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
