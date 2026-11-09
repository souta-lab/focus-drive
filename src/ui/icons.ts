const paths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="m4 8 6 3m10-3-6 3m-2 3v7"/>',
  garage: '<path d="m3 9 9-6 9 6v12H3zM6 21V10h12v11M7 14h10M7 17h10"/>',
  collection: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 5 8-5M12 12.5V21"/>',
  chart: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/><circle cx="12" cy="10" r="1"/>',
  settings: '<path d="m9 3 1 3h4l1-3 3 2-1 3 2 3 3 1v3l-3 1-2 3 1 3-3 2-1-3h-4l-1 3-3-2 1-3-2-3-3-1v-3l3-1 2-3-1-3z" transform="translate(1 -1) scale(.9)"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m5 5 14 14M5 19 19 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8.5h-4a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4h-4M12 6v12"/>',
  guide: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><circle cx="12" cy="12" r="2"/>',
  sound: '<path d="m4 9 5 0 5-5v16l-5-5H4zM18 8a6 6 0 0 1 0 8M20 4a11 11 0 0 1 0 16"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 13 8-13 8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  leaf: '<path d="M20 3C8 2 2 7 5 15s15 3 15-12ZM5 20 16 9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  mountain: '<path d="m2 21 8-17 5 10 3-5 5 12zM7 10l3 3 3-3"/>',
  city: '<path d="M3 21V9h6V3h7v10h5v8M9 21V9M12 7h1m-1 4h1m-1 4h1M6 13v2m12 2v2"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1-1 7z"/>',
};
export function icon(name: string, cls = ''): string {
  return `<svg class="icon ${cls}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
}
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
