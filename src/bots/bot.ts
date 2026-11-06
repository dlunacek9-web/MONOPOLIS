import {
  BUSINESS,
  GROUP_ORDER,
  JAIL_BAIL,
  MIN_BID_STEP,
  MONEY_UNIT,
  actorOf,
  bribeCost,
  buildCost,
  canBribeBuild,
  canBribeOfficial,
  canBreakout,
  canBribePolice,
  canBuild,
  canBuyShares,
  canLaunder,
  canMortgage,
  canCounterTrade,
  canProposeTrade,
  canPumpDump,
  canSellBuilding,
  canSellShares,
  canSetOffBooks,
  canUnmortgage,
  deedOf,
  groupTiles,
  hasBuildingsInGroup,
  hashToUnit,
  holdingOf,
  isValidCounter,
  isValidTrade,
  launderFine,
  launderLimit,
  liquidationValue,
  minBid,
  ownablePrice,
  ownsWholeGroup,
  playerOf,
  pumpOn,
  sharePrice,
  tileAt,
  tilesOfKind,
  tilesOwnedBy,
} from '../core';
import type {
  Action,
  Difficulty,
  GameState,
  Personality,
  PlayerId,
  TileId,
  TradeOffer,
} from '../core';

interface Traits {
  buyReserve: number;
  buildReserve: number;
  auctionFactor: number;
  acceptMargin: number;
  /** Ochota riskovat 0–1: nájem na ruku, úplatky, pump & dump. */
  crime: number;
}

/** Rezervy jsou v jednotkách `MONEY_UNIT` (Next level: tisíce Kč, Klasika: Kč). */
const TRAIT_TABLE: Record<Personality, Traits> = {
  zralok: { buyReserve: 30, buildReserve: 120, auctionFactor: 1.35, acceptMargin: 1.2, crime: 0.6 },
  lakomec: {
    buyReserve: 300,
    buildReserve: 600,
    auctionFactor: 0.75,
    acceptMargin: 1.0,
    crime: 0.15,
  },
  kriminalnik: {
    buyReserve: 0,
    buildReserve: 40,
    auctionFactor: 1.2,
    acceptMargin: 1.1,
    crime: 0.9,
  },
  vyvazeny: {
    buyReserve: 120,
    buildReserve: 220,
    auctionFactor: 1.0,
    acceptMargin: 1.1,
    crime: 0.35,
  },
};

function traitsOf(personality: Personality): Traits {
  const t = TRAIT_TABLE[personality];
  return {
    ...t,
    buyReserve: t.buyReserve * MONEY_UNIT,
    buildReserve: t.buildReserve * MONEY_UNIT,
  };
}

interface Skill {
  setBonus: number;
  danger: number;
  tradeEvery: number;
}

const SKILLS: Record<Difficulty, Skill> = {
  easy: { setBonus: 0.5, danger: 0.7, tradeEvery: 5 },
  normal: { setBonus: 1, danger: 1, tradeEvery: 3 },
  hard: { setBonus: 1.5, danger: 1.25, tradeEvery: 2 },
};

const jailCardValue = () => 40 * MONEY_UNIT;
const consolidateCash = () => 500 * MONEY_UNIT;

function botOf(s: GameState, player: PlayerId) {
  const bot = playerOf(s, player).bot;
  return {
    traits: traitsOf(bot?.personality ?? 'vyvazeny'),
    skill: SKILLS[bot?.difficulty ?? 'normal'],
  };
}

function otherGroupTiles(tile: TileId): TileId[] {
  const t = tileAt(tile);
  return t.kind === 'property' ? groupTiles(t.group).filter((id) => id !== tile) : [];
}

function wouldComplete(s: GameState, player: PlayerId, tile: TileId): boolean {
  const others = otherGroupTiles(tile);
  return others.length > 0 && others.every((id) => deedOf(s, id).owner === player);
}

/** Kolik má pro hráče pozemek hodnotu podle toho, co už vlastní. */
export function tileValue(s: GameState, player: PlayerId, tile: TileId): number {
  const t = tileAt(tile);
  const price = ownablePrice(tile) ?? 0;
  const { skill } = botOf(s, player);
  let value = price;
  if (t.kind === 'property') {
    const mine = otherGroupTiles(tile).filter((id) => deedOf(s, id).owner === player).length;
    if (wouldComplete(s, player, tile)) value = price * (1.6 + skill.setBonus);
    else if (mine > 0) value = price * 1.35;
  } else {
    const kind = t.kind === 'station' ? 'station' : 'utility';
    const owned = tilesOfKind(kind).filter(
      (id) => id !== tile && deedOf(s, id).owner === player,
    ).length;
    value = price * (1 + 0.3 * owned);
  }
  return deedOf(s, tile).mortgaged ? value * 0.75 : value;
}

