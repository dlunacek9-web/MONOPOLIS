import { BUSINESS, HOTEL_LEVEL, MONEY_UNIT, groupTiles, tileAt } from './board';
import { buildCost, canManage, deedOf, ownsWholeGroup, playerOf } from './rules';
import type {
  ArchetypePerks,
  BribeRules,
  BusinessRules,
  GameState,
  GroupId,
  HeistRules,
  HeistTarget,
  Holding,
  PlayerId,
  Pump,
  TileId,
} from './types';

function rules(): BusinessRules {
  if (!BUSINESS) throw new Error('Tahle sada pravidel nemá byznysovou vrstvu');
  return BUSINESS;
}

export function hasBusiness(s: GameState): boolean {
  return BUSINESS !== null && s.market !== null;
}

function perksOf(s: GameState, player: PlayerId): Partial<ArchetypePerks> {
  const archetype = playerOf(s, player).archetype;
  return (archetype && BUSINESS?.perks[archetype]) || {};
}

export function launderFeePct(s: GameState, player: PlayerId): number {
  return perksOf(s, player).launderFeePct ?? rules().launderFeePct;
}

export function launderRiskPct(s: GameState, player: PlayerId): number {
  return rules().launderRiskPct + (perksOf(s, player).launderRiskDelta ?? 0);
}

/** Kolik bílých zbude z vyprané částky. */
export function launderNet(s: GameState, player: PlayerId, amount: number): number {
  return Math.floor((amount * (100 - launderFeePct(s, player))) / 100);
}

export function launderFine(amount: number): number {
  return Math.ceil((amount * rules().launderFinePct) / 100 / MONEY_UNIT) * MONEY_UNIT;
}

export function launderLimit(s: GameState, player: PlayerId): number {
  return Math.min(rules().launderCap, playerOf(s, player).dirty);
}

export function bribeCost(s: GameState, player: PlayerId, bribe: BribeRules): number {
  const discount = perksOf(s, player).bribeDiscountPct ?? 0;
  return Math.ceil((bribe.cost * (100 - discount)) / 100 / MONEY_UNIT) * MONEY_UNIT;
}

export function bribeRiskPct(s: GameState, player: PlayerId, bribe: BribeRules): number {
  return bribe.riskPct + (perksOf(s, player).bribeRiskDelta ?? 0);
}

/** Úplatek jde zaplatit černými i bílými. `spent` je už zamluvená hotovost. */
function canAffordBribe(s: GameState, player: PlayerId, bribe: BribeRules, spent = 0): boolean {
  const p = playerOf(s, player);
  return p.dirty + p.cash - spent >= bribeCost(s, player, bribe);
}

/** Nelegální akce jdou jen na svobodě, bez dluhu a mimo rozhodování o koupi nebo dani. */
function canDoCrime(s: GameState, player: PlayerId): boolean {
  if (!hasBusiness(s) || !canManage(s, player) || s.debts.length > 0) return false;
  if (playerOf(s, player).inJail) return false;
  return s.phase === 'awaitRoll' || s.phase === 'awaitEnd';
}

export function canSetOffBooks(s: GameState, player: PlayerId, tile: TileId): boolean {
  if (!hasBusiness(s) || !canManage(s, player) || s.debts.length > 0) return false;
  return s.deeds[tile]?.owner === player;
}

/** Podnikem je každý vlastní nezastavený pozemek. Každý vypere jednou za tah. */
export function canLaunder(s: GameState, player: PlayerId, tile: TileId, amount: number): boolean {
  if (!canDoCrime(s, player)) return false;
  const deed = s.deeds[tile];
  if (!deed || deed.owner !== player || deed.mortgaged) return false;
  if (s.launderedTiles.includes(tile)) return false;
  return Number.isInteger(amount) && amount > 0 && amount <= launderLimit(s, player);
}

export function canBribeOfficial(s: GameState, player: PlayerId): boolean {
  if (!hasBusiness(s) || s.phase !== 'awaitTax' || !s.pendingTax) return false;
  if (!canManage(s, player) || s.debts.length > 0) return false;
  return canAffordBribe(s, player, rules().official);
}

export function canBribePolice(s: GameState, player: PlayerId): boolean {
  if (!hasBusiness(s) || s.phase !== 'awaitRoll') return false;
  if (!canManage(s, player) || s.debts.length > 0 || !playerOf(s, player).inJail) return false;
  return canAffordBribe(s, player, rules().police);
}

/** Útěk jde zkusit místo hodu. Pokuta se platí až po nezdaru, takže peníze předem nejsou potřeba. */
export function canBreakout(s: GameState, player: PlayerId): boolean {
  if (!hasBusiness(s) || s.phase !== 'awaitRoll') return false;
  return canManage(s, player) && s.debts.length === 0 && playerOf(s, player).inJail;
}

export function heistRules(target: HeistTarget): HeistRules {
  return rules().heist[target];
}

