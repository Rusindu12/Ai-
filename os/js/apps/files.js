/* Dahat OS — Files: a browser over /sdcard and the app sandbox. */
import { h, icon, clear, fmtBytes, fmtAgo } from '../ui/dom.js';
import { scaffold, row, empty } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { log } from '../kernel/log.js';
import { confirm, prompt, sheet, toast, listSheet } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });
const ICOS = { md: 'notes', txt: 'file', json: 'cpu', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', mp3: 'music', wav: 'music', ogg: 'music' };

export default {
  id: 'files',
  create(ctx) {
    let path = '/sdcard';
    let sort = 'name';
    let clip = null;
    let editing = null;

    const ui = scaffold(ctx, {
      title: B('Files', 'ගොනු'),
      back: false,
      actions: [
        { id: 'up', icon: 'up', label: B('Up one level', 'ඉහළට'), run: () => cd(path.split('/').slice(0, -1).join('/') || '/') },
        { id: 'sort', icon: 'filter', label: B('Sort', 'පෙළගැස්ම'), run: () => pickSort() },
        { id: 'more', icon: 'dots', label: B('More', 'තව'), run: () => overflow() },
      ],
      fab: { icon: 'plus', run: () => newFile() },
    });
    const crumbs = h('div.row-flex', { style: { gap: '4px', flexWrap: 'wrap', marginBottom: '10px' } });
    const list = h('div.list');
    const foot = h('div.tiny.muted', { style: { marginTop: '12px', textAlign: 'center' } });

    async function cd(p) {
      path = p || '/';
      try { await ctx.api.fs.dir(path); }
      catch (e) {
        if (e.code === 'EACCES') { toast(B('Dahat asked for storage access — allow it to browse your files', 'ගබඩා අවසරය අවශ්‍යයි')); return; }
        throw e;
      }
      paint();
    }

    async function paint() {
      ui.setTitle(path === '/sdcard' ? B('Files', 'ගොනු') : path.split('/').pop() || '/');
      ui.setSubtitle(path);
      clear(crumbs);
      const parts = path.split('/').filter(Boolean);
      crumbs.appendChild(crumb('/', 'sdcard' === parts[0] ? '⌂' : '⌂'));
      let acc = '';
      parts.forEach((seg) => { acc += `/${seg}`; crumbs.appendChild(h('span', { html: icon('right', 12), style: { opacity: '.4' } })); crumbs.appendChild(crumb(acc, seg)); });
      let entries = [];
      try { entries = await ctx.api.fs.ls(path); } catch (e) { clear(list); list.appendChild(empty('shield', e.message)); return; }
      entries = sortEntries(entries);
      clear(list);
      if (!entries.length) list.appendChild(empty('folder', B('this folder is empty', 'මෙම ෆෝල්ඩරය හිස්ය'), h('button.btn', { onclick: newFile, text: B('New file', 'නව ගොනුව') })));
      entries.forEach((e) => list.appendChild(entryRow(e)));
      ui.setBody(crumbs, list, foot);
      const bytes = entries.reduce((s, e) => s + (e.type === 'file' ? e.size : 0), 0);
      const df = await ctx.api.fs.df();
      foot.textContent = `${entries.length} ${B('items', 'අයිතම')} · ${fmtBytes(bytes)} · ${fmtBytes(df.free)} ${B('free', 'හිස්')}`;
    }
    const crumb = (p, label) => h('button.chip', { onclick: () => cd(p) }, label);
    function sortEntries(list) {
      const dirRank = (e) => (e.type === 'dir' ? 0 : 1);
      return [...list].sort((a, b) => dirRank(a) - dirRank(b)
        || (sort === 'size' ? b.size - a.size : sort === 'date' ? b.mtime - a.mtime : a.name.localeCompare(b.name, undefined, { numeric: true })));
    }
    function extOf(n) { return (n.split('.').pop() || '').toLowerCase(); }
    function entryRow(e) {
      const isDir = e.type === 'dir';
      const ic = isDir ? 'folder' : (ICOS[extOf(e.name)] || 'file');
      const r = row({
        icon: ic,
        color: isDir ? ['#f2b134', '#5c3a06'] : ['#5b6b80', '#1b222c'],
        title: e.name,
        sub: `${isDir ? B('folder', 'ෆෝල්ඩරය') : fmtBytes(e.size)} · ${fmtAgo(e.mtime, i18n.lang)}`,
        trailing: clip === e.path ? h('span.chip.on', B('in clipboard', 'ක්ලිප්බෝඩ්')) : null,
        onTap: () => (isDir ? cd(e.path) : openFile(e)),
      });
      let lp = null;
      r.addEventListener('pointerdown', () => { lp = setTimeout(() => itemMenu(e), 400); });
      ['pointerup', 'pointerleave', 'pointercancel', 'contextmenu'].forEach((ev) => r.addEventListener(ev, (x) => { if (ev === 'contextmenu') x.preventDefault(); clearTimeout(lp); }, { passive: ev !== 'contextmenu' }));
      return r;
    }

    async function openFile(e) {
      const data = await ctx.api.fs.read(e.path);
      const img = /^image\//.test(e.mime || '') || (typeof data === 'string' && data.startsWith('data:image'));
      if (img) {
        const el = h('div', { style: { padding: '10px' } }, h('img', { src: data, style: { width: '100%', borderRadius: '14px', display: 'block' } }),
          h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } },
            h('button.btn', { onclick: () => { URL.revokeObjectURL && sheetImageActions(data); }, text: B('Actions', 'ක්‍රියා') })),
          h('div.tiny.muted', { style: { marginTop: '8px' }, text: `${e.name} · ${fmtBytes(e.size)}` }));
        return viewer(e.name, el);
      }
      const ta = h('textarea.input', { style: { minHeight: '52vh', fontFamily: 'ui-monospace,monospace', fontSize: '12.5px', lineHeight: '1.6' }, value: typeof data === 'string' ? data : JSON.stringify(data, null, 2) });
      const saveState = h('span.chip', B('saved', 'සුරකින ලදී'));
      let dirty = false;
      const save = async () => {
        if (!dirty) return;
        await ctx.api.fs.write(e.path, ta.value, { mime: e.mime || 'text/plain' });
        dirty = false;
        saveState.textContent = B('saved', 'සුරකින ලදී');
        saveState.className = 'chip';
        toast(`${B('wrote', 'ලිවීය')}: ${e.path}`);
        log.info('files', `saved ${e.path} (${ta.value.length}B)`);
      };
      ta.addEventListener('input', () => { dirty = true; saveState.textContent = B('unsaved', 'නොසුරකින'); saveState.className = 'chip warn'; });
      ta.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); save(); } });
      editing = { path: e.path, save, isDirty: () => dirty };
      viewer(e.name, h('div', ta), {
        right: h('button.btn.primary', { onclick: async () => { await save(); }, text: B('Save', 'සුරකින්න') }),
        onClose: async () => { if (dirty) { const ok = await confirm({ title: B('Save changes?', 'වෙනස්කම් සුරකින්නද?'), ok: B('Save', 'සුරකින්න'), cancel: B('Discard', 'අවලංගු') }); if (ok) await save(); } editing = null; },
      });
    }
    function viewer(title, node, { right = null, onClose } = {}) {
      const sc = h('div.scrim', { style: { alignItems: 'stretch', padding: '0', background: 'var(--bg)' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
          h('div.app-bar', h('button.btn.icon', { onclick: close, html: icon('x', 19) }), h('span.title', title), h('span', { style: { flex: '1' } }), right),
          h('div.app-body', node)));
      document.getElementById('screen').appendChild(sc);
      async function close() {
        await onClose?.();
        sc.remove();
      }
    }
    function sheetImageActions(data) {
      listSheet(B('Image', 'රූපය'), [
        { id: 'dl', icon: 'download', label: B('Download', 'බාගන්න'), onTap: () => download(data) },
        { id: 'share', icon: 'share', label: B('Share', 'බෙදාගන්න'), onTap: () => ctx.api.app.share({ title: 'image', url: null, text: data?.slice(0, 60) }) },
        { id: 'del', icon: 'trash', label: B('Delete', 'මකන්න'), onTap: async () => { await ctx.api.fs.rm(pathFileFromViewer(), { recursive: false }).catch(() => {}); } },
      ]);
    }
    const pathFileFromViewer = () => path;

    async function itemMenu(e) {
      const isDir = e.type === 'dir';
      const items = [
        { id: 'open', icon: 'arrowright', label: isDir ? B('Open folder', 'ෆෝල්ඩරය විවෘත') : B('Open', 'විවෘත කරන්න'), onTap: () => (isDir ? cd(e.path) : openFile(e)) },
        { id: 'rename', icon: 'edit', label: B('Rename', 'නම වෙනස් කරන්න'), onTap: async () => { const v = await prompt({ title: B('Rename', 'නම වෙනස් කරන්න'), value: e.name }); if (v && v !== e.name) { await ctx.api.fs.move(e.path, `${path}/${v}`); toast(B('renamed', 'නම වෙනස් කෙරිණි')); paint(); } } },
        { id: 'copy', icon: 'copy', label: B('Copy path', 'මග පිටපත්'), onTap: () => ctx.api.bus.call('clip.set', { text: e.path }, { appId: 'files', pid: ctx.pid }).then(() => toast(B('path copied', 'මග පිටපත් කෙරිණි'))) },
        { id: 'clip', icon: 'layers', label: clip ? B('Move clipboard here', 'ක්ලිප්බෝඩ් මෙතැනට') : B('Copy to clipboard', 'ක්ලිප්බෝඩ් වෙත පිටපත්'), onTap: async () => {
          if (clip) { const name = clip.split('/').pop(); await ctx.api.fs.move(clip, `${path}/${name}`); clip = null; toast(B('moved', 'ගෙනියන ලදී')); paint(); }
          else { clip = e.path; toast(`${B('clipboard', 'ක්ලිප්බෝඩ්')}: ${e.name}`); paint(); }
        } },
      ];
      if (!isDir) items.push({ id: 'dl', icon: 'download', label: B('Download', 'බාගන්න'), onTap: async () => download(await ctx.api.fs.read(e.path), e.name) });
      items.push({ id: 'dup', icon: 'copy', label: B('Duplicate', 'පිටපතක්'), onTap: async () => { if (isDir) return; const data = await ctx.api.fs.read(e.path); const base = e.name.replace(/(\.\w+)?$/, ''); await ctx.api.fs.write(`${path}/${base}-copy${extOf(e.name) ? '.' + extOf(e.name) : ''}`, data); paint(); } });
      items.push({ id: 'del', icon: 'trash', label: B('Delete', 'මකන්න'), onTap: async () => {
        if (!await confirm({ title: `${B('Delete', 'මකන්න')} ${e.name}?`, body: B('This cannot be undone.', 'මෙය ආපසු හැරවිය නොහැක.'), danger: true, ok: B('Delete', 'මකන්න') })) return;
        await ctx.api.fs.rm(e.path, { recursive: true });
        log.info('files', `deleted ${e.path}`);
        paint();
      } });
      listSheet(e.name, items);
    }

    async function newFile() {
      const name = await prompt({ title: B('New file in', 'නව ගොනුව'), label: path, value: 'untitled.md', placeholder: 'notes.md' });
      if (!name) return;
      const p = `${path.replace(/\/$/, '')}/${name}`;
      await ctx.api.fs.write(p, `# ${name.replace(/\.\w+$/, '')}\n\n`);
      toast(`${B('created', 'සාදන ලදී')}: ${p}`);
      paint();
    }
    async function newFolder() {
      const name = await prompt({ title: B('New folder', 'නව ෆෝල්ඩරය'), label: path, value: 'New folder' });
      if (!name) return;
      await ctx.api.fs.mkdir(`${path}/${name}`);
      paint();
    }
    function pickSort() {
      listSheet(B('Sort by', 'පෙළගස්වන්න'), ['name', 'size', 'date'].map((s) => ({
        id: s, icon: s === 'name' ? 'list' : s === 'size' ? 'storage' : 'calendar', label: B(s, s === 'name' ? 'නම' : s === 'size' ? 'ප්‍රමාණය' : 'දිනය'),
        onTap: () => { sort = s; paint(); },
      })));
    }
    function overflow() {
      const dir = path;
      sheet(h('div.list',
        btn2('plus', B('New file', 'නව ගොනුව'), newFile),
        btn2('folder', B('New folder', 'නව ෆෝල්ඩරය'), newFolder),
        btn2('download', B('Import from device', 'උපාංගයෙන් ආයත'), importFile),
        btn2('copy', B('Paste here', 'මෙතැනට ඇලවීම'), async () => { if (!clip) { toast(B('clipboard is empty', 'ක්ලිප්බෝඩ් එක හිස්')); return; } const name = clip.split('/').pop(); await ctx.api.fs.read(clip).then((d) => ctx.api.fs.write(`${dir}/${name}`, d)).catch(() => ctx.api.fs.mkdir(`${dir}/${name}`, {})); paint(); }),
        btn2('search', B('Jump to…', 'යන්න'), () => jumpTo()),
        btn2('storage', B('Volume info', 'පරිමාණ තොරතුරු'), () => volumeInfo())
      ), { title: B('Files', 'ගොනු') });
    }
    const btn2 = (ic, label, fn) => h('button.row', { onclick: () => document.querySelector('.scrim')?.__done?.(), },
      h('span.r-ico', { html: icon(ic, 17), style: { background: 'var(--surface-3)', color: 'var(--text)' } }), h('span.r-title', label));

    function jumpTo() {
      const spots = ['/sdcard', '/sdcard/Notes', '/sdcard/DCIM', '/sdcard/Download', '/sdcard/Documents', '/sdcard/Music', '/tmp', `/apps/${ctx.appId}`];
      listSheet(B('Go to', 'යන්න'), spots.map((s) => ({ id: s, icon: s === '/tmp' ? 'zap' : 'folder', label: s, onTap: () => cd(s) })));
    }
    async function volumeInfo() {
      const df = await ctx.api.fs.df();
      sheet(h('div', ...Object.entries(df).map(([k, v]) => h('div.row-flex', { style: { justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)' } },
        h('span.muted', k), h('b', { text: k === 'total' || k === 'used' || k === 'free' ? fmtBytes(v) : String(v) })))),
      { title: B('Dahat volume', 'දහත් පරිමාව') });
    }
    function download(data, name = `file-${Date.now()}`) {
      const blob = new Blob([data], { type: 'text/plain' });
      const a = h('a', { href: URL.createObjectURL(blob), download: name, style: { display: 'none' } });
      document.body.appendChild(a); a.click(); a.remove();
    }
    function importFile() {
      const inp = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: async () => {
        for (const f of [...(inp.files || [])]) {
          const text = f.type.startsWith('image/') || f.type.startsWith('audio/') ? await readAsDataURL(f) : await f.text();
          await ctx.api.fs.write(`${path}/${f.name}`, text, { mime: f.type });
        }
        toast(B('imported', 'ආයත කෙරිණි'));
        inp.remove();
        paint();
      } });
      document.body.appendChild(inp);
      inp.click();
    }
    const readAsDataURL = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });

    cd(ctx.params?.open ? ctx.params.open.replace(/\/[^/]*$/, '/') : '/sdcard');
    return {
      el: ui.el,
      onResume: () => paint(),
      destroy: () => { editing?.save?.(); },
    };
  },
};
