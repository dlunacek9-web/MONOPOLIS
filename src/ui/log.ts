import { hashToUnit } from '../core';
import type { GameEvent, GameState, PlayerId, TileId } from '../core';
import { cs, formatMoney } from '../i18n/cs';

function name(s: GameState, player: PlayerId): string {
  return s.players[player]?.name ?? '?';
}

function tile(id: TileId): string {
  return cs.tiles[id] ?? '?';
}

function creditor(s: GameState, player: PlayerId | null): string {
  return player === null ? cs.game.bank : name(s, player);
}

/** Převede událost z pravidel na větu. Vrací prázdný text pro události, které se nevypisují. */
export function formatEvent(s: GameState, e: GameEvent): string {
  const l = cs.log;
  switch (e.type) {
    case 'gameStart':
      return l.gameStart;
    case 'controller':
      return e.bot
        ? l.controllerBot(name(s, e.player))
        : l.controllerHuman(name(s, e.player), e.previous);
    case 'turnStart':
      return l.turnStart(name(s, e.player), e.round);
    case 'roll':
      return l.roll(name(s, e.player), e.dice[0], e.dice[1]);
    case 'move':
      return l.move(name(s, e.player), tile(e.tile));
    case 'passStart':
      return l.passStart(name(s, e.player), formatMoney(e.amount));
    case 'buy':
      return l.buy(name(s, e.player), tile(e.tile), formatMoney(e.price));
    case 'decline':
      return l.decline(name(s, e.player), tile(e.tile));
    case 'chaseStart':
      return cs.chase.logStart(name(s, e.player), tile(e.tile));
    case 'chaseEnd':
      return e.escaped
        ? cs.chase.logEscaped(name(s, e.player), name(s, e.owner))
        : cs.chase.logCaught(name(s, e.player));
    case 'heistStart':
      return e.tile === null
        ? cs.heist.logStartBank(name(s, e.player))
        : cs.heist.logStartHotel(name(s, e.player), tile(e.tile));
    case 'heistEnd':
      if (!e.escaped) return cs.heist.logCaught(name(s, e.player));
      return e.loot > 0
        ? cs.heist.logEscaped(name(s, e.player), formatMoney(e.loot))
        : cs.heist.logEmpty(name(s, e.player));
    case 'breakoutStart':
      return cs.breakout.logStart(name(s, e.player));
    case 'breakoutEnd':
      return e.escaped
        ? cs.breakout.logEscaped(name(s, e.player))
        : cs.breakout.logCaught(name(s, e.player), formatMoney(e.fine));
    case 'rent':
      return l.rent(name(s, e.player), name(s, e.owner), tile(e.tile), formatMoney(e.amount));
    case 'mortgagedNoRent':
      return l.mortgagedNoRent(tile(e.tile));
    case 'tax':
      return l.tax(name(s, e.player), tile(e.tile), formatMoney(e.amount));
    case 'card':
      return l.card(name(s, e.player), cs.decks[e.deck], cs.cards[e.deck][e.card] ?? '');
    case 'gain':
      return l.gain(name(s, e.player), formatMoney(e.amount));
    case 'pay':
      return l.pay(name(s, e.player), formatMoney(e.amount), creditor(s, e.to));
    case 'jail':
      return l.jail(name(s, e.player));
    case 'jailStay':
      return l.jailStay(name(s, e.player), e.attempt);
    case 'jailOut':
      if (e.how === 'bail') return l.jailOutBail(name(s, e.player));
      if (e.how === 'card') return l.jailOutCard(name(s, e.player));
      if (e.how === 'doubles') return l.jailOutDoubles(name(s, e.player));
      if (e.how === 'bribe') return l.jailOutBribe(name(s, e.player));
      if (e.how === 'breakout') return cs.breakout.logOut(name(s, e.player));
      return l.jailOutForced(name(s, e.player));
    case 'threeDoubles':
      return l.threeDoubles(name(s, e.player));
    case 'auctionStart':
      return l.auctionStart(tile(e.tile));
    case 'bid':
      return l.bid(name(s, e.player), formatMoney(e.amount));
    case 'passBid':
      return l.passBid(name(s, e.player));
    case 'auctionWon':
      return l.auctionWon(name(s, e.player), tile(e.tile), formatMoney(e.amount));
    case 'auctionNone':
      return l.auctionNone(tile(e.tile));
    case 'build':
      return l.build(name(s, e.player), tile(e.tile), e.level === 5);
    case 'sellBuilding':
      return l.sellBuilding(name(s, e.player), tile(e.tile));
    case 'mortgage':
      return l.mortgage(name(s, e.player), tile(e.tile));
    case 'unmortgage':
      return l.unmortgage(name(s, e.player), tile(e.tile));
    case 'tradeProposed':
      return l.tradeProposed(name(s, e.from), name(s, e.to));
    case 'tradeCountered':
      return l.tradeCountered(name(s, e.from), name(s, e.to));
    case 'tradeAccepted':
      return l.tradeAccepted(name(s, e.from), name(s, e.to));
    case 'tradeRejected':
      return l.tradeRejected(name(s, e.from), name(s, e.to));
    case 'debt':
      return l.debt(name(s, e.player), formatMoney(e.amount), creditor(s, e.creditor));
    case 'debtPaid':
      return l.debtPaid(name(s, e.player), formatMoney(e.amount), creditor(s, e.creditor));
    case 'bankrupt':
      return l.bankrupt(name(s, e.player));
    case 'gameOver':
      return l.gameOver(name(s, e.winner));
    case 'blackRent':
      return l.blackRent(name(s, e.owner), tile(e.tile), formatMoney(e.amount));
    case 'launder':
      return l.launder(name(s, e.player), tile(e.tile), formatMoney(e.amount), formatMoney(e.net));
    case 'bribe':
      return l.bribe[e.kind](name(s, e.player), formatMoney(e.cost));
    case 'busted':
      return `${l.busted[e.reason]} ${l.bustedPenalty(name(s, e.player), formatMoney(e.fine), formatMoney(e.seized))}`;
    case 'shares': {
      const say = e.buy ? l.sharesBuy : l.sharesSell;
      return say(name(s, e.player), e.count, cs.groups[e.group], formatMoney(e.price));
    }
    case 'pump':
      return l.pump(name(s, e.player), cs.groups[e.group], formatMoney(e.price));
    case 'dump':
      return l.dump(cs.groups[e.group], formatMoney(e.price));
  }
}

const QUIP_CHANCE = 0.45;

/** Hláška bota k události. Bot mluví jen občas, aby výpis nezahltil. */
export function quipFor(s: GameState, e: GameEvent): string | null {
  let speaker: PlayerId;
  let kind: keyof typeof cs.quips;
  if (e.type === 'buy' || e.type === 'auctionWon') {
    speaker = e.player;
    kind = 'buy';
  } else if (e.type === 'rent') {
    speaker = e.owner;
    kind = 'rent';
  } else if (e.type === 'jail') {
    speaker = e.player;
    kind = 'jail';
  } else if (e.type === 'bankrupt') {
    speaker = e.player;
    kind = 'bankrupt';
  } else {
    return null;
  }
  const bot = s.players[speaker]?.bot;
  if (!bot) return null;
  const always = e.type === 'bankrupt';
  if (!always && hashToUnit(e.seq, 1) > QUIP_CHANCE) return null;
  const lines = cs.quips[kind][bot.personality];
  const line = lines[Math.floor(hashToUnit(e.seq, 2) * lines.length)]!;
  return cs.log.quip(name(s, speaker), line);
}
