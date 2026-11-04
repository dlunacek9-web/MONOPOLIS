import {
  BOARD_SIZE,
  HOTEL_LEVEL,
  JAIL_BAIL,
  JAIL_TILE,
  MAX_JAIL_ATTEMPTS,
  START_CASH,
  START_SALARY,
  TOTAL_HOTELS,
  TOTAL_HOUSES,
  BOARD,
  ownablePrice,
  tileAt,
  tilesOfKind,
} from './board';
import { CARDS, cardEffect } from './cards';
import { randomInt, rollDice, shuffle } from './rng';
import {
  actorOf,
  canBuild,
  canMortgage,
  canProposeTrade,
  canSellBuilding,
  canUnmortgage,
  deedOf,
  isValidTrade,
  minBid,
  mortgageInterest,
  mortgageValue,
  netWorth,
  playerOf,
  rentOf,
  tilesOwnedBy,
  unmortgageCost,
} from './rules';
import type {
  Action,
  DeckId,
  Deed,
  GameEventBody,
  GameSettings,
  GameState,
  PlayerId,
  PlayerSetup,
  TileId,
  TradeSide,
} from './types';

const MAX_LOG = 80;

export class IllegalActionError extends Error {}

function illegal(reason: string): never {
  throw new IllegalActionError(reason);
}

function emit(s: GameState, event: GameEventBody): void {
  s.eventSeq += 1;
  s.events.push({ ...event, seq: s.eventSeq });
  if (s.events.length > MAX_LOG) s.events.shift();
}

export function createGame(
  settings: GameSettings,
  setups: readonly PlayerSetup[],
  seed: number,
): GameState {
  if (setups.length < 2 || setups.length > 4) throw new Error('Hra je pro 2–4 hráče');
  const deeds: (Deed | null)[] = BOARD.map((_, id) =>
    ownablePrice(id) === null ? null : { owner: null, level: 0, mortgaged: false },
  );
  const s: GameState = {
    settings,
    players: setups.map((setup, id) => ({
      id,
      name: setup.name,
      bot: setup.bot ?? null,
      cash: settings.startCash ?? START_CASH,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      doublesCount: 0,
      bankrupt: false,
    })),
    deeds,
    phase: 'awaitRoll',
    active: 0,
    firstPlayer: 0,
    round: 1,
    turn: 1,
    rng: seed | 0,
    lastRoll: null,
    extraRoll: false,
    pendingBuy: null,
    decks: { tip: [], urad: [] },
    housesLeft: TOTAL_HOUSES,
    hotelsLeft: TOTAL_HOTELS,
    debts: [],
    auction: null,
    pendingAuctions: [],
    trade: null,
    tradesThisTurn: 0,
    winner: null,
    events: [],
    eventSeq: 0,
    stats: { biggestRent: null },
  };
  s.decks.tip = shuffle(
    s,
    CARDS.tip.map((_, i) => i),
  );
  s.decks.urad = shuffle(
    s,
    CARDS.urad.map((_, i) => i),
  );
  s.active = randomInt(s, setups.length);
  s.firstPlayer = s.active;
  emit(s, { type: 'gameStart' });
  emit(s, { type: 'turnStart', player: s.active, round: s.round });
  return s;
}

/** Zaplatí hned, nebo založí dluh, který musí hráč vyřešit. `to = null` je banka. */
function charge(s: GameState, from: PlayerId, to: PlayerId | null, amount: number): void {
  if (amount <= 0) return;
  const payer = playerOf(s, from);
  const alreadyInDebt = s.debts.some((debt) => debt.player === from);
  if (!alreadyInDebt && payer.cash >= amount) {
    payer.cash -= amount;
    if (to !== null) playerOf(s, to).cash += amount;
    return;
  }
  s.debts.push({ player: from, creditor: to, amount });
  emit(s, { type: 'debt', player: from, amount, creditor: to });
}

function sendToJail(s: GameState, player: PlayerId): void {
  const p = playerOf(s, player);
  p.position = JAIL_TILE;
  p.inJail = true;
  p.jailTurns = 0;
  p.doublesCount = 0;
  s.extraRoll = false;
  s.phase = 'awaitEnd';
  emit(s, { type: 'jail', player });
}

