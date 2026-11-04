import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorOf, createGame, reduce } from '../core';
import type { GameState } from '../core';
import { chooseBotAction } from '../bots/bot';
import { CONNECT_TIMEOUT_MS, GuestSession } from './guest';
import { HOST_SEAT, HostSession, RECONNECT_GRACE_MS } from './host';
import { DEFAULT_MATCH, matchSettings, matchSetups } from './match';
import { PROTOCOL_VERSION, parseGuestMessage } from './protocol';
import type { PeerRoom } from './room';
import { normalizeRoomCode, randomRoomCode } from './room';

/** Místnost v paměti: doručuje stejně jako síť, jen okamžitě a přes JSON. */
class FakeNetwork {
  private readonly rooms = new Map<string, FakeRoom>();

  join(id: string): FakeRoom {
    const room = new FakeRoom(id, this);
    for (const other of this.rooms.values()) {
      room.addPeer(other.id);
      other.addPeer(id);
    }
    this.rooms.set(id, room);
    return room;
  }

  /** Spojí všechny nově příchozí. Zvlášť, aby se stihly nastavit posluchače. */
  flushJoins(): void {
    for (const room of this.rooms.values()) room.flushJoins();
  }

  remove(id: string): void {
    this.rooms.delete(id);
    for (const other of this.rooms.values()) other.peerLeft(id);
  }

  deliver(from: string, to: string, message: unknown): void {
    this.rooms.get(to)?.receive(JSON.parse(JSON.stringify(message)), from);
  }

  peers(except: string): string[] {
    return [...this.rooms.keys()].filter((id) => id !== except);
  }
}

class FakeRoom implements PeerRoom {
  private handler: (message: unknown, peerId: string) => void = () => {};
  private joinHandler: (peerId: string) => void = () => {};
  private leaveHandler: (peerId: string) => void = () => {};
  private pendingJoins: string[] = [];

  constructor(
    readonly id: string,
    private readonly network: FakeNetwork,
  ) {}

  addPeer(id: string): void {
    this.pendingJoins.push(id);
  }

  flushJoins(): void {
    const joins = this.pendingJoins;
    this.pendingJoins = [];
    for (const id of joins) this.joinHandler(id);
  }

  peerLeft(id: string): void {
    this.leaveHandler(id);
  }

  receive(message: unknown, from: string): void {
    this.handler(message, from);
  }

  send(message: unknown, peerId?: string): void {
    const targets = peerId === undefined ? this.network.peers(this.id) : [peerId];
    for (const target of targets) this.network.deliver(this.id, target, message);
  }

  onMessage(handler: (message: unknown, peerId: string) => void): void {
    this.handler = handler;
  }

  onPeerJoin(handler: (peerId: string) => void): void {
    this.joinHandler = handler;
  }

  onPeerLeave(handler: (peerId: string) => void): void {
    this.leaveHandler = handler;
  }

  leave(): void {
    this.network.remove(this.id);
  }
}

function setupHost(network: FakeNetwork, seats = 4): HostSession {
  return new HostSession(network.join('host'), 'ABCDEF', 'Host', { ...DEFAULT_MATCH, seats });
}

function joinGuest(
  network: FakeNetwork,
  id: string,
  name = id,
  clientId = `c-${id}`,
): GuestSession {
  const guest = new GuestSession(network.join(id), clientId, name);
  network.flushJoins();
  return guest;
}

function actorState(state: GameState): number {
  const actor = actorOf(state);
  if (actor === null) throw new Error('Nikdo není na tahu');
  return actor;
}

