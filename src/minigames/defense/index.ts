import { chooseDefenseAction } from '../../bots/defense';
import { DEFENSE_BUILD_MS } from '../../bots/defense-runner';
import {
  DEFENSE_LIVES,
  DEFENSE_WAVES,
  MAX_TOWER_LEVEL,
  TOWERS,
  TOWER_KINDS,
  WaveSim,
  canDefenseBuild,
  canDefenseUpgrade,
  sectorOf,
  towerAt,
  upgradeCost,
} from '../../core';
import type { Action, ActiveDefense, GameEvent, GameState, PlayerId, TowerKind } from '../../core';
import { cs, formatMoney } from '../../i18n/cs';
import { PLAYER_COLORS } from '../../render/palette';
import { escapeHtml } from '../../ui/html';
import type { GameTransport } from '../../net/transport';
import { endPanel, introPanel, showEnd } from '../shell';
import type { Minigame, MinigameContext } from '../types';
import { DefenseView } from './view';

export interface DefenseInput {
  player: PlayerId;
  transport: GameTransport;
}

export type DefenseResult = 'done' | 'skipped';

const MAX_FRAME = 0.1;
const RESULT_MS = 2_200;
const KIND_KEYS = ['Digit1', 'Digit2', 'Digit3'];

function markup(s: GameState, d: ActiveDefense, me: PlayerId): string {
  const t = cs.defense;
  const seats = d.defenders
    .map(
      (id) => `
      <div class="td-seat" data-seat="${id}" style="--pawn:${PLAYER_COLORS[id] ?? '#fff'}">
        <b>${escapeHtml(s.players[id]?.name ?? '')}${id === me ? ` <small>${cs.game.you}</small>` : ''}</b>
        <em></em>
      </div>`,
    )
    .join('');
  const towers = TOWER_KINDS.map(
    (kind, i) => `
      <button class="td-tower" data-kind="${kind}" title="${t.towerTips[kind]}">
        <kbd>${i + 1}</kbd><b>${t.towers[kind]}</b><span>${TOWERS[kind].cost}</span>
      </button>`,
  ).join('');
  return `
    <div class="mg-scene"></div>
    <div class="td-top">
      <div class="td-box td-wave"><small>${t.title}</small><strong></strong></div>
      <div class="td-box td-lives"><small>${t.lives}</small><div class="td-bar"><i></i></div><b></b></div>
      <div class="td-box td-clock"><small></small><strong></strong></div>
    </div>
    <div class="td-seats">${seats}</div>
    <div class="td-dock">
      <div class="td-budget"><small>${t.budget}</small><strong></strong></div>
      <div class="td-towers">${towers}</div>
      <div class="td-go">
        <button class="btn primary" data-ready><kbd>Mezerník</kbd> ${t.ready}</button>
        <button class="btn" data-auto>${t.auto}</button>
      </div>
      <p class="td-hint"></p>
    </div>
    <div class="td-banner" hidden></div>
    ${introPanel({
      title: t.title,
      who: 'cop',
      bubble: t.introBubble,
      goal: t.yourSector,
      keys: [
        { keys: ['1', '2', '3'], label: TOWER_KINDS.map((k) => t.towers[k]).join(', ') },
        { keys: ['Myš'], label: t.hint },
        { keys: ['Mezerník'], label: t.ready },
      ],
      skipLabel: t.auto,
    })}
    ${endPanel()}`;
}

