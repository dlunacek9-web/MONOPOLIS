import type { Action } from '../core';

/** Co minihra dostane při spuštění. */
export interface MinigameContext<Input> {
  /** Prvek, do kterého si minihra vykreslí celou obrazovku. */
  host: HTMLElement;
  input: Input;
  /** Hra skončila dřív, minihra po sobě musí uklidit. */
  signal: AbortSignal;
}

/**
 * Minihra je plugin nad pravidly. Sama nic nemění, výsledek se do hry vrací běžnou akcí,
 * takže funguje stejně v sólu i přes síť.
 */
export interface Minigame<Input, Result> {
  id: string;
  /** Odehraje minihru. Odmítnutí znamená, že nejde spustit a má rozhodnout `autoResolve`. */
  start(context: MinigameContext<Input>): Promise<Result>;
  /** Akce, která rozhodne minihru bez hraní. Náhodu řeší seedovaný generátor v pravidlech. */
  autoResolve(input: Input): Action;
  /** Akce, která do pravidel zapíše výsledek. `null`, když minihra hrála přes akce průběžně. */
  resultAction(input: Input, result: Result): Action | null;
}
