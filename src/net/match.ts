import type {
  Archetype,
  Difficulty,
  GameMode,
  GameSettings,
  Personality,
  PlayerSetup,
  WinCondition,
} from '../core';
import { cs } from '../i18n/cs';

/** Nastavení partie z lobby, stejné pro sólo i multiplayer. */
export interface MatchOptions {
  mode: GameMode;
  /** Počet míst u stolu včetně lidí, volná místa obsadí boti. */
  seats: number;
  difficulty: Difficulty;
  win: 'last' | 'rounds' | 'money';
  rounds: number;
  money: number;
  startCash: number;
  /** Archetyp prvního člověka u stolu (sólista, hostitel). Ostatní ho dostanou náhodně. */
  archetype: Archetype | 'random';
}

/** Částky závisí na režimu: Klasika počítá jako originál, Next level v tisících korun. */
export interface ModeMoney {
  startCashChoices: readonly number[];
  startCash: number;
  /** Výchozí cílová částka pro výhru podle jmění. */
  money: number;
  /** Nejmenší povolený krok a odstup cíle od počáteční hotovosti. */
  step: number;
}

export const MODE_MONEY: Record<GameMode, ModeMoney> = {
  classic: { startCashChoices: [1500], startCash: 1500, money: 5000, step: 100 },
  nextlevel: {
    startCashChoices: [1_000_000, 1_500_000, 2_000_000],
    startCash: 1_500_000,
    money: 5_000_000,
    step: 100_000,
  },
};

/** Čísla, která do režimu nepatří (např. po přepnutí), nahradí výchozími. */
export function normalizeMatch(options: MatchOptions): MatchOptions {
  const mode: GameMode = options.mode === 'classic' ? 'classic' : 'nextlevel';
  const money = MODE_MONEY[mode];
  const startCash = money.startCashChoices.includes(options.startCash)
    ? options.startCash
    : money.startCash;
  const target =
    options.money >= startCash + money.step && options.money < money.money * 100
      ? options.money
      : money.money;
  const archetype = ARCHETYPES.includes(options.archetype as Archetype)
    ? options.archetype
    : 'random';
  return { ...options, mode, startCash, money: target, archetype };
}

export const DEFAULT_MATCH: MatchOptions = {
  mode: 'nextlevel',
  seats: 4,
  difficulty: 'normal',
  win: 'last',
  rounds: 20,
  money: 5_000_000,
  startCash: 1_500_000,
  archetype: 'random',
};

export const ARCHETYPES: readonly Archetype[] = ['developer', 'kryptobro', 'baron', 'trafikant'];

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

/** Každé místo dostane jiný archetyp. Volbu člověka zachová a zbytek rozdá podle seedu. */
function pickArchetypes(count: number, chosen: MatchOptions['archetype'], seed: number) {
  const pool = ARCHETYPES.filter((archetype) => archetype !== chosen);
  const result: Archetype[] = chosen === 'random' ? [] : [chosen];
  let value = (seed >>> 0) + 3;
  while (result.length < count && pool.length > 0) {
    result.push(pool.splice(value % pool.length, 1)[0]!);
    value = Math.floor(value / 5) + 11;
  }
  return result;
}

export function matchSettings(options: MatchOptions): GameSettings {
  // Cíl pod počáteční hotovostí by partii ukončil hned po startu.
  const amount = Math.max(options.money, options.startCash + MODE_MONEY[options.mode].step);
  const win: WinCondition =
    options.win === 'rounds'
      ? { type: 'richestAfterRounds', rounds: options.rounds }
      : options.win === 'money'
        ? { type: 'firstToMoney', amount }
        : { type: 'lastStanding' };
  return { mode: options.mode, win, startCash: options.startCash };
}

/** Lidé sedí první, zbytek míst dostanou boti s náhodnou osobností. */
export function matchSetups(
  humans: readonly string[],
  options: MatchOptions,
  seed: number,
): PlayerSetup[] {
  const bots = pickPersonalities(Math.max(0, options.seats - humans.length), seed);
  const seats = [
    ...humans.map((name): PlayerSetup => ({ name })),
    ...bots.map((personality): PlayerSetup => ({
      name: cs.botNames[personality],
      bot: { personality, difficulty: options.difficulty },
    })),
  ];
  const archetypes = pickArchetypes(seats.length, options.archetype, seed);
  return seats.map((seat, i) => ({ ...seat, archetype: archetypes[i] }));
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! | 0;
}
