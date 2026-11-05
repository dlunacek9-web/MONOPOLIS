import './ui/styles.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Chybí kořenový element #app');
// Jen pro vývoj: `?minihra=drazba` spustí samotnou dražbu. Do hotové hry se to nedostane.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('minihra') === 'drazba') {
  void import('./minigames/auction/sandbox').then((module) => module.startAuctionSandbox(root));
} else {
  startApp(root);
}
