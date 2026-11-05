import { createGame } from '../core';
import type { GameState, PlayerId } from '../core';
import { cs } from '../i18n/cs';
import { LocalTransport } from './local';
import { STAND_IN_PERSONALITY, matchSettings, matchSetups } from './match';
import type { MatchOptions } from './match';
import { PROTOCOL_VERSION, cleanName, parseGuestMessage } from './protocol';
import type { GuestMessage, HostMessage, LobbySeat, LobbyView } from './protocol';
import type { PeerRoom } from './room';
import type { GameTransport } from './transport';

/** Krátký výpadek bot nepřebírá, hráč má čas se znovu připojit. */
export const RECONNECT_GRACE_MS = 15_000;

export const HOST_SEAT: PlayerId = 0;
const MAX_SEATS = 4;

interface Guest {
  clientId: string;
  name: string;
  /** `null`, když je hráč odpojený. */
  peerId: string | null;
  seat: PlayerId | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Hostitel drží jediný platný stav hry. Ostatní posílají akce a dostávají hotový výsledek. */
export class HostSession {
  private readonly guests: Guest[] = [];
  private transport: LocalTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeAck: (() => void) | null = null;
  private rev = 0;
  private changeListener: (() => void) | null = null;

  constructor(
    private readonly room: PeerRoom,
    readonly code: string,
    private readonly hostName: string,
    private optionsValue: MatchOptions,
  ) {
    room.onMessage((data, peerId) => this.onMessage(data, peerId));
    room.onPeerLeave((peerId) => this.onPeerLeave(peerId));
  }

  get options(): MatchOptions {
    return this.optionsValue;
  }

  get humanCount(): number {
    return 1 + this.guests.filter((guest) => guest.peerId !== null).length;
  }

  /** Lobby se překreslí, když někdo přijde nebo odejde. */
  onChange(listener: () => void): void {
    this.changeListener = listener;
  }

  view(): LobbyView {
    const humans: LobbySeat[] = [
      { name: this.hostName, kind: 'host' },
      ...this.guests.map((guest) => ({ name: guest.name, kind: 'guest' as const })),
    ];
    const bots = Math.max(0, this.optionsValue.seats - humans.length);
    const seats = [
      ...humans,
      ...Array.from({ length: bots }, () => ({ name: cs.mp.botName, kind: 'bot' as const })),
    ];
    return { code: this.code, seats, options: this.optionsValue };
  }

  setOptions(options: MatchOptions): void {
    this.optionsValue = { ...options, seats: Math.max(options.seats, this.humanCount) };
    this.broadcastLobby();
  }

  /** Hostitel sedí vždy na místě 0, hosté podle pořadí příchodu, zbytek obsadí boti. */
  startGame(seed: number): GameTransport {
    this.endGameSubscription();
    this.guests.forEach((guest, index) => {
      guest.seat = index + 1;
    });
    const setups = matchSetups(
      [this.hostName, ...this.guests.map((guest) => guest.name)],
      this.optionsValue,
      seed,
    );
    const state = createGame(matchSettings(this.optionsValue), setups, seed);
    const transport = new LocalTransport(state);
    this.transport = transport;
    this.unsubscribe = transport.subscribe((next) => this.broadcastGame(next));
    this.unsubscribeAck = transport.onAcknowledge((player, seq) =>
      this.send({ type: 'ack', player, seq }),
    );
    this.broadcastGame(state);
    return transport;
  }

  returnToLobby(): void {
    this.endGameSubscription();
    this.transport = null;
    for (const guest of [...this.guests]) {
      this.clearTimer(guest);
      guest.seat = null;
      if (guest.peerId === null) this.guests.splice(this.guests.indexOf(guest), 1);
    }
    // Za běhu mohli přijít další zájemci o boty, jenže u stolu je nejvýš 4 lidí.
    for (const extra of this.guests.splice(MAX_SEATS - 1)) {
      if (extra.peerId !== null) this.send({ type: 'rejected', reason: 'full' }, extra.peerId);
    }
    this.optionsValue = {
      ...this.optionsValue,
      seats: Math.max(this.optionsValue.seats, this.humanCount),
    };
    this.broadcastLobby();
    this.changeListener?.();
  }

  close(): void {
    this.endGameSubscription();
    for (const guest of this.guests) this.clearTimer(guest);
    this.send({ type: 'closed' });
    this.room.leave();
  }

  private endGameSubscription(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeAck?.();
    this.unsubscribeAck = null;
  }

  private clearTimer(guest: Guest): void {
    if (guest.timer !== null) clearTimeout(guest.timer);
    guest.timer = null;
  }

  private send(message: HostMessage, peerId?: string): void {
    this.room.send(message, peerId);
  }

  private broadcastLobby(): void {
    this.send({ type: 'lobby', view: this.view() });
  }

