import './ui/styles.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Chybí kořenový element #app');
startApp(root);
