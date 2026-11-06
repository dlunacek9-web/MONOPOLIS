import type { HeistTarget } from '../../core';
import { applyMode } from '../../ui/mode';
import { heistMinigame } from './index';

/** Jen pro vývoj: heist bez desky, ať jde minihru zkoušet pořád dokola. */
export function startHeistSandbox(root: HTMLElement, target: HeistTarget): void {
  applyMode('nextlevel');
  const signal = new AbortController().signal;
  const round = () => {
    const input = {
      player: 0,
      seed: Math.floor(Math.random() * 2 ** 31),
      color: '#e6195f',
      target,
    };
    void heistMinigame.start({ host: root, input, signal }).then(round);
  };
  round();
}
