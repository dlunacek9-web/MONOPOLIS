import { BUSINESS, type Action, type PlayerId } from '../../core';
import { cs } from '../../i18n/cs';
import { endPanel, introPanel, showEnd as showEndPanel } from '../shell';
import type { Minigame, MinigameContext } from '../types';
import { perCar, policeController, trafficController } from './ai';
import { BOUND, GRID, PITCH, ROAD, createMap } from './map';
import { ChaseSim } from './sim';
import type { CarController, CarInput, ChaseOutcome, Rapier } from './sim';
import { ChaseView } from './view';

export interface ChaseInput {
  player: PlayerId;
  seed: number;
  color: string;
}

export type ChaseResult = ChaseOutcome | 'skipped';

const COUNTDOWN = 3;
/** Metry za sekundu na km/h a kousek navíc, ať rychlost na tachometru vypadá arkádově. */
const SPEED_TO_KMH = 5.5;
const KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
]);

/** Klávesnice člověka jako běžný ovladač auta. */
class Keyboard {
  private readonly pressed = new Set<string>();
  private readonly onDown = (event: KeyboardEvent) => {
    if (!KEYS.has(event.code)) return;
    event.preventDefault();
    this.pressed.add(event.code);
  };
  private readonly onUp = (event: KeyboardEvent) => this.pressed.delete(event.code);
  private readonly onBlur = () => this.pressed.clear();

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private any(...codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  readonly controller: CarController = (): CarInput => ({
    throttle: (this.any('KeyW', 'ArrowUp') ? 1 : 0) - (this.any('KeyS', 'ArrowDown') ? 1 : 0),
    steer: (this.any('KeyA', 'ArrowLeft') ? 1 : 0) - (this.any('KeyD', 'ArrowRight') ? 1 : 0),
    drift: this.any('Space'),
    nitro: this.any('ShiftLeft', 'ShiftRight'),
  });

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

let rapierLoad: Promise<Rapier> | null = null;

/** Rapier je velký, načítá se až při první honičce. Je součástí hry, internet nepotřebuje. */
function loadRapier(): Promise<Rapier> {
  rapierLoad ??= import('@dimforge/rapier3d-compat').then(async (module) => {
    const rapier = module.default;
    await rapier.init();
    return rapier;
  });
  return rapierLoad;
}

function drawMinimap(canvas: HTMLCanvasElement, sim: ChaseSim): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  const scale = size / ((BOUND + 3) * 2);
  // Kamera se dívá po ose +z, proto je mapa zrcadlená: vlevo na mapě je vlevo od startu.
  const px = (x: number) => size / 2 - x * scale;
  const pz = (z: number) => size / 2 - z * scale;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#00000059';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff55';
  const span = (GRID * PITCH) / 2;
  for (let line = 0; line <= GRID; line++) {
    const at = line * PITCH - span;
    ctx.fillRect(px(span), pz(at) - (ROAD * scale) / 2, span * 2 * scale, ROAD * scale);
    ctx.fillRect(px(at) - (ROAD * scale) / 2, pz(span), ROAD * scale, span * 2 * scale);
  }
  ctx.fillStyle = '#ff3b3b';
  for (const barricade of sim.map.barricades) {
    ctx.fillRect(px(barricade.x) - 2, pz(barricade.z) - 2, 4, 4);
  }
  ctx.fillStyle = '#2ee6b6';
  ctx.beginPath();
  ctx.arc(px(sim.goal.x), pz(sim.goal.z), 6, 0, Math.PI * 2);
  ctx.fill();
  for (const car of sim.cars) {
    if (car.kind !== 'police') continue;
    ctx.fillStyle = car.stunned > 0 ? '#ffffff' : '#3d7bff';
    ctx.fillRect(px(car.x) - 3, pz(car.z) - 3, 6, 6);
  }
  const { runner } = sim;
  ctx.save();
  ctx.translate(px(runner.x), pz(runner.z));
  ctx.rotate(Math.PI - runner.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.5, 5);
  ctx.lineTo(-4.5, 5);
  ctx.fill();
  ctx.restore();
}

const SKIP_LABEL = () => cs.chase.skip(BUSINESS?.chase.autoEscapePct ?? 0);

function hudMarkup(): string {
  const t = cs.chase;
  return `
    <div class="mg-scene"></div>
    <div class="mg-hud" hidden>
      <div class="mg-timer"></div>
      <div class="mg-arrest" hidden><span>${t.busted}</span><i></i></div>
      <canvas class="mg-map" width="200" height="200"></canvas>
      <div class="mg-nitro"><span>${t.nitro}</span><i></i></div>
      <div class="mg-speed"><b></b><small>${t.unit}</small></div>
    </div>
    <div class="mg-count" hidden></div>
    ${introPanel({
      title: t.introTitle,
      who: 'cop',
      bubble: t.introBubble,
      goal: t.introGoal,
      keys: t.introKeys,
      skipLabel: SKIP_LABEL(),
    })}
    ${endPanel()}`;
}

/** Jedno spuštění honičky: úvod, odpočet, jízda a výsledek. */
function run({ host, input, signal }: MinigameContext<ChaseInput>): Promise<ChaseResult> {
  return new Promise<ChaseResult>((resolve, reject) => {
    const root = document.createElement('div');
    root.className = 'minigame';
    root.innerHTML = hudMarkup();
    host.append(root);
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

    const keyboard = new Keyboard();
    let sim: ChaseSim | null = null;
    let view: ChaseView | null = null;
    let frame = 0;
    let finished = false;

    const cleanup = () => {
      finished = true;
      cancelAnimationFrame(frame);
      keyboard.dispose();
      window.removeEventListener('keydown', onEnter);
      signal.removeEventListener('abort', onAbort);
      view?.dispose();
      sim?.free();
      root.remove();
    };
    const finish = (result: ChaseResult) => {
      if (finished) return;
      cleanup();
      resolve(result);
    };
    const onAbort = () => finish('skipped');
    signal.addEventListener('abort', onAbort);

    const panelButton = (name: string) => find<HTMLButtonElement>(`[data-mg="${name}"]`);
    const onEnter = (event: KeyboardEvent) => {
      if (event.code !== 'Enter') return;
      const panel = root.querySelector<HTMLButtonElement>(
        '.mg-panel:not([hidden]) .btn.primary:not(:disabled)',
      );
      panel?.click();
    };
    window.addEventListener('keydown', onEnter);

    panelButton('skip').onclick = () => finish('skipped');

    const updateHud = (active: ChaseSim) => {
      find('.mg-timer').textContent = active.timeLeft.toFixed(1);
      find('.mg-timer').classList.toggle('low', active.timeLeft < 10);
      find('.mg-nitro i').style.setProperty('--v', String(active.nitro));
      find('.mg-speed b').textContent = String(Math.round(active.runner.speed * SPEED_TO_KMH));
      const arrest = find('.mg-arrest');
      arrest.hidden = active.arrest <= 0;
      find('.mg-arrest i').style.setProperty('--v', String(active.arrest));
      drawMinimap(find<HTMLCanvasElement>('.mg-map'), active);
    };

    const showEnd = (outcome: ChaseOutcome) => {
      const t = cs.chase;
      const won = outcome === 'escaped';
      showEndPanel(root, {
        won,
        title: won ? t.escaped : t.caught,
        text: won ? t.escapedText : t.caughtText,
        who: 'cop',
      });
      panelButton('resume').onclick = () => finish(outcome);
    };

    const play = (activeSim: ChaseSim, activeView: ChaseView) => {
      find('.mg-intro').hidden = true;
      find('.mg-hud').hidden = false;
      const count = find('.mg-count');
      count.hidden = false;
      let countdown = COUNTDOWN;
      let last = performance.now();
      let ended = false;
      const tick = (now: number) => {
        if (finished) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (countdown > 0) {
          countdown -= dt;
          count.textContent = String(Math.ceil(Math.max(countdown, 0.01)));
          if (countdown <= 0) count.hidden = true;
        } else {
          activeSim.advance(dt);
          if (activeSim.outcome && !ended) {
            ended = true;
            showEnd(activeSim.outcome);
          }
        }
        updateHud(activeSim);
        activeView.render(dt);
        frame = requestAnimationFrame(tick);
      };
      updateHud(activeSim);
      frame = requestAnimationFrame(tick);
    };

    void loadRapier()
      .then((rapier) => {
        if (finished) return;
        const map = createMap(input.seed);
        sim = new ChaseSim({
          rapier,
          seed: input.seed,
          runner: keyboard.controller,
          police: perCar(policeController),
          traffic: trafficController(map, input.seed),
        });
        view = new ChaseView(find('.mg-scene'), sim, input.color);
        view.render(0);
        const start = panelButton('start');
        start.disabled = false;
        start.textContent = cs.chase.start;
        start.onclick = () => play(sim!, view!);
      })
      .catch((error: unknown) => {
        if (finished) return;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

export const chaseMinigame: Minigame<ChaseInput, ChaseResult> = {
  id: 'chase',
  start: run,
  autoResolve: (input): Action => ({ type: 'chaseSkip', player: input.player }),
  resultAction: (input, result): Action =>
    result === 'skipped'
      ? { type: 'chaseSkip', player: input.player }
      : { type: 'chaseResult', player: input.player, escaped: result === 'escaped' },
};