/** Lup za donesené pytle. Bez pytle není lup. */
export function heistLoot(target: HeistTarget, bags: number): number {
  const { baseLoot, bagLoot, maxBags } = heistRules(target);
  return bags <= 0 ? 0 : baseLoot + (Math.min(bags, maxBags) - 1) * bagLoot;
}

/** Hotely soupeřů, které jde vykrást. */
export function heistHotels(s: GameState, player: PlayerId): TileId[] {
  const result: TileId[] = [];
  s.deeds.forEach((deed, tile) => {
    if (deed && deed.level === HOTEL_LEVEL && deed.owner !== null && deed.owner !== player) {
      result.push(tile);
    }
  });
  return result;
}

/** Za kolik kol smí hráč na další heist. Nula znamená hned. */
export function heistCooldown(s: GameState, player: PlayerId): number {
  return Math.max(0, playerOf(s, player).nextHeistRound - s.round);
}

/** Banka stojí pořád, hotel musí patřit soupeři. Mezi heisty musí uběhnout pár kol. */
export function canHeist(
  s: GameState,
  player: PlayerId,
  target: HeistTarget,
  tile: TileId | null,
): boolean {
  if (!canDoCrime(s, player) || heistCooldown(s, player) > 0) return false;
  if (target === 'bank') return tile === null;
  return target === 'hotel' && tile !== null && heistHotels(s, player).includes(tile);
}

/** Stavba mimo pořadí. Když jde stavět normálně, úplatek nedává smysl a nenabízí se. */
export function canBribeBuild(s: GameState, player: PlayerId, tile: TileId): boolean {
  if (!canDoCrime(s, player)) return false;
  const t = tileAt(tile);
  if (t.kind !== 'property' || !ownsWholeGroup(s, player, tile)) return false;
  const group = groupTiles(t.group).map((id) => deedOf(s, id));
  if (group.some((deed) => deed.mortgaged)) return false;
  const level = deedOf(s, tile).level;
  if (level >= HOTEL_LEVEL || level <= Math.min(...group.map((deed) => deed.level))) return false;
  if (level === HOTEL_LEVEL - 1 ? s.hotelsLeft <= 0 : s.housesLeft <= 0) return false;
  const cost = buildCost(s, player, tile);
  if (playerOf(s, player).cash < cost) return false;
  return canAffordBribe(s, player, rules().build, cost);
}

export function holdingOf(s: GameState, player: PlayerId, group: GroupId): Holding {
  return playerOf(s, player).shares[group] ?? { count: 0, cost: 0 };
}

export function sharePrice(s: GameState, group: GroupId): number {
  return s.market?.prices[group] ?? 0;
}

export function pumpOn(s: GameState, group: GroupId): Pump | null {
  return s.market?.pumps.find((pump) => pump.group === group) ?? null;
}

export function canBuyShares(
  s: GameState,
  player: PlayerId,
  group: GroupId,
  count: number,
): boolean {
  if (!hasBusiness(s) || !canManage(s, player) || s.debts.length > 0) return false;
  if (!Number.isInteger(count) || count <= 0) return false;
  if (holdingOf(s, player, group).count + count > rules().stock.maxShares) return false;
  return playerOf(s, player).cash >= count * sharePrice(s, group);
}

/** Prodej jde i během dluhu: akcie jsou první, co se dá proměnit v hotovost. */
export function canSellShares(
  s: GameState,
  player: PlayerId,
  group: GroupId,
  count: number,
): boolean {
  if (!hasBusiness(s) || !canManage(s, player)) return false;
  if (!Number.isInteger(count) || count <= 0) return false;
  return count <= holdingOf(s, player, group).count;
}

/** Pořizovací cena prodávaných kusů a výplata včetně bonusu archetypu. */
export function saleOf(
  s: GameState,
  player: PlayerId,
  group: GroupId,
  count: number,
): { basis: number; proceeds: number } {
  const holding = holdingOf(s, player, group);
  const basis = Math.floor((holding.cost * count) / holding.count);
  const gross = count * sharePrice(s, group);
  const bonusPct = perksOf(s, player).profitBonusPct ?? 0;
  const bonus = Math.floor((Math.max(0, gross - basis) * bonusPct) / 100);
  return { basis, proceeds: gross + bonus };
}

/** Procenta zdražení a pádu při pump & dumpu tohoto hráče. */
export function pumpSwing(s: GameState, player: PlayerId): { up: number; down: number } {
  const { upPct, downPct } = rules().pump;
  const swing = 100 + (perksOf(s, player).pumpSwingPct ?? 0);
  return { up: Math.round((upPct * swing) / 100), down: Math.round((downPct * swing) / 100) };
}

/** Pump & dump stojí jen černé. Hráč smí mít jeden a každá firma může být jen v jednom. */
export function canPumpDump(s: GameState, player: PlayerId, group: GroupId): boolean {
  if (!canDoCrime(s, player) || !s.market) return false;
  if (playerOf(s, player).dirty < rules().pump.cost) return false;
  if (pumpOn(s, group)) return false;
  return !s.market.pumps.some((pump) => pump.by === player);
}
