import { cs } from '../i18n/cs';
import { PLAYER_COLORS } from '../render/palette';
import { signedMoney } from './beats';
import type { Beat } from './beats';
import { tileColor } from './board';
import { character } from './characters';
import { escapeHtml } from './html';
import { icon } from './icons';

const TOAST_MS = 3200;
const MAX_TOASTS = 4;

/** Otočení kostky tak, aby k divákovi mířila daná stěna. */
const FACE_ROTATION: Record<number, [number, number]> = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function dieFace(value: number): string {
  const cells = Array.from(
    { length: 9 },
    (_, i) => `<span class="${PIPS[value]?.includes(i) ? 'dot' : ''}"></span>`,
  ).join('');
  return `<div class="die" aria-label="${value}">${cells}</div>`;
}

function cube(): string {
  const faces = [1, 2, 3, 4, 5, 6]
    .map((value) => `<div class="face face-${value}">${dieFace(value)}</div>`)
    .join('');
  return `<div class="cube">${faces}</div>`;
}

function prefersStill(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateDie(el: HTMLElement, value: number, side: -1 | 1, ms: number): void {
  const [x, y] = FACE_ROTATION[value]!;
  const final = `rotateX(${x}deg) rotateY(${y}deg)`;
  if (ms <= 0 || prefersStill()) {
    el.style.transform = final;
    return;
  }
  // Každý hod se koulí jinak. Výsledek už určila pravidla, tohle je jen divadlo.
  const spinX = (2 + Math.floor(Math.random() * 3)) * 360;
  const spinY = (2 + Math.floor(Math.random() * 3)) * 360;
  const startX = side * (340 + Math.random() * 120);
  const rot = (px: number, py: number) => `rotateX(${x + px}deg) rotateY(${y + py}deg)`;
  el.animate(
    [
      { transform: `translate3d(${startX}px, -260px, 0) ${rot(spinX, spinY)}`, offset: 0 },
      {
        transform: `translate3d(${startX * 0.45}px, 40px, 0) ${rot(spinX * 0.55, spinY * 0.6)}`,
        offset: 0.42,
      },
      {
        transform: `translate3d(${startX * 0.2}px, -70px, 0) ${rot(spinX * 0.25, spinY * 0.3)}`,
        offset: 0.66,
      },
      {
        transform: `translate3d(${startX * 0.05}px, 12px, 0) ${rot(spinX * 0.04, spinY * 0.05)}`,
        offset: 0.86,
      },
      { transform: `translate3d(0, 0, 0) ${final}`, offset: 1 },
    ],
    { duration: ms, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' },
  );
}

function sceneProp(prop: string | null): string {
  switch (prop) {
    case 'envelope':
      return `<div class="prop prop-envelope">${icon('envelope')}</div>`;
    case 'washer':
      return `<div class="prop prop-washer"><i></i></div>`;
    case 'chart':
      return `<div class="prop prop-chart">${icon('chart')}</div>`;
    case 'gavel':
      return `<div class="prop prop-gavel">${icon('hammer')}</div>`;
    case 'siren':
      return `<div class="prop-siren"><i></i><i></i></div>`;
    default:
      return '';
  }
}

export type StageFooter = { kind: 'skip' } | { kind: 'click' } | { kind: 'waiting'; name: string };

function footerHtml(footer: StageFooter): string {
  if (footer.kind === 'click') {
    return `<button class="btn primary dismiss" data-action="skipBeat">${cs.game.continue}<small>${cs.game.continueKey}</small></button>`;
  }
  const text =
    footer.kind === 'waiting' ? cs.game.waitingClick(escapeHtml(footer.name)) : cs.game.skip;
  return `<small class="skip-hint">${text}</small>`;
}

/** Vrstva nad hrou, kterou překreslování rozhraní neruší: scény, kostky a oznámení. */
export class Stage {
  private readonly scene: HTMLElement;
  private readonly toasts: HTMLElement;

  constructor(host: HTMLElement) {
    host.innerHTML = '<div class="stage-scene"></div><div class="toasts"></div>';
    this.scene = host.querySelector<HTMLElement>('.stage-scene')!;
    this.toasts = host.querySelector<HTMLElement>('.toasts')!;
  }

  clear(): void {
    this.scene.innerHTML = '';
  }

  /** `ms` je délka animace po přepočtu na tempo. `footer` je text nebo tlačítko pod scénou. */
  show(beat: Beat, ms: number, footer: StageFooter = { kind: 'skip' }): void {
    if (beat.kind === 'note') return;
    if (beat.kind === 'toast') {
      if (ms >= 0) this.toast(beat);
      return;
    }
    if (ms <= 0 || beat.kind === 'drive') {
      this.clear();
      return;
    }
    const hint = footerHtml(footer);
    switch (beat.kind) {
      case 'turn':
        this.scene.innerHTML = `
          <div class="turn-flash${beat.mine ? ' mine' : ''}" style="--c:${this.color(beat.player)};--ms:${ms}ms">
            <span>${beat.mine ? cs.game.yourTurn : cs.game.onTurn(escapeHtml(beat.name))}</span>
          </div>`;
        return;
      case 'dice':
        this.showDice(beat.dice, ms, hint);
        return;
      case 'card':
        this.scene.innerHTML = `
          <div class="scene-wrap" data-action="skipBeat">
            <div class="card-table">
              ${beat.character ? `<div class="card-char">${character(beat.character)}</div>` : ''}
              <div class="flip-card deck-${beat.deck}">
                <div class="flip-back"><span>${cs.decks[beat.deck]}</span></div>
                <div class="flip-front">
                  <strong>${cs.decks[beat.deck]}</strong>
                  <p>${beat.body}</p>
                </div>
              </div>
            </div>
            ${hint}
          </div>`;
        return;
      case 'scene': {
        const bubbles = beat.lines
          .map((line, i) => {
            const delay = i * (ms / (beat.lines.length + 0.6));
            return `<p class="bubble${i % 2 ? ' other' : ''}" style="--d:${Math.round(delay)}ms">${line}</p>`;
          })
          .join('');
        const stamp = beat.stamp
          ? `<div class="stamp ${beat.stamp.good ? 'good' : 'bad'}" style="--d:${Math.round(ms * 0.62)}ms">${beat.stamp.text}</div>`
          : '';
        this.scene.innerHTML = `
          <div class="scene-wrap" data-action="skipBeat">
            <div class="scene tone-${beat.tone}" style="--ms:${ms}ms">
              <div class="scene-char">${character(beat.character)}</div>
              <div class="scene-talk">${bubbles}</div>
              ${sceneProp(beat.prop)}
              ${stamp}
            </div>
            ${hint}
          </div>`;
        return;
      }
      case 'stamp': {
        const color = tileColor(beat.tile);
        this.scene.innerHTML = `
          <div class="scene-wrap light" data-action="skipBeat">
            <div class="mini-deed">
              <header style="background:${color.bg};color:${color.ink}">${beat.title}</header>
              <p>${escapeHtml(beat.text)}</p>
              <div class="stamp good" style="--d:${Math.round(ms * 0.2)}ms">${beat.stamp}</div>
            </div>
            ${hint}
          </div>`;
        return;
      }
      case 'banner':
        this.scene.innerHTML = `
          <div class="scene-wrap light" data-action="skipBeat">
            <div class="banner tone-${beat.tone}" style="--c:${this.color(beat.player)}">${escapeHtml(beat.text)}</div>
            ${hint}
          </div>`;
        return;
    }
  }

  private color(player: number | null): string {
    return player === null ? 'transparent' : (PLAYER_COLORS[player] ?? 'transparent');
  }

  private showDice(dice: [number, number], ms: number, hint: string): void {
    const doubles = dice[0] === dice[1];
    this.scene.innerHTML = `
      <div class="scene-wrap light" data-action="skipBeat">
        <div class="dice-roll">
          <div class="cube-slot">${cube()}</div>
          <div class="cube-slot">${cube()}</div>
          <div class="dice-result" style="--d:${Math.round(ms * 0.78)}ms">
            <b>${dice[0] + dice[1]}</b>${doubles ? `<span>${cs.game.doubles}</span>` : ''}
          </div>
        </div>
        ${hint}
      </div>`;
    const spin = Math.round(ms * 0.8);
    const cubes = this.scene.querySelectorAll<HTMLElement>('.cube');
    animateDie(cubes[0]!, dice[0], -1, spin);
    animateDie(cubes[1]!, dice[1], 1, spin);
  }

  private toast(beat: Extract<Beat, { kind: 'toast' }>): void {
    if (!beat.text) return;
    const el = document.createElement('div');
    el.className = `toast${beat.quip ? ' quip' : ''}`;
    el.style.setProperty('--c', this.color(beat.player));
    const amount =
      beat.amount === null
        ? ''
        : `<b class="${beat.amount >= 0 ? 'plus' : 'minus'}">${signedMoney(beat.amount)}</b>`;
    el.innerHTML = `${amount}<span>${escapeHtml(beat.text)}</span>`;
    this.toasts.prepend(el);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.lastElementChild?.remove();
    setTimeout(() => el.remove(), TOAST_MS);
  }
}
