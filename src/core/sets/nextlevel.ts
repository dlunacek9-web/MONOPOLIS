import type { CardEffect, DeckId, GroupId, Ruleset, Tile } from '../types';

const GROUP_INFO: Record<GroupId, { houseCost: number; multipliers: readonly number[] }> = {
  most: { houseCost: 60_000, multipliers: [5, 15, 40, 65, 90] },
  ostrava: { houseCost: 60_000, multipliers: [5, 15, 40, 58, 78] },
  usti: { houseCost: 110_000, multipliers: [5, 14, 40, 55, 70] },
  olomouc: { houseCost: 110_000, multipliers: [5, 14, 38, 50, 62] },
  plzen: { houseCost: 160_000, multipliers: [5, 14, 36, 46, 56] },
  brno: { houseCost: 160_000, multipliers: [5, 14, 34, 42, 50] },
  vary: { houseCost: 210_000, multipliers: [5, 13, 32, 39, 46] },
  praha: { houseCost: 210_000, multipliers: [4, 12, 28, 34, 40] },
};

function property(group: GroupId, price: number, baseRent: number): Tile {
  const { houseCost, multipliers } = GROUP_INFO[group];
  const rents = [baseRent, ...multipliers.map((m) => Math.round((baseRent * m) / 1000) * 1000)];
  return { kind: 'property', group, price, rents, houseCost };
}

const tipCard: Tile = { kind: 'card', deck: 'tip' };
const uradCard: Tile = { kind: 'card', deck: 'urad' };
const station: Tile = { kind: 'station', price: 200_000 };
const utility: Tile = { kind: 'utility', price: 150_000 };

/** Názvy políček jsou v `src/i18n/cs.ts` podle stejného indexu. */
const BOARD: readonly Tile[] = [
  { kind: 'start' },
  property('most', 70_000, 3_000),
  uradCard,
  property('most', 90_000, 5_000),
  { kind: 'tax', amount: 200_000 },
  station,
  property('ostrava', 110_000, 7_000),
  tipCard,
  property('ostrava', 110_000, 7_000),
  property('ostrava', 130_000, 9_000),
  { kind: 'jail' },
  property('usti', 150_000, 11_000),
  utility,
  property('usti', 150_000, 11_000),
  property('usti', 170_000, 13_000),
  station,
  property('olomouc', 190_000, 15_000),
  uradCard,
  property('olomouc', 190_000, 15_000),
  property('olomouc', 210_000, 17_000),
  { kind: 'parking' },
  property('plzen', 230_000, 19_000),
  tipCard,
  property('plzen', 230_000, 19_000),
  property('plzen', 250_000, 21_000),
  station,
  property('brno', 270_000, 23_000),
  property('brno', 270_000, 23_000),
  utility,
  property('brno', 290_000, 25_000),
  { kind: 'goToJail' },
  property('vary', 310_000, 27_000),
  property('vary', 310_000, 27_000),
  uradCard,
  property('vary', 330_000, 30_000),
  station,
  tipCard,
  property('praha', 370_000, 36_000),
  { kind: 'tax', amount: 100_000 },
  property('praha', 420_000, 52_000),
];

const CARDS: Record<DeckId, readonly CardEffect[]> = {
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

/** Next level: vlastní české město s vlastními cenami. Částky jsou v tisících korun. */
export const NEXTLEVEL: Ruleset = {
  board: BOARD,
  cards: CARDS,
  moneyUnit: 1000,
  startCash: 1_500_000,
  startSalary: 200_000,
  jailBail: 50_000,
  minBidStep: 10_000,
  stationRents: [30_000, 60_000, 120_000, 240_000],
  utilityRateOne: 4_000,
  utilityRateBoth: 10_000,
  totalHouses: 32,
  totalHotels: 12,
  business: {
    blackRentBonusPct: 50,
    dirtyWorthPct: 75,
    seizeDirtyPct: 50,
    launderCap: 100_000,
    launderFeePct: 25,
    launderRiskPct: 10,
    launderFinePct: 50,
    taxDiscountPct: 50,
    official: { cost: 20_000, riskPct: 15, fine: 100_000 },
    police: { cost: 40_000, riskPct: 20, fine: 100_000 },
    build: { cost: 50_000, riskPct: 20, fine: 150_000 },
    pump: { cost: 50_000, riskPct: 25, fine: 200_000, upPct: 30, downPct: 40, turns: 2 },
    stock: {
      startPrice: 10_000,
      minPrice: 2_000,
      priceUnit: 100,
      maxShares: 50,
      buildPct: 2,
      bankruptPct: -15,
      noisePct: 3,
    },
    chase: { autoEscapePct: 45, cooldownRounds: 3, caughtRentFactor: 2 },
    breakout: { autoEscapePct: 40, fine: 30_000 },
    defense: { everyRounds: 8, reward: 200_000, penalty: 200_000 },
    heist: {
      cooldownRounds: 6,
      hotel: {
        baseLoot: 200_000,
        bagLoot: 100_000,
        maxBags: 4,
        riskPct: 30,
        fine: 300_000,
        autoEscapePct: 50,
      },
      bank: {
        baseLoot: 500_000,
        bagLoot: 100_000,
        maxBags: 6,
        riskPct: 45,
        fine: 500_000,
        autoEscapePct: 35,
      },
    },
    perks: {
      developer: { buildDiscountPct: 15 },
      kryptobro: { profitBonusPct: 20, pumpSwingPct: 50 },
      baron: { bribeDiscountPct: 30, bribeRiskDelta: -5 },
      trafikant: { launderFeePct: 15, launderRiskDelta: -5 },
    },
  },
};
