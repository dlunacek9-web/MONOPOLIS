import { BOARD, GROUP_ORDER, TOWER_KINDS } from '../core';
import type { Action, GameState, GroupId, PlayerId, TileId, TowerKind, TradeSide } from '../core';
import type { MatchOptions } from './match';

/** Zvyš při každé nekompatibilní změně zpráv, ať se nepotkají různé verze hry. */
export const PROTOCOL_VERSION = 7;
export const MAX_NAME_LENGTH = 20;

export type SeatKind = 'host' | 'guest' | 'bot';

export interface LobbySeat {
  name: string;
  kind: SeatKind;
}

export interface LobbyView {
  code: string;
  seats: LobbySeat[];
  options: MatchOptions;
}

export type GuestMessage =
  | { type: 'hello'; version: number; clientId: string; name: string }
  | { type: 'action'; action: Action }
  | { type: 'claim'; player: PlayerId }
  /** Host odklikl svou scénu. Komu patří, určí hostitel podle místa u stolu. */
  | { type: 'ack'; seq: number };

export type HostMessage =
  | { type: 'lobby'; view: LobbyView }
  /** `seat` je místo příjemce. `null` znamená, že si ještě musí vybrat bota. */
  | { type: 'game'; rev: number; state: GameState; seat: PlayerId | null }
  /** Hráč odklikl svou scénu, ostatní ji můžou zavřít. */
  | { type: 'ack'; player: PlayerId; seq: number }
  | { type: 'rejected'; reason: 'full' | 'version' }
  | { type: 'closed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTile(value: unknown): value is TileId {
  return isCount(value) && value < BOARD.length;
}

function isGroup(value: unknown): value is GroupId {
  return GROUP_ORDER.includes(value as GroupId);
}

function parseSide(value: unknown): TradeSide | null {
  if (!isRecord(value)) return null;
  const { tiles, cash, jailCards } = value;
  if (!Array.isArray(tiles) || !tiles.every(isTile) || new Set(tiles).size !== tiles.length) {
    return null;
  }
  if (!isCount(cash) || !isCount(jailCards)) return null;
  return { tiles, cash, jailCards };
}

function isTowerKind(value: unknown): value is TowerKind {
  return TOWER_KINDS.includes(value as TowerKind);
}

/**
 * Zpráva od hosta může být cokoli, proto se skládá znovu jen z ověřených polí.
 * `setController` tu záměrně chybí: o místech u stolu rozhoduje jen hostitel.
 * `auctionGavel` taky: kladívko je časovač hostitele, jinak by si dražbu ukončil kdokoli.
 * Stejně tak `defenseTimeout`: čas na stavbu ve Válce gangů hlídá jen hostitel.
 */
function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isCount(value.player)) return null;
  const player = value.player;
  switch (value.type) {
    case 'roll':
    case 'payBail':
    case 'useJailCard':
    case 'buy':
    case 'decline':
    case 'passBid':
    case 'acceptTrade':
    case 'rejectTrade':
    case 'settleDebt':
    case 'declareBankruptcy':
    case 'endTurn':
    case 'payTax':
    case 'bribeOfficial':
    case 'bribePolice':
    case 'payRent':
    case 'flee':
    case 'chaseSkip':
    case 'breakout':
    case 'breakoutSkip':
    case 'heistSkip':
    case 'defenseReady':
      return { type: value.type, player };
    case 'defenseBuild':
      return isCount(value.cell) && isTowerKind(value.kind)
        ? { type: 'defenseBuild', player, cell: value.cell, kind: value.kind }
        : null;
    case 'defenseUpgrade':
      return isCount(value.cell) ? { type: 'defenseUpgrade', player, cell: value.cell } : null;
    case 'chaseResult':
      return typeof value.escaped === 'boolean'
        ? { type: 'chaseResult', player, escaped: value.escaped }
        : null;
    case 'breakoutResult':
      return typeof value.escaped === 'boolean'
        ? { type: 'breakoutResult', player, escaped: value.escaped }
        : null;
    case 'heistResult':
      return typeof value.escaped === 'boolean' && isCount(value.bags)
        ? { type: 'heistResult', player, escaped: value.escaped, bags: value.bags }
        : null;
    case 'heist':
      if (value.target === 'bank') return { type: 'heist', player, target: 'bank', tile: null };
      return value.target === 'hotel' && isCount(value.tile)
        ? { type: 'heist', player, target: 'hotel', tile: value.tile }
        : null;
    case 'bid':
      return isCount(value.amount) ? { type: 'bid', player, amount: value.amount } : null;
    case 'build':
    case 'sellBuilding':
    case 'mortgage':
    case 'unmortgage':
    case 'bribeBuild':
      return isTile(value.tile) ? { type: value.type, player, tile: value.tile } : null;
    case 'setOffBooks':
      return isTile(value.tile) && typeof value.on === 'boolean'
        ? { type: 'setOffBooks', player, tile: value.tile, on: value.on }
        : null;
    case 'launder':
      return isTile(value.tile) && isCount(value.amount)
        ? { type: 'launder', player, tile: value.tile, amount: value.amount }
        : null;
    case 'buyShares':
    case 'sellShares':
      return isGroup(value.group) && isCount(value.count)
        ? { type: value.type, player, group: value.group, count: value.count }
        : null;
    case 'pumpDump':
      return isGroup(value.group) ? { type: 'pumpDump', player, group: value.group } : null;
    case 'proposeTrade':
    case 'counterTrade': {
      if (!isRecord(value.offer) || !isCount(value.offer.to)) return null;
      const give = parseSide(value.offer.give);
      const get = parseSide(value.offer.get);
      if (!give || !get) return null;
      return { type: value.type, player, offer: { to: value.offer.to, give, get } };
    }
    default:
      return null;
  }
}

export function parseGuestMessage(value: unknown): GuestMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'hello':
      if (typeof value.version !== 'number') return null;
      if (typeof value.clientId !== 'string' || value.clientId.length > 64) return null;
      if (typeof value.name !== 'string') return null;
      return { type: 'hello', version: value.version, clientId: value.clientId, name: value.name };
    case 'action': {
      const action = parseAction(value.action);
      return action && { type: 'action', action };
    }
    case 'claim':
      return isCount(value.player) ? { type: 'claim', player: value.player } : null;
    case 'ack':
      return isCount(value.seq) ? { type: 'ack', seq: value.seq } : null;
    default:
      return null;
  }
}

export function parseHostMessage(value: unknown): HostMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'lobby':
      return isRecord(value.view) ? (value as unknown as HostMessage) : null;
    case 'game':
      return isCount(value.rev) && isRecord(value.state) ? (value as unknown as HostMessage) : null;
    case 'ack':
      return isCount(value.player) && isCount(value.seq)
        ? { type: 'ack', player: value.player, seq: value.seq }
        : null;
    case 'rejected':
      return value.reason === 'full' || value.reason === 'version'
        ? { type: 'rejected', reason: value.reason }
        : null;
    case 'closed':
      return { type: 'closed' };
    default:
      return null;
  }
}

/** Jméno od cizího klienta: bez okrajových mezer, s omezenou délkou a nikdy prázdné. */
export function cleanName(value: string, fallback: string): string {
  return value.trim().slice(0, MAX_NAME_LENGTH) || fallback;
}