describe('multiplayer: lobby', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('host vidí hostitele a volná místa pro boty', () => {
    const network = new FakeNetwork();
    const host = setupHost(network);
    const guest = joinGuest(network, 'a', 'Anna');
    expect(guest.status.kind).toBe('lobby');
    if (guest.status.kind !== 'lobby') return;
    expect(guest.status.view.seats.map((seat) => seat.kind)).toEqual([
      'host',
      'guest',
      'bot',
      'bot',
    ]);
    expect(guest.status.view.seats[1]!.name).toBe('Anna');
    expect(host.humanCount).toBe(2);
  });

  it('počet míst nejde snížit pod počet připojených lidí', () => {
    const network = new FakeNetwork();
    const host = setupHost(network);
    joinGuest(network, 'a');
    joinGuest(network, 'b');
    host.setOptions({ ...DEFAULT_MATCH, seats: 2 });
    expect(host.options.seats).toBe(3);
  });

  it('pátého člověka hostitel odmítne', () => {
    const network = new FakeNetwork();
    setupHost(network);
    joinGuest(network, 'a');
    joinGuest(network, 'b');
    joinGuest(network, 'c');
    const late = joinGuest(network, 'd');
    expect(late.status).toEqual({ kind: 'ended', reason: 'full' });
  });

  it('jiná verze protokolu se nepřipojí', () => {
    const network = new FakeNetwork();
    setupHost(network);
    const room = network.join('old');
    const seen: unknown[] = [];
    room.onMessage((message) => seen.push(message));
    room.send(
      { type: 'hello', version: PROTOCOL_VERSION + 1, clientId: 'x', name: 'Starý' },
      'host',
    );
    expect(seen).toEqual([{ type: 'rejected', reason: 'version' }]);
  });

  it('když se hostitel neozve, host dostane srozumitelnou chybu', () => {
    const network = new FakeNetwork();
    const guest = new GuestSession(network.join('a'), 'c-a', 'Anna');
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(guest.status).toEqual({ kind: 'ended', reason: 'timeout' });
  });

  it('odchod z lobby uvolní místo', () => {
    const network = new FakeNetwork();
    const host = setupHost(network);
    const guest = joinGuest(network, 'a');
    guest.leave();
    expect(host.humanCount).toBe(1);
    expect(host.view().seats.map((seat) => seat.kind)).toEqual(['host', 'bot', 'bot', 'bot']);
  });
});