/** Přirážka za pozemek, který soupeři doplní město. S koly klesá, aby se partie nezasekla. */
function dangerPremium(s: GameState, player: PlayerId): number {
  return Math.max(1.2, (2.2 - 0.04 * s.round) * botOf(s, player).skill.danger);
}

/** Co hráč v nabídce získá, a kolik by musel dostat, aby se mu vyplatila. */
function tradeBalance(s: GameState, me: PlayerId, offer: TradeOffer) {
  const other = offer.from === me ? offer.to : offer.from;
  const received = offer.from === me ? offer.get : offer.give;
  const given = offer.from === me ? offer.give : offer.get;
  let gain = received.cash + received.jailCards * jailCardValue();
  for (const tile of received.tiles) gain += tileValue(s, me, tile);
  let loss = given.cash + given.jailCards * jailCardValue();
  for (const tile of given.tiles) {
    const value = tileValue(s, me, tile);
    loss += wouldComplete(s, other, tile) ? value * dangerPremium(s, me) : value;
  }
  return { gain, loss, wanted: loss * botOf(s, me).traits.acceptMargin };
}

export function acceptsTrade(s: GameState, me: PlayerId, offer: TradeOffer): boolean {
  const { gain, wanted } = tradeBalance(s, me, offer);
  return gain >= wanted;
}

/** Pod tenhle podíl toho, co bot chce, je nabídka urážka a nestojí za vyjednávání. */
const INSULT_SHARE = 0.5;
/** Přirážka nad cenu bota v každém kole vyjednávání, jako podíl z toho, o co by přišel. */
const HAGGLE_PREMIUM = [0.15, 0.06, 0];

/**
 * Protinabídka bota, `null`, když nechce vyjednávat. Pozemky a propustky nechává, jak jsou, a chce
 * doplatek. Začne s přirážkou a v dalších kolech slevuje až na svou cenu. Vychází z veřejného stavu.
 */
export function chooseCounter(s: GameState, me: PlayerId): Action | null {
  const offer = s.trade;
  if (!offer || !canCounterTrade(s)) return null;
  const { gain, loss, wanted } = tradeBalance(s, me, offer);
  if (gain < wanted * INSULT_SHARE) return null;
  const premium = HAGGLE_PREMIUM[s.tradeCounters] ?? 0;
  const mood = 0.5 + 0.5 * hashToUnit(s.rng, s.turn, me, s.tradeCounters);
  const ask = Math.ceil((wanted - gain + loss * premium * mood) / MONEY_UNIT) * MONEY_UNIT;
  const owedToMe = offer.give.cash - offer.get.cash + ask;
  const counter: TradeOffer = {
    from: me,
    to: offer.from,
    give: { ...offer.get, cash: Math.max(0, -owedToMe) },
    get: { ...offer.give, cash: Math.min(Math.max(0, owedToMe), playerOf(s, offer.from).cash) },
  };
  // Na doplatek nemusí protistrana mít. Oříznutá protinabídka už by se botovi nevyplatila.
  if (!isValidCounter(s, counter) || !acceptsTrade(s, me, counter)) return null;
  return {
    type: 'counterTrade',
    player: me,
    offer: { to: counter.to, give: counter.give, get: counter.get },
  };
}

function raiseCash(s: GameState, me: PlayerId, amount: number): Action {
  if (liquidationValue(s, me) < amount) return { type: 'declareBankruptcy', player: me };
  for (const group of GROUP_ORDER) {
    const { count } = holdingOf(s, me, group);
    if (canSellShares(s, me, group, count)) {
      return { type: 'sellShares', player: me, group, count };
    }
  }
  const owned = tilesOwnedBy(s, me);
  const byPrice = (a: TileId, b: TileId) => (ownablePrice(a) ?? 0) - (ownablePrice(b) ?? 0);
  const cheapFirst = [...owned].sort(byPrice);
  const loose = cheapFirst.find((tile) => canMortgage(s, me, tile) && !wouldComplete(s, me, tile));
  if (loose !== undefined) return { type: 'mortgage', player: me, tile: loose };
  const building = cheapFirst.find((tile) => canSellBuilding(s, me, tile));
  if (building !== undefined) return { type: 'sellBuilding', player: me, tile: building };
  const any = cheapFirst.find((tile) => canMortgage(s, me, tile));
  if (any !== undefined) return { type: 'mortgage', player: me, tile: any };
  return { type: 'declareBankruptcy', player: me };
}

