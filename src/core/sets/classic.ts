import type { CardEffect, DeckId, GroupId, Ruleset, Tile } from '../types';

/** Nájmy: pozemek, 1–4 domy, hotel. Klasická tabulka z originální hry. */
function property(
  group: GroupId,
  price: number,
  rents: readonly number[],
  houseCost: number,
): Tile {
  return { kind: 'property', group, price, rents, houseCost };
}

const chance: Tile = { kind: 'card', deck: 'tip' };
const chest: Tile = { kind: 'card', deck: 'urad' };
const station: Tile = { kind: 'station', price: 200 };
const utility: Tile = { kind: 'utility', price: 150 };

const BOARD: readonly Tile[] = [
  { kind: 'start' },
  property('most', 60, [2, 10, 30, 90, 160, 250], 50),
  chest,
  property('most', 60, [4, 20, 60, 180, 320, 450], 50),
  { kind: 'tax', amount: 200 },
  station,
  property('ostrava', 100, [6, 30, 90, 270, 400, 550], 50),
  chance,
  property('ostrava', 100, [6, 30, 90, 270, 400, 550], 50),
  property('ostrava', 120, [8, 40, 100, 300, 450, 600], 50),
  { kind: 'jail' },
  property('usti', 140, [10, 50, 150, 450, 625, 750], 100),
  utility,
  property('usti', 140, [10, 50, 150, 450, 625, 750], 100),
  property('usti', 160, [12, 60, 180, 500, 700, 900], 100),
  station,
  property('olomouc', 180, [14, 70, 200, 550, 750, 950], 100),
  chest,
  property('olomouc', 180, [14, 70, 200, 550, 750, 950], 100),
  property('olomouc', 200, [16, 80, 220, 600, 800, 1000], 100),
  { kind: 'parking' },
  property('plzen', 220, [18, 90, 250, 700, 875, 1050], 150),
  chance,
  property('plzen', 220, [18, 90, 250, 700, 875, 1050], 150),
  property('plzen', 240, [20, 100, 300, 750, 925, 1100], 150),
  station,
  property('brno', 260, [22, 110, 330, 800, 975, 1150], 150),
  property('brno', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility,
  property('brno', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { kind: 'goToJail' },
  property('vary', 300, [26, 130, 390, 900, 1100, 1275], 200),
  property('vary', 300, [26, 130, 390, 900, 1100, 1275], 200),
  chest,
  property('vary', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  station,
  chance,
  property('praha', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { kind: 'tax', amount: 100 },
  property('praha', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

/** Šance. Pořadí odpovídá textům v `src/i18n/cs.ts`. */
const CHANCE: readonly CardEffect[] = [
  { kind: 'moveTo', tile: 39 },
  { kind: 'moveTo', tile: 0 },
  { kind: 'moveTo', tile: 24 },
  { kind: 'moveTo', tile: 11 },
  { kind: 'nearest', what: 'station' },
  { kind: 'nearest', what: 'station' },
  { kind: 'nearest', what: 'utility' },
  { kind: 'gain', amount: 50 },
  { kind: 'jailCard' },
  { kind: 'moveBack', steps: 3 },
  { kind: 'toJail' },
  { kind: 'repairs', perHouse: 25, perHotel: 100 },
  { kind: 'pay', amount: 15 },
  { kind: 'moveTo', tile: 5 },
  { kind: 'payEach', amount: 50 },
  { kind: 'gain', amount: 150 },
];

/** Pokladna. */
const CHEST: readonly CardEffect[] = [
  { kind: 'moveTo', tile: 0 },
  { kind: 'gain', amount: 200 },
  { kind: 'pay', amount: 50 },
  { kind: 'gain', amount: 50 },
  { kind: 'jailCard' },
  { kind: 'toJail' },
  { kind: 'gain', amount: 100 },
  { kind: 'gain', amount: 20 },
  { kind: 'gainEach', amount: 10 },
  { kind: 'gain', amount: 100 },
  { kind: 'pay', amount: 100 },
  { kind: 'pay', amount: 50 },
  { kind: 'gain', amount: 25 },
  { kind: 'repairs', perHouse: 40, perHotel: 115 },
  { kind: 'gain', amount: 10 },
  { kind: 'gain', amount: 100 },
];

const CARDS: Record<DeckId, readonly CardEffect[]> = { tip: CHANCE, urad: CHEST };

/** Klasika: čísla a pravidla originální hry. Částky jsou v celých korunách. */
export const CLASSIC: Ruleset = {
  board: BOARD,
  cards: CARDS,
  moneyUnit: 1,
  startCash: 1500,
  startSalary: 200,
  jailBail: 50,
  minBidStep: 10,
  stationRents: [25, 50, 100, 200],
  utilityRateOne: 4,
  utilityRateBoth: 10,
  totalHouses: 32,
  totalHotels: 12,
};
