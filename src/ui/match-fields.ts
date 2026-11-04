import { cs, formatMoney } from '../i18n/cs';
import { START_CASH_CHOICES } from '../net/match';
import type { MatchOptions } from '../net/match';
import { escapeHtml } from './html';

export function option(value: string, label: string, selected: boolean, disabled = false): string {
  return `<option value="${value}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`;
}

/** Pole nastavení partie společná pro sólo a multiplayer. */
export function renderMatchFields(prefs: MatchOptions): string {
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
        ${option('classic', cs.lobby.modeClassic, true)}
        ${option('monopolis', cs.lobby.modeMonopolis, false, true)}
      </select>
    </label>
    <label>${cs.lobby.startCash}
      <select name="startCash">
        ${START_CASH_CHOICES.map((cash) =>
          option(String(cash), formatMoney(cash), prefs.startCash === cash),
        ).join('')}
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
  sync();
  form.addEventListener('change', sync);
}

/** Skrytá pole ve formuláři chybí, proto si nechávají předchozí hodnotu. */
export function readMatchFields(form: HTMLFormElement, previous: MatchOptions): MatchOptions {
  const data = new FormData(form);
  return {
    seats: Number(data.get('seats') ?? previous.seats),
    difficulty: data.get('difficulty') as MatchOptions['difficulty'],
    win: data.get('win') as MatchOptions['win'],
    rounds: Number(data.get('rounds') ?? previous.rounds),
    money: Number(data.get('money') ?? previous.money),
    startCash: Number(data.get('startCash')),
  };
}
