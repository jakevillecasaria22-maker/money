// Inline stroke icons (24x24). Kept local so the app needs no network or third-party assets.

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M7 3.5h10"/><circle cx="16.5" cy="15" r="1.2"/>',
  bill: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.3z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  plan: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11"/><circle cx="5" cy="18" r="1"/>',
  chart: '<path d="M3 20h18"/><path d="M6 20v-6M11 20V8M16 20v-9M21 20V5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  critical: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
  warning: '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.3"/>',
  good: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  sync: '<path d="M20 8a8.5 8.5 0 0 0-15.5-1.5M4 4v3.5h3.5"/><path d="M4 16a8.5 8.5 0 0 0 15.5 1.5M20 20v-3.5h-3.5"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M8 7.5A6 6 0 0 1 17.5 11 4 4 0 0 1 20 18M15 18H7a4.5 4.5 0 0 1-1.5-8.7"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5"/><path d="M4 20h16"/>',
  cart: '<path d="M3 4h2.5l2.2 11h10.6L20.5 8H6.6"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  piggy: '<path d="M4 11.5c0-3.5 3.5-6 8-6 1.6 0 3 .3 4.2.9L19 5v3.3c.9.8 1.5 1.8 1.7 2.9H22v3.6h-1.6c-.5 1-1.3 1.9-2.4 2.5V20h-3v-1.9c-.9.2-1.9.3-3 .3s-2.1-.1-3-.3V20H6v-2.6c-1.3-1.2-2-2.6-2-4.4z"/><circle cx="16" cy="10.5" r=".6"/>',
  income: '<path d="M12 20V6M6.5 11.5 12 6l5.5 5.5"/><path d="M4 3.5h16"/>',
  expense: '<path d="M12 4v14M6.5 12.5 12 18l5.5-5.5"/><path d="M4 20.5h16"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.info}</svg>`;
}
