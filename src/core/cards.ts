import type { DeckId, TileId } from './types';

export type CardEffect =
  | { kind: 'gain'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'gainEach'; amount: number }
  | { kind: 'payEach'; amount: number }
  | { kind: 'moveTo'; tile: TileId }
  | { kind: 'moveBack'; steps: number }
  | { kind: 'nearest'; what: 'station' | 'utility' }
  | { kind: 'toJail' }
  | { kind: 'jailCard' }
  | { kind: 'repairs'; perHouse: number; perHotel: number };

/** Texty karet jsou v `src/i18n/cs.ts` podle stejného indexu. */
export const CARDS: Record<DeckId, readonly CardEffect[]> = {
  tip: [
    { kind: 'moveTo', tile: 39 },
    { kind: 'moveTo', tile: 0 },
    { kind: 'moveTo', tile: 24 },
    { kind: 'moveTo', tile: 11 },
    { kind: 'moveTo', tile: 5 },
    { kind: 'nearest', what: 'station' },
    { kind: 'nearest', what: 'station' },
    { kind: 'nearest', what: 'utility' },
    { kind: 'moveBack', steps: 3 },
    { kind: 'toJail' },
    { kind: 'jailCard' },
    { kind: 'gain', amount: 60_000 },
    { kind: 'gain', amount: 140_000 },
    { kind: 'pay', amount: 20_000 },
    { kind: 'payEach', amount: 40_000 },
    { kind: 'repairs', perHouse: 25_000, perHotel: 90_000 },
  ],
  urad: [
    { kind: 'moveTo', tile: 0 },
    { kind: 'toJail' },
    { kind: 'jailCard' },
    { kind: 'gain', amount: 180_000 },
    { kind: 'gain', amount: 110_000 },
    { kind: 'gain', amount: 90_000 },
    { kind: 'gain', amount: 40_000 },
    { kind: 'gain', amount: 30_000 },
    { kind: 'gain', amount: 15_000 },
    { kind: 'gainEach', amount: 20_000 },
    { kind: 'gainEach', amount: 40_000 },
    { kind: 'pay', amount: 120_000 },
    { kind: 'pay', amount: 60_000 },
    { kind: 'pay', amount: 40_000 },
    { kind: 'repairs', perHouse: 35_000, perHotel: 120_000 },
    { kind: 'gain', amount: 70_000 },
  ],
};

export function cardEffect(deck: DeckId, card: number): CardEffect {
  const effect = CARDS[deck][card];
  if (!effect) throw new Error(`Neplatná karta ${deck}/${card}`);
  return effect;
}