type RentRule = { kind: 'normal' } | { kind: 'double' } | { kind: 'utilityRoll' };

function land(s: GameState, player: PlayerId, rule: RentRule = { kind: 'normal' }): void {
  const p = playerOf(s, player);
  const tile = tileAt(p.position);
  switch (tile.kind) {
    case 'property':
    case 'station':
    case 'utility':
      landOnOwnable(s, player, p.position, rule);
      break;
    case 'tax':
      emit(s, { type: 'tax', player, tile: p.position, amount: tile.amount });
      charge(s, player, null, tile.amount);
      break;
    case 'card':
      drawCard(s, player, tile.deck);
      break;
    case 'goToJail':
      sendToJail(s, player);
      break;
    case 'start':
    case 'jail':
    case 'parking':
      break;
  }
}

function landOnOwnable(s: GameState, player: PlayerId, tile: TileId, rule: RentRule): void {
  const deed = deedOf(s, tile);
  if (deed.owner === null) {
    s.phase = 'awaitBuy';
    s.pendingBuy = tile;
    return;
  }
  if (deed.owner === player) return;
  if (deed.mortgaged) {
    emit(s, { type: 'mortgagedNoRent', player, tile });
    return;
  }
  let amount: number;
  if (rule.kind === 'utilityRoll') {
    const dice = rollDice(s);
    emit(s, { type: 'roll', player, dice });
    amount = (dice[0] + dice[1]) * 10_000;
  } else {
    const dice = s.lastRoll ?? [0, 0];
    amount = rentOf(s, tile, dice[0] + dice[1]);
    if (rule.kind === 'double') amount *= 2;
  }
  emit(s, { type: 'rent', player, owner: deed.owner, tile, amount });
  if (!s.stats.biggestRent || amount > s.stats.biggestRent.amount) {
    s.stats.biggestRent = { player: deed.owner, amount };
  }
  charge(s, player, deed.owner, amount);
}

function moveTo(s: GameState, player: PlayerId, tile: TileId, rule?: RentRule): void {
  const p = playerOf(s, player);
  if (tile <= p.position) {
    p.cash += START_SALARY;
    emit(s, { type: 'passStart', player, amount: START_SALARY });
  }
  p.position = tile;
  emit(s, { type: 'move', player, tile });
  land(s, player, rule);
}

function moveBy(s: GameState, player: PlayerId, steps: number): void {
  const p = playerOf(s, player);
  moveTo(s, player, (p.position + steps) % BOARD_SIZE);
}

function drawCard(s: GameState, player: PlayerId, deck: DeckId): void {
  const card = s.decks[deck].shift();
  if (card === undefined) return;
  const effect = cardEffect(deck, card);
  emit(s, { type: 'card', player, deck, card });
  if (effect.kind === 'jailCard') {
    playerOf(s, player).jailCards.push(deck);
  } else {
    s.decks[deck].push(card);
  }
  const others = s.players.filter((p) => !p.bankrupt && p.id !== player);
  switch (effect.kind) {
    case 'gain':
      playerOf(s, player).cash += effect.amount;
      emit(s, { type: 'gain', player, amount: effect.amount });
      break;
    case 'pay':
      emit(s, { type: 'pay', player, amount: effect.amount, to: null });
      charge(s, player, null, effect.amount);
      break;
    case 'gainEach':
      for (const other of others) {
        emit(s, { type: 'pay', player: other.id, amount: effect.amount, to: player });
        charge(s, other.id, player, effect.amount);
      }
      break;
    case 'payEach':
      for (const other of others) {
        emit(s, { type: 'pay', player, amount: effect.amount, to: other.id });
        charge(s, player, other.id, effect.amount);
      }
      break;
    case 'moveTo':
      moveTo(s, player, effect.tile);
      break;
    case 'moveBack': {
      const p = playerOf(s, player);
      p.position = (p.position - effect.steps + BOARD_SIZE) % BOARD_SIZE;
      emit(s, { type: 'move', player, tile: p.position });
      land(s, player);
      break;
    }
    case 'nearest': {
      const position = playerOf(s, player).position;
      const tiles = tilesOfKind(effect.what);
      const target = tiles.find((id) => id > position) ?? tiles[0]!;
      moveTo(
        s,
        player,
        target,
        effect.what === 'station' ? { kind: 'double' } : { kind: 'utilityRoll' },
      );
      break;
    }
    case 'toJail':
      sendToJail(s, player);
      break;
    case 'jailCard':
      break;
    case 'repairs': {
      let total = 0;
      for (const tile of tilesOwnedBy(s, player)) {
        const level = deedOf(s, tile).level;
        total += level === HOTEL_LEVEL ? effect.perHotel : level * effect.perHouse;
      }
      if (total > 0) {
        emit(s, { type: 'pay', player, amount: total, to: null });
        charge(s, player, null, total);
      }
      break;
    }
  }
}

