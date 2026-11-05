import { showEnd } from './shell';
import type { EndOptions } from './shell';

const COUNTDOWN = 3;
/** Nejdelší krok simulace. Po zaseknutí prohlížeče se hra radši zpomalí, než aby přeskočila čas. */
const MAX_FRAME = 0.1;

/** Stisknuté klávesy, které si hra vyhradí. Ostatní dál patří prohlížeči. */
export class Keys {
  private readonly pressed = new Set<string>();
  private readonly onDown = (event: KeyboardEvent) => {
    if (!this.watched.has(event.code)) return;
    event.preventDefault();
    this.pressed.add(event.code);
  };
  private readonly onUp = (event: KeyboardEvent) => this.pressed.delete(event.code);
  private readonly onBlur = () => this.pressed.clear();

  constructor(private readonly watched: ReadonlySet<string>) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  any(...codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Co arkáda potřebuje od připravené hry. */
export interface ArcadeRound<Outcome> {
  readonly outcome: Outcome | null;
  advance(dt: number): void;
  render(dt: number): void;
  updateHud(): void;
  dispose(): void;
}

export interface ArcadeOptions<Outcome> {
  host: HTMLElement;
  signal: AbortSignal;
  /** HTML se `.mg-scene`, `.mg-hud`, `.mg-count` a panely z `shell.ts`. */
  markup: string;
  keys: ReadonlySet<string>;
  startLabel: string;
  load(root: HTMLElement, keys: Keys): Promise<ArcadeRound<Outcome>>;
  end(outcome: Outcome): EndOptions;
}

/** Společný průběh krátkých arkád: úvod, odpočet, hra, výsledek a úklid. */
export function runArcade<Outcome>(options: ArcadeOptions<Outcome>): Promise<Outcome | 'skipped'> {
  const { host, signal } = options;
  return new Promise((resolve, reject) => {
    const root = document.createElement('div');
    root.className = 'minigame';
    root.innerHTML = options.markup;
    host.append(root);
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const panelButton = (name: string) => find<HTMLButtonElement>(`[data-mg="${name}"]`);

    const keys = new Keys(options.keys);
    let round: ArcadeRound<Outcome> | null = null;
    let frame = 0;
    let finished = false;

    const cleanup = () => {
      finished = true;
      cancelAnimationFrame(frame);
      keys.dispose();
      window.removeEventListener('keydown', onEnter);
      signal.removeEventListener('abort', onAbort);
      round?.dispose();
      root.remove();
    };
    const finish = (result: Outcome | 'skipped') => {
      if (finished) return;
      cleanup();
      resolve(result);
    };
    const onAbort = () => finish('skipped');
    const onEnter = (event: KeyboardEvent) => {
      if (event.code !== 'Enter') return;
      root
        .querySelector<HTMLButtonElement>('.mg-panel:not([hidden]) .btn.primary:not(:disabled)')
        ?.click();
    };
    signal.addEventListener('abort', onAbort);
    window.addEventListener('keydown', onEnter);
    panelButton('skip').onclick = () => finish('skipped');

    const play = (active: ArcadeRound<Outcome>) => {
      find('.mg-intro').hidden = true;
      find('.mg-hud').hidden = false;
      const count = find('.mg-count');
      count.hidden = false;
      let countdown = COUNTDOWN;
      let last = performance.now();
      let ended = false;
      const tick = (now: number) => {
        if (finished) return;
        const dt = Math.min(MAX_FRAME, (now - last) / 1000);
        last = now;
        if (countdown > 0) {
          countdown -= dt;
          count.textContent = String(Math.ceil(Math.max(countdown, 0.01)));
          if (countdown <= 0) count.hidden = true;
        } else {
          active.advance(dt);
          const outcome = active.outcome;
          if (outcome !== null && !ended) {
            ended = true;
            showEnd(root, options.end(outcome));
            panelButton('resume').onclick = () => finish(outcome);
          }
        }
        active.updateHud();
        active.render(dt);
        frame = requestAnimationFrame(tick);
      };
      active.updateHud();
      frame = requestAnimationFrame(tick);
    };

    options
      .load(root, keys)
      .then((loaded) => {
        if (finished) {
          loaded.dispose();
          return;
        }
        round = loaded;
        const start = panelButton('start');
        start.disabled = false;
        start.textContent = options.startLabel;
        start.onclick = () => play(loaded);
      })
      .catch((error: unknown) => {
        if (finished) return;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
