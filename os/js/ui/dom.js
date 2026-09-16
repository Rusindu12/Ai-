/* Dahat OS — UI kit: tiny hyperscript, icon set, formatters.
 * No framework, no build step: the OS ships as readable ES modules.
 */

/**
 * h(sel, propsOrChild?, ...children)
 *  sel: 'div.card.large#main' (tag defaults to div)
 *  props: plain object → attributes/props/handlers (`onclick`, `style{}`, `dataset{}`, `html`)
 *  anything else (string, number, Node, Array) is treated as a child.
 */
export function h(sel, props, ...kids) {
  let tag = 'div', id = '', cls = [];
  if (typeof sel === 'string') {
    const m = sel.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
    if (m) {
      tag = m[1] || 'div';
      (m[2] || '').replace(/([.#])([\w-]+)/g, (_, ch, name) => {
        if (ch === '#') id = name; else cls.push(name);
        return '';
      });
    }
  } else if (sel && sel.nodeType) {
    return append(sel, [props, ...kids]);
  }

  const el = document.createElement(tag);
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');

  const isProps = props && typeof props === 'object' && !props.nodeType && !Array.isArray(props);
  const children = isProps ? kids : [props, ...kids];
  if (isProps) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.setAttribute('class', [...cls, v].filter(Boolean).join(' '));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else if (k === 'focus') { if (v) requestAnimationFrame(() => el.focus()); }
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(4)) {
    if (k == null || k === false) continue;
    el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- icons */
const P = (d, extra) => `<path d="${d}"${extra || ''}/>`;
const C = (cx, r) => `<circle cx="${cx}" cy="12" r="${r}"/>`;
const R = (x, y, w, hh, r) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${r ?? 2}"/>`;
const ICONS = {
  settings: '<circle cx="12" cy="12" r="3.2"/>' + P('M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4'),
  folder: P('M3 7a2 2 0 0 1 2-2h4l2 2.4h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  file: P('M6 3h7l5 5v13H6z') + P('M13 3v5h5'),
  notes: P('M6 3h12v18H6z') + P('M9 8h6M9 12h6M9 16h3'),
  terminal: R(3, 4, 18, 16, 3) + P('M7 9l3 3-3 3M13 15h4'),
  calculator: R(6, 3, 12, 18, 3) + P('M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h3'),
  clock: C(12, 9) + P('M12 7.5V12l3 2'),
  phone: P('M6.5 3.5h3l1.5 4-2 1.5a10 10 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z'),
  camera: P('M4 8h3l1.5-2.2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z') + '<circle cx="12" cy="13" r="3.6"/>',
  image: R(3, 5, 18, 14, 3) + P('M5 17l4.5-5 3 3 2.5-2.5L21 17') + `<circle cx="9" cy="10" r="1.4"/>`,
  monitor: P('M3 5h18v11H3z') + P('M8 20h8M12 16v4') + P('M6 12l2.5-3 2 2L13 8l2 4h3'),
  store: P('M4 8h16l-1.2 11.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z') + P('M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8'),
  assistant: P('M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6z') + P('M18 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'),
  todo: R(4, 4, 16, 16, 4) + P('M8.5 12.2l2.4 2.4 4.6-5'),
  game: R(3, 7, 18, 10, 5) + P('M7 10.5v3M5.5 12h3M15.5 11.5h.01M18 13.5h.01'),
  paint: P('M4 5h16v6H4z') + P('M8 11v3a2.5 2.5 0 0 0 5 0v-1h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2'),
  converter: P('M4 8h9a4 4 0 0 1 0 8H8') + P('M10.5 13.5L8 16l2.5 2.5M20 16h-9'),
  piano: R(3, 5, 18, 14, 2) + P('M7.5 5v9M12 5v9M16.5 5v9M5.2 5h4.6v5.5H5.2zM9.6 5h4.8v5.5H9.6zM14.2 5h4.6v5.5h-4.6z'),
  wifi: P('M3.5 9.5a13 13 0 0 1 17 0M6.5 13a8.6 8.6 0 0 1 11 0M9.5 16.4a4 4 0 0 1 5 0') + P('M12 20h.01'),
  bluetooth: P('M7 7.5L17 16.5 12 20V4l5 3.5L7 16.5'),
  moon: P('M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z'),
  sun: C(12, 4) + P('M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6'),
  volume: P('M4 9.5h3.5L12 6v12l-4.5-3.5H4z') + P('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
  mute: P('M4 9.5h3.5L12 6v12l-4.5-3.5H4z') + P('M16 10l4 4M20 10l-4 4'),
  bell: P('M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z') + P('M10 19a2.2 2.2 0 0 0 4 0'),
  'bell-off': P('M6.5 10a5.5 5.5 0 0 1 8-4.8M17.5 12.4c0-1 0-1.7 0-2.4M5 15.5h14S17.5 14 17.5 10') + P('M10 19a2.2 2.2 0 0 0 4 0') + P('M4 4l16 16'),
  battery: R(2.5, 8, 17, 8, 2) + P('M21.5 11v2'),
  lock: R(4.5, 10.5, 15, 10, 3) + P('M8 10.5V8a4 4 0 0 1 8 0v2.5'),
  unlock: R(4.5, 10.5, 15, 10, 3) + P('M8 10.5V8a4 4 0 0 1 7.6-1.7'),
  search: '<circle cx="11" cy="11" r="6"/>' + P('M15.4 15.4L20 20'),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  trash: P('M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13') + P('M10.5 11v6M13.5 11v6'),
  edit: P('M4 20h4L20 8l-4-4L4 16z') + P('M14.5 5.5l4 4'),
  check: P('M5 12.5l4.5 4.5L19 7'),
  x: P('M6 6l12 12M18 6L6 18'),
  left: P('M14.5 6l-6 6 6 6'),
  right: P('M9.5 6l6 6-6 6'),
  up: P('M6 14.5l6-6 6 6'),
  down: P('M6 9.5l6 6 6-6'),
  home: P('M4 11l8-6.5L20 11v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z') + P('M9.5 20.5v-6h5v6'),
  apps: R(4, 4, 7, 7, 2) + R(13, 4, 7, 7, 2) + R(4, 13, 7, 7, 2) + R(13, 13, 7, 7, 2),
  power: P('M12 4v7') + P('M7.5 6.8a7 7 0 1 0 9 0'),
  refresh: P('M20 12a8 8 0 1 1-2.4-5.7') + P('M20 4v4h-4'),
  copy: R(9, 9, 11, 11, 2) + P('M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15'),
  send: P('M4 12l16-7-7 16-2.2-6.4z'),
  mic: R(9.5, 3, 5, 11, 2.5) + P('M6 11.5a6 6 0 0 0 12 0M12 17.5V21'),
  share: P('M12 15V4') + P('M8.5 7.5L12 4l3.5 3.5') + P('M5 13v6h14v-6'),
  download: P('M12 4v10') + P('M8 10.5L12 14.5l4-4') + P('M5 17v3h14v-3'),
  shield: P('M12 3.5l7 2.5v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6z'),
  cpu: R(6.5, 6.5, 11, 11, 2.5) + R(9.5, 9.5, 5, 5, 1.2) + P('M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21'),
  alert: P('M12 4l8.5 15H3.5z') + P('M12 9.5v4.5M12 17h.01'),
  info: C(12, 8.5) + P('M12 11v5.5M12 7.8h.01'),
  globe: C(12, 8.5) + P('M3.5 12h17M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.4-3.6-8.5S9.6 5.9 12 3.5z'),
  palette: P('M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 2-1.8s-.7-1.3-.7-2.2.6-1.5 1.6-1.5H17a3.5 3.5 0 0 0 3.5-3.6C20.2 6.8 16.5 3.5 12 3.5z') + P('M7.5 10h.01M11 7.5h.01M15 8.5h.01'),
  star: P('M12 4l2.4 5 5.6.7-4 3.8 1 5.5-5-2.7-5 2.7 1-5.5-4-3.8 5.6-.7z'),
  play: P('M7 4.5l12 7.5-12 7.5z'),
  pause: P('M8.5 5v14M15.5 5v14'),
  stop: R(6, 6, 12, 12, 2),
  backspace: P('M9 5h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H9L3 12z') + P('M12 9.5l5 5M17 9.5l-5 5'),
  dots: '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>',
  eye: P('M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z') + C(12, 2.8),
  list: P('M4 6.5h16M4 12h16M4 17.5h11'),
  calendar: R(3.5, 5, 17, 15, 3) + P('M3.5 10h17M8 3.5v3M16 3.5v3'),
  music: P('M9 18V5l10-1.5V16') + `<circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="16" r="2.2"/>`,
  zap: P('M13.5 3L6 13.5h4.5L9.5 21l8-11H13z'),
  key: C(8, 3.4) + P('M11 9.5L20 18M17 15l-2 2M19 13l-2.5 2.5'),
  layers: P('M12 3.5l8.5 4.5L12 12.5 3.5 8zM4 12.5l8 4.2 8-4.2M4 16.5l8 4.2 8-4.2'),
  filter: P('M4 6h16l-6 7v5l-4 2v-7z'),
  heart: P('M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z'),
  language: P('M3.5 5.5h8M7.5 5.5c0 4-1.6 7-4 9M5 9.5c1.4 2.6 3.6 4.4 6 5.4') + P('M12 20.5l4-10 4 10M13.6 17h4.8'),
  storage: R(3.5, 4, 17, 6, 2) + R(3.5, 14, 17, 6, 2) + P('M7 7h.01M7 17h.01'),
  users: '<circle cx="9" cy="8" r="3"/>' + P('M3.5 19a5.5 5.5 0 0 1 11 0') + P('M16 5.6a3 3 0 0 1 0 5.8M17 19a5.5 5.5 0 0 0-1.6-3.9'),
  arrowup: P('M12 19V5M6.5 10.5L12 5l5.5 5.5'),
  arrowright: P('M5 12h13M13 6.5l5.5 5.5L13 17.5'),
  flip: P('M4 8.5A8 8 0 0 1 18 6l2 1.8M20 15.5A8 8 0 0 1 6 18l-2-1.8') + P('M20 3.5V8h-4.5M4 20.5V16h4.5'),
};

export function icon(name, size = 24, opts = {}) {
  const inner = ICONS[name] || ICONS.apps;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${opts.fill || 'none'}" stroke="currentColor"
    stroke-width="${opts.sw || 1.7}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
export const hasIcon = (n) => Object.prototype.hasOwnProperty.call(ICONS, n);

/* ---------------------------------------------------------------- format */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; n = Math.abs(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
export const pad2 = (n) => String(n).padStart(2, '0');
export function fmtTime(d = new Date(), seconds = false) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${seconds ? ':' + pad2(d.getSeconds()) : ''}`;
}
export function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? `${hh}:${pad2(mm)}:` : '') + `${pad2(mm)}:${pad2(ss)}`;
}
export function fmtAgo(ts, lang = 'en') {
  const diff = Date.now() - ts, m = Math.floor(diff / 60000);
  if (lang === 'si') {
    if (m < 1) return 'දැන්';
    if (m < 60) return `විනිඩි ${m}කට ඉහත`;
    const h = Math.floor(m / 60);
    if (h < 24) return `පැය ${h}කට ඉහත`;
    return `දින ${Math.floor(h / 24)}කට ඉහත`;
  }
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return days < 7 ? `${days}d ago` : new Date(ts).toLocaleDateString();
}
export const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const SI_DAYS = ['ඉරිදා', 'සඳුදා', 'අඟහරුවාදා', 'බදාදා', 'බ්‍රහස්පතින්දා', 'සිකුරාදා', 'සෙනසුරාදා'];
export const SI_MONTHS = ['ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'];

/* ---------------------------------------------------------------- misc */
export function uid(prefix = 'x') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}
/** Minimal event emitter used across the UI layer. */
export class Sig {
  constructor() { this.map = new Map(); }
  on(ev, fn) { (this.map.get(ev) || this.map.set(ev, new Set()).get(ev)).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.map.get(ev)?.delete(fn); }
  emit(ev, data) { this.map.get(ev)?.forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); }
}
/** Drag helper: gives delta-x/y and a normalized gesture summary. */
export function drag(el, { onStart, onMove, onEnd, axis = 'both' } = {}) {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now() };
    onStart?.(st, e);
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    let dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (axis === 'x') dy = 0; if (axis === 'y') dx = 0;
    onMove?.(dx, dy, st, e);
  });
  const finish = (e) => {
    if (!st || (e.pointerId != null && e.pointerId !== st.id)) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    onEnd?.({ dx, dy, dt: performance.now() - st.t0, x0: st.x0, y0: st.y0 }, e);
    st = null;
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  return () => finish({});
}
export function raf(fn) { let id = requestAnimationFrame(function loop(t) { if (fn(t) === false) { cancelAnimationFrame(id); return; } id = requestAnimationFrame(loop); }); return () => cancelAnimationFrame(id); }
