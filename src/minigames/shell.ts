import { cs } from '../i18n/cs';
import { character } from '../ui/characters';
import type { CharacterId } from '../ui/characters';

export interface IntroOptions {
  title: string;
  who: CharacterId;
  bubble: string;
  goal: string;
  keys: readonly { keys: readonly string[]; label: string }[];
  skipLabel: string;
}

/** Společný úvod miniher: postava, cíl, klávesy a dvě tlačítka `data-mg="start|skip"`. */
export function introPanel(o: IntroOptions): string {
  const keys = o.keys
    .map(
      (row) =>
        `<li>${row.keys.map((key) => `<kbd>${key}</kbd>`).join('')}<span>${row.label}</span></li>`,
    )
    .join('');
  return `
    <div class="mg-panel mg-intro">
      <div class="mg-char">${character(o.who)}</div>
      <div class="mg-body">
        <h2>${o.title}</h2>
        <p class="bubble still">${o.bubble}</p>
        <p class="mg-goal">${o.goal}</p>
        <ul class="mg-keys">${keys}</ul>
        <div class="mg-buttons">
          <button class="btn primary" data-mg="start" disabled>${cs.chase.loading}</button>
          <button class="btn" data-mg="skip">${o.skipLabel}</button>
        </div>
      </div>
    </div>`;
}

/** Společný závěr miniher: razítko s výsledkem a tlačítko `data-mg="resume"`. */
export function endPanel(): string {
  return `
    <div class="mg-panel mg-end" hidden>
      <div class="mg-char"></div>
      <div class="mg-body">
        <h2 class="stamp-title"></h2>
        <p></p>
        <div class="mg-buttons">
          <button class="btn primary" data-mg="resume">${cs.chase.resume}</button>
        </div>
      </div>
    </div>`;
}

/** Vyplní závěrečný panel a ukáže ho. */
export function showEnd(
  root: HTMLElement,
  options: { won: boolean; title: string; text: string; who: CharacterId },
): void {
  const panel = root.querySelector<HTMLElement>('.mg-end')!;
  panel.hidden = false;
  panel.classList.toggle('won', options.won);
  panel.querySelector<HTMLElement>('.mg-char')!.innerHTML = character(options.who);
  panel.querySelector<HTMLElement>('h2')!.textContent = options.title;
  panel.querySelector<HTMLElement>('.mg-body p')!.textContent = options.text;
}
