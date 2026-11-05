import { BUSINESS, type Action, type PlayerId } from '../../core';
import { cs } from '../../i18n/cs';
import { runArcade } from '../arcade';
import type { Keys } from '../arcade';
import { endPanel, introPanel } from '../shell';
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
function keyboardController(keys: Keys): CarController {
  return (): CarInput => ({
    throttle: (keys.any('KeyW', 'ArrowUp') ? 1 : 0) - (keys.any('KeyS', 'ArrowDown') ? 1 : 0),
    steer: (keys.any('KeyA', 'ArrowLeft') ? 1 : 0) - (keys.any('KeyD', 'ArrowRight') ? 1 : 0),
    drift: keys.any('Space'),
    nitro: keys.any('ShiftLeft', 'ShiftRight'),
  });
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

function updateHud(root: HTMLElement, sim: ChaseSim): void {
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  find('.mg-timer').textContent = sim.timeLeft.toFixed(1);
  find('.mg-timer').classList.toggle('low', sim.timeLeft < 10);
  find('.mg-nitro i').style.setProperty('--v', String(sim.nitro));
  find('.mg-speed b').textContent = String(Math.round(sim.runner.speed * SPEED_TO_KMH));
  const arrest = find('.mg-arrest');
  arrest.hidden = sim.arrest <= 0;
  find('.mg-arrest i').style.setProperty('--v', String(sim.arrest));
  drawMinimap(find<HTMLCanvasElement>('.mg-map'), sim);
}

/** Jedno spuštění honičky: úvod, odpočet, jízda a výsledek. */
function run({ host, input, signal }: MinigameContext<ChaseInput>): Promise<ChaseResult> {
  return runArcade<ChaseOutcome>({
    host,
    signal,
    markup: hudMarkup(),
    keys: KEYS,
    startLabel: cs.chase.start,
    load: async (root, keys) => {
      const rapier = await loadRapier();
      const map = createMap(input.seed);
      const sim = new ChaseSim({
        rapier,
        seed: input.seed,
        runner: keyboardController(keys),
        police: perCar(policeController),
        traffic: trafficController(map, input.seed),
      });
      const view = new ChaseView(root.querySelector<HTMLElement>('.mg-scene')!, sim, input.color);
      view.render(0);
      return {
        get outcome() {
          return sim.outcome;
        },
        advance: (dt) => sim.advance(dt),
        render: (dt) => view.render(dt),
        updateHud: () => updateHud(root, sim),
        dispose: () => {
          view.dispose();
          sim.free();
        },
      };
    },
    end: (outcome) => {
      const t = cs.chase;
      const won = outcome === 'escaped';
      return {
        won,
        title: won ? t.escaped : t.caught,
        text: won ? t.escapedText : t.caughtText,
        who: 'cop',
      };
    },
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