function startAuction(s: GameState, tile: TileId): void {
  const count = s.players.length;
  const bidders: PlayerId[] = [];
  for (let i = 1; i <= count; i++) {
    const p = s.players[(s.active + i) % count]!;
    if (!p.bankrupt) bidders.push(p.id);
  }
  s.auction = { tile, bid: 0, leader: null, bidders, index: 0 };
  emit(s, { type: 'auctionStart', tile });
}

function finishAuction(s: GameState): void {
  const auction = s.auction!;
  if (auction.leader === null) {
    emit(s, { type: 'auctionNone', tile: auction.tile });
  } else {
    playerOf(s, auction.leader).cash -= auction.bid;
    deedOf(s, auction.tile).owner = auction.leader;
    emit(s, {
      type: 'auctionWon',
      player: auction.leader,
      tile: auction.tile,
      amount: auction.bid,
    });
  }
  s.auction = null;
}

function transferSide(s: GameState, from: PlayerId, to: PlayerId, side: TradeSide): void {
  const giver = playerOf(s, from);
  const receiver = playerOf(s, to);
  giver.cash -= side.cash;
  receiver.cash += side.cash;
  receiver.jailCards.push(...giver.jailCards.splice(0, side.jailCards));
  for (const tile of side.tiles) deedOf(s, tile).owner = to;
}

function chargeMortgageFees(s: GameState, receiver: PlayerId, tiles: readonly TileId[]): void {
  for (const tile of tiles) {
    if (deedOf(s, tile).mortgaged) charge(s, receiver, null, mortgageInterest(tile));
  }
}

function liquidateBuildings(s: GameState, player: PlayerId): void {
  const p = playerOf(s, player);
  for (const tile of tilesOwnedBy(s, player)) {
    const deed = deedOf(s, tile);
    const t = tileAt(tile);
    if (t.kind !== 'property' || deed.level === 0) continue;
    if (deed.level === HOTEL_LEVEL) s.hotelsLeft += 1;
    else s.housesLeft += deed.level;
    p.cash += Math.floor((deed.level * t.houseCost) / 2);
    deed.level = 0;
  }
}

function bankrupt(s: GameState, player: PlayerId, creditor: PlayerId | null): void {
  const p = playerOf(s, player);
  liquidateBuildings(s, player);
  const tiles = tilesOwnedBy(s, player);
  s.debts = s.debts.filter((debt) => debt.player !== player);
  for (const debt of s.debts) {
    if (debt.creditor === player) debt.creditor = null;
  }
  if (creditor === null) {
    for (const tile of tiles) {
      const deed = deedOf(s, tile);
      deed.owner = null;
      deed.mortgaged = false;
      s.pendingAuctions.push(tile);
    }
    for (const deck of p.jailCards) s.decks[deck].push(CARDS[deck].findIndex(isJailCard));
  } else {
    const receiver = playerOf(s, creditor);
    receiver.cash += p.cash;
    receiver.jailCards.push(...p.jailCards);
    for (const tile of tiles) deedOf(s, tile).owner = creditor;
    chargeMortgageFees(s, creditor, tiles);
  }
  p.cash = 0;
  p.jailCards = [];
  p.bankrupt = true;
  p.inJail = false;
  emit(s, { type: 'bankrupt', player, creditor });
}

