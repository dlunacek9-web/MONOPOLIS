import './ui/styles.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Chybí kořenový element #app');
// Jen pro vývoj: `?minihra=drazba|banka|hotel|valka` spustí samotnou minihru. Do hotové hry se to nedostane.
const sandbox = import.meta.env.DEV ? new URLSearchParams(location.search).get('minihra') : null;
if (sandbox === 'drazba') {
  void import('./minigames/auction/sandbox').then((module) => module.startAuctionSandbox(root));
} else if (sandbox === 'banka' || sandbox === 'hotel') {
  const target = sandbox === 'banka' ? 'bank' : 'hotel';
  void import('./minigames/heist/sandbox').then((module) => module.startHeistSandbox(root, target));
} else if (sandbox === 'valka') {
  const players = Number(new URLSearchParams(location.search).get('hracu') ?? 4);
  void import('./minigames/defense/sandbox').then((module) =>
    module.startDefenseSandbox(root, Math.min(4, Math.max(2, players))),
  );
} else {
  startApp(root);
}