describe('multiplayer: partie', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function started(seats = 3) {
    const network = new FakeNetwork();
    const host = setupHost(network, seats);
    const anna = joinGuest(network, 'a', 'Anna');
    const transport = host.startGame(7);
    return { network, host, anna, transport };
  }

  /** Odehraje akce za všechny ostatní, dokud není na řadě `seat`. */
  function advanceTo(transport: ReturnType<HostSession['startGame']>, seat: number): void {
    for (let i = 0; i < 2000; i++) {
      const state = transport.getState();
      const actor = actorState(state);
      if (actor === seat) return;
      transport.dispatch(chooseBotAction(state, actor));
    }
    throw new Error('Hráč se nedostal na tah');
  }

  it('host dostane stav a své místo', () => {
    const { anna, transport } = started();
    expect(anna.status).toEqual({ kind: 'playing', seat: 1 });
    expect(anna.getState()).toEqual(transport.getState());
    const players = transport.getState().players;
    expect(players[0]!.bot).toBeNull();
    expect(players[1]!.bot).toBeNull();
    expect(players[1]!.name).toBe('Anna');
    expect(players[2]!.bot).not.toBeNull();
  });

  it('akce hosta projde přes hostitele a vrátí se všem', () => {
    const { anna, transport } = started();
    advanceTo(transport, 1);
    const updates: GameState[] = [];
    anna.subscribe((state) => updates.push(state));
    anna.dispatch({ type: 'roll', player: 1 });
    expect(updates.length).toBeGreaterThan(0);
    expect(anna.getState()).toEqual(transport.getState());
    expect(transport.getState().lastRoll).not.toBeNull();
  });

  it('host nemůže hrát za někoho jiného', () => {
    const { anna, transport } = started();
    advanceTo(transport, HOST_SEAT);
    const before = transport.getState();
    anna.dispatch({ type: 'roll', player: HOST_SEAT });
    expect(transport.getState()).toBe(before);
  });

  it('host neprosadí zakázanou akci ani změnu místa', () => {
    expect(
      parseGuestMessage({
        type: 'action',
        action: { type: 'setController', player: 1, name: 'x', bot: null },
      }),
    ).toBeNull();
    expect(
      parseGuestMessage({ type: 'action', action: { type: 'build', player: 1, tile: 999 } }),
    ).toBeNull();
    expect(
      parseGuestMessage({ type: 'action', action: { type: 'bid', player: 1, amount: -5 } }),
    ).toBeNull();
    expect(
      parseGuestMessage({
        type: 'action',
        action: {
          type: 'proposeTrade',
          player: 1,
          offer: { to: 0, give: { tiles: [1, 1], cash: 0, jailCards: 0 }, get: {} },
        },
      }),
    ).toBeNull();
    expect(parseGuestMessage('nesmysl')).toBeNull();
  });

  it('po výpadku začne hrát bot, až po uplynutí lhůty', () => {
    const { network, transport } = started();
    network.remove('a');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    expect(transport.getState().players[1]!.bot).toBeNull();
    vi.advanceTimersByTime(1);
    const player = transport.getState().players[1]!;
    expect(player.bot).toEqual({ personality: 'vyvazeny', difficulty: 'normal' });
    expect(player.name).toBe('Anna');
  });

  it('návrat v rámci lhůty bota vůbec nespustí', () => {
    const { network, transport } = started();
    network.remove('a');
    vi.advanceTimersByTime(1000);
    const back = joinGuest(network, 'a2', 'Anna', 'c-a');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(transport.getState().players[1]!.bot).toBeNull();
    expect(back.status).toEqual({ kind: 'playing', seat: 1 });
  });

  it('po pozdním návratu dostane hráč své místo zpátky od bota', () => {
    const { network, transport } = started();
    network.remove('a');
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    const back = joinGuest(network, 'a2', 'Anna', 'c-a');
    expect(transport.getState().players[1]!.bot).toBeNull();
    expect(back.status).toEqual({ kind: 'playing', seat: 1 });
    expect(back.getState()).toEqual(transport.getState());
  });

  it('nový člověk za běhu převezme bota', () => {
    const { network, transport } = started();
    const bob = joinGuest(network, 'b', 'Bob');
    expect(bob.status.kind).toBe('claim');
    bob.claim(2);
    expect(bob.status).toEqual({ kind: 'playing', seat: 2 });
    const player = transport.getState().players[2]!;
    expect(player.bot).toBeNull();
    expect(player.name).toBe('Bob');
    expect(transport.getState().events.at(-1)).toMatchObject({ type: 'controller', bot: false });
  });

  it('člověka nejde převzít a dva lidé nedostanou stejného bota', () => {
    const { network, transport } = started();
    const bob = joinGuest(network, 'b', 'Bob');
    bob.claim(0);
    expect(bob.status.kind).toBe('claim');
    expect(transport.getState().players[0]!.bot).toBeNull();
    const cyril = joinGuest(network, 'c', 'Cyril');
    bob.claim(2);
    cyril.claim(2);
    expect(bob.status).toEqual({ kind: 'playing', seat: 2 });
    expect(cyril.status.kind).toBe('claim');
  });

  it('když už není koho převzít, nováček se nedostane dovnitř', () => {
    const network = new FakeNetwork();
    const host = setupHost(network, 2);
    joinGuest(network, 'a');
    host.startGame(7);
    const late = joinGuest(network, 'b');
    expect(late.status).toEqual({ kind: 'ended', reason: 'full' });
  });

  it('když hostitel odejde, hostům to hra řekne', () => {
    const { host, anna } = started();
    host.close();
    expect(anna.status).toEqual({ kind: 'ended', reason: 'hostLeft' });
  });

  it('hosté neumějí podvrhnout stav za hostitele', () => {
    const { network, anna, transport } = started();
    const rogue = network.join('rogue');
    network.flushJoins();
    rogue.send({ type: 'closed' }, 'a');
    rogue.send({ type: 'game', rev: 9999, state: { hacked: true }, seat: 0 }, 'a');
    expect(anna.status).toEqual({ kind: 'playing', seat: 1 });
    expect(anna.getState()).toEqual(transport.getState());
  });

  it('návrat do lobby vrátí hosty do čekárny', () => {
    const { host, anna } = started();
    host.returnToLobby();
    expect(anna.status.kind).toBe('lobby');
  });

  it('v lobby po partii nezůstane hráč, který vypadl, a nezapnou se jeho boti', () => {
    const { network, host, transport } = started();
    network.remove('a');
    host.returnToLobby();
    expect(host.humanCount).toBe(1);
    expect(host.view().seats.filter((seat) => seat.kind === 'guest')).toEqual([]);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(transport.getState().players[1]!.bot).toBeNull();
  });

  it('celá partie hostitele a hosta s botem doběhne a stavy se shodují', () => {
    const network = new FakeNetwork();
    const host = setupHost(network, 3);
    const anna = joinGuest(network, 'a', 'Anna');
    host.setOptions({ ...DEFAULT_MATCH, seats: 3, win: 'rounds', rounds: 8 });
    const transport = host.startGame(11);
    for (let i = 0; i < 20_000 && transport.getState().phase !== 'gameOver'; i++) {
      const state = transport.getState();
      const actor = actorState(state);
      const action = chooseBotAction(state, actor);
      if (actor === 1) anna.dispatch(action);
      else transport.dispatch(action);
    }
    expect(transport.getState().phase).toBe('gameOver');
    expect(anna.getState()).toEqual(transport.getState());
  });
});