function chooseBid(s: GameState, me: PlayerId): Action {
  const auction = s.auction!;
  const p = playerOf(s, me);
  const { traits } = botOf(s, me);
  const worth = tileValue(s, me, auction.tile) * traits.auctionFactor;
  const limit =
    Math.floor(Math.min(p.cash - traits.buyReserve / 2, worth) / MONEY_UNIT) * MONEY_UNIT;
  const needed = minBid(s);
  if (needed > limit) return { type: 'passBid', player: me };
  const bump =
    Math.floor(((ownablePrice(auction.tile) ?? 0) * 0.15) / (5 * MONEY_UNIT)) * (5 * MONEY_UNIT);
  const amount = Math.min(limit, Math.max(needed, auction.bid + Math.max(bump, MIN_BID_STEP)));
  return { type: 'bid', player: me, amount };
}

/** Příhoz nebo pas bota v živé dražbě a kolik si s ním dá načas. */
export interface LiveMove {
  action: Action;
  delayMs: number;
}

const SNIPE_SHARE = 0.35;
const JUMP_SHARE = 0.25;
const SILENT_SHARE = 0.5;
/** Blafující bot přeplácí nejvýš o tolik nad to, co mu pozemek opravdu stojí za to. */
const BLUFF_MAX_EXTRA = 0.4;

/**
 * Tah bota v živé dražbě, `null` znamená, že zatím mlčí. Vidí jen to co člověk a rozhodnutí
 * závisí jen na stavu. Blafuje dvěma způsoby: přihazuje nad svou cenu v naději, že soupeře
 * vyžene výš, a mlčí, takže nejde poznat, jestli už skončil, nebo číhá na poslední chvíli.
 * Blaf je opravdové riziko: když soupeř couvne, bot předražený pozemek zaplatí.
 */
export function chooseLiveMove(s: GameState, me: PlayerId): LiveMove | null {
  const auction = s.auction;
  if (!auction?.live || !auction.bidders.includes(me) || auction.leader === me) return null;
  const { traits } = botOf(s, me);
  // Stejná dražba, stejná povaha: bot si styl nemění s každým příhozem.
  const trait = (salt: number) => hashToUnit(s.rng, s.turn, auction.tile, me, salt);
  const moment = (salt: number) =>
    hashToUnit(s.rng, s.turn, auction.tile, me, auction.bid, auction.gavel, salt);

  const bluffing = trait(1) < 0.1 + traits.crime * 0.6;
  const worth = tileValue(s, me, auction.tile) * traits.auctionFactor;
  const ceiling = bluffing ? worth * (1 + trait(2) * BLUFF_MAX_EXTRA) : worth;
  const limit =
    Math.floor(Math.min(playerOf(s, me).cash - traits.buyReserve / 2, ceiling) / MONEY_UNIT) * MONEY_UNIT;
  const needed = minBid(s);
  if (needed > limit) {
    if (trait(3) < SILENT_SHARE) return null;
    return { action: { type: 'passBid', player: me }, delayMs: 900 + moment(4) * 2000 };
  }

  // Číhající bot přihazuje až po klepnutí kladívka, ale stihne to dřív než další klepnutí.
  const sniper = trait(5) < SNIPE_SHARE;
  const waitForKnocks = trait(6) < 0.5 ? 1 : 2;
  if (sniper && auction.gavel < waitForKnocks) return null;
  const delayMs = sniper ? 350 + moment(7) * 700 : 700 + moment(7) * 1300;

  const bump =
    Math.floor(((ownablePrice(auction.tile) ?? 0) * 0.15) / (5 * MONEY_UNIT)) * (5 * MONEY_UNIT);
  // Velký skok má soupeře zastrašit. Bot ho zkouší, jen když má z čeho.
  const jump = moment(8) < JUMP_SHARE ? 3 : 1;
  const amount = Math.min(limit, Math.max(needed, auction.bid + Math.max(bump, MIN_BID_STEP) * jump));
  return { action: { type: 'bid', player: me, amount }, delayMs };
}

