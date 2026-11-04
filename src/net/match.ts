import type { Difficulty, GameSettings, Personality, PlayerSetup, WinCondition } from '../core';
import { cs } from '../i18n/cs';

/** Nastavení partie z lobby, stejné pro sólo i multiplayer. */
export interface MatchOptions {
  /** Počet míst u stolu včetně lidí, volná místa obsadí boti. */
  seats: number;
  difficulty: Difficulty;
  win: 'last' | 'rounds' | 'money';
  rounds: number;
  money: number;
  startCash: number;
}

export const START_CASH_CHOICES = [1_000_000, 1_500_000, 2_000_000] as const;

export const DEFAULT_MATCH: MatchOptions = {
  seats: 4,
  difficulty: 'normal',
  win: 'last',
  rounds: 20,
  money: 5_000_000,
  startCash: 1_500_000,
};

const PERSONALITIES: Personality[] = ['zralok', 'lakomec', 'kriminalnik', 'vyvazeny'];

/** Bot, který zaskočí za člověka, když vypadne ze sítě. */
export const STAND_IN_PERSONALITY: Personality = 'vyvazeny';

function pickPersonalities(count: number, seed: number): Personality[] {
  const pool = [...PERSONALITIES];
  const result: Personality[] = [];
  let value = seed >>> 0;
  for (let i = 0; i < count; i++) {
    result.push(pool.splice(value % pool.length, 1)[0]!);
    value = Math.floor(value / 7) + 13;
  }
  return result;
}

export function matchSettings(options: MatchOptions): GameSettings {
  // Cíl pod počáteční hotovostí by partii ukončil hned po startu.
  const amount = Math.max(options.money, options.startCash + 100_000);
  const win: WinCondition =
    options.win === 'rounds'
      ? { type: 'richestAfterRounds', rounds: options.rounds }
      : options.win === 'money'
        ? { type: 'firstToMoney', amount }
        : { type: 'lastStanding' };
  return { mode: 'classic', win, startCash: options.startCash };
}

/** Lidé sedí první, zbytek míst dostanou boti s náhodnou osobností. */
export function matchSetups(
  humans: readonly string[],
  options: MatchOptions,
  seed: number,
): PlayerSetup[] {
  const bots = pickPersonalities(Math.max(0, options.seats - humans.length), seed);
  return [
    ...humans.map((name) => ({ name })),
    ...bots.map((personality) => ({
      name: cs.botNames[personality],
      bot: { personality, difficulty: options.difficulty },
    })),
  ];
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! | 0;
}
