import type { GameState } from './types';

/** Generátor mulberry32. Celý jeho stav je jedno číslo uložené v herním stavu. */
function next(state: number): { value: number; state: number } {
  const nextState = (state + 0x6d2b79f5) | 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: nextState };
}

export function randomInt(s: GameState, exclusiveMax: number): number {
  const result = next(s.rng);
  s.rng = result.state;
  return Math.floor(result.value * exclusiveMax);
}

export function shuffle<T>(s: GameState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(s, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export function rollDice(s: GameState): [number, number] {
  return [randomInt(s, 6) + 1, randomInt(s, 6) + 1];
}

/** Bez změny stavu odvodí z čísel pseudonáhodnou hodnotu 0–1. Slouží botům. */
export function hashToUnit(...parts: number[]): number {
  let state = 0x9e3779b9;
  for (const part of parts) state = next((state ^ part) | 0).state;
  return next(state).value;
}
