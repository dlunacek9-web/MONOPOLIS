import { cs } from '../i18n/cs';
import { icon } from './icons';
import type { IconId } from './icons';

/** Každý druh akce má jiný vzhled: hned je vidět, jestli jde o legální tah, nebo o průšvih. */
export type ActKind = 'go' | 'legal' | 'black' | 'market' | 'danger' | 'plain';

export interface ActOptions {
  kind?: ActKind;
  icon?: IconId;
  sub?: string;
  /** Riziko odhalení v procentech. */
  risk?: number;
  tip?: string;
  attrs?: string;
  disabled?: boolean;
  primary?: boolean;
}

/** Riziko jako pět dílků: čitelné na první pohled, přesné číslo je v popisku. */
export function riskMeter(pct: number): string {
  const filled = Math.max(1, Math.min(5, Math.ceil(pct / 20)));
  const pips = Array.from(
    { length: 5 },
    (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`,
  ).join('');
  return `<span class="risk risk-${filled}" aria-label="${cs.game.riskTip(pct)}">${pips}</span>`;
}

export function act(label: string, action: string, options: ActOptions = {}): string {
  const { kind = 'plain', sub, risk, attrs = '', disabled, primary } = options;
  const tips = [options.tip, risk === undefined ? '' : cs.game.riskTip(risk)].filter(Boolean);
  const tip = tips.length ? ` data-tip="${tips.join(' ')}"` : '';
  return `
    <button class="act act-${kind}" data-action="${action}" ${attrs}${tip}${disabled ? ' disabled' : ''}${primary ? ' data-primary' : ''}>
      ${options.icon ? `<span class="act-ic">${icon(options.icon)}</span>` : ''}
      <span class="act-text"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      ${risk === undefined ? '' : riskMeter(risk)}
    </button>`;
}
