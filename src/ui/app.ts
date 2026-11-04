import { createGame } from '../core';
import type { Difficulty, Personality, PlayerSetup, WinCondition } from '../core';
import { cs } from '../i18n/cs';
import { LocalStorageProfile } from '../profile/profile';
import { escapeHtml } from './html';
import { GameScreen } from './game';

interface LobbyPrefs {
  name: string;
  bots: number;
  difficulty: Difficulty;
  win: 'last' | 'rounds' | 'money';
  rounds: number;
  money: number;
}

const DEFAULT_PREFS: LobbyPrefs = {
  name: cs.lobby.defaultName,
  bots: 3,
  difficulty: 'normal',
  win: 'last',
  rounds: 20,
  money: 5_000_000,
};

const PERSONALITIES: Personality[] = ['zralok', 'lakomec', 'kriminalnik', 'vyvazeny'];

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! | 0;
}

function pickPersonalities(count: number, seed: number): Personality[] {
  const pool = [...PERSONALITIES];
  const result: Personality[] = [];
  let value = seed >>> 0;
  for (let i = 0; i < count; i++) {
    result.push(pool.splice(value % pool.length, 1)[0]!);
    value = Math.floor(value / 7) + 13;
  }
  return result;
}

function option(value: string, label: string, selected: boolean, disabled = false): string {
  return `<option value="${value}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`;
}

export function startApp(root: HTMLElement): void {
  const profile = new LocalStorageProfile();
  let game: GameScreen | null = null;

  function showMenu(): void {
    game?.stop();
    game = null;
    root.innerHTML = `
      <main class="menu">
        <h1 class="logo">${cs.title}</h1>
        <p class="tagline">${cs.tagline}</p>
        <button class="btn primary big" data-go="lobby" data-primary>${cs.menu.solo}</button>
        <button class="btn big" disabled>${cs.menu.multiplayer} <small>(${cs.menu.soon})</small></button>
      </main>`;
    root.querySelector('[data-go="lobby"]')?.addEventListener('click', showLobby);
  }

  function showLobby(): void {
    game?.stop();
    game = null;
    const prefs = { ...DEFAULT_PREFS, ...profile.load<Partial<LobbyPrefs>>('lobby') };
    root.innerHTML = `
      <main class="menu">
        <h2>${cs.lobby.title}</h2>
        <form class="lobby" id="lobby">
          <label>${cs.lobby.name}
            <input name="name" maxlength="20" required value="${escapeHtml(prefs.name)}" />
          </label>
          <label>${cs.lobby.bots}
            <select name="bots">
              ${[1, 2, 3].map((n) => option(String(n), String(n), prefs.bots === n)).join('')}
            </select>
          </label>
          <label>${cs.lobby.difficulty}
            <select name="difficulty">
              ${(['easy', 'normal', 'hard'] as const)
                .map((d) => option(d, cs.difficulty[d], prefs.difficulty === d))
                .join('')}
            </select>
          </label>
          <label>${cs.lobby.mode}
            <select name="mode">
              ${option('classic', cs.lobby.modeClassic, true)}
              ${option('monopolis', cs.lobby.modeMonopolis, false, true)}
            </select>
          </label>
          <label>${cs.lobby.win}
            <select name="win">
              ${option('last', cs.lobby.winLast, prefs.win === 'last')}
              ${option('rounds', cs.lobby.winRounds, prefs.win === 'rounds')}
              ${option('money', cs.lobby.winMoney, prefs.win === 'money')}
            </select>
          </label>
          <label data-for="rounds">${cs.lobby.rounds}
            <input name="rounds" type="number" min="1" max="200" required value="${prefs.rounds}" />
          </label>
          <label data-for="money">${cs.lobby.money}
            <input name="money" type="number" min="1600000" step="100000" required value="${prefs.money}" />
          </label>
          <div class="row">
            <button class="btn" type="button" data-go="menu">${cs.lobby.back}</button>
            <button class="btn primary" type="submit">${cs.lobby.start}</button>
          </div>
        </form>
      </main>`;
    const form = root.querySelector<HTMLFormElement>('#lobby')!;
    const syncWinFields = () => {
      const win = new FormData(form).get('win');
      for (const field of ['rounds', 'money']) {
        const label = form.querySelector<HTMLElement>(`[data-for="${field}"]`)!;
        const visible = win === field;
        label.hidden = !visible;
        label.querySelector('input')!.disabled = !visible;
      }
    };
    syncWinFields();
    form.addEventListener('change', syncWinFields);
    root.querySelector('[data-go="menu"]')?.addEventListener('click', showMenu);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const next: LobbyPrefs = {
        name: String(data.get('name')).trim() || cs.lobby.defaultName,
        bots: Number(data.get('bots')),
        difficulty: data.get('difficulty') as Difficulty,
        win: data.get('win') as LobbyPrefs['win'],
        rounds: Number(data.get('rounds') ?? prefs.rounds),
        money: Number(data.get('money') ?? prefs.money),
      };
      profile.save('lobby', next);
      startGame(next);
    });
  }

  function startGame(prefs: LobbyPrefs): void {
    const seed = randomSeed();
    const win: WinCondition =
      prefs.win === 'rounds'
        ? { type: 'richestAfterRounds', rounds: prefs.rounds }
        : prefs.win === 'money'
          ? { type: 'firstToMoney', amount: prefs.money }
          : { type: 'lastStanding' };
    const setups: PlayerSetup[] = [
      { name: prefs.name },
      ...pickPersonalities(prefs.bots, seed).map((personality) => ({
        name: cs.botNames[personality],
        bot: { personality, difficulty: prefs.difficulty },
      })),
    ];
    const state = createGame({ mode: 'classic', win }, setups, seed);
    game = new GameScreen(root, state, 0, {
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

  showMenu();
}
