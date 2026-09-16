/* Dahat OS — Notes: markdown files in /sdcard/Notes, nothing else.
 * There is no note database — delete the file in Files and it is gone.
 */
import { h, icon, clear, fmtAgo } from '../ui/dom.js';
import { scaffold, row, empty, seg } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { confirm, prompt, toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });
const DIR = '/sdcard/Notes';
const parse = (raw, name) => {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw || '');
  const meta = {};
  if (m) m[1].split('\n').forEach((l) => { const [k, ...r] = l.split(':'); meta[k.trim()] = r.join(':').trim(); });
  const body = m ? raw.slice(m[0].length) : raw || '';
  const first = body.split('\n').find((l) => l.trim());
  return { name, title: meta.title || (first || name).replace(/^#+\s*/, '').slice(0, 60) || name, pinned: meta.pinned === '1', tags: meta.tags ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean) : [], body, at: Number(meta.at) || 0 };
};
const serial = (n) => `---\ntitle: ${n.title}\npinned: ${n.pinned ? 1 : 0}\ntags: ${(n.tags || []).join(', ')}\nat: ${Date.now()}\n---\n${n.body.replace(/^\s*\n/, '')}`;

export default {
  id: 'notes',
  create(ctx) {
    let notes = [];
    let mode = 'all';
    let current = null;
    let filter = '';

    const input = h('input', { placeholder: B('Search notes', 'සටහන් සොයන්න'), value: '', oninput: (e) => { filter = e.target.value; paint(); }, style: { flex: '1', border: '0', background: 'none', outline: '0', fontSize: '13px' } });
    const search = h('div.drawer-search', { style: { margin: '0 0 10px' } }, h('span', { html: icon('search', 15) }), input);
    const segEl = seg([{ id: 'all', label: B('All', 'සියල්ල') }, { id: 'pinned', label: B('Pinned', 'අමුණා') }, { id: 'tag', label: B('Tags', 'ටැග්') }], 'all', (v) => { mode = v; paint(); });
    const listBox = h('div');
    const foot = h('div.tiny.muted', { style: { textAlign: 'center', marginTop: '10px' } });
    const ui = scaffold(ctx, {
      title: B('Notes', 'සටහන්'), back: false,
      actions: [{ id: 'new', icon: 'edit', label: B('New note', 'නව සටහන'), run: () => create() }],
      fab: { icon: 'plus', run: () => create() },
      body: [search, segEl, listBox, foot],
    });

    async function load() {
      try { await ctx.api.fs.mkdir(DIR); } catch { /* exists */ }
      const entries = await ctx.api.fs.ls(DIR).catch(() => []);
      notes = [];
      for (const e of entries.filter((x) => x.type === 'file' && /\.(md|txt)$/i.test(x.name))) {
        const raw = await ctx.api.fs.read(e.path).catch(() => '');
        const n = parse(raw, e.name);
        notes.push({ ...n, path: e.path, mtime: e.mtime, size: e.size });
      }
      notes.sort((a, b) => (b.pinned - a.pinned) || (b.mtime - a.mtime));
      paint();
    }

    function paint() {
      const q = filter.toLowerCase();
      const shown = notes.filter((n) => (mode === 'pinned' ? n.pinned : true)
        && (!q || `${n.title} ${n.body}`.toLowerCase().includes(q)));
      clear(listBox);
      if (!shown.length) {
        listBox.appendChild(empty('notes', notes.length ? B('no matches', 'ගැළපීමක් නැත') : B('no notes yet — tap + to write one', 'තවම සටහන් නැත'),
          h('button.btn.primary', { onclick: () => create(), text: B('Write a note', 'සටහනක් ලියන්න') })));
      } else {
        shown.forEach((n) => listBox.appendChild(row({
          icon: n.pinned ? 'star' : 'notes',
          color: n.pinned ? ['#f2b134', '#5c3a06'] : ['#12b7a2', '#053b35'],
          title: (n.title || n.name).slice(0, 54),
          sub: `${n.body.replace(/[#*`>_-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || B('empty', 'හිස්')} · ${fmtAgo(n.mtime, i18n.lang)}`,
          trailing: n.tags?.length ? h('span.chip', n.tags[0]) : null,
          onTap: () => edit(n),
        })));
      }
      foot.textContent = `${notes.length} ${B('notes', 'සටහන්')} · ${DIR}`;
      ui.setSubtitle(B('stored in your filesystem', 'ගොනු පද්ධතියේ'));
    }

    async function create(seed = '') {
      const name = `note-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.md`;
      const path = `${DIR}/${name}`;
      const n = { name, path, title: B('New note', 'නව සටහන'), pinned: false, tags: [], body: seed, mtime: Date.now(), size: 0 };
      await ctx.api.fs.write(path, serial({ ...n, body: `# ${n.title}\n${seed}` }));
      await load();
      edit(notes.find((x) => x.path === path) || n);
    }

    function edit(n) {
      const ta = h('textarea.input', { style: { minHeight: '58vh', fontFamily: "'Dahat Sans','Noto Sans Sinhala',ui-monospace,monospace", lineHeight: '1.65', fontSize: '14px' }, value: n.body || `# ${n.title}\n\n` });
      const stats = h('div.tiny.mono.muted');
      let dirty = false;
      const save = async (quiet = true) => {
        const out = { ...n, title: (ta.value.split('\n')[0] || '').replace(/^#+\s*/, '').slice(0, 60) || n.title, body: ta.value };
        await ctx.api.fs.write(n.path, serial(out));
        dirty = false;
        n.title = out.title;
        n.body = out.body;
        if (!quiet) toast(B('saved', 'සුරකින ලදී'));
      };
      const count = () => {
        const words = ta.value.trim().split(/\s+/).filter(Boolean).length;
        stats.textContent = `${words} ${B('words', 'වචන')} · ${ta.value.length}B · ${dirty ? B('unsaved', 'නොසුරකින') : B('saved', 'සුරකින ලදී')}`;
      };
      ta.addEventListener('input', () => { dirty = true; count(); scheduleSave(); });
      let t = null;
      const scheduleSave = () => { clearTimeout(t); t = setTimeout(() => save().then(count), 700); };
      const pin = h('button.btn', { onclick: () => { n.pinned = !n.pinned; save(); toast(n.pinned ? B('pinned', 'අමුණා ඇත') : B('unpinned', 'ඉවත් කෙරිණි')); paint(); }, html: `${icon('star', 15)} ${n.pinned ? B('Unpin', 'ඉවත්') : B('Pin', 'අමුණන්න')}` });
      const tagBtn = h('button.btn', { onclick: async () => { const v = await prompt({ title: B('Tags', 'ටැග්'), value: (n.tags || []).join(', '), hint: 'comma separated' }); if (v !== null) { n.tags = v.split(',').map((x) => x.trim()).filter(Boolean); await save(); } }, html: `${icon('list', 15)} ${B('Tags', 'ටැග්')}` });
      const del = h('button.btn.danger', { onclick: async () => { if (!await confirm({ title: B('Delete this note?', 'මෙම සටහන මකන්නද?'), danger: true, ok: B('Delete', 'මකන්න') })) return; await ctx.api.fs.rm(n.path); toast(B('deleted', 'මකා දමන ලදී')); close(); await load(); }, html: `${icon('trash', 15)} ${B('Delete', 'මකන්න')}` });
      const bar = h('div.app-bar',
        h('button.btn.icon', { onclick: close, html: icon('left', 19) }),
        h('span.title', n.title || n.name), h('span', { style: { flex: '1' } }),
        h('button.btn.icon', { onclick: () => { save(); ta.value += '\n\n- [ ] '; ta.dispatchEvent(new Event('input')); }, html: icon('todo', 18), title: B('checkbox', 'කොටුව') }),
        h('button.btn.icon', { onclick: () => ctx.api.app.share({ title: n.title, text: n.body }), html: icon('share', 18), title: B('share', 'බෙදාගන්න') }));
      const sc = h('div.scrim', { style: { alignItems: 'stretch', padding: '0', background: 'var(--bg)' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, bar,
          h('div.app-body', { style: { paddingBottom: '4px' } }, ta, h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } }, pin, tagBtn, del), stats),
          h('div.row-flex', { style: { padding: '8px 12px 14px', borderTop: '1px solid var(--line)' } },
            h('button.btn.primary', { style: { flex: '1' }, onclick: async () => { await save(false); close(); await load(); }, text: B('Save', 'සුරකින්න') }))));
      document.getElementById('screen').appendChild(sc);
      count();
      setTimeout(() => ta.focus(), 60);
      function close() { clearTimeout(t); sc.remove(); }
    }

    load();
    return {
      el: ui.el,
      onParams: (p) => { if (p?.open) { const n = notes.find((x) => x.path === p.open); if (n) edit(n); } },
      onResume: () => { paint(); },
      destroy: () => ctx.api.notif.post({ title: B('Notes', 'සටහන්'), body: B('autosaved to /sdcard/Notes', '/sdcard/Notes වෙත ස්වයංක්‍රීයව සුරැකිණි') }).catch(() => {}),
    };
  },
};
