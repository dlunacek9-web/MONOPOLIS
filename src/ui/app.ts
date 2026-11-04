import { createGame } from '../core';
import { cs } from '../i18n/cs';
import { LocalTransport } from '../net/local';
import { DEFAULT_MATCH, matchSettings, matchSetups, randomSeed } from '../net/match';
import type { MatchOptions } from '../net/match';
import { LocalStorageProfile } from '../profile/profile';
import { GameScreen } from './game';
import type { GameRole } from './game';
import { escapeHtml } from './html';
import { option, readMatchFields, renderMatchFields, wireMatchFields } from './match-fields';
import { MultiplayerScreens, roomCodeFromUrl } from './multiplayer';
import type { GameTransport } from '../net/transport';

interface LobbyPrefs extends MatchOptions {
  name: string;
}

const DEFAULT_PREFS: LobbyPrefs = {
  ...DEFAULT_MATCH,
  name: cs.lobby.defaultName,
};

export function startApp(root: HTMLElement): void {
  const profile = new LocalStorageProfile();
  let game: GameScreen | null = null;

  function stopGame(): void {
    game?.stop();
    game = null;
  }

  function loadPrefs(): LobbyPrefs {
    return { ...DEFAULT_PREFS, ...profile.load<Partial<LobbyPrefs>>('lobby') };
  }

  const multiplayer = new MultiplayerScreens(root, {
    loadName: () => loadPrefs().name,
    saveName: (name) => profile.save('lobby', { ...loadPrefs(), name }),
    loadMatch: () => loadPrefs(),
    saveMatch: (match) => profile.save('lobby', { ...loadPrefs(), ...match }),
    showMenu,
    stopGame,
    startGame: (
      transport: GameTransport,
      seat: number,
      role: GameRole,
      callbacks: { onExit: () => void; onNewGame: () => void },
    ) => {
      stopGame();
      game = new GameScreen(root, transport, seat, callbacks, role);
    },
  });

  function showMenu(): void {
    stopGame();
    root.innerHTML = `
      <main class="menu">
        <h1 class="logo">${cs.title}</h1>
        <p class="tagline">${cs.tagline}</p>
        <button class="btn primary big" data-go="lobby" data-primary>${cs.menu.solo}</button>
        <button class="btn big" data-go="multiplayer">${cs.menu.multiplayer}</button>
      </main>`;
    root.querySelector('[data-go="lobby"]')?.addEventListener('click', showLobby);
    root
      .querySelector('[data-go="multiplayer"]')
      ?.addEventListener('click', () => multiplayer.showEntry());
  }

  function showLobby(): void {
    stopGame();
    const prefs = loadPrefs();
    const bots = Math.min(3, Math.max(1, prefs.seats - 1));
    root.innerHTML = `
      <main class="menu">
        <h2>${cs.lobby.title}</h2>
        <form class="lobby" id="lobby">
          <label>${cs.lobby.name}
            <input name="name" maxlength="20" required value="${escapeHtml(prefs.name)}" />
          </label>
          <label>${cs.lobby.bots}
            <select name="bots">
              ${[1, 2, 3].map((n) => option(String(n), String(n), bots === n)).join('')}
            </select>
          </label>
          ${renderMatchFields(prefs)}
          <div class="row">
            <button class="btn" type="button" data-go="menu">${cs.lobby.back}</button>
            <button class="btn primary" type="submit">${cs.lobby.start}</button>
          </div>
        </form>
      </main>`;
    const form = root.querySelector<HTMLFormElement>('#lobby')!;
    wireMatchFields(form);
    root.querySelector('[data-go="menu"]')?.addEventListener('click', showMenu);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const next: LobbyPrefs = {
        ...readMatchFields(form, prefs),
        seats: Number(data.get('bots')) + 1,
        name: String(data.get('name')).trim() || cs.lobby.defaultName,
      };
      profile.save('lobby', next);
      startSolo(next);
    });
  }

  function startSolo(prefs: LobbyPrefs): void {
    const seed = randomSeed();
    const state = createGame(matchSettings(prefs), matchSetups([prefs.name], prefs, seed), seed);
    game = new GameScreen(root, new LocalTransport(state), 0, {
      onExit: showMenu,
      onNewGame: showLobby,
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea, button, a')) return;
    // Otevřený dialog překrývá hru, takže klávesa nesmí zmáčknout tlačítko pod ním.
    const scope = root.querySelector('.overlay') ?? root;
    const primary = scope.querySelector<HTMLButtonElement>('[data-primary]:not(:disabled)');
    if (primary) {
      event.preventDefault();
      primary.click();
    }
  });

  // Odkaz od kamaráda vede rovnou na připojení do jeho místnosti.
  const invited = roomCodeFromUrl();
  if (invited) multiplayer.showEntry(invited);
  else showMenu();

  // Odkaz vložený do už otevřené karty stránku nenačte znovu. Běžící partii nepřeruší.
  window.addEventListener('hashchange', () => {
    const code = roomCodeFromUrl();
    if (code && !game && !multiplayer.inRoom) multiplayer.showEntry(code);
  });
}
