/* Dahat OS — Gallery: reads image files out of the VFS and nothing else. */
import { h, icon, clear, fmtBytes, fmtAgo } from '../ui/dom.js';
import { scaffold, empty } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { confirm, toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });
const isImage = (e) => e.type === 'file' && (/^image\//.test(e.mime || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(e.name));

export default {
  id: 'gallery',
  create(ctx) {
    let items = [];
    let idx = -1;
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px' } });
    const ui = scaffold(ctx, {
      title: B('Gallery', 'ඡායාගාලරිය'), back: false,
      actions: [{ id: 'refresh', icon: 'refresh', label: B('Rescan', 'නැවත ස্কෑන්'), run: () => scan() }],
      body: [h('div.tiny.muted', { id: 'gal-sub', style: { marginBottom: '8px' } }), grid],
    });

    async function scan() {
      const found = [];
      const walk = async (dir) => {
        let entries = [];
        try { entries = await ctx.api.fs.ls(dir); } catch { return; }
        for (const e of entries) {
          if (e.type === 'dir' && !/DCIM|Pictures|Download|Documents/.test(e.name) && found.length > 400) continue;
          if (e.type === 'dir') await walk(e.path);
          else if (isImage(e)) found.push(e);
        }
      };
      await walk('/sdcard');
      items = found.sort((a, b) => b.mtime - a.mtime);
      paint();
    }
    function paint() {
      clear(grid);
      const sub = ui.el.querySelector('#gal-sub');
      if (sub) sub.textContent = `${items.length} ${B('images on this volume', 'රූප')} · ${fmtBytes(items.reduce((s, e) => s + e.size, 0))}`;
      if (!items.length) { grid.appendChild(empty('image', B('no photos yet — the Camera app writes them here', 'තවම ඡායාරූප නැත'), h('button.btn.primary', { onclick: () => ctx.api.app.open('camera'), text: B('Open Camera', 'කැමරාව විවෘත') }))); return; }
      items.forEach((e, i) => {
        const img = h('img', { src: '', alt: e.name, loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } });
        const cell = h('button', {
          style: { aspectRatio: '1', padding: 0, border: '1px solid var(--line)', borderRadius: '10px', overflow: 'hidden', background: 'var(--surface-3)', cursor: 'pointer' },
          onclick: () => openAt(i),
        }, img);
        grid.appendChild(cell);
        ctx.api.fs.read(e.path).then((d) => { img.src = d; }).catch(() => { cell.innerHTML = `<span style="opacity:.5">${icon('image', 18)}</span>`; });
      });
    }

    function openAt(i) {
      idx = i;
      const e = items[i];
      if (!e) return;
      const img = h('img', { style: { maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '10px', display: 'block', margin: '0 auto' } });
      ctx.api.fs.read(e.path).then((d) => { img.src = d; });
      const info = h('div.tiny.mono.muted', { text: `${e.name} · ${fmtBytes(e.size)} · ${fmtAgo(e.mtime, i18n.lang)}` });
      const acts = h('div.row-flex', { style: { gap: '8px', flexWrap: 'wrap', marginTop: '12px', justifyContent: 'center' } },
        h('button.btn', { onclick: () => setWallpaper(e), text: B('Set as wallpaper', 'තිරපසය කරන්න') }),
        h('button.btn', { onclick: () => share(e), text: B('Share', 'බෙදාගන්න') }),
        h('button.btn', { onclick: () => download(e), text: B('Download', 'බාගන්න') }),
        h('button.btn.danger', { onclick: () => del(e), text: B('Delete', 'මකන්න') }));
      const wrap = h('div', img, info, acts);
      const sc = h('div.scrim', { style: { alignItems: 'center', overflow: 'auto' }, onclick: (ev) => { if (ev.target === sc) sc.remove(); } },
        h('div', { style: { width: '100%', maxWidth: '420px' } },
          h('div.row-flex', { style: { justifyContent: 'space-between', marginBottom: '8px' } },
            h('button.btn.icon', { onclick: () => { sc.remove(); openAt(Math.max(0, idx - 1)); }, html: icon('left', 18) }),
            h('span.chip', `${idx + 1} / ${items.length}`),
            h('button.btn.icon', { onclick: () => { sc.remove(); openAt(Math.min(items.length - 1, idx + 1)); }, html: icon('right', 18) })),
          wrap));
      document.getElementById('screen').appendChild(sc);
    }
    async function del(e) {
      if (!await confirm({ title: B('Delete this photo?', 'මෙම ඡායාරූපය මකන්නද?'), body: e.path, danger: true, ok: B('Delete', 'මකන්න') })) return;
      await ctx.api.fs.rm(e.path);
      document.querySelector('.scrim')?.remove();
      toast(B('deleted', 'මකා දමන ලදී'));
      scan();
    }
    async function share(e) {
      const data = await ctx.api.fs.read(e.path);
      try {
        const blob = await (await fetch(data)).blob();
        const file = new File([blob], e.name, { type: e.mime || 'image/jpeg' });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: e.name }); return; }
      } catch { /* fall back to text share */ }
      await ctx.api.app.share({ title: e.name, text: B('a photo from Dahat OS', 'දහත් OS හි ඡායාරූපයක්') });
    }
    function download(e) {
      ctx.api.fs.read(e.path).then((d) => {
        const a = h('a', { href: d, download: e.name, style: { display: 'none' } });
        document.body.appendChild(a); a.click(); a.remove();
      });
    }
    /** The kernel owns the wallpaper: we ask for the `settings` capability and write
     * two keys — the image first, then the switch to 'custom', so the theme can never
     * read a half-updated pair. If the user denied us, the photo still stays in the
     * gallery's own sandbox and we say so instead of failing silently. */
    async function setWallpaper(e) {
      const data = await ctx.api.fs.read(e.path);
      await ctx.api.store.set('wallpaper', data).catch(() => {});
      if (await applyWallpaper(data)) { toast(B('wallpaper updated', 'තිරපසය යාවත්කාලීන කෙරිණි')); return; }
      const granted = await ctx.requestCap('settings', B('Gallery writes display.wallpaper so your photo becomes the system wallpaper', 'තිරපසයක් සක්‍රීය කිරීමට Gallery ට සැකසුම් ලිවිය යුතුය'));
      toast(granted && (await applyWallpaper(data))
        ? B('wallpaper updated', 'තිරපසය යාවත්කාලීන කෙරිණි')
        : B('saved in Gallery only — allow the “settings” permission to make it the wallpaper', 'Gallery තුළ පමණක් සුරැකිණි — තිරපසය කිරීමට “settings” අවසරය දෙන්න'));
    }
    async function applyWallpaper(data) {
      try {
        await ctx.api.settings.set('display.wallpaperData', data);
        await ctx.api.settings.set('display.wallpaper', 'custom');
        return true;
      } catch { return false; }
    }

    scan();
    return { el: ui.el, onResume: scan };
  },
};
