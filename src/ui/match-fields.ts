import { cs, formatMoney } from '../i18n/cs';
import { ARCHETYPES, DEFAULT_MATCH, MODE_MONEY, normalizeMatch } from '../net/match';
import type { MatchOptions } from '../net/match';
import { escapeHtml } from './html';

export function option(value: string, label: string, selected: boolean, disabled = false): string {
  return `<option value="${value}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`;
}

function startCashOptions(prefs: MatchOptions): string {
  return MODE_MONEY[prefs.mode].startCashChoices
    .map((cash) => option(String(cash), formatMoney(cash), prefs.startCash === cash))
    .join('');
}

/** Pole nastavení partie společná pro sólo a multiplayer. */
export function renderMatchFields(options: MatchOptions): string {
  const prefs = normalizeMatch(options);
  const money = MODE_MONEY[prefs.mode];
  return `
    <label>${cs.lobby.difficulty}
      <select name="difficulty">
        ${(['easy', 'normal', 'hard'] as const)
          .map((d) => option(d, cs.difficulty[d], prefs.difficulty === d))
          .join('')}
      </select>
    </label>
    <label>${cs.lobby.mode}
      <select name="mode">
        ${option('classic', cs.lobby.modeClassic, prefs.mode === 'classic')}
        ${option('nextlevel', cs.lobby.modeNextLevel, prefs.mode === 'nextlevel')}
      </select>
    </label>
    <p class="mode-hint" data-mode-hint>${prefs.mode === 'classic' ? cs.lobby.modeHintClassic : cs.lobby.modeHintNextLevel}</p>
    <label data-archetype${prefs.mode === 'classic' ? ' hidden' : ''}>${cs.lobby.archetype}
      <select name="archetype">
        ${option('random', cs.lobby.archetypeRandom, prefs.archetype === 'random')}
        ${ARCHETYPES.map((a) => option(a, `${cs.archetypes[a].name}: ${cs.archetypes[a].perk}`, prefs.archetype === a)).join('')}
      </select>
    </label>
    <label>${cs.lobby.startCash}
      <select name="startCash">
        ${startCashOptions(prefs)}
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
      <input name="money" type="number" min="${prefs.startCash + money.step}" step="${money.step}" required value="${prefs.money}" />
    </label>`;
}

/** Ukazuje jen ta pole, která patří k vybrané podmínce výhry. */
export function wireMatchFields(form: HTMLFormElement): void {
  const sync = () => {
    const win = new FormData(form).get('win');
    for (const field of ['rounds', 'money']) {
      const label = form.querySelector<HTMLElement>(`[data-for="${field}"]`)!;
      const visible = win === field;
      label.hidden = !visible;
      label.querySelector('input')!.disabled = !visible;
    }
  };
  // Po přepnutí režimu se částky přepočítají na měřítko nového režimu.
  const syncMode = () => {
    const mode = new FormData(form).get('mode') === 'classic' ? 'classic' : 'nextlevel';
    const defaults = MODE_MONEY[mode];
    const cash = form.querySelector<HTMLSelectElement>('[name="startCash"]')!;
    cash.innerHTML = startCashOptions({ ...DEFAULT_MATCH, mode, startCash: defaults.startCash });
    const money = form.querySelector<HTMLInputElement>('[name="money"]')!;
    money.min = String(defaults.startCash + defaults.step);
    money.step = String(defaults.step);
    money.value = String(defaults.money);
    form.querySelector<HTMLElement>('[data-archetype]')!.hidden = mode === 'classic';
    form.querySelector('[data-mode-hint]')!.textContent =
      mode === 'classic' ? cs.lobby.modeHintClassic : cs.lobby.modeHintNextLevel;
  };
  sync();
  form.addEventListener('change', (event) => {
    if ((event.target as HTMLElement).getAttribute('name') === 'mode') syncMode();
    sync();
  });
}

/** Skrytá pole ve formuláři chybí, proto si nechávají předchozí hodnotu. */
export function readMatchFields(form: HTMLFormElement, previous: MatchOptions): MatchOptions {
  const data = new FormData(form);
  return normalizeMatch({
    mode: data.get('mode') === 'classic' ? 'classic' : 'nextlevel',
    seats: Number(data.get('seats') ?? previous.seats),
    difficulty: data.get('difficulty') as MatchOptions['difficulty'],
    win: data.get('win') as MatchOptions['win'],
    rounds: Number(data.get('rounds') ?? previous.rounds),
    money: Number(data.get('money') ?? previous.money),
    startCash: Number(data.get('startCash')),
    archetype: data.get('archetype') as MatchOptions['archetype'],
  });
}
