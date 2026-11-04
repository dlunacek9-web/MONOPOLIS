import { cs, formatMoney } from '../i18n/cs';
import { GuestSession } from '../net/guest';
import type { EndReason, GuestStatus } from '../net/guest';
import { HOST_SEAT, HostSession } from '../net/host';
import { randomSeed } from '../net/match';
import type { MatchOptions } from '../net/match';
import { MAX_NAME_LENGTH, cleanName } from '../net/protocol';
import type { LobbySeat, LobbyView } from '../net/protocol';
import { CODE_LENGTH, normalizeRoomCode, randomRoomCode } from '../net/room';
import type { PeerRoom } from '../net/room';
import { joinTrysteroRoom } from '../net/trystero-room';
import type { GameTransport } from '../net/transport';
import type { GameRole } from './game';
import { escapeHtml } from './html';
import { option, readMatchFields, renderMatchFields, wireMatchFields } from './match-fields';

const CLIENT_ID_KEY = 'monopolis.clientId';
const ROOM_HASH = /^#room=(.+)$/;

export interface MultiplayerHost {
  loadName(): string;
  saveName(name: string): void;
  loadMatch(): MatchOptions;
  saveMatch(match: MatchOptions): void;
  showMenu(): void;
  stopGame(): void;
  startGame(
    transport: GameTransport,
    seat: number,
    role: GameRole,
    callbacks: { onExit: () => void; onNewGame: () => void },
  ): void;
}

export function roomCodeFromUrl(): string | null {
  const match = ROOM_HASH.exec(location.hash);
  return match ? normalizeRoomCode(match[1]!) : null;
}

function setRoomInUrl(code: string | null): void {
  const url = location.pathname + location.search + (code ? `#room=${code}` : '');
  history.replaceState(null, '', url);
}

/** Stejné ID po obnovení stránky vrátí hráči jeho místo u stolu. Každá karta má vlastní. */
function clientId(): string {
  const saved = sessionStorage.getItem(CLIENT_ID_KEY);
  if (saved) return saved;
  const created = crypto.randomUUID();
  sessionStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}

function renderSeats(seats: readonly LobbySeat[], myIndex: number | null): string {
  const labels = { host: cs.mp.seatHost, guest: cs.mp.seatGuest, bot: cs.mp.seatBot };
  return seats
    .map((seat, index) => {
      const mine = index === myIndex ? ` · ${cs.mp.you}` : '';
      return `<li class="seat seat-${seat.kind}"><strong>${escapeHtml(seat.name)}</strong><small>${labels[seat.kind] ?? ''}${mine}</small></li>`;
    })
    .join('');
}

