/* Sketchpad — paint with a finger, export PNG into /sdcard/DCIM (needs the
 * storage capability, so the first export shows a permission prompt).
 */
import { h, icon } from '../ui/dom.js';
import { scaffold, section } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });
const PALETTE = ['#f2f5f8', '#12b7a2', '#4cc4ff', '#8b7bff', '#f2b134', '#ff7a59', '#f5626c', '#ff5fa2', '#37c978', '#0e141b'];

export default {
  id: 'paint',
  create(ctx) {
    const cvs = h('canvas', { style: { width: '100%', height: '100%', display: 'block', touchAction: 'none', borderRadius: '14px', background: '#fff' } });
    const state = { color: '#0e141b', size: 6, eraser: false, drawing: false, undo: [] };
    const bar = h('div.row-flex', { style: { gap: '6px', flexWrap: 'wrap', padding: '8px 0' } },
      ...PALETTE.map((p) => h('button', { 'aria-label': p, style: { width: '24px', height: '24px', borderRadius: '50%', background: p, border: p === state.color ? '3px solid var(--accent)' : '1px solid var(--line)', cursor: 'pointer' }, onclick: (e) => { state.color = p; state.eraser = false; [...bar.children].forEach((b, i) => { if (PALETTE[i]) b.style.border = PALETTE[i] === p ? '3px solid var(--accent)' : '1px solid var(--line)'; }); } })),
      h('input', { type: 'range', min: '2', max: '40', value: '6', style: { width: '84px' }, oninput: (e) => (state.size = Number(e.target.value)) }),
      h('button.btn', { text: B('eraser', 'මකනය'), onclick: () => { state.eraser = !state.eraser; } }));
    const tools = h('div.row-flex', { style: { gap: '6px', padding: '6px 0' } },
      h('button.btn.icon', { onclick: undo, html: icon('refresh', 17), title: 'undo' }),
      h('button.btn', { onclick: clear2, text: B('clear', 'හිස්') }),
      h('button.btn', { onclick: () => save(false), text: B('save', 'සුරකින්න') }),
      h('button.btn.primary', { onclick: () => save(true), text: B('save to Gallery', 'ගැලරියට') }));
    const ui = scaffold(ctx, { title: { en: 'Sketchpad', si: 'සිතුවම්' }, back: false, body: [cvs, bar, tools] });

    function fit() {
      const r = cvs.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      const snapshot = cvs.width ? cvs.toDataURL() : null;
      cvs.width = Math.max(1, r.width * dpr); cvs.height = Math.max(1, r.height * dpr);
      const c = cvs.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, cvs.width, cvs.height);
      c.lineJoin = c.lineCap = 'round';
      if (snapshot) { const img = new Image(); img.onload = () => c.drawImage(img, 0, 0, cvs.width, cvs.height); img.src = snapshot; }
    }
    const pos = (e) => { const r = cvs.getBoundingClientRect(); const dpr = devicePixelRatio || 1; return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }; };
    cvs.addEventListener('pointerdown', (e) => {
      state.undo.push(cvs.toDataURL());
      if (state.undo.length > 12) state.undo.shift();
      state.drawing = true;
      cvs.setPointerCapture(e.pointerId);
      const { x, y } = pos(e);
      const c = cvs.getContext('2d');
      c.strokeStyle = state.eraser ? '#ffffff' : state.color;
      c.lineWidth = state.eraser ? state.size * 2.4 : state.size;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 0.1, y + 0.1); c.stroke();
    });
    cvs.addEventListener('pointermove', (e) => {
      if (!state.drawing) return;
      const { x, y } = pos(e);
      cvs.getContext('2d').lineTo(x, y);
      cvs.getContext('2d').stroke();
    });
    ['pointerup', 'pointercancel'].forEach((ev) => cvs.addEventListener(ev, () => { state.drawing = false; }));
    function undo() {
      const prev = state.undo.pop();
      if (!prev) return toast(B('nothing to undo', 'ආපසු යාමට කිසිවක් නැත'));
      const img = new Image();
      img.onload = () => { const c = cvs.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cvs.width, cvs.height); c.drawImage(img, 0, 0); };
      img.src = prev;
    }
    function clear2() { const c = cvs.getContext('2d'); state.undo.push(cvs.toDataURL()); c.fillStyle = '#fff'; c.fillRect(0, 0, cvs.width, cvs.height); }
    async function save(toGallery) {
      const data = cvs.toDataURL('image/png');
      if (!toGallery) { const a = h('a', { href: data, download: `sketch-${Date.now()}.png`, style: { display: 'none' } }); document.body.appendChild(a); a.click(); a.remove(); return; }
      const path = `/sdcard/DCIM/sketch-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`;
      try { await ctx.api.fs.mkdir('/sdcard/DCIM'); } catch { /* exists */ }
      const r = await ctx.api.fs.write(path, data, { mime: 'image/png' });
      toast(`${B('saved', 'සුරැකිණි')} ${path} (${Math.round(r.size / 1024)} KiB)`);
    }
    let fitRaf = requestAnimationFrame(fit);
    const refit = () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fit); };
    return { el: ui.el, onResize: refit, destroy: () => cancelAnimationFrame(fitRaf) };
  },
};