function isJailCard(effect: { kind: string }): boolean {
  return effect.kind === 'jailCard';
}

function finishGame(s: GameState, winner: PlayerId): void {
  s.phase = 'gameOver';
  s.winner = winner;
  s.auction = null;
  s.trade = null;
  s.debts = [];
  s.pendingAuctions = [];
  s.pendingBuy = null;
  emit(s, { type: 'gameOver', winner });
}

function richestPlayer(s: GameState): PlayerId {
  const alive = s.players.filter((p) => !p.bankrupt);
  return alive.reduce((best, p) => (netWorth(s, p.id) > netWorth(s, best.id) ? p : best)).id;
}

function nextTurn(s: GameState): void {
  const count = s.players.length;
  let next = s.active;
  let wrapped = false;
  do {
    next = (next + 1) % count;
    if (next === s.firstPlayer) wrapped = true;
  } while (s.players[next]!.bankrupt);
  playerOf(s, s.active).doublesCount = 0;
  if (wrapped) s.round += 1;
  s.active = next;
  s.turn += 1;
  s.phase = 'awaitRoll';
  s.pendingBuy = null;
  s.extraRoll = false;
  s.tradesThisTurn = 0;
  if (s.settings.win.type === 'richestAfterRounds' && s.round > s.settings.win.rounds) {
    finishGame(s, richestPlayer(s));
    return;
  }
  emit(s, { type: 'turnStart', player: next, round: s.round });
}

/** Dotáhne automatické následky akce: konec hry, další dražbu a tah po bankrotu. */
function settle(s: GameState): void {
  if (s.phase === 'gameOver') return;
  const alive = s.players.filter((p) => !p.bankrupt);
  if (alive.length === 1) {
    finishGame(s, alive[0]!.id);
    return;
  }
  if (s.debts.length > 0 || s.auction || s.trade) return;
  if (s.settings.win.type === 'firstToMoney') {
    const amount = s.settings.win.amount;
    const winner = alive.find((p) => netWorth(s, p.id) >= amount);
    if (winner) {
      finishGame(s, winner.id);
      return;
    }
  }
  const nextAuction = s.pendingAuctions.shift();
  if (nextAuction !== undefined) {
    startAuction(s, nextAuction);
    return;
  }
  if (playerOf(s, s.active).bankrupt) nextTurn(s);
}

function requireActor(s: GameState, player: PlayerId): void {
  if (actorOf(s) !== player) illegal('Hráč není na řadě');
}

function requirePlainTurn(s: GameState, player: PlayerId): void {
  requireActor(s, player);
  if (s.trade || s.auction || s.debts.length > 0)
    illegal('Nejdřív se musí vyřešit obchod nebo dluh');
}

function doRoll(s: GameState, player: PlayerId): void {
  requirePlainTurn(s, player);
  if (s.phase !== 'awaitRoll') illegal('Teď se nehází');
  const p = playerOf(s, player);
  const dice = rollDice(s);
  const steps = dice[0] + dice[1];
  const doubles = dice[0] === dice[1];
  s.lastRoll = dice;
  s.phase = 'awaitEnd';
  s.extraRoll = false;
  emit(s, { type: 'roll', player, dice });
  if (p.inJail) {
    if (doubles) {
      p.inJail = false;
      p.jailTurns = 0;
      emit(s, { type: 'jailOut', player, how: 'doubles' });
      moveBy(s, player, steps);
      return;
    }
    p.jailTurns += 1;
    if (p.jailTurns >= MAX_JAIL_ATTEMPTS) {
      p.inJail = false;
      p.jailTurns = 0;
      emit(s, { type: 'jailOut', player, how: 'forced' });
      charge(s, player, null, JAIL_BAIL);
      moveBy(s, player, steps);
    } else {
      emit(s, { type: 'jailStay', player, attempt: p.jailTurns });
    }
    return;
  }
  if (doubles) {
    p.doublesCount += 1;
    if (p.doublesCount >= 3) {
      emit(s, { type: 'threeDoubles', player });
      sendToJail(s, player);
      return;
    }
    s.extraRoll = true;
  } else {
    p.doublesCount = 0;
  }
  moveBy(s, player, steps);
}