describe('nastavení partie', () => {
  it('počáteční hotovost platí pro všechny hráče', () => {
    const options = { ...DEFAULT_MATCH, seats: 3, startCash: 2_000_000 };
    const state = createGame(matchSettings(options), matchSetups(['A'], options, 5), 5);
    expect(state.players.map((p) => p.cash)).toEqual([2_000_000, 2_000_000, 2_000_000]);
    expect(state.players.filter((p) => p.bot).length).toBe(2);
  });

  it('cíl pod počáteční hotovostí se zvedne nad ni', () => {
    const options = {
      ...DEFAULT_MATCH,
      startCash: 2_000_000,
      win: 'money' as const,
      money: 1_600_000,
    };
    expect(matchSettings(options).win).toEqual({ type: 'firstToMoney', amount: 2_100_000 });
  });

  it('boti mají různé osobnosti', () => {
    const setups = matchSetups(['A'], { ...DEFAULT_MATCH, seats: 4 }, 123);
    const personalities = setups.flatMap((setup) => (setup.bot ? [setup.bot.personality] : []));
    expect(new Set(personalities).size).toBe(3);
  });
});

describe('kód místnosti', () => {
  it('náhodný kód projde kontrolou', () => {
    const code = randomRoomCode();
    expect(normalizeRoomCode(code.toLowerCase())).toBe(code);
  });

  it('nesmyslný kód neprojde', () => {
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode('O0I1LL')).toBeNull();
  });
});

describe('převzetí místa v pravidlech', () => {
  it('bankrotující ani skončená hra místo nemění', () => {
    const state = createGame(matchSettings(DEFAULT_MATCH), [{ name: 'A' }, { name: 'B' }], 1);
    state.players[1]!.bankrupt = true;
    expect(() =>
      reduce(state, { type: 'setController', player: 1, name: 'C', bot: null }),
    ).toThrow();
  });

  it('převzetí změní jméno a řízení, peníze zůstanou', () => {
    const state = createGame(matchSettings(DEFAULT_MATCH), [{ name: 'A' }, { name: 'B' }], 1);
    const next = reduce(state, {
      type: 'setController',
      player: 1,
      name: 'C',
      bot: { personality: 'zralok', difficulty: 'easy' },
    });
    expect(next.players[1]).toMatchObject({
      name: 'C',
      bot: { personality: 'zralok', difficulty: 'easy' },
      cash: state.players[1]!.cash,
    });
    expect(next.events.at(-1)).toMatchObject({ type: 'controller', previous: 'B', bot: true });
  });
});
