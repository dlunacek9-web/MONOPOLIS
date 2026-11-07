import { AUCTION_GAVEL_MS, AUCTION_OPENING_MS } from '../../bots/auction-runner';
import {
  BOARD,
  GAVEL_KNOCKS,
  MIN_BID_STEP,
  groupTiles,
  hashToUnit,
  minBid,
  ownablePrice,
} from '../../core';
import type { Action, Auction, GameEvent, GameState, PlayerId, TileId } from '../../core';
import { cs, formatMoney, formatMoneyShort } from '../../i18n/cs';
import { PLAYER_COLORS } from '../../render/palette';
import { tileColor } from '../../render/tile-info';
import { escapeHtml } from '../../ui/html';
import type { GameTransport } from '../../net/transport';
import type { Minigame, MinigameContext } from '../types';
import { AuctionView } from './view';

export interface AuctionInput {
  player: PlayerId;
  transport: GameTransport;
}

export type AuctionResult = 'done' | 'skipped';

/** Jak dlouho zůstane na obrazovce výsledek, než se hra vrátí do města. */
const SOLD_MS = 1_500;
const BUBBLE_MS = 2_000;
const MAX_FRAME = 0.1;
/** Násobky minimálního kroku pro tři tlačítka příhozu. */
const BID_RAISES = [0, 4, 9];
const BID_KEYS = ['Space', 'KeyW', 'KeyE'];
const BID_KEY_LABELS = ['Mezerník', 'W', 'E'];

function pick(lines: readonly string[], ...salt: number[]): string {
  return lines[Math.floor(hashToUnit(...salt) * lines.length)] ?? '';
}

function lotNote(s: GameState, player: PlayerId, tile: TileId): string {
  const t = BOARD[tile];
  if (t?.kind !== 'property') return '';
  const tiles = groupTiles(t.group);
  const mine = tiles.filter((id) => s.deeds[id]?.owner === player).length;
  return cs.auctionLive.cityShare(mine, tiles.length);
}

function markup(s: GameState, input: AuctionInput, auction: Auction): string {
  const t = cs.auctionLive;
  const color = tileColor(auction.tile);
  const seats = auction.bidders
    .map(
      (id) => `
      <div class="al-seat" data-seat="${id}" style="--pawn:${PLAYER_COLORS[id] ?? '#fff'}">
        <p class="al-bubble" hidden></p>
        <b>${escapeHtml(s.players[id]?.name ?? '')}${id === input.player ? ` <small>${cs.game.you}</small>` : ''}</b>
        <span class="al-cash"></span>
        <em class="al-status"></em>
      </div>`,
    )
    .join('');
  const bidButtons = BID_RAISES.map(
    (_, i) => `
      <button class="btn${i === 0 ? ' primary' : ''}" data-bid="${i}">
        <kbd>${BID_KEY_LABELS[i]}</kbd><span></span>
      </button>`,
  ).join('');
  return `
    <div class="mg-scene"></div>
    <div class="al-top">
      <div class="al-lot" style="--city:${color.bg};--city-ink:${color.ink}">
        <h2>${cs.tiles[auction.tile] ?? ''}</h2>
        <p>${t.listPrice(formatMoney(ownablePrice(auction.tile) ?? 0))}</p>
        <p>${lotNote(s, input.player, auction.tile)}</p>
      </div>
      <div class="al-board">
        <small>${t.topBid}</small>
        <strong class="al-amount"></strong>
        <span class="al-leader"></span>
      </div>
      <div class="al-gavel">
        <strong class="al-call"></strong>
        <div class="al-knocks">${'<i></i>'.repeat(GAVEL_KNOCKS)}</div>
        <div class="al-time"><i></i></div>
      </div>
    </div>
    <div class="al-floor">
      <div class="al-seats">${seats}</div>
      <div class="al-actions">
        ${bidButtons}
        <button class="btn" data-pass><kbd>Q</kbd><span>${t.pass}</span></button>
      </div>
      <p class="al-hint"></p>
    </div>
    <div class="al-sold" hidden><h1></h1><p></p></div>`;
}