/** Válka gangů pro jednoho člověka u stolu. Běží přes běžné akce, takže ji hrají všichni najednou. */
function run({ host, input, signal }: MinigameContext<DefenseInput>): Promise<DefenseResult> {
  const { transport, player: me } = input;
  const first = transport.getState();
  const opening = first.defense;
  if (first.phase !== 'defense' || !opening) return Promise.resolve('done');

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'minigame td';
    root.innerHTML = markup(first, opening, me);
    host.append(root);
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const t = cs.defense;
    const mySector = sectorOf(opening, me);
    const colors = opening.defenders.map((id) => PLAYER_COLORS[id] ?? '#ffffff');

    let view: DefenseView | null = null;
    try {
      view = new DefenseView(find('.mg-scene'), colors, mySector);
    } catch (error) {
      console.warn('3D město nejde spustit, za hráče staví bot.', error);
    }

    let snapshot: ActiveDefense = structuredClone(opening);
    let lastSeq = first.eventSeq;
    let selected: TowerKind = 'bouncer';
    let hover: number | null = null;
    let autopilot = view === null;
    let intro = view !== null;
    let replaying = false;
    let replayEnd = 0;
    let pendingEnd: Extract<GameEvent, { type: 'defenseEnd' }> | null = null;
    let deadline = performance.now() + DEFENSE_BUILD_MS;
    let bannerUntil = 0;
    let finished = false;
    let frame = 0;
    let lastFrame = performance.now();

    find<HTMLElement>('.mg-intro').hidden = !intro;
    const startButton = root.querySelector<HTMLButtonElement>('[data-mg="start"]');
    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = t.start;
    }

    const current = (): ActiveDefense | null => {
      const s = transport.getState();
      return s.phase === 'defense' ? s.defense : null;
    };
    const send = (action: Action) => {
      transport.dispatch(action);
    };

    const finish = (result: DefenseResult) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      signal.removeEventListener('abort', onAbort);
      view?.dispose();
      root.remove();
      resolve(result);
    };
    const onAbort = () => finish('skipped');

    /** Bot postaví za hráče, co se dá, a pustí vlnu. */
    let autoBuilding = false;
    const autoBuild = () => {
      // Každá stavba vyvolá změnu stavu. Staví se jen na vlnu, která běžela na začátku.
      if (autoBuilding || replaying) return;
      autoBuilding = true;
      const wave = current()?.wave;
      for (let guard = 0; guard < 80 && !replaying; guard++) {
        const s = transport.getState();
        const d = s.defense;
        if (s.phase !== 'defense' || !d || d.wave !== wave || d.ready.includes(me)) break;
        send(chooseDefenseAction(s, me));
      }
      autoBuilding = false;
    };

    const banner = (text: string) => {
      const el = find('.td-banner');
      el.textContent = text;
      el.hidden = false;
      bannerUntil = performance.now() + RESULT_MS;
    };

    const building = () => !replaying && !intro && current() !== null;

    const paint = () => {
      const s = transport.getState();
      const d = current();
      // Během přehrávání ukazuje stav před vlnou, výsledek přijde až na konci.
      const shown = replaying || !d ? snapshot : d;
      const lives = shown.lives;
      find('.td-wave strong').textContent = t.wave(
        Math.min(shown.wave, DEFENSE_WAVES),
        DEFENSE_WAVES,
      );
      find('.td-lives b').textContent = String(lives);
      find('.td-lives i').style.setProperty('--v', String(lives / DEFENSE_LIVES));
      find('.td-budget strong').textContent = String(shown.budgets[mySector] ?? 0);
      for (const id of shown.defenders) {
        const seat = root.querySelector<HTMLElement>(`[data-seat="${id}"]`);
        const done = replaying || shown.ready.includes(id);
        seat?.classList.toggle('done', done);
        const em = seat?.querySelector('em');
        if (em) em.textContent = s.players[id]?.bankrupt ? '' : done ? t.readyMark : t.buildingMark;
      }
      const canBuild = building() && d !== null && !d.ready.includes(me);
      root.classList.toggle('td-locked', !canBuild);
      root.querySelectorAll<HTMLButtonElement>('.td-tower').forEach((button) => {
        const kind = button.dataset.kind as TowerKind;
        button.classList.toggle('on', kind === selected);
        button.disabled = !canBuild || (d?.budgets[mySector] ?? 0) < TOWERS[kind].cost;
      });
      find<HTMLButtonElement>('[data-ready]').disabled = !canBuild;
      find<HTMLButtonElement>('[data-auto]').disabled = !canBuild;
      find('.td-hint').textContent = hint(d);
      view?.setTowers(shown.towers, shown.defenders);
      paintCursor(d);
    };

    const hint = (d: ActiveDefense | null): string => {
      if (replaying) return t.playing;
      if (!d) return '';
      if (d.ready.includes(me)) return t.waiting;
      const tower = hover === null ? undefined : towerAt(d, hover);
      if (tower) {
        const head = `${t.towers[tower.kind]}, ${t.level(tower.level)}`;
        if (tower.owner !== me) return head;
        return `${head} · ${tower.level >= MAX_TOWER_LEVEL ? t.maxed : t.upgrade(upgradeCost(tower))}`;
      }
      return `${t.towers[selected]}: ${t.towerTips[selected]} ${t.hint}`;
    };

    const paintCursor = (d: ActiveDefense | null) => {
      if (!view) return;
      if (!building() || !d || hover === null || d.ready.includes(me)) {
        view.setCursor(null, false, null);
        return;
      }
      const tower = towerAt(d, hover);
      if (tower) {
        view.setCursor(hover, canDefenseUpgrade(d, me, hover), tower.kind, tower.level);
      } else {
        view.setCursor(hover, canDefenseBuild(d, me, hover, selected), selected);
      }
    };

    const startReplay = (wave: number) => {
      replaying = true;
      const sim = new WaveSim(snapshot.towers, snapshot.defenders, wave);
      if (view) view.play(sim);
      else replayEnd = performance.now();
    };

    const onState = () => {
      const s = transport.getState();
      const fresh = s.events.filter((e) => e.seq > lastSeq);
      lastSeq = s.eventSeq;
      for (const e of fresh) {
        if (e.type === 'defenseWave') {
          startReplay(e.wave);
          pendingWave = e;
        } else if (e.type === 'defenseEnd') {
          pendingEnd = e;
        }
      }
      if (s.phase === 'defense' && s.defense) {
        if (!replaying) snapshot = structuredClone(s.defense);
        else nextSnapshot = structuredClone(s.defense);
      }
      if (autopilot && !replaying) autoBuild();
      paint();
    };
    let pendingWave: Extract<GameEvent, { type: 'defenseWave' }> | null = null;
    let nextSnapshot: ActiveDefense | null = null;

    const replayDone = () => {
      replaying = false;
      if (pendingWave) {
        banner(t.waveResult(pendingWave.leaked));
        snapshot = { ...(nextSnapshot ?? snapshot), lives: pendingWave.lives };
        pendingWave = null;
        nextSnapshot = null;
      }
      const d = current();
      if (d) snapshot = structuredClone(d);
      deadline = performance.now() + DEFENSE_BUILD_MS;
      if (pendingEnd) {
        const end = pendingEnd;
        const amount = formatMoney(end.amount);
        showEnd(root, {
          won: end.held,
          title: end.held ? t.held : t.fell,
          text: end.held ? t.heldText(end.lives, amount) : t.fellText(amount),
          who: end.held ? 'friend' : 'cop',
        });
      } else if (autopilot) {
        autoBuild();
      }
      paint();
    };

    const tick = (now: number) => {
      const dt = Math.min(MAX_FRAME, (now - lastFrame) / 1_000);
      lastFrame = now;
      const wasPlaying = replaying;
      view?.render(dt);
      if (wasPlaying && (view ? !view.playing : now >= replayEnd)) replayDone();
      const clock = find('.td-clock');
      if (replaying) {
        clock.querySelector('small')!.textContent = t.playing;
        clock.querySelector('strong')!.textContent = '';
      } else if (current()) {
        const left = Math.max(0, Math.ceil((deadline - now) / 1_000));
        clock.querySelector('small')!.textContent = t.timeLeft(left);
        clock.querySelector('strong')!.textContent = String(left);
      }
      if (bannerUntil && now > bannerUntil) {
        find('.td-banner').hidden = true;
        bannerUntil = 0;
      }
      frame = requestAnimationFrame(tick);
    };

    const tryCell = (cell: number) => {
      const d = current();
      if (!d || !building()) return;
      const tower = towerAt(d, cell);
      if (tower) {
        if (canDefenseUpgrade(d, me, cell)) send({ type: 'defenseUpgrade', player: me, cell });
      } else if (canDefenseBuild(d, me, cell, selected)) {
        send({ type: 'defenseBuild', player: me, cell, kind: selected });
      }
    };

    const ready = () => {
      const d = current();
      if (d && building() && !d.ready.includes(me)) send({ type: 'defenseReady', player: me });
    };

    const onKey = (event: KeyboardEvent) => {
      const index = KIND_KEYS.indexOf(event.code);
      if (index >= 0) {
        selected = TOWER_KINDS[index]!;
        paint();
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (intro) closeIntro();
        else ready();
      }
    };

    const closeIntro = () => {
      intro = false;
      find<HTMLElement>('.mg-intro').hidden = true;
      paint();
    };

    root.addEventListener('mousemove', (event) => {
      const cell = view?.pick(event.clientX, event.clientY) ?? null;
      if (cell === hover) return;
      hover = cell;
      paint();
    });
    root.querySelector('.mg-scene')!.addEventListener('click', (event) => {
      const e = event as MouseEvent;
      const cell = view?.pick(e.clientX, e.clientY);
      if (cell !== null && cell !== undefined) tryCell(cell);
    });
    root.addEventListener('click', (event) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (!el) return;
      if (el.dataset.kind) {
        selected = el.dataset.kind as TowerKind;
        paint();
      } else if (el.dataset.ready !== undefined) {
        ready();
      } else if (el.dataset.auto !== undefined) {
        autoBuild();
      } else if (el.dataset.mg === 'start') {
        closeIntro();
      } else if (el.dataset.mg === 'skip') {
        autopilot = true;
        closeIntro();
        autoBuild();
      } else if (el.dataset.mg === 'resume') {
        finish('done');
      }
    });

    const unsubscribe = transport.subscribe(onState);
    window.addEventListener('keydown', onKey);
    signal.addEventListener('abort', onAbort);
    if (autopilot) autoBuild();
    paint();
    frame = requestAnimationFrame(tick);
  });
}

export const defenseMinigame: Minigame<DefenseInput, DefenseResult> = {
  id: 'defense',
  start: run,
  autoResolve: (input): Action => ({ type: 'defenseReady', player: input.player }),
  resultAction: () => null,
};
