const paths = {
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  stop: '<path d="M4 12h12M12 6l6 6-6 6"/>',
  stamp: '<path d="M9 4h6v5l2 4H7l2-4zM5 17h14v3H5z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9c-1-1.5-5-1.5-6 0s1 3 3 3 4 1.5 3 3-5 1.5-6 0M12 5v14"/>',
  envelope: '<rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="m3 7 9 7 9-7"/>',
  chart: '<path d="M4 4v16h16M7 15l4-5 3 3 5-7"/>',
  door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/>',
  hands: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
  car: '<path d="M4 16v-3l2-6h12l2 6v3zM4 13h16"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="m11 11 9 9M16 16l2-2"/>',
  bars: '<path d="M4 4h16v16H4zM9 4v16M15 4v16"/>',
  flag: '<path d="M6 21V4h12l-3 4 3 4H6"/>',
  hammer: '<path d="M4 20 13 11M10 6l6-3 5 5-3 6z"/>',
  wave: '<path d="M4 8c3-3 5 3 8 0s5 3 8 0M4 15c3-3 5 3 8 0s5 3 8 0"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  skull:
    '<path d="M5 11a7 7 0 1 1 14 0c0 3-2 4-2 6H7c0-2-2-3-2-6zM9 21v-4M15 21v-4"/><circle cx="9" cy="11" r="1.5" fill="currentColor"/><circle cx="15" cy="11" r="1.5" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
  history: '<path d="M4 12a8 8 0 1 0 3-6.2L4 8M4 4v4h4M12 8v4l3 2"/>',
};

export type IconId = keyof typeof paths;

export function icon(id: IconId): string {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]}</svg>`;
}