export class MultiplayerScreens {
  private host: HostSession | null = null;
  private guest: GuestSession | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly app: MultiplayerHost,
  ) {}

  get inRoom(): boolean {
    return this.host !== null || this.guest !== null;
  }

  private leave(): void {
    this.host?.close();
    this.guest?.leave();
    this.host = null;
    this.guest = null;
    setRoomInUrl(null);
    this.app.showMenu();
  }

  showEntry(code = ''): void {
    this.root.innerHTML = `
      <main class="menu">
        <h2>${cs.mp.title}</h2>
        <form class="lobby" id="mp-entry">
          <label>${cs.lobby.name}
            <input name="name" maxlength="${MAX_NAME_LENGTH}" required value="${escapeHtml(this.app.loadName())}" />
          </label>
          ${code ? '' : `<button class="btn primary" type="button" data-go="create">${cs.mp.create}</button><p class="mp-or">${cs.mp.or}</p>`}
          <label>${cs.mp.code}
            <input name="code" class="code-input" maxlength="${CODE_LENGTH}" autocomplete="off" spellcheck="false" value="${code}" />
          </label>
          <p class="error" hidden></p>
          <div class="row">
            <button class="btn" type="button" data-go="menu">${cs.lobby.back}</button>
            <button class="btn${code ? ' primary' : ''}" type="submit">${cs.mp.join}</button>
          </div>
        </form>
      </main>`;
    const form = this.root.querySelector<HTMLFormElement>('#mp-entry')!;
    const nameOf = () => {
      const name = cleanName(String(new FormData(form).get('name')), cs.lobby.defaultName);
      this.app.saveName(name);
      return name;
    };
    this.root.querySelector('[data-go="menu"]')?.addEventListener('click', () => {
      setRoomInUrl(null);
      this.app.showMenu();
    });
    this.root.querySelector('[data-go="create"]')?.addEventListener('click', () => {
      if (form.reportValidity()) void this.createRoom(nameOf());
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = normalizeRoomCode(String(new FormData(form).get('code')));
      if (!parsed) {
        const error = form.querySelector<HTMLElement>('.error')!;
        error.textContent = cs.mp.invalidCode;
        error.hidden = false;
        return;
      }
      void this.joinRoom(parsed, nameOf());
    });
  }

  private showConnecting(): void {
    this.root.innerHTML = `
      <main class="menu">
        <h2>${cs.mp.connecting}</h2>
        <p class="tagline">${cs.mp.connectingHint}</p>
        <button class="btn" data-go="leave">${cs.mp.leave}</button>
      </main>`;
    this.root.querySelector('[data-go="leave"]')?.addEventListener('click', () => this.leave());
  }

  private showEnded(text: string): void {
    this.app.stopGame();
    this.guest = null;
    setRoomInUrl(null);
    this.root.innerHTML = `
      <main class="menu">
        <h2>${cs.mp.title}</h2>
        <p class="tagline">${text}</p>
        <button class="btn primary" data-go="menu" data-primary>${cs.mp.backToMenu}</button>
      </main>`;
    this.root
      .querySelector('[data-go="menu"]')
      ?.addEventListener('click', () => this.app.showMenu());
  }

  /** Bez připojení nebo s blokovaným síťovým kódem padne jen multiplayer, sólo běží dál. */
  private async connect(code: string): Promise<PeerRoom | null> {
    try {
      return await joinTrysteroRoom(code);
    } catch (error) {
      console.warn('Multiplayer nejde spustit.', error);
      this.showEnded(cs.mp.ended.failed);
      return null;
    }
  }

  private async createRoom(name: string): Promise<void> {
    this.showConnecting();
    const code = randomRoomCode();
    const room = await this.connect(code);
    if (!room) return;
    this.host = new HostSession(room, code, name, this.app.loadMatch());
    setRoomInUrl(code);
    this.showHostLobby();
  }

  private showHostLobby(): void {
    const host = this.host!;
    this.app.stopGame();
    this.root.innerHTML = `
      <main class="menu mp-lobby">
        <h2>${cs.mp.roomCode}</h2>
        <p class="room-code">${host.code}</p>
        <button class="btn" data-go="copy">${cs.mp.copyLink}</button>
        <div class="mp-columns">
          <section>
            <h3>${cs.mp.seatsTitle}</h3>
            <ul class="seats" id="mp-seats"></ul>
          </section>
          <section>
            <h3>${cs.mp.settingsTitle}</h3>
            <form class="lobby" id="mp-options">
              <label>${cs.mp.seats}
                <select name="seats" id="mp-seat-count"></select>
              </label>
              ${renderMatchFields(host.options)}
            </form>
          </section>
        </div>
        <div class="row">
          <button class="btn" data-go="leave">${cs.mp.leave}</button>
          <button class="btn primary" data-go="start">${cs.mp.start}</button>
        </div>
      </main>`;
    const form = this.root.querySelector<HTMLFormElement>('#mp-options')!;
    wireMatchFields(form);
    // Seznam se obnovuje zvlášť, aby příchod hráče nesmazal rozepsané nastavení.
    const refresh = () => {
      this.root.querySelector('#mp-seats')!.innerHTML = renderSeats(host.view().seats, HOST_SEAT);
      this.root.querySelector('#mp-seat-count')!.innerHTML = [2, 3, 4]
        .map((n) => option(String(n), String(n), host.options.seats === n, n < host.humanCount))
        .join('');
    };
    refresh();
    host.onChange(refresh);
    form.addEventListener('change', () => {
      host.setOptions(readMatchFields(form, host.options));
      this.app.saveMatch(host.options);
      refresh();
    });
    form.addEventListener('submit', (event) => event.preventDefault());
    const copy = this.root.querySelector<HTMLButtonElement>('[data-go="copy"]')!;
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(location.href).then(() => {
        copy.textContent = cs.mp.copied;
      });
    });
    this.root.querySelector('[data-go="leave"]')?.addEventListener('click', () => this.leave());
    this.root.querySelector('[data-go="start"]')?.addEventListener('click', () => {
      if (form.reportValidity()) this.startHostGame();
    });
  }

  private startHostGame(): void {
    const host = this.host!;
    host.onChange(() => {});
    const transport = host.startGame(randomSeed());
    this.app.startGame(transport, HOST_SEAT, 'host', {
      onExit: () => this.leave(),
      onNewGame: () => {
        host.returnToLobby();
        this.showHostLobby();
      },
    });
  }

  private async joinRoom(code: string, name: string): Promise<void> {
    this.showConnecting();
    setRoomInUrl(code);
    const room = await this.connect(code);
    if (!room) return;
    const guest = new GuestSession(room, clientId(), name);
    this.guest = guest;
    guest.onStatus((status) => this.onGuestStatus(guest, status));
  }

  private onGuestStatus(guest: GuestSession, status: GuestStatus): void {
    if (guest !== this.guest) return;
    switch (status.kind) {
      case 'connecting':
        return;
      case 'lobby':
        this.app.stopGame();
        this.showGuestLobby(status.view);
        return;
      case 'claim':
        this.showClaim(guest, status);
        return;
      case 'playing':
        this.app.startGame(guest, status.seat, 'guest', {
          onExit: () => this.leave(),
          onNewGame: () => {},
        });
        return;
      case 'ended':
        this.showEnded(this.endText(status.reason));
        return;
    }
  }

  private endText(reason: EndReason): string {
    return cs.mp.ended[reason];
  }

  private showGuestLobby(view: LobbyView): void {
    const { options } = view;
    const win =
      options.win === 'rounds'
        ? `${cs.lobby.winRounds}: ${options.rounds}`
        : options.win === 'money'
          ? `${cs.lobby.winMoney}: ${formatMoney(options.money)}`
          : cs.lobby.winLast;
    this.root.innerHTML = `
      <main class="menu mp-lobby">
        <h2>${cs.mp.roomCode}</h2>
        <p class="room-code">${escapeHtml(view.code)}</p>
        <div class="mp-columns">
          <section>
            <h3>${cs.mp.seatsTitle}</h3>
            <ul class="seats">${renderSeats(view.seats, null)}</ul>
          </section>
          <section>
            <h3>${cs.mp.settingsTitle}</h3>
            <ul class="mp-summary">
              <li>${cs.lobby.mode}: ${options.mode === 'classic' ? cs.lobby.modeClassic : cs.lobby.modeNextLevel}</li>
              <li>${cs.lobby.difficulty}: ${cs.difficulty[options.difficulty] ?? ''}</li>
              <li>${cs.lobby.startCash}: ${formatMoney(options.startCash)}</li>
              <li>${cs.lobby.win}: ${win}</li>
            </ul>
          </section>
        </div>
        <p class="waiting">${cs.mp.waitingHost}</p>
        <button class="btn" data-go="leave">${cs.mp.leave}</button>
      </main>`;
    this.root.querySelector('[data-go="leave"]')?.addEventListener('click', () => this.leave());
  }

  private showClaim(guest: GuestSession, status: Extract<GuestStatus, { kind: 'claim' }>): void {
    const buttons = status.state.players
      .filter((player) => player.bot !== null && !player.bankrupt)
      .map(
        (player) =>
          `<button class="btn" data-claim="${player.id}">${cs.mp.claim(escapeHtml(player.name))}</button>`,
      )
      .join('');
    this.root.innerHTML = `
      <main class="menu">
        <h2>${cs.mp.claimTitle}</h2>
        <p class="tagline">${cs.mp.claimText}</p>
        ${buttons}
        <button class="btn" data-go="leave">${cs.mp.leave}</button>
      </main>`;
    this.root.querySelectorAll<HTMLElement>('[data-claim]').forEach((el) => {
      el.addEventListener('click', () => guest.claim(Number(el.dataset.claim)));
    });
    this.root.querySelector('[data-go="leave"]')?.addEventListener('click', () => this.leave());
  }
}
