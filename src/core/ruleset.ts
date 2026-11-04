import { installBoard } from './board';
import { installCards } from './cards';
import { CLASSIC } from './sets/classic';
import { NEXTLEVEL } from './sets/nextlevel';
import type { GameMode, Ruleset } from './types';

const SETS: Record<GameMode, Ruleset> = { classic: CLASSIC, nextlevel: NEXTLEVEL };

let current: GameMode = 'nextlevel';

export function currentMode(): GameMode {
  return current;
}

export function rulesetOf(mode: GameMode): Ruleset {
  return SETS[mode];
}

/** Přepne aktivní desku, karty a čísla. Zdarma, když už je režim nastavený. */
export function useRuleset(mode: GameMode): void {
  if (mode === current) return;
  current = mode;
  installBoard(SETS[mode]);
  installCards(SETS[mode]);
}
