/* Dahat OS — Camera: getUserMedia → canvas → /sdcard/DCIM.
 * No upload, no EXIF library: the file is a plain JPEG written by the kernel.
 */
import { h, icon } from '../ui/dom.js';
import { scaffold } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'camera',
  async create(ctx) {
    const video = h('video', { playsinline: true, muted: true, autoplay: true, style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', background: '#000' } });
    const canvas = h('canvas', { style: { display: 'none' } });
    const grid = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none', background: 'linear-gradient(90deg,transparent 32.9%,rgba(255,255,255,.35) 33%,transparent 33.1%,transparent 66.2%,rgba(255,255,255,.35) 66.5%,transparent 66.8%),linear-gradient(0deg,transparent 32.9%,rgba(255,255,255,.35) 33%,transparent 33.1%,transparent 66.2%,rgba(255,255,255,.35) 66.5%,transparent 66.8%)' } });
    const chip = (txt) => `<span class="chip" style="backdrop-filter:blur(8px)">${txt}</span>`;
    const status = h('div', { style: { position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)', zIndex: '3' }, html: chip('…') });
    const stage = h('div', { style: { flex: '1', position: 'relative', overflow: 'hidden', background: '#000' } }, video, grid, canvas, status);
    let stream = null, facing = 'environment', shots = 0, watermark = true, showGrid = false, dead = false;
    const state = { ok: false };

    const shutter = h('button', {
      style: { width: '66px', height: '66px', borderRadius: '50%', border: '4px solid rgba(255,255,255,.9)', background: '#fff', cursor: 'pointer', boxShadow: '0 0 0 3px rgba(0,0,0,.25)' },
      onclick: () => shoot(),
      'aria-label': B('shutter', 'ෂටරය'),
    });
    const ctrl = (ic, label, fn, active = false) => h('button', {
      style: { width: '44px', height: '44px', borderRadius: '14px', border: '1px solid var(--line)', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? 'var(--accent-ink)' : 'var(--text)', display: 'grid', placeItems: 'center', cursor: 'pointer' },
      html: icon(ic, 19), title: label, onclick: fn,
    });
    const bar = h('div.row-flex', { style: { justifyContent: 'space-around', alignItems: 'center', padding: '12px 14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' } },
      ctrl('image', B('Gallery', 'ගැලරිය'), () => { ctx.api.app.open('gallery'); ctx.close(); }),
      shutter,
      ctrl('refresh', B('Flip', 'ආවර්තනය'), () => { facing = facing === 'environment' ? 'user' : 'environment'; open(); }),
      ctrl('apps', B('Grid', 'දැලක්'), (e) => { showGrid = !showGrid; grid.style.display = showGrid ? 'block' : 'none'; e.currentTarget.style.background = showGrid ? 'var(--accent)' : 'var(--surface-2)'; }),
      ctrl('edit', B('Watermark', 'ජල මුද්‍රාව'), (e) => { watermark = !watermark; e.currentTarget.style.background = watermark ? 'var(--accent)' : 'var(--surface-2)'; toast(watermark ? 'Dahat watermark on' : 'off'); }));

    const ui = scaffold(ctx, { title: B('Camera', 'කැමරාව'), back: false, body: [h('div', { style: { display: 'flex', flexDirection: 'column', position: 'absolute', inset: '0' } }, stage, bar)] });
    ui.el.style.background = '#000';

    async function open() {
      status.innerHTML = chip('requesting camera…');
      const ok = await ctx.requestCap('camera', B('Photos are written to /sdcard/DCIM by the kernel. Nothing is uploaded.', 'ඡායාරූප /sdcard/DCIM වෙත පමණක් ලියයි.'));
      if (!ok) { state.ok = false; return fallback(B('camera permission denied', 'කැමරා අවසරය ප්‍රතික්ෂේප කෙරිණි')); }
      try {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 } }, audio: false });
        video.srcObject = stream;
        await video.play();
        state.ok = true;
        const tr = stream.getVideoTracks()[0]?.getSettings?.();
        status.innerHTML = chip(`${tr ? `${tr.width}×${tr.height}` : 'live'} · ${facing === 'user' ? B('front', 'ඉදිරිපස') : B('back', 'පසුපස')}`);
      } catch (e) {
        state.ok = false;
        fallback(e.message);
      }
    }
    function fallback(msg) {
      status.innerHTML = chip(B('no camera here', 'කැමරාවක් නැත'));
      clearStage();
      stage.appendChild(h('div.empty', { style: { position: 'absolute', inset: '0' } },
        icon('camera', 34), h('span', B('This device did not give the OS a camera.', 'මෙම උපාංගය OS වෙත කැමරාව නොලබයි.')),
        h('div.tiny.mono', { text: String(msg).slice(0, 80) }),
        h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } },
          h('button.btn.primary', { onclick: open, text: B('Try again', 'නැවත උත්සාහ') }),
          h('button.btn', { onclick: () => importFile(), text: B('Import instead', 'ආයත කරන්න') }))))
      ;
    }
    function clearStage() { [video, grid].forEach((n) => n.remove()); }
    function importFile() {
      const inp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' }, onchange: async () => {
        const f = inp.files?.[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = async () => { await save(String(r.result)); };
        r.readAsDataURL(f);
        inp.remove();
      } });
      document.body.appendChild(inp);
      inp.click();
    }

    async function shoot() {
      if (!state.ok) { toast(B('no signal', 'සංඥාවක් නැත')); return; }
      actuate('heavy');
      flashFx();
      const w = video.videoWidth || 1280, hh = video.videoHeight || 720;
      canvas.width = w; canvas.height = hh;
      const c = canvas.getContext('2d');
      if (facing === 'user') { c.translate(w, 0); c.scale(-1, 1); }
      c.drawImage(video, 0, 0, w, hh);
      if (watermark) {
        c.font = `${Math.max(13, w / 46)}px 'Dahat Sans', sans-serif`;
        c.fillStyle = 'rgba(255,255,255,.72)';
        c.textAlign = 'right';
        c.fillText(`Dahat OS · ${new Date().toLocaleString()}`, w - 16, hh - 16);
      }
      await save(canvas.toDataURL('image/jpeg', 0.92));
    }
    let flashRaf = null;
    function flashFx() {
      const f = h('div', { style: { position: 'absolute', inset: '0', background: '#fff', opacity: '.85', transition: 'opacity .35s', zIndex: '4' } });
      stage.appendChild(f);
      // tracked frame: destroying the app mid-flash must not touch a detached node
      flashRaf = requestAnimationFrame(() => {
        flashRaf = null;
        f.style.opacity = '0';
        setTimeout(() => f.remove(), 380);
      });
    }
    async function save(dataUrl) {
      const d = new Date();
      const name = `dahat-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.jpg`;
      const path = `/sdcard/DCIM/${name}`;
      await ctx.api.fs.mkdir('/sdcard/DCIM').catch(() => {});
      const r = await ctx.api.fs.write(path, dataUrl, { mime: 'image/jpeg' });
      shots++;
      ctx.toast(`${B('saved', 'සුරැකිණි')} · ${name} (${Math.round(r.size / 1024)} KiB)`);
    }

    open();
    return {
      el: ui.el,
      onResume: () => { if (!state.ok) open(); },
      onPause: () => { if (stream) stream.getTracks().forEach((t) => t.enabled = false); },
      destroy: () => { dead = true; if (flashRaf != null) cancelAnimationFrame(flashRaf); if (stream) stream.getTracks().forEach((t) => t.stop()); },
    };
  },
};