function manage(s: GameState, me: PlayerId): Action | null {
  const p = playerOf(s, me);
  const { traits } = botOf(s, me);
  const owned = tilesOwnedBy(s, me);
  const mortgaged = owned.find(
    (tile) =>
      canUnmortgage(s, me, tile) && p.cash - (ownablePrice(tile) ?? 0) >= traits.buildReserve,
  );
  if (mortgaged !== undefined) return { type: 'unmortgage', player: me, tile: mortgaged };
  const buildable = owned
    .filter((tile) => canBuild(s, me, tile))
    .filter((tile) => {
      const t = tileAt(tile);
      return t.kind === 'property' && p.cash - buildCost(s, me, tile) >= traits.buildReserve;
    })
    .sort(
      // Nejdřív dotáhnout rozestavěné město: hotely vrací domy do banky a brání jejich nedostatku.
      (a, b) =>
        deedOf(s, b).level - deedOf(s, a).level || (ownablePrice(b) ?? 0) - (ownablePrice(a) ?? 0),
    );
  const target = buildable[0];
  return target === undefined ? null : { type: 'build', player: me, tile: target };
}

function emptySide() {
  return { tiles: [] as TileId[], cash: 0, jailCards: 0 };
}

function proposeTrade(s: GameState, me: PlayerId): Action | null {
  const p = playerOf(s, me);
  const { skill, traits } = botOf(s, me);
  if (!canProposeTrade(s, me) || s.tradesThisTurn > 0) return null;
  // Hash místo modula: při modulu by někteří boti podle počtu hráčů nenabídli obchod nikdy.
  if (hashToUnit(s.turn, me) >= 1 / skill.tradeEvery) return null;
  const offers: Omit<TradeOffer, 'from'>[] = [];
  for (const [tile, deed] of s.deeds.entries()) {
    if (!deed || deed.owner === null || deed.owner === me) continue;
    if (tileAt(tile).kind !== 'property' || hasBuildingsInGroup(s, tile)) continue;
    const owner = deed.owner;
    const get = { ...emptySide(), tiles: [tile] };
    const price = ownablePrice(tile) ?? 0;
    if (wouldComplete(s, me, tile)) {
      for (const mine of tilesOwnedBy(s, me)) {
        if (!wouldComplete(s, owner, mine) || hasBuildingsInGroup(s, mine)) continue;
        // Výměna kusů téhož města nikomu nic nedá a boti by ji opakovali donekonečna.
        if (otherGroupTiles(tile).includes(mine)) continue;
        const cash = Math.max(0, price - (ownablePrice(mine) ?? 0));
        offers.push({ to: owner, give: { ...emptySide(), tiles: [mine], cash }, get });
      }
      const premium = dangerPremium(s, owner) * 1.15 * botOf(s, owner).traits.acceptMargin;
      const cash = Math.ceil((tileValue(s, owner, tile) * premium) / MONEY_UNIT) * MONEY_UNIT;
      if (p.cash - cash >= traits.buyReserve / 2) {
        offers.push({ to: owner, give: { ...emptySide(), cash }, get });
      }
    } else if (p.cash >= consolidateCash()) {
      const others = otherGroupTiles(tile);
      const iOwnSome = others.some((id) => deedOf(s, id).owner === me);
      const ownerHasOnlyThis = others.every((id) => deedOf(s, id).owner !== owner);
      if (iOwnSome && ownerHasOnlyThis) {
        const cash = Math.ceil((price * 1.4) / MONEY_UNIT) * MONEY_UNIT;
        offers.push({ to: owner, give: { ...emptySide(), cash }, get });
      }
    }
  }
  for (const offer of offers) {
    const full = { ...offer, from: me };
    if (!isValidTrade(s, full)) continue;
    const target = playerOf(s, offer.to);
    if (target.bot && !acceptsTrade(s, offer.to, full)) continue;
    return { type: 'proposeTrade', player: me, offer };
  }
  return null;
}

/** Salt odděluje jednotlivá rozhodnutí v jednom tahu, ať nejsou všechna stejná. */
function dares(s: GameState, me: PlayerId, salt: number, chance: number): boolean {
  return hashToUnit(s.turn, me, salt) < chance;
}

