import { BUSINESS, type Action, type PlayerId } from '../../core';
import { cs, formatMoney } from '../../i18n/cs';
import { runArcade } from '../arcade';
import type { Keys } from '../arcade';
import { endPanel, introPanel } from '../shell';
import type { Minigame, MinigameContext } from '../types';
import { BreakoutSim } from './sim';
import type { BreakoutOutcome, PrisonerController } from './sim';
import { BreakoutView } from './view';

export interface BreakoutInput {
  player: PlayerId;
  seed: number;
  color: string;
}

export type BreakoutResult = BreakoutOutcome | 'skipped';

const LOW_TIME = 10;
const KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

/** Klávesnice člověka jako běžný ovladač vězně. Nahoru na obrazovce je do dvora. */
function keyboardController(keys: Keys): PrisonerController {
  return () => ({
    x: (keys.any('KeyD', 'ArrowRight') ? 1 : 0) - (keys.any('KeyA', 'ArrowLeft') ? 1 : 0),
    z: (keys.any('KeyS', 'ArrowDown') ? 1 : 0) - (keys.any('KeyW', 'ArrowUp') ? 1 : 0),
    sprint: keys.any('ShiftLeft', 'ShiftRight'),
  });
}

function hudMarkup(): string {
  const t = cs.breakout;
  return `
    <div class="mg-scene"></div>
    <div class="mg-vignette"></div>
    <div class="mg-hud" hidden>
      <div class="mg-timer"></div>
      <div class="mg-arrest" hidden><span>${t.alarm}</span><i></i></div>
      <div class="mg-nitro"><span>${t.sprint}</span><i></i></div>
      <div class="mg-objective"></div>
    </div>
    <div class="mg-count" hidden></div>
    ${introPanel({
      title: t.introTitle,
      who: 'cop',
      bubble: t.introBubble,
      goal: t.introGoal,
      keys: t.introKeys,
      skipLabel: t.skip(BUSINESS?.breakout.autoEscapePct ?? 0),
    })}
    ${endPanel()}`;
}

function updateHud(root: HTMLElement, sim: BreakoutSim): void {
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  find('.mg-timer').textContent = sim.timeLeft.toFixed(1);
  find('.mg-timer').classList.toggle('low', sim.timeLeft < LOW_TIME);
  find('.mg-nitro i').style.setProperty('--v', String(sim.stamina));
  find('.mg-arrest').hidden = sim.alarm <= 0;
  find('.mg-arrest i').style.setProperty('--v', String(sim.alarm));
  find('.mg-objective').textContent = sim.hasKey ? cs.breakout.toGate : cs.breakout.findKey;
  find('.mg-vignette').style.opacity = String(sim.alarm);
}

/** Jedno spuštění útěku: úvod, odpočet, plížení a výsledek. */
function run({ host, input, signal }: MinigameContext<BreakoutInput>): Promise<BreakoutResult> {
  return runArcade<BreakoutOutcome>({
    host,
    signal,
    markup: hudMarkup(),
    keys: KEYS,
    startLabel: cs.breakout.start,
    load: (root, keys) => {
      const sim = new BreakoutSim(input.seed, keyboardController(keys));
      const scene = root.querySelector<HTMLElement>('.mg-scene')!;
      const view = new BreakoutView(scene, sim, input.color);
      view.render(0);
      return Promise.resolve({
        get outcome() {
          return sim.outcome;
        },
        advance: (dt) => sim.advance(dt),
        render: (dt) => view.render(dt),
        updateHud: () => updateHud(root, sim),
        dispose: () => view.dispose(),
      });
    },
    end: (outcome) => {
      const t = cs.breakout;
      const won = outcome === 'escaped';
      return {
        won,
        title: won ? t.escaped : t.caught,
        text: won ? t.escapedText : t.caughtText(formatMoney(BUSINESS?.breakout.fine ?? 0)),
        who: 'cop',
      };
    },
  });
}

export const breakoutMinigame: Minigame<BreakoutInput, BreakoutResult> = {
  id: 'breakout',
  start: run,
  autoResolve: (input): Action => ({ type: 'breakoutSkip', player: input.player }),
  resultAction: (input, result): Action =>
    result === 'skipped'
      ? { type: 'breakoutSkip', player: input.player }
      : { type: 'breakoutResult', player: input.player, escaped: result === 'escaped' },
};
