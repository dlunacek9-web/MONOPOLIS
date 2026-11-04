import { useRuleset } from '../core';
import type { GameMode } from '../core';
import { useTexts } from '../i18n/cs';

let applied: GameMode | null = null;

/** Přepne desku, karty, čísla i texty na režim rozehrané partie. Opakované volání nic nestojí. */
export function applyMode(mode: GameMode): void {
  // Jádro si hlídá režim samo (jiná partie ho mohla přepnout), texty jen při změně.
  useRuleset(mode);
  if (applied === mode) return;
  applied = mode;
  useTexts(mode);
}
