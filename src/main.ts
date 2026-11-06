import './ui/styles.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Chybí kořenový element #app');
// Jen pro vývoj: `?minihra=drazba|banka|hotel` spustí samotnou minihru. Do hotové hry se to nedostane.
const sandbox = import.meta.env.DEV ? new URLSearchParams(location.search).get('minihra') : null;
if (sandbox === 'drazba') {
  void import('./minigames/auction/sandbox').then((module) => module.startAuctionSandbox(root));
} else if (sandbox === 'banka' || sandbox === 'hotel') {
  const target = sandbox === 'banka' ? 'bank' : 'hotel';
  void import('./minigames/heist/sandbox').then((module) => module.startHeistSandbox(root, target));
} else {
  startApp(root);
}