/** Prodej: pumpa je signál utéct, jinak bot bere zisk od 25 %. */
function chooseSale(s: GameState, me: PlayerId): Action | null {
  for (const group of GROUP_ORDER) {
    const { count, cost } = holdingOf(s, me, group);
    if (count === 0) continue;
    const profitable = count * sharePrice(s, group) >= cost * 1.25;
    if ((pumpOn(s, group) || profitable) && canSellShares(s, me, group, count)) {
      return { type: 'sellShares', player: me, group, count };
    }
  }
  return null;
}

/** Bot sází na firmy z měst, která má někdo celá: tam se bude stavět a cena poroste. */
function chooseInvestment(s: GameState, me: PlayerId): Action | null {
  const { traits } = botOf(s, me);
  if (!dares(s, me, 1, 0.2 + traits.crime / 2)) return null;
  const spare = playerOf(s, me).cash - traits.buildReserve - 300 * MONEY_UNIT;
  for (const group of GROUP_ORDER) {
    const tile = groupTiles(group)[0]!;
    const owner = deedOf(s, tile).owner;
    if (owner === null || !ownsWholeGroup(s, owner, tile) || pumpOn(s, group)) continue;
    if (holdingOf(s, me, group).count > 0) continue;
    const count = 10;
    if (spare >= count * sharePrice(s, group) && canBuyShares(s, me, group, count)) {
      return { type: 'buyShares', player: me, group, count };
    }
  }
  return null;
}

function chooseLaundering(s: GameState, me: PlayerId): Action | null {
  const amount = launderLimit(s, me);
  const p = playerOf(s, me);
  // Pokutu musí unést, jinak by jedno odhalení znamenalo bankrot.
  if (amount < 20 * MONEY_UNIT || p.cash < launderFine(amount)) return null;
  for (const tile of tilesOwnedBy(s, me)) {
    if (canLaunder(s, me, tile, amount) && dares(s, me, 100 + tile, 0.6)) {
      return { type: 'launder', player: me, tile, amount };
    }
  }
  return null;
}

function choosePump(s: GameState, me: PlayerId): Action | null {
  if (!BUSINESS || botOf(s, me).traits.crime < 0.5) return null;
  if (playerOf(s, me).cash < BUSINESS.pump.fine * 1.5 || !dares(s, me, 2, 0.3)) return null;
  for (const group of GROUP_ORDER) {
    if (holdingOf(s, me, group).count >= 10 && canPumpDump(s, me, group)) {
      return { type: 'pumpDump', player: me, group };
    }
  }
  return null;
}

function chooseBribeBuild(s: GameState, me: PlayerId): Action | null {
  if (!BUSINESS || botOf(s, me).traits.crime < 0.5 || !dares(s, me, 3, 0.3)) return null;
  const rules = BUSINESS.build;
  const needed = rules.cost + rules.fine + botOf(s, me).traits.buildReserve;
  for (const tile of tilesOwnedBy(s, me)) {
    if (!canBribeBuild(s, me, tile)) continue;
    if (playerOf(s, me).cash - buildCost(s, me, tile) >= needed) {
      return { type: 'bribeBuild', player: me, tile };
    }
  }
  return null;
}

/** Byznysová vrstva. Každá větev se v jednom tahu vyčerpá, takže bot nikdy neuvízne ve smyčce. */
function chooseBusiness(s: GameState, me: PlayerId): Action | null {
  if (!BUSINESS || !s.market) return null;
  const sale = chooseSale(s, me);
  if (sale) return sale;
  const { traits } = botOf(s, me);
  for (const tile of tilesOwnedBy(s, me)) {
    const wanted = hashToUnit(tile, me, 7) < traits.crime;
    if (deedOf(s, tile).offBooks !== wanted && canSetOffBooks(s, me, tile)) {
      return { type: 'setOffBooks', player: me, tile, on: wanted };
    }
  }
  return (
    chooseLaundering(s, me) ??
    choosePump(s, me) ??
    chooseBribeBuild(s, me) ??
    chooseInvestment(s, me)
  );
}

function chooseTax(s: GameState, me: PlayerId): Action {
  const tax = s.pendingTax;
  if (BUSINESS && tax && canBribeOfficial(s, me)) {
    const rules = BUSINESS.official;
    const safe = playerOf(s, me).cash >= tax.amount + rules.fine;
    if (safe && dares(s, me, 4, botOf(s, me).traits.crime)) {
      return { type: 'bribeOfficial', player: me };
    }
  }
  return { type: 'payTax', player: me };
}