  private sendGame(guest: Guest, state: GameState): void {
    if (guest.peerId === null) return;
    this.send({ type: 'game', rev: this.rev, state, seat: guest.seat }, guest.peerId);
  }

  private broadcastGame(state: GameState): void {
    this.rev += 1;
    for (const guest of this.guests) this.sendGame(guest, state);
  }

  private onMessage(data: unknown, peerId: string): void {
    const message = parseGuestMessage(data);
    if (!message) return;
    if (message.type === 'hello') {
      this.onHello(message, peerId);
      return;
    }
    const guest = this.guests.find((candidate) => candidate.peerId === peerId);
    if (!guest || !this.transport) return;
    if (message.type === 'claim') this.onClaim(guest, message.player);
    else if (message.type === 'ack') {
      // Odklikává jen sám za sebe: místo u stolu zná hostitel, ne odesílatel.
      if (guest.seat !== null) this.transport.acknowledge(guest.seat, message.seq);
    } else this.onAction(guest, message);
  }

  private onHello(message: Extract<GuestMessage, { type: 'hello' }>, peerId: string): void {
    if (message.version !== PROTOCOL_VERSION) {
      this.send({ type: 'rejected', reason: 'version' }, peerId);
      return;
    }
    const known = this.guests.find((guest) => guest.clientId === message.clientId);
    if (known) {
      this.reconnect(known, peerId);
      return;
    }
    if (!this.hasRoomForNewcomer()) {
      this.send({ type: 'rejected', reason: 'full' }, peerId);
      return;
    }
    const guest: Guest = {
      clientId: message.clientId,
      name: cleanName(message.name, cs.lobby.defaultName),
      peerId,
      seat: null,
      timer: null,
    };
    this.guests.push(guest);
    if (this.transport) {
      this.sendGame(guest, this.transport.getState());
    } else {
      this.optionsValue = {
        ...this.optionsValue,
        seats: Math.max(this.optionsValue.seats, this.humanCount),
      };
      this.broadcastLobby();
    }
    this.changeListener?.();
  }

  private hasRoomForNewcomer(): boolean {
    if (this.transport) {
      return this.transport.getState().players.some((p) => p.bot !== null && !p.bankrupt);
    }
    return this.guests.length + 1 < MAX_SEATS;
  }

  /** Stejný klient se vrací třeba po obnovení stránky a dostane své místo zpátky. */
  private reconnect(guest: Guest, peerId: string): void {
    this.clearTimer(guest);
    guest.peerId = peerId;
    if (!this.transport) {
      this.send({ type: 'lobby', view: this.view() }, peerId);
      return;
    }
    const state = this.transport.getState();
    if (guest.seat !== null && state.players[guest.seat]?.bot) {
      // Výsledek netřeba kontrolovat: po konci hry nebo bankrotu se místo už nemění.
      this.transport.dispatch({
        type: 'setController',
        player: guest.seat,
        name: guest.name,
        bot: null,
      });
    }
    this.sendGame(guest, this.transport.getState());
  }

  private onClaim(guest: Guest, player: PlayerId): void {
    const transport = this.transport!;
    const target = transport.getState().players[player];
    if (guest.seat !== null || !target?.bot || target.bankrupt) {
      this.sendGame(guest, transport.getState());
      return;
    }
    // Místo po hráči, který vypadl, patří od teď novému člověku.
    for (const other of this.guests) if (other.seat === player) other.seat = null;
    guest.seat = player;
    transport.dispatch({ type: 'setController', player, name: guest.name, bot: null });
  }

  private onAction(guest: Guest, message: Extract<GuestMessage, { type: 'action' }>): void {
    const transport = this.transport!;
    if (guest.seat === null || message.action.player !== guest.seat) return;
    try {
      const result = transport.dispatch(message.action);
      if (!result.ok) this.sendGame(guest, transport.getState());
    } catch (error) {
      // Rozbitá zpráva od jednoho hráče nesmí shodit partii ostatním.
      console.warn('Akci od hráče nejde zpracovat.', error);
    }
  }

  private onPeerLeave(peerId: string): void {
    const guest = this.guests.find((candidate) => candidate.peerId === peerId);
    if (!guest) return;
    guest.peerId = null;
    if (!this.transport) {
      this.guests.splice(this.guests.indexOf(guest), 1);
      this.broadcastLobby();
      this.changeListener?.();
      return;
    }
    guest.timer = setTimeout(() => this.standIn(guest), RECONNECT_GRACE_MS);
  }

  private standIn(guest: Guest): void {
    guest.timer = null;
    if (!this.transport || guest.seat === null) return;
    this.transport.dispatch({
      type: 'setController',
      player: guest.seat,
      name: guest.name,
      bot: { personality: STAND_IN_PERSONALITY, difficulty: this.optionsValue.difficulty },
    });
  }
}
