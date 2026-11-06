import { heistLoot, heistRules } from '../../core';
import type { Action, HeistTarget, PlayerId } from '../../core';
import { cs, formatMoney } from '../../i18n/cs';
import { runArcade } from '../arcade';
import type { Keys } from '../arcade';
import { endPanel, introPanel } from '../shell';
import type { Minigame, MinigameContext } from '../types';
import { ALARM_TIME, HeistSim } from './sim';
import type { HeistOutcome, ThiefController } from './sim';
import { HeistView } from './view';

export interface HeistInput {
  player: PlayerId;
  seed: number;
  color: string;
  target: HeistTarget;
}

export type HeistResult = HeistOutcome | 'skipped';

const LOW_TIME = 10;
const KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyE',
  'KeyQ',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

/** Klávesnice člověka jako běžný ovladač lupiče. Nahoru na obrazovce je do budovy. */
function keyboardController(keys: Keys): ThiefController {
  return () => ({
    x: (keys.any('KeyD', 'ArrowRight') ? 1 : 0) - (keys.any('KeyA', 'ArrowLeft') ? 1 : 0),
    z: (keys.any('KeyS', 'ArrowDown') ? 1 : 0) - (keys.any('KeyW', 'ArrowUp') ? 1 : 0),
    sprint: keys.any('ShiftLeft', 'ShiftRight'),
    action: keys.any('KeyE', 'Space'),
    drop: keys.any('KeyQ'),
  });
}

function hudMarkup(target: HeistTarget): string {
  const t = cs.heist;
  return `
    <div class="mg-scene"></div>
    <div class="mg-vignette"></div>
    <div class="mg-hud" hidden>
      <div class="mg-timer"></div>
      <div class="hs-clean">${t.cleanLeft}</div>
      <div class="mg-arrest" hidden><span>${t.suspicion}</span><i></i></div>
      <div class="mg-nitro"><span>${t.sprint}</span><i></i></div>
      <div class="hs-loot"><b></b><strong></strong><small></small></div>
      <div class="hs-dial" hidden><i></i></div>
      <div class="mg-objective"></div>
    </div>
    <div class="mg-count" hidden></div>
    ${introPanel({
      title: t.introTitle[target],
      who: 'friend',
      bubble: t.introBubble,
      goal: t.introGoal(ALARM_TIME[target]),
      keys: t.introKeys,
      skipLabel: t.skip(heistRules(target).autoEscapePct),
    })}
    ${endPanel()}`;
}

function objective(sim: HeistSim): string {
  const t = cs.heist;
  if (sim.dial) return t.crack(sim.opened, sim.map.tumblers);
  if (!sim.vaultOpen) return sim.atVault ? t.crackHint : t.toVault;
  if (sim.bagInReach) return t.grab;
  return sim.carried === 0 ? t.loot : t.toVan;
}

function updateHud(root: HTMLElement, sim: HeistSim): void {
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const t = cs.heist;
  find('.mg-timer').textContent = sim.timeLeft.toFixed(1);
  find('.mg-timer').classList.toggle('low', sim.alarm && sim.timeLeft < LOW_TIME);
  find('.mg-timer').classList.toggle('calm', !sim.alarm);
  find('.hs-clean').hidden = sim.alarm;
  find('.mg-nitro i').style.setProperty('--v', String(sim.stamina));
  find('.mg-arrest').hidden = sim.alarm || sim.suspicion <= 0;
  find('.mg-arrest i').style.setProperty('--v', String(sim.suspicion));
  find('.hs-loot b').textContent = t.bags(sim.carried, sim.maxBags);
  find('.hs-loot strong').textContent = formatMoney(heistLoot(sim.map.target, sim.carried));
  find('.hs-loot small').textContent = t.weight(Math.round(sim.load * 100));
  find('.mg-objective').textContent = objective(sim);
  find('.mg-vignette').style.opacity = String(sim.alarm ? 0.45 : sim.suspicion * 0.8);
  const dial = find('.hs-dial');
  dial.hidden = !sim.dial;
  if (sim.dial) {
    dial.style.setProperty('--center', `${sim.dial.center}rad`);
    dial.style.setProperty('--half', `${sim.dial.half}rad`);
    dial.style.setProperty('--needle', `${sim.dial.needle}rad`);
  }
}

/** Jedno spuštění heistu: úvod, odpočet, tři fáze mise a výsledek. */
function run({ host, input, signal }: MinigameContext<HeistInput>): Promise<HeistResult> {
  const { target } = input;
  return runArcade<HeistOutcome>({
    host,
    signal,
    markup: hudMarkup(target),
    keys: KEYS,
    startLabel: cs.heist.start,
    load: (root, keys) => {
      const sim = new HeistSim(target, input.seed, keyboardController(keys));
      const scene = root.querySelector<HTMLElement>('.mg-scene')!;
      const view = new HeistView(scene, sim, input.color);
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
      const t = cs.heist;
      const { riskPct, fine } = heistRules(target);
      if (!outcome.escaped) {
        return {
          won: false,
          title: t.lost,
          text: t.lostText(riskPct, formatMoney(fine)),
          who: 'cop',
        };
      }
      const loot = heistLoot(target, outcome.bags);
      return {
        won: loot > 0,
        title: loot > 0 ? t.won : t.wonEmpty,
        text: loot > 0 ? t.wonText(formatMoney(loot)) : t.wonEmptyText,
        who: 'friend',
      };
    },
  });
}

export const heistMinigame: Minigame<HeistInput, HeistResult> = {
  id: 'heist',
  start: run,
  autoResolve: (input): Action => ({ type: 'heistSkip', player: input.player }),
  resultAction: (input, result): Action =>
    result === 'skipped'
      ? { type: 'heistSkip', player: input.player }
      : { type: 'heistResult', player: input.player, ...result },
};