function apply(s: GameState, action: Action): void {
  const player = action.player;
  if (s.phase === 'gameOver') illegal('Hra skončila');
  if (!s.players[player] || playerOf(s, player).bankrupt) illegal('Neplatný hráč');
  const p = playerOf(s, player);
  switch (action.type) {
    case 'setController': {
      const previous = p.name;
      p.name = action.name;
      p.bot = action.bot;
      emit(s, { type: 'controller', player, previous, bot: action.bot !== null });
      break;
    }
    case 'roll':
      doRoll(s, player);
      break;
    case 'payBail':
      requirePlainTurn(s, player);
      if (s.phase !== 'awaitRoll' || !p.inJail) illegal('Kauce teď nejde zaplatit');
      if (p.cash < JAIL_BAIL) illegal('Málo peněz na kauci');
      p.cash -= JAIL_BAIL;
      p.inJail = false;
      p.jailTurns = 0;
      emit(s, { type: 'jailOut', player, how: 'bail' });
      break;
    case 'useJailCard': {
      requirePlainTurn(s, player);
      if (s.phase !== 'awaitRoll' || !p.inJail) illegal('Propustka teď nejde použít');
      const deck = p.jailCards.shift();
      if (!deck) illegal('Hráč nemá propustku');
      s.decks[deck].push(CARDS[deck].findIndex(isJailCard));
      p.inJail = false;
      p.jailTurns = 0;
      emit(s, { type: 'jailOut', player, how: 'card' });
      break;
    }
    case 'buy': {
      requirePlainTurn(s, player);
      if (s.phase !== 'awaitBuy' || s.pendingBuy === null) illegal('Není co koupit');
      const tile = s.pendingBuy;
      const price = ownablePrice(tile) ?? 0;
      if (p.cash < price) illegal('Málo peněz');
      p.cash -= price;
      deedOf(s, tile).owner = player;
      s.pendingBuy = null;
      s.phase = 'awaitEnd';
      emit(s, { type: 'buy', player, tile, price });
      break;
    }
    case 'decline': {
      requirePlainTurn(s, player);
      if (s.phase !== 'awaitBuy' || s.pendingBuy === null) illegal('Není co odmítnout');
      const tile = s.pendingBuy;
      s.pendingBuy = null;
      s.phase = 'awaitEnd';
      emit(s, { type: 'decline', player, tile });
      startAuction(s, tile);
      break;
    }
    case 'bid': {
      requireActor(s, player);
      const auction = s.auction;
      if (!auction || s.trade || s.debts.length > 0) illegal('Neběží dražba');
      if (!Number.isInteger(action.amount)) illegal('Neplatný příhoz');
      if (action.amount < minBid(s) || action.amount > p.cash) illegal('Neplatný příhoz');
      auction.bid = action.amount;
      auction.leader = player;
      emit(s, { type: 'bid', player, amount: action.amount });
      auction.index = (auction.index + 1) % auction.bidders.length;
      if (auction.bidders.length === 1) finishAuction(s);
      break;
    }
    case 'passBid': {
      requireActor(s, player);
      const auction = s.auction;
      if (!auction || s.trade || s.debts.length > 0) illegal('Neběží dražba');
      auction.bidders.splice(auction.index, 1);
      emit(s, { type: 'passBid', player });
      if (auction.index >= auction.bidders.length) auction.index = 0;
      const onlyLeaderLeft = auction.bidders.length === 1 && auction.bidders[0] === auction.leader;
      if (auction.bidders.length === 0 || onlyLeaderLeft) finishAuction(s);
      break;
    }
    case 'build': {
      if (!canBuild(s, player, action.tile)) illegal('Tady teď stavět nejde');
      const t = tileAt(action.tile);
      if (t.kind !== 'property') illegal('Tady teď stavět nejde');
      const deed = deedOf(s, action.tile);
      p.cash -= t.houseCost;
      if (deed.level === HOTEL_LEVEL - 1) {
        s.hotelsLeft -= 1;
        s.housesLeft += HOTEL_LEVEL - 1;
      } else {
        s.housesLeft -= 1;
      }
      deed.level += 1;
      emit(s, { type: 'build', player, tile: action.tile, level: deed.level });
      break;
    }
    case 'sellBuilding': {
      if (!canSellBuilding(s, player, action.tile)) illegal('Budova teď nejde prodat');
      const t = tileAt(action.tile);
      if (t.kind !== 'property') illegal('Budova teď nejde prodat');
      const deed = deedOf(s, action.tile);
      p.cash += Math.floor(t.houseCost / 2);
      if (deed.level === HOTEL_LEVEL) {
        s.hotelsLeft += 1;
        s.housesLeft -= HOTEL_LEVEL - 1;
      } else {
        s.housesLeft += 1;
      }
      deed.level -= 1;
      emit(s, { type: 'sellBuilding', player, tile: action.tile, level: deed.level });
      break;
    }
    case 'mortgage':
      if (!canMortgage(s, player, action.tile)) illegal('Pozemek teď nejde zastavit');
      deedOf(s, action.tile).mortgaged = true;
      p.cash += mortgageValue(action.tile);
      emit(s, { type: 'mortgage', player, tile: action.tile });
      break;
    case 'unmortgage':
      if (!canUnmortgage(s, player, action.tile)) illegal('Pozemek teď nejde splatit');
      p.cash -= unmortgageCost(action.tile);
      deedOf(s, action.tile).mortgaged = false;
      emit(s, { type: 'unmortgage', player, tile: action.tile });
      break;
    case 'proposeTrade': {
      if (!canProposeTrade(s, player)) illegal('Teď nejde nabídnout obchod');
      const offer = { ...action.offer, from: player };
      if (!isValidTrade(s, offer)) illegal('Neplatná nabídka');
      s.trade = offer;
      s.tradesThisTurn += 1;
      emit(s, { type: 'tradeProposed', from: player, to: offer.to });
      break;
    }
    case 'acceptTrade': {
      requireActor(s, player);
      const offer = s.trade;
      if (!offer) illegal('Žádná nabídka');
      if (!isValidTrade(s, offer)) illegal('Nabídka už neplatí');
      transferSide(s, offer.from, offer.to, offer.give);
      transferSide(s, offer.to, offer.from, offer.get);
      s.trade = null;
      emit(s, { type: 'tradeAccepted', from: offer.from, to: offer.to });
      chargeMortgageFees(s, offer.to, offer.give.tiles);
      chargeMortgageFees(s, offer.from, offer.get.tiles);
      break;
    }
    case 'rejectTrade': {
      requireActor(s, player);
      const offer = s.trade;
      if (!offer) illegal('Žádná nabídka');
      s.trade = null;
      emit(s, { type: 'tradeRejected', from: offer.from, to: offer.to });
      break;
    }
    case 'settleDebt': {
      requireActor(s, player);
      const debt = s.debts[0];
      if (s.trade || !debt || debt.player !== player) illegal('Hráč nemá dluh');
      if (p.cash < debt.amount) illegal('Málo peněz');
      p.cash -= debt.amount;
      if (debt.creditor !== null) playerOf(s, debt.creditor).cash += debt.amount;
      s.debts.shift();
      emit(s, {
        type: 'debtPaid',
        player,
        amount: debt.amount,
        creditor: debt.creditor,
      });
      break;
    }
    case 'declareBankruptcy': {
      requireActor(s, player);
      const debt = s.debts[0];
      if (s.trade || !debt || debt.player !== player) illegal('Hráč nemá dluh');
      bankrupt(s, player, debt.creditor);
      break;
    }
    case 'endTurn': {
      requirePlainTurn(s, player);
      if (s.phase !== 'awaitEnd') illegal('Tah teď nejde ukončit');
      if (s.extraRoll && !p.inJail) {
        s.phase = 'awaitRoll';
        s.extraRoll = false;
      } else {
        nextTurn(s);
      }
      break;
    }
  }
}

/** Čistá funkce: původní stav se nemění. Neplatná akce vyhodí `IllegalActionError`. */
export function reduce(state: GameState, action: Action): GameState {
  const s = structuredClone(state);
  apply(s, action);
  settle(s);
  return s;
}
