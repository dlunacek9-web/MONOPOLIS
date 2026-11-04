import type { Action, GameState, PlayerId } from '../core';
import { PROTOCOL_VERSION, parseHostMessage } from './protocol';
import type { GuestMessage, LobbyView } from './protocol';
import type { PeerRoom } from './room';
import type { DispatchResult, GameTransport } from './transport';

export const CONNECT_TIMEOUT_MS = 30_000;

export type EndReason = 'hostLeft' | 'timeout' | 'full' | 'version';

export type GuestStatus =
  | { kind: 'connecting' }
  | { kind: 'lobby'; view: LobbyView }
  | { kind: 'claim'; state: GameState }
  | { kind: 'playing'; seat: PlayerId }
  | { kind: 'ended'; reason: EndReason };

/** Host hraje přes stejný `GameTransport` jako sólo, jen pravidla počítá hostitel. */
export class GuestSession implements GameTransport {
  private state: GameState | null = null;
  private rev = -1;
  private hostId: string | null = null;
  private statusValue: GuestStatus = { kind: 'connecting' };
  private statusListener: ((status: GuestStatus) => void) | null = null;
  private readonly listeners = new Set<(state: GameState) => void>();
  private timeout: ReturnType<typeof setTimeout> | null;

  constructor(
    private readonly room: PeerRoom,
    private readonly clientId: string,
    private readonly name: string,
  ) {
    room.onMessage((data, peerId) => this.onMessage(data, peerId));
    room.onPeerJoin((peerId) => {
      // Dokud neznáme hostitele, ptáme se všech. Ostatní hosté zprávu ignorují.
      if (this.hostId === null) this.sendHello(peerId);
    });
    room.onPeerLeave((peerId) => {
      if (peerId === this.hostId) this.end('hostLeft');
    });
    this.timeout = setTimeout(() => this.end('timeout'), CONNECT_TIMEOUT_MS);
  }

  get status(): GuestStatus {
    return this.statusValue;
  }

  onStatus(listener: (status: GuestStatus) => void): void {
    this.statusListener = listener;
  }

  getState(): GameState {
    if (!this.state) throw new Error('Stav hry ještě nedorazil');
    return this.state;
  }

  /** Výsledek přijde se stavem od hostitele. Neplatnou akci hostitel jen zahodí. */
  dispatch(action: Action): DispatchResult {
    this.sendToHost({ type: 'action', action });
    return { ok: true };
  }

  subscribe(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  claim(player: PlayerId): void {
    this.sendToHost({ type: 'claim', player });
  }

  leave(): void {
    this.clearTimeout();
    this.room.leave();
  }

  private sendHello(peerId: string): void {
    const hello: GuestMessage = {
      type: 'hello',
      version: PROTOCOL_VERSION,
      clientId: this.clientId,
      name: this.name,
    };
    this.room.send(hello, peerId);
  }

  private sendToHost(message: GuestMessage): void {
    if (this.hostId !== null) this.room.send(message, this.hostId);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private setStatus(status: GuestStatus): void {
    this.statusValue = status;
    this.statusListener?.(status);
  }

  private end(reason: EndReason): void {
    if (this.statusValue.kind === 'ended') return;
    this.clearTimeout();
    this.room.leave();
    this.setStatus({ kind: 'ended', reason });
  }

  private onMessage(data: unknown, peerId: string): void {
    const message = parseHostMessage(data);
    if (!message) return;
    // Hostitelem je ten, kdo odpoví první. Zprávy ostatních už nemají žádnou váhu.
    if (this.hostId === null) this.hostId = peerId;
    if (peerId !== this.hostId) return;
    this.clearTimeout();
    switch (message.type) {
      case 'lobby':
        this.state = null;
        this.setStatus({ kind: 'lobby', view: message.view });
        break;
      case 'game': {
        if (message.rev < this.rev) return;
        this.rev = message.rev;
        this.state = message.state;
        const previous = this.statusValue;
        if (message.seat === null) {
          this.setStatus({ kind: 'claim', state: message.state });
          return;
        }
        // Hráč na svém místě jen překresluje hru, stav obrazovky se nemění.
        if (previous.kind !== 'playing' || previous.seat !== message.seat) {
          this.setStatus({ kind: 'playing', seat: message.seat });
        }
        for (const listener of this.listeners) listener(message.state);
        break;
      }
      case 'rejected':
        this.end(message.reason);
        break;
      case 'closed':
        this.end('hostLeft');
        break;
    }
  }
}
