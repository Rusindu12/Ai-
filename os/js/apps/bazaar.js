/* Dahat OS — Bazaar: the app store. No account, no network: the catalogue ships
 * inside the OS, and "downloading" is the kernel verifying, unpacking and
 * registering a package it already has. That is honest — and it is also why
 * installs work on a plane.
 */
import { h, icon, clear, fmtBytes } from '../ui/dom.js';
import { scaffold, section, row, seg } from './kit.js';
import { pm } from '../kernel/pm.js';
import { PKGS, nameOf } from '../kernel/packages.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { confirm, toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'bazaar',
  create(ctx) {
    let tab = 'browse';
    const ui = scaffold(ctx, { title: B('Bazaar', 'බාසාරය'), back: false });
    const segEl = seg([
      { id: 'browse', label: B('Browse', 'බ්‍රවුස්') },
      { id: 'apps', label: B('Installed', 'ස්ථාපිත') },
      { id: 'manage', label: B('Manage', 'කළමනාකුම') },
    ], tab, (v) => { tab = v; paint(); });
    const list = h('div');
    const note = h('p.tiny.muted', { style: { textAlign: 'center', marginTop: '14px' } });
    ui.setBody(segEl, list, note);

    function paint() {
      clear(list);
      if (tab === 'browse') {
        const cats = {};
        PKGS.filter((p) => p.kind === 'bazaar').forEach((p) => { (cats[p.cat] = cats[p.cat] || []).push(p); });
        Object.entries(cats).forEach(([cat, pkgs]) => {
          list.appendChild(h('div', { style: { margin: '14px 2px 6px', fontWeight: '800', fontSize: '13px' } }, cat));
          pkgs.forEach((p) => list.appendChild(card(p)));
        });
        const n = PKGS.filter((p) => p.kind === 'bazaar').length;
        note.textContent = B(`${n} packages · signed by their authors · no account, no tracking`, `${n} පැකේජ · ගිණුමක් අවශ්‍ය නැත`);
      } else if (tab === 'apps') {
        PKGS.filter((p) => pm.isInstalled(p.id)).forEach((p) => list.appendChild(card(p)));
        note.textContent = B('everything you install shows up here', 'ඔබ ස්ථාපනය කරන සියල්ල මෙහි දිස්වේ');
      } else {
        const hist = pm.history.slice().reverse();
        const journal = hist.length
          ? h('div.list', ...hist.map((x) => row({
            icon: x.action === 'install' ? 'download' : 'trash',
            title: `${x.action} · ${x.id}`,
            sub: `${new Date(x.at).toLocaleString()} · via ${x.from}`,
          })))
          : h('div.tiny.muted', B('nothing installed or removed yet', 'තවම කිසිවක් නැත'));
        const safety = [
          [B('Runtime capabilities', 'ක්‍රියාකාරී අයිතිවාසිකම්'), B('An installed app starts with zero permissions. Each first use asks once, in the foreground.', 'ස්ථාපිත ඇප් එකක් අවසර රහිතව ආරම්භ වේ.')],
          [B('Sandbox', 'සැඟවුණු භූමිකාව'), B('Each package owns /apps/<id>. Shared space needs the storage capability.', 'සෑම පැකේජයකටම /apps/<id> පමණක්.')],
          [B('Kill switch', 'නවත්වන බොත්තම'), B('Revoke, force-stop or uninstall from Settings ▸ Apps at any time.', 'සැකසුම් ▸ ඇප් යටින් ඕනෑම වේලාවක ඉවත් කළ හැක.')],
        ].map(([t, s]) => h('div', { style: { padding: '7px 0', borderBottom: '1px solid var(--line)' } },
          h('div', { style: { fontWeight: '700', fontSize: '13px' } }, t), h('div.tiny.muted', s)));
        list.appendChild(section(B('Install journal', 'ස්ථාපන ලඝුපොත'), journal));
        list.appendChild(section(B('Safety model', 'ආරක්ෂක ආකෘතිය'), safety));
        note.textContent = B('Dahat Bazaar never talks to a server. Nothing here is a recommendation.', 'දහත් බාසාරය කිසිදු සේවාදායකයෙකු හා සම්බන්ධ නොවේ.');
      }
    }

    function card(p) {
      const installed = pm.isInstalled(p.id);
      const prog = h('i', { style: { display: 'block', height: '100%', width: '0%', background: 'var(--accent)', transition: 'width .15s' } });
      const bar = h('div', { style: { height: '5px', borderRadius: '9px', background: 'var(--surface-3)', overflow: 'hidden', display: 'none', marginTop: '8px' } }, prog);
      const status = h('div.tiny.mono.muted');
      const btn = h('button.btn', {
        style: { minWidth: '92px' },
        text: installed ? B('Open', 'විවෘත') : B('Install', 'ස්ථාපනය'),
        onclick: () => (installed ? openOrManage(p) : install(p, prog, bar, status)),
      });
      const meta = h('div.row-flex', { style: { gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
        h('span.chip', `v${p.version}`), h('span.chip', fmtBytes(p.size)),
        p.caps?.length ? h('span.chip.warn', `${p.caps.length} ${B('caps', 'අවසර')}`) : h('span.chip.ok', B('no permissions', 'අවසර නැත')),
        h('span.chip', p.author || 'Dahat'));
      const mid = h('div', { style: { flex: '1', minWidth: '0' } },
        h('div.row-flex', { style: { gap: '6px' } }, h('b', { style: { fontSize: '14px' } }, nameOf(p, i18n.lang)), h('span.chip', p.cat)),
        h('div.tiny.muted', { style: { marginTop: '2px' } }, i18n.bi(p.desc)),
        meta, bar, status);
      const avatar = h('span', {
        style: { width: '46px', height: '46px', borderRadius: '15px', flex: '0 0 auto', display: 'grid', placeItems: 'center', color: '#fff', background: `linear-gradient(150deg,${p.color[0]},${p.color[1]})` },
        html: icon(p.icon, 22),
      });
      return h('div.card', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } }, avatar, mid, btn);
    }

    async function openOrManage(p) {
      const r = await confirm({
        title: nameOf(p, i18n.lang),
        body: B('Open it, or manage its permissions and storage in Settings.', 'විවෘත කරන්න, නැතහොත් සැකසුම් වලින් කළමනාකුණු කරන්න.'),
        ok: B('Open', 'විවෘත කරන්න'), cancel: B('Manage', 'කළමනාකුණු'),
      });
      if (r) ctx.api.app.open(p.id);
      else ctx.api.app.open('settings', { appId: p.id });
      ctx.close();
    }

    async function install(p, prog, bar, status) {
      bar.style.display = 'block';
      actuate('tap');
      try {
        await pm.install(p.id, {
          from: 'bazaar',
          progress: (pct, msg) => { prog.style.width = `${pct}%`; status.textContent = `${pct}% · ${msg}`; },
        });
        status.textContent = B('installed · 0 bytes left the device', 'ස්ථාපිත · දත්ත බාහිරව ගොස් නැත');
        toast(`${nameOf(p, i18n.lang)} ${B('installed', 'ස්ථාපනය කෙරිණි')}`);
        paint();
      } catch (e) {
        status.textContent = e.message;
        toast(e.message);
      }
    }

    paint();
    return { el: ui.el, onResume: paint };
  },
};
