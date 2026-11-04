import { netWorth } from '../core';
import type { GameState, PlayerId } from '../core';

/** Úložiště za rozhraním. Později ho může nahradit třeba synchronizace mezi zařízeními. */
export interface ProfileStorage {
  load<T>(key: string): T | null;
  save<T>(key: string, value: T): void;
}

export class LocalStorageProfile implements ProfileStorage {
  constructor(private readonly prefix = 'monopolis:') {}

  load<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  save<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // Plné nebo zakázané úložiště nesmí shodit hru.
    }
  }
}

export interface GameSummary {
  winner: PlayerId;
  rounds: number;
  turns: number;
  biggestRent: GameState['stats']['biggestRent'];
  standings: { player: PlayerId; netWorth: number; bankrupt: boolean }[];
}

export function summarizeGame(s: GameState): GameSummary {
  if (s.winner === null) throw new Error('Hra ještě neskončila');
  const standings = s.players
    .map((p) => ({ player: p.id, netWorth: netWorth(s, p.id), bankrupt: p.bankrupt }))
    .sort((a, b) => b.netWorth - a.netWorth);
  return {
    winner: s.winner,
    rounds: s.round,
    turns: s.turn,
    biggestRent: s.stats.biggestRent,
    standings,
  };
}

type GameEndListener = (summary: GameSummary) => void;
const gameEndListeners = new Set<GameEndListener>();

/** Sem se později napojí statistiky a odemykání. */
export function onGameEnd(listener: GameEndListener): () => void {
  gameEndListeners.add(listener);
  return () => gameEndListeners.delete(listener);
}

export function publishGameEnd(summary: GameSummary): void {
  for (const listener of gameEndListeners) listener(summary);
}