/** Ujíždí podle povahy, malý nájem za riziko nestojí. Kdo nemá na zaplacení, nemá co ztratit. */
function chooseRent(s: GameState, me: PlayerId): Action {
  const amount = s.pendingRent?.amount ?? 0;
  const cash = playerOf(s, me).cash;
  const desperate = cash < amount;
  const safe = cash >= amount * (BUSINESS?.chase.caughtRentFactor ?? 2);
  const worthIt = amount >= 20 * MONEY_UNIT;
  const flees = desperate || (safe && worthIt && dares(s, me, 6, botOf(s, me).traits.crime));
  return { type: flees ? 'flee' : 'payRent', player: me };
}

function choosePoliceBribe(s: GameState, me: PlayerId): Action | null {
  if (!BUSINESS || !canBribePolice(s, me)) return null;
  const rules = BUSINESS.police;
  const safe = playerOf(s, me).cash >= rules.fine + bribeCost(s, me, rules);
  return safe && dares(s, me, 5, botOf(s, me).traits.crime)
    ? { type: 'bribePolice', player: me }
    : null;
}

/** Pokutu si musí moct dovolit a odvahu dává povaha, stejně jako u úplatku. */
function wantsBreakout(s: GameState, me: PlayerId): boolean {
  if (!BUSINESS || !canBreakout(s, me)) return false;
  const safe = playerOf(s, me).cash >= BUSINESS.breakout.fine + botOf(s, me).traits.buyReserve;
  return safe && dares(s, me, 7, botOf(s, me).traits.crime);
}

function wantsOutOfJail(s: GameState): boolean {
  const unowned = s.deeds.filter((deed) => deed && deed.owner === null).length;
  const buildings = s.deeds.some((deed) => deed && deed.level > 0);
  return unowned > 5 || !buildings;
}

function chooseRollPhase(s: GameState, me: PlayerId): Action {
  const p = playerOf(s, me);
  const managed = manage(s, me);
  if (managed) return managed;
  const trade = proposeTrade(s, me);
  if (trade) return trade;
  const business = chooseBusiness(s, me);
  if (business) return business;
  if (p.inJail && wantsOutOfJail(s)) {
    if (p.jailCards.length > 0) return { type: 'useJailCard', player: me };
    const bribe = choosePoliceBribe(s, me);
    if (bribe) return bribe;
    if (wantsBreakout(s, me)) return { type: 'breakout', player: me };
    if (p.cash >= JAIL_BAIL + botOf(s, me).traits.buyReserve) {
      return { type: 'payBail', player: me };
    }
  }
  return { type: 'roll', player: me };
}

function chooseBuy(s: GameState, me: PlayerId): Action {
  const tile = s.pendingBuy!;
  const price = ownablePrice(tile) ?? 0;
  const p = playerOf(s, me);
  const { traits } = botOf(s, me);
  if (p.cash < price) return { type: 'decline', player: me };
  const valuable = wouldComplete(s, me, tile) || tileValue(s, me, tile) > price;
  const reserve = valuable ? traits.buyReserve / 2 : traits.buyReserve;
  return p.cash - price >= reserve ? { type: 'buy', player: me } : { type: 'decline', player: me };
}

/** Vrátí jednu legální akci bota, který je právě na řadě. Rozhodnutí závisí jen na stavu. */
export function chooseBotAction(s: GameState, me: PlayerId): Action {
  if (actorOf(s) !== me) throw new Error('Bot není na řadě');
  if (s.trade) {
    if (acceptsTrade(s, me, s.trade)) return { type: 'acceptTrade', player: me };
    return chooseCounter(s, me) ?? { type: 'rejectTrade', player: me };
  }
  const debt = s.debts[0];
  if (debt) {
    return playerOf(s, me).cash >= debt.amount
      ? { type: 'settleDebt', player: me }
      : raiseCash(s, me, debt.amount);
  }
  if (s.auction) return chooseBid(s, me);
  if (s.phase === 'awaitBuy') return chooseBuy(s, me);
  if (s.phase === 'awaitTax') return chooseTax(s, me);
  if (s.phase === 'awaitRent') return chooseRent(s, me);
  // Bot se nehraje, stejně jako když člověk honičku přeskočí.
  if (s.phase === 'chase') return { type: 'chaseSkip', player: me };
  if (s.phase === 'breakout') return { type: 'breakoutSkip', player: me };
  if (s.phase === 'awaitRoll') return chooseRollPhase(s, me);
  return manage(s, me) ?? chooseBusiness(s, me) ?? { type: 'endTurn', player: me };
}
