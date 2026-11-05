import { LiveAuctionRunner } from '../../bots/auction-runner';
import { BOARD, createGame, ownablePrice, reduce } from '../../core';
import type { GameState, PlayerSetup, TileId } from '../../core';
import { cs } from '../../i18n/cs';
import { LocalTransport } from '../../net/local';
import { applyMode } from '../../ui/mode';
import { auctionMinigame } from './index';

const PLAYER = 0;

function freshAuction(): GameState {
  const setups: PlayerSetup[] = [
    { name: cs.lobby.defaultName },
    { name: 'Žralok', bot: { personality: 'zralok', difficulty: 'normal' } },
    { name: 'Lakomec', bot: { personality: 'lakomec', difficulty: 'normal' } },
    { name: 'Kriminálník', bot: { personality: 'kriminalnik', difficulty: 'normal' } },
  ];
  const seed = Math.floor(Math.random() * 2 ** 31);
  const s = createGame({ mode: 'nextlevel', win: { type: 'lastStanding' } }, setups, seed);
  const lots = BOARD.map((_, id) => id as TileId).filter((id) => ownablePrice(id) !== null);
  s.active = PLAYER;
  s.phase = 'awaitBuy';
  s.pendingBuy = lots[seed % lots.length]!;
  return reduce(s, { type: 'decline', player: PLAYER });
}

/** Jen pro vývoj: dražba bez desky, ať jde minihru zkoušet pořád dokola. */
export function startAuctionSandbox(root: HTMLElement): void {
  applyMode('nextlevel');
  const round = () => {
    root.innerHTML = '';
    const transport = new LocalTransport(freshAuction());
    const clock = new LiveAuctionRunner(transport);
    void auctionMinigame
      .start({
        host: root,
        input: { player: PLAYER, transport },
        signal: new AbortController().signal,
      })
      .then(() => {
        clock.stop();
        const again = document.createElement('button');
        again.className = 'btn primary al-again';
        again.textContent = cs.auctionLive.again;
        again.onclick = round;
        root.append(again);
      });
  };
  round();
}
