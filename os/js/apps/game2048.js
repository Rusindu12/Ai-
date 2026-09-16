/* Thala 2048 — a Bazaar game. Keyboard + swipe, best score in app data. */
import { h, icon } from '../ui/dom.js';
import { scaffold } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';

const B = (en, si) => i18n.bi({ en, si });
const SIZE = 4;
const COLORS = { 2: '#3d4b5c', 4: '#4a5c70', 8: '#12b7a2', 16: '#0fb6a0', 32: '#4cc4ff', 64: '#2f9fe0', 128: '#f2b134', 256: '#e79a1c', 512: '#ff7a59', 1024: '#f5626c', 2048: '#8b7bff' };

const blank = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
function add2(g) {
  const free = [];
  g.forEach((row, y) => row.forEach((v, x) => !v && free.push([x, y])));
  if (!free.length) return false;
  const [x, y] = free[(Math.random() * free.length) | 0];
  g[y][x] = Math.random() < 0.9 ? 2 : 4;
  return true;
}
const slide = (row) => {
  const a = row.filter((v) => v);
  let gained = 0;
  for (let i = 0; i < a.length - 1; i++) {
    if (a[i] === a[i + 1]) { a[i] *= 2; gained += a[i]; a.splice(i + 1, 1); }
  }
  while (a.length < SIZE) a.push(0);
  return { row: a, gained };
};
const rowsOf = (g) => g.map((r) => [...r]);
const colsOf = (g) => g[0].map((_, i) => g.map((r) => r[i]));
function move(g, dir) {
  const lines = dir === 'l' || dir === 'r' ? rowsOf(g) : colsOf(g);
  const flip = dir === 'r' || dir === 'd';
  let gained = 0;
  const out = lines.map((ln) => {
    const src = flip ? [...ln].reverse() : ln;
    const { row, g: gg } = slide(src);
    gained += gg;
    return flip ? row.reverse() : row;
  });
  const next = dir === 'l' || dir === 'r' ? out : out[0].map((_, i) => out.map((r) => r[i]));
  return { next, gained };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stuck = (g) => ['l', 'r', 'u', 'd'].every((d) => same(g, move(g, d).next));

export default {
  id: 'game2048',
  create(ctx) {
    let g = blank(), score = 0, best = 0, over = false;
    ctx.api.store.get('best').then((v) => { best = v || 0; hud(); });
    const board = h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${SIZE},1fr)`, gap: '8px', padding: '10px', background: 'var(--surface-3)', borderRadius: '18px', border: '1px solid var(--line)', aspectRatio: '1' } });
    const scoreEl = h('span', { style: { fontWeight: '800', fontSize: '17px' } }, '0');
    const bestEl = h('span.chip', `best 0`);
    const banner = h('div', { style: { textAlign: 'center', fontWeight: '800', minHeight: '22px' } });
    const hud = () => { scoreEl.textContent = String(score); bestEl.textContent = `best ${best}`; };

    function paint() {
      board.innerHTML = '';
      g.flat().forEach((v) => {
        const cell = h('div', {
          style: { display: 'grid', placeItems: 'center', borderRadius: '12px', fontWeight: '800', fontSize: v > 999 ? '17px' : '23px', background: v ? (COLORS[v] || '#8b7bff') : 'rgba(255,255,255,.05)', color: v ? '#04120f' : 'transparent', transition: 'transform .12s' },
          text: v || '',
        });
        if (v === 2048) cell.style.boxShadow = '0 0 22px rgba(139,123,255,.7)';
        board.appendChild(cell);
      });
    }
    function go(dir) {
      if (over) return;
      const { next, gained } = move(g, dir);
      if (same(next, g)) return;
      g = next; score += gained;
      actuate('tap');
      add2(g); paint(); hud();
      if (score > best) { best = score; ctx.api.store.set('best', best); }
      if (g.flat().includes(2048)) banner.textContent = B('2048! keep going', '2048! ඉදිරියට');
      if (stuck(g)) { over = true; banner.textContent = B('no moves left', 'අසාමාන්‍යයි — චලන නැත'); actuate('error'); }
    }
    function reset() { g = blank(); add2(g); add2(g); score = 0; over = false; banner.textContent = ''; paint(); hud(); }
    reset();

    const keys = h('div.kbd-pad', { style: { gridTemplateColumns: 'repeat(3,1fr)', maxWidth: '220px', margin: '14px auto' } },
      h('button', { html: icon('up', 20), onclick: () => go('u') }), h('button', { html: icon('left', 20), onclick: () => go('l') }), h('button', { html: icon('down', 20), onclick: () => go('d') }),
      h('button', { html: icon('right', 20), onclick: () => go('r') }),
      h('button.op', { text: '↺', onclick: reset }), h('button.op', { text: '?', onclick: () => ctx.toast(B('swipe or use arrows', 'ඇඟිලි සහිතයෙන් හෝ යොමු බොත්තම්')) }));
    const wrap = h('div', { style: { padding: '12px' } }, h('div.row-flex', { style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('div', h('div.tiny.muted', B('score', 'ලකුණු')), scoreEl), bestEl, h('button.btn', { onclick: reset, html: icon('refresh', 16) })), board, banner, keys);
    let sx = 0, sy = 0;
    wrap.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    wrap.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
    });
    const onKey = (e) => {
      const map = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r' };
      if (map[e.key]) { e.preventDefault(); go(map[e.key]); }
    };
    addEventListener('keydown', onKey);
    return { el: h('div.app', h('div.app-bar', h('button.btn.icon', { onclick: () => ctx.close(), html: icon('left', 19) }), h('span.title', { en: 'Thala 2048', si: 'තල 2048' })), h('div.app-body', { style: { padding: 0 } }, wrap)), destroy: () => removeEventListener('keydown', onKey) };
  },
};
