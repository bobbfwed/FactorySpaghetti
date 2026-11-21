// Shared mock-up helpers: inline SVG icons drawn from the printed piece shapes, and anchoring HTML to the 3D table.
export const COLORS = { blue: '#2f6fd6', red: '#e0454f', orange: '#f08a24', green: '#2e9e5b' };

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
let gid = 0;
export const ICONS = {
  ore: () => { const id = 'go' + gid++; return svg(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a35fe0"/><stop offset=".45" stop-color="#5d62d0"/><stop offset=".75" stop-color="#9a55b4"/><stop offset="1" stop-color="#c4589a"/></linearGradient></defs><path d="M12 3.2c.6 0 1.1.3 1.4.8l8 13.7c.6 1-.1 2.3-1.3 2.3H3.9c-1.2 0-1.9-1.3-1.3-2.3l8-13.7c.3-.5.8-.8 1.4-.8z" fill="url(#${id})"/><path d="M12 6.5 6.2 16.8" stroke="rgba(255,255,255,.35)" stroke-width="1.2" stroke-linecap="round"/>`); },
  plate: () => svg(`<path d="M8.2 5.5h13c.9 0 1.4.9 1 1.6l-5.5 10.6c-.2.5-.7.8-1.2.8h-13c-.9 0-1.4-.9-1-1.6L7 6.3c.2-.5.7-.8 1.2-.8z" fill="#f2a21e" fill-opacity=".92" stroke="#ffd27a" stroke-width=".9"/><path d="M9 8h9" stroke="rgba(255,255,255,.55)" stroke-width="1.2" stroke-linecap="round"/>`),
  sphere: () => svg(`<circle cx="12" cy="12" r="9" fill="#1d4f2c"/><circle cx="12" cy="12" r="6.6" fill="#2a6b3d"/><circle cx="9" cy="9" r=".9" fill="#a7f0bb"/><circle cx="14.5" cy="13.5" r=".7" fill="#7fd99a"/><circle cx="11" cy="15" r=".6" fill="#c8ffd6"/><circle cx="15" cy="8.6" r=".5" fill="#c8ffd6"/>`),
  tess: () => svg(`<path d="M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z" fill="#2b2b30" stroke="#d9d3c6" stroke-width="1.1" stroke-linejoin="round"/>`),
  power: () => svg(`<circle cx="12" cy="12" r="10" fill="#e1ac36"/><circle cx="12" cy="12" r="8.6" fill="none" stroke="#b88520" stroke-width=".8"/><path d="M13.6 4.6 7.6 13h3.6l-1.6 6.4 6.6-9h-3.7l1.9-5.8z" fill="#121214"/>`),
  card: () => svg(`<rect x="5" y="2.5" width="14" height="19" rx="2.2" fill="#121214" stroke="#e8b730" stroke-width="1.4"/><path d="M8 9c3-3 5 3 8 0M8 14c3-3 5 3 8 0" stroke="#e8b730" stroke-width="1.2" fill="none"/>`),
  belt: (c = '#2f6fd6') => svg(`<g fill="${c}"><path d="M1 8h3.4l3 4-3 4H1l3-4z"/><path d="M7.4 8h3.4l3 4-3 4H7.4l3-4z"/><path d="M13.8 8h3.4l3 4-3 4h-3.4l3-4z"/><path d="M19.6 7.2 23.4 12l-3.8 4.8z"/></g>`),
  teleporter: (c = '#2f6fd6') => svg(`<ellipse cx="12" cy="15" rx="8.5" ry="4" fill="none" stroke="${c}" stroke-width="2.6"/><path d="M3.5 15V10M20.5 15V10" stroke="${c}" stroke-width="2.6"/><ellipse cx="12" cy="10" rx="8.5" ry="4" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.4"/>`),
  meeple: (c = '#2f6fd6') => svg(`<g fill="${c}"><circle cx="12" cy="5.4" r="3.9"/><rect x="2.2" y="8.4" width="19.6" height="5.4" rx="2.7"/><path d="M7.2 10.5h9.6l2.7 9.6c.3 1-.4 1.9-1.4 1.9h-3.3L12 17.6 9.2 22H5.9c-1 0-1.7-.9-1.4-1.9z"/></g>`),
  mine: () => svg(`<path d="M2 7.5 6 4h5l2 3.5L11 11H6zM13 7.5 17 4h5" fill="none"/><g><polygon points="3,12 6,7 12,7 15,12 12,17 6,17" fill="#efede6"/><circle cx="9" cy="12" r="2.2" fill="#151515"/><g stroke="#151515" stroke-width="1.1"><path d="M9 8.2V7.4M9 15.8v.8M5.6 10l-.8-.5M12.4 14l.8.5M5.6 14l-.8.5M12.4 10l.8-.5"/></g><polygon points="15,12 18,7 22.5,9.5 22.5,14.5 18,17" fill="#efede6"/></g>`),
  module: (c = '#2f6fd6', n = '') => svg(`<rect x="3" y="3" width="18" height="18" rx="3.5" fill="${c}"/><text x="12" y="16.6" font-family="Arial Black,Segoe UI Black,sans-serif" font-weight="900" font-size="11" text-anchor="middle" fill="#0d0d0d">${n}</text>`),
  // interface glyphs
  rotate: () => svg(`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20 3.5v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  recenter: () => svg(`<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`),
  topdown: () => svg(`<polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  menu: () => svg(`<path d="M4.5 7h15M4.5 12h15M4.5 17h15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  check: () => svg(`<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),
  cross: () => svg(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>`),
  link: () => svg(`<path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.3-1.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  download: () => svg(`<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 19.5h15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  book: () => svg(`<path d="M4 5.5c2.8-1.2 5.5-1.2 8 .5 2.5-1.7 5.2-1.7 8-.5v13c-2.8-1.2-5.5-1.2-8 .5-2.5-1.7-5.2-1.7-8-.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6v13" stroke="currentColor" stroke-width="1.8"/>`),
  gear: () => svg(`<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  leave: () => svg(`<path d="M10 4.5H5.5v15H10M14.5 8l4 4-4 4M18.5 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  file: () => svg(`<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M14 3v4h4M9 13h6M9 17h6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`),
  copy: () => svg(`<rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5H6" fill="none" stroke="currentColor" stroke-width="1.9"/>`),
  install: () => svg(`<rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v7.5M9 11.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  bot: () => svg(`<rect x="4.5" y="7.5" width="15" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="9.5" cy="13" r="1.4" fill="currentColor"/><circle cx="14.5" cy="13" r="1.4" fill="currentColor"/><path d="M12 7.5V4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="3.6" r="1.3" fill="currentColor"/>`),
  crown: () => svg(`<path d="M4 17.5 3 7.5l5 4 4-6 4 6 5-4-1 10z" fill="currentColor"/>`),
  wifi: () => svg(`<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>`),
};
export const pipSvg = (owned) => `<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.9 6.9 2.6-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6z" fill="${owned ? '#e8b730' : 'none'}" stroke="${owned ? '#e8b730' : '#5d5a55'}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

// <i class="ic" data-icon="ore"></i>  /  data-color="blue" / data-n="3"
export function hydrate(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const f = ICONS[el.dataset.icon]; if (!f) return;
    const c = el.dataset.color ? COLORS[el.dataset.color] || el.dataset.color : undefined;
    el.innerHTML = f(c, el.dataset.n);
  });
  root.querySelectorAll('[data-pips]').forEach((el) => {
    const n = +el.dataset.pips; el.innerHTML = [0, 1, 2, 3].map((i) => `<span class="pip">${pipSvg(i < n)}</span>`).join('');
  });
  root.querySelectorAll('[data-tray]').forEach((el) => {
    // Control Module tray: rows from 18 down to 1, like the printed tray
    const color = COLORS[el.dataset.tray] || el.dataset.tray;
    const missing = (el.dataset.missing || '').split(',').filter(Boolean).map(Number);
    const lit = (el.dataset.lit || '').split(',').filter(Boolean).map(Number);
    let h = '';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
      const n = 18 - (3 * r + c);
      h += missing.includes(n) ? `<span class="mod empty"></span>` : `<span class="mod${n === 6 || n === 9 ? ' u' : ''}${lit.includes(n) ? ' lit' : ''}" style="background:${color}">${n}</span>`;
    }
    el.innerHTML = h;
  });
}

// place an element so that its (ax, ay) fraction sits on the given screen point
export function pin(el, pt, ax = 0.5, ay = 0.5, dx = 0, dy = 0) {
  const r = el.getBoundingClientRect();
  el.style.left = Math.round(pt.x - r.width * ax + dx) + 'px';
  el.style.top = Math.round(pt.y - r.height * ay + dy) + 'px';
}

export function cardHTML(title, text) {
  return `<div class="top">LEVERAGE</div><div class="band">${title}</div><div class="txt">${text}</div><div class="foot">Step 3 · up to 2 per turn</div>`;
}
