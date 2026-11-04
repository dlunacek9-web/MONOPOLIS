/**
 * Klasický herní panáček v barvě hráče: kulatá hlava, zúžený trup a široká podstavec.
 * Kreslený vlastním SVG, takže nepotřebuje žádný externí asset.
 */
export function pawnSvg(color: string): string {
  return `<svg class="pawn-svg" viewBox="0 0 40 52" aria-hidden="true">
    <ellipse cx="20" cy="49" rx="15" ry="3" fill="#0006"/>
    <path d="M13 46 C13 38 17 33 17 27 L23 27 C23 33 27 38 27 46 Z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    <ellipse cx="20" cy="46" rx="15" ry="4.5" fill="${color}" stroke="#fff" stroke-width="2"/>
    <ellipse cx="20" cy="28" rx="8" ry="3" fill="${color}" stroke="#fff" stroke-width="2"/>
    <circle cx="20" cy="15" r="10" fill="${color}" stroke="#fff" stroke-width="2"/>
    <ellipse cx="16.5" cy="11.5" rx="3" ry="2" fill="#fff6" transform="rotate(-30 16.5 11.5)"/>
  </svg>`;
}
