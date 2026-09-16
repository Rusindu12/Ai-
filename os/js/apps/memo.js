/* Voice Memo — MediaRecorder → a file in /sdcard/Music. Needs the mic
 * capability, and the OS asks the first time you press record.
 */
import { h, icon, fmtDur } from '../ui/dom.js';
import { scaffold, row, empty } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { confirm, prompt, toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'memo',
  create(ctx) {
    let rec = null, chunks = [], started = 0, ticker = null, items = [];
    const big = h('div.num', { style: { fontSize: '46px', fontWeight: '200', textAlign: 'center', padding: '10px 0' } }, '00:00');
    const dot = h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: 'var(--text-3)', display: 'inline-block' } });
    const list = h('div.list');
    const btn = h('button', {
      style: { width: '72px', height: '72px', borderRadius: '50%', border: '0', background: 'var(--err)', color: '#fff', display: 'grid', placeItems: 'center', margin: '8px auto', cursor: 'pointer', transition: 'border-radius .2s' },
      html: icon('mic', 28),
      onclick: () => (rec ? stop() : start()),
    });

    async function start() {
      const ok = await ctx.requestCap('mic', B('Recordings stay on this device.', 'හඬ පටි උපාංගයේම රඳී.'));
      if (!ok) return toast(B('microphone denied', 'මයික්‍රොෆෝනය ප්‍රතික්ෂේප කෙරිණි'));
      if (!navigator.mediaDevices?.mediaDevices && !window.MediaRecorder) return toast(B('no recorder here', 'පටිගත කිරීම මෙතැනට නැත'));
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        rec = new MediaRecorder(stream);
        chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const name = `memo-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.webm`;
          const data = await blobToDataURL(blob);
          try {
            await ctx.api.fs.mkdir('/sdcard/Music');
            const r = await ctx.api.fs.write(`/sdcard/Music/${name}`, data, { mime: blob.type });
            items.unshift({ name, path: `/sdcard/Music/${name}`, size: r.size, at: Date.now(), ms: Date.now() - started });
            await ctx.api.store.set('index', items);
            paint();
            toast(`${B('saved', 'සුරැකිණි')} ${name}`);
          } catch (e) { toast(e.message); }
          rec = null;
        };
        rec.start();
        started = Date.now();
        actuate('toggle');
        dot.style.background = 'var(--err)';
        btn.style.borderRadius = '22px';
        btn.innerHTML = icon('stop', 26);
        ticker = setInterval(() => { big.textContent = fmtDur(Date.now() - started); }, 200);
      } catch (e) {
        toast(`${B('microphone failed', 'මයික්‍රොෆෝනය අසාර්ථකයි')}: ${e.message}`);
      }
    }
    function stop() {
      if (!rec) return;
      rec.stop();
      clearInterval(ticker);
      dot.style.background = 'var(--text-3)';
      btn.style.borderRadius = '50%';
      btn.innerHTML = icon('mic', 28);
      big.textContent = '00:00';
    }
    const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

    function paint() {
      list.innerHTML = '';
      if (!items.length) { list.appendChild(empty('mic', B('no memos yet', 'තවම හඬ සටහන් නැත'))); return; }
      items.forEach((m, i) => {
        const audio = h('audio', { controls: true, style: { width: '100%', marginTop: '6px', display: 'none' } });
        const node = row({
          icon: 'music', color: ['#f5626c', '#3d0d12'], title: m.name,
          sub: `${fmtDur(m.ms || 0)} · ${Math.round((m.size || 0) / 1024)} KiB · ${new Date(m.at).toLocaleTimeString()}`,
          onTap: async () => {
            const show = audio.style.display === 'none';
            audio.style.display = show ? 'block' : 'none';
            if (show && !audio.src) audio.src = await ctx.api.fs.read(m.path);
            if (show) audio.play().catch(() => {});
          },
        });
        node.appendChild(h('div', { style: { flex: '0 0 auto', display: 'flex', gap: '4px' } },
          h('button.btn.icon', { onclick: async (e) => { e.stopPropagation(); const v = await prompt({ title: B('Rename', 'නම වෙනස්'), value: m.name }); if (v) { await ctx.api.fs.move(m.path, `/sdcard/Music/${v}`); m.name = v; m.path = `/sdcard/Music/${v}`; await ctx.api.store.set('index', items); paint(); } }, html: icon('edit', 15) }),
          h('button.btn.icon', { onclick: async (e) => { e.stopPropagation(); if (!await confirm({ title: B('Delete memo?', 'හඬ සටහන මකන්නද?'), danger: true })) return; await ctx.api.fs.rm(m.path).catch(() => {}); items.splice(i, 1); await ctx.api.store.set('index', items); paint(); }, html: icon('trash', 15) })));
        list.appendChild(h('div', node, audio));
      });
    }
    ctx.api.store.get('index').then((v) => { if (Array.isArray(v)) { items = v; paint(); } });
    const ui = scaffold(ctx, {
      title: { en: 'Voice Memo', si: 'හඬ සටහන' }, back: false,
      body: [h('div.card', { style: { textAlign: 'center', padding: '14px' } }, h('div.row-flex', { style: { justifyContent: 'center', gap: '6px' } }, dot, h('span.tiny.muted', B('recording goes to /sdcard/Music', 'පටිගත කිරීම් /sdcard/Music වෙත'))), big, btn),
        h('h4', { style: { margin: '16px 2px 6px' } }, B('Memos', 'සටහන්')), list],
    });
    paint();
    return { el: ui.el, destroy: () => { stop(); clearInterval(ticker); } };
  },
};