/** Jedna živá dražba: běží přes běžné akce, takže ji vidí všichni lidé u stolu najednou. */
function run({ host, input, signal }: MinigameContext<AuctionInput>): Promise<AuctionResult> {
  const { transport, player } = input;
  const first = transport.getState();
  const opening = first.auction;
  if (!opening?.live) return Promise.resolve('done');
  const tile = opening.tile;

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'minigame al';
    root.innerHTML = markup(first, input, opening);
    host.append(root);
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const seatEl = (id: PlayerId) => root.querySelector<HTMLElement>(`[data-seat="${id}"]`);

    let view: AuctionView | null = null;
    try {
      view = new AuctionView(
        find('.mg-scene'),
        opening.bidders.map((id) => ({ id, color: PLAYER_COLORS[id] ?? '#ffffff' })),
        tileColor(tile).bg,
      );
    } catch (error) {
      // Dražba se dá hrát i bez 3D: všechno důležité je v panelech.
      console.warn('3D síň nejde spustit, dražba běží bez ní.', error);
    }

    const everyone = [...opening.bidders];
    let lastSeq = first.eventSeq;
    let lastAuction: Auction = opening;
    let clockStart = performance.now();
    let clockKey = '';
    let closing = false;
    let finished = false;
    let frame = 0;
    let lastFrame = performance.now();
    const bubbles = new Map<PlayerId, ReturnType<typeof setTimeout>>();

    const live = (s: GameState) => (s.auction?.live && s.auction.tile === tile ? s.auction : null);

    const finish = (result: AuctionResult) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      signal.removeEventListener('abort', onAbort);
      for (const timer of bubbles.values()) clearTimeout(timer);
      view?.dispose();
      root.remove();
      resolve(result);
    };
    const onAbort = () => finish('skipped');

    const say = (id: PlayerId, text: string) => {
      const bubble = seatEl(id)?.querySelector<HTMLElement>('.al-bubble');
      if (!bubble) return;
      bubble.textContent = text;
      bubble.hidden = false;
      const old = bubbles.get(id);
      if (old !== undefined) clearTimeout(old);
      bubbles.set(
        id,
        setTimeout(() => {
          bubble.hidden = true;
        }, BUBBLE_MS),
      );
    };

    const react = (s: GameState, event: GameEvent) => {
      if (event.type === 'bid') {
        view?.raisePaddle(event.player);
        const seat = seatEl(event.player);
        seat?.classList.remove('bump');
        void seat?.offsetWidth;
        seat?.classList.add('bump');
        if (s.players[event.player]?.bot) {
          say(event.player, pick(cs.auctionLive.taunts, s.rng, event.seq));
        }
      } else if (event.type === 'passBid' && s.players[event.player]?.bot) {
        say(event.player, pick(cs.auctionLive.folds, s.rng, event.seq));
      }
    };

    const paint = (s: GameState, auction: Auction) => {
      const t = cs.auctionLive;
      find('.al-amount').textContent = auction.leader === null ? '—' : formatMoney(auction.bid);
      find('.al-leader').textContent =
        auction.leader === null ? t.noBid : (s.players[auction.leader]?.name ?? '');
      const untouched = auction.leader === null && auction.gavel === 0;
      find('.al-call').textContent = t.calls[auction.gavel] ?? '';
      root.querySelectorAll<HTMLElement>('.al-knocks i').forEach((pip, i) => {
        pip.classList.toggle('on', i < auction.gavel);
      });
      const key = `${auction.bid}:${auction.gavel}`;
      if (key !== clockKey) {
        clockKey = key;
        clockStart = performance.now();
        find('.al-time').dataset.total = String(untouched ? AUCTION_OPENING_MS : AUCTION_GAVEL_MS);
      }

      for (const id of everyone) {
        const seat = seatEl(id);
        if (!seat) continue;
        const inGame = auction.bidders.includes(id);
        const leading = auction.leader === id;
        seat.classList.toggle('leading', leading);
        seat.classList.toggle('out', !inGame);
        seat.querySelector<HTMLElement>('.al-cash')!.textContent = formatMoneyShort(
          s.players[id]?.cash ?? 0,
        );
        seat.querySelector<HTMLElement>('.al-status')!.textContent = leading
          ? t.leading
          : inGame
            ? ''
            : t.passed;
      }
      view?.update(
        everyone.map((id) => ({
          id,
          leading: auction.leader === id,
          out: !auction.bidders.includes(id),
        })),
      );

      const me = s.players[player];
      const inGame = auction.bidders.includes(player);
      const leading = auction.leader === player;
      const min = minBid(s);
      root.querySelectorAll<HTMLButtonElement>('[data-bid]').forEach((button, i) => {
        const amount = min + (BID_RAISES[i] ?? 0) * MIN_BID_STEP;
        button.dataset.amount = String(amount);
        button.querySelector('span')!.textContent = formatMoney(amount);
        button.disabled = !inGame || leading || amount > (me?.cash ?? 0);
      });
      find<HTMLButtonElement>('[data-pass]').disabled = !inGame || leading;
      find('.al-hint').textContent = !inGame
        ? t.watching
        : leading
          ? t.youLead
          : min > (me?.cash ?? 0)
            ? t.noCash
            : '';
    };

    const close = (s: GameState) => {
      if (closing) return;
      closing = true;
      // Poslední člověk odešel: zbytek dohrají boti po řadě a výsledek ukáže běžná scéna.
      if (s.auction?.tile === tile) {
        finish('done');
        return;
      }
      const t = cs.auctionLive;
      const sold = lastAuction.leader !== null;
      const panel = find('.al-sold');
      panel.classList.toggle('won', lastAuction.leader === player);
      panel.querySelector('h1')!.textContent = sold ? t.sold : t.unsold;
      panel.querySelector('p')!.textContent = sold
        ? t.soldTo(s.players[lastAuction.leader!]?.name ?? '', formatMoney(lastAuction.bid))
        : t.unsoldText;
      panel.hidden = false;
      find('.al-floor').hidden = true;
      find('.al-call').textContent = t.calls[GAVEL_KNOCKS] ?? '';
      root.querySelectorAll('.al-knocks i').forEach((pip) => pip.classList.add('on'));
      view?.knockGavel();
      setTimeout(() => finish('done'), SOLD_MS);
    };

    const onState = (s: GameState) => {
      if (finished) return;
      for (const event of s.events) {
        if (event.seq > lastSeq) react(s, event);
      }
      lastSeq = s.eventSeq;
      const auction = live(s);
      if (!auction) {
        close(s);
        return;
      }
      if (auction.gavel > lastAuction.gavel) view?.knockGavel();
      lastAuction = auction;
      paint(s, auction);
    };
    const unsubscribe = transport.subscribe(onState);

    const send = (action: Action) => {
      // Příhoz mohl někdo těsně předběhnout. Pravidla ho odmítnou a tlačítka se překreslí.
      transport.dispatch(action);
    };
    const bid = (button: HTMLButtonElement | null) => {
      if (!button || button.disabled || closing) return;
      send({ type: 'bid', player, amount: Number(button.dataset.amount) });
    };
    const pass = () => {
      const button = find<HTMLButtonElement>('[data-pass]');
      if (!button.disabled && !closing) send({ type: 'passBid', player });
    };
    const onKey = (event: KeyboardEvent) => {
      const index = BID_KEYS.indexOf(event.code);
      if (index < 0 && event.code !== 'KeyQ') return;
      event.preventDefault();
      if (event.repeat) return;
      if (index >= 0) bid(root.querySelector(`[data-bid="${index}"]`));
      else pass();
    };
    root.onclick = (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!target) return;
      if (target.dataset.bid !== undefined) bid(target);
      else if (target.dataset.pass !== undefined) pass();
    };
    // Tlačítko bez fokusu: mezerník má vždycky znamenat příhoz, ne znovu poslední kliknutí.
    root.onmousedown = (event) => event.preventDefault();

    signal.addEventListener('abort', onAbort);
    window.addEventListener('keydown', onKey);
    paint(first, opening);

    const tick = (now: number) => {
      if (finished) return;
      const dt = Math.min(MAX_FRAME, (now - lastFrame) / 1000);
      lastFrame = now;
      const clock = find('.al-time');
      const total = Number(clock.dataset.total) || AUCTION_GAVEL_MS;
      const left = Math.max(0, 1 - (now - clockStart) / total);
      clock.style.setProperty('--v', String(left));
      view?.render(dt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Mezi vytvořením obrazovky a přihlášením se stav mohl změnit.
    onState(transport.getState());
  });
}

export const auctionMinigame: Minigame<AuctionInput, AuctionResult> = {
  id: 'auction',
  start: run,
  autoResolve: (input): Action => ({ type: 'passBid', player: input.player }),
  resultAction: () => null,
};
