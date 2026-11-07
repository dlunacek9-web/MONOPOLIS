import { DefenseRunner } from '../../bots/defense-runner';
import { createGame, reduce } from '../../core';
import type { GameState, PlayerSetup } from '../../core';
import { cs } from '../../i18n/cs';
import { LocalTransport } from '../../net/local';
import { applyMode } from '../../ui/mode';
import { defenseMinigame } from './index';

/** Partie těsně před osmým kolem: tah posledního hráče končí a začne Válka gangů. */
function freshWar(players: number): GameState {
  const bots: PlayerSetup[] = [
    { name: 'Žralok', bot: { personality: 'zralok', difficulty: 'normal' } },
    { name: 'Lakomec', bot: { personality: 'lakomec', difficulty: 'normal' } },
    { name: 'Kriminálník', bot: { personality: 'kriminalnik', difficulty: 'normal' } },
  ];
  const setups = [{ name: cs.lobby.defaultName }, ...bots.slice(0, players - 1)];
  const seed = Math.floor(Math.random() * 2 ** 31);
  const s = createGame({ mode: 'nextlevel', win: { type: 'lastStanding' } }, setups, seed);
  const last = setups.length - 1;
  return reduce(
    { ...s, round: 7, active: last, firstPlayer: 0, phase: 'awaitEnd' },
    { type: 'endTurn', player: last },
  );
}

/** Jen pro vývoj: Válka gangů bez desky, ať jde zkoušet pořád dokola. */
export function startDefenseSandbox(root: HTMLElement, players: number): void {
  applyMode('nextlevel');
  const round = () => {
    root.innerHTML = '';
    const transport = new LocalTransport(freshWar(players));
    const clock = new DefenseRunner(transport);
    void defenseMinigame
      .start({ host: root, input: { player: 0, transport }, signal: new AbortController().signal })
      .then(() => {
        clock.stop();
        round();
      });
  };
  round();
}
