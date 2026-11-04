import { NEXTLEVEL } from './sets/nextlevel';
import type { CardEffect, DeckId, Ruleset } from './types';

export type { CardEffect };

/** Aktivní balíčky karet. Texty jsou v `src/i18n/cs.ts` podle stejného indexu. */
export let CARDS: Record<DeckId, readonly CardEffect[]> = NEXTLEVEL.cards;

export function installCards(set: Ruleset): void {
  CARDS = set.cards;
}

export function cardEffect(deck: DeckId, card: number): CardEffect {
  const effect = CARDS[deck][card];
  if (!effect) throw new Error(`Neplatná karta ${deck}/${card}`);
  return effect;
}
