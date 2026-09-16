/* Dahat OS — Settings (the system app that drives kernel config) */
import { h, icon, clear, fmtBytes, fmtDur } from '../ui/dom.js';
import { scaffold, section, group, row, switchEl, seg, kv, progressbar } from './kit.js';
import { config, WALLPAPERS, ACCENTS } from '../kernel/config.js';
import { pm } from '../kernel/pm.js';
import { caps, CAPS } from '../kernel/caps.js';
import { vfs } from '../kernel/vfs.js';
import { power } from '../kernel/power.js';
import { sched } from '../kernel/sched.js';
import { log } from '../kernel/log.js';
import { bus } from '../kernel/bus.js';
import { storage } from '../kernel/storage.js';
import { notif } from '../kernel/notify.js';
import { nameOf, PKGS } from '../kernel/packages.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { confirm, prompt, toast, sheet } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'settings',
  create(ctx) {
    const ui = scaffold(ctx, {
      title: { en: 'Settings', si: 'සැකසුම්' },
      subtitle: 'Dahat 1.0.0',
      back: false,
    });
    const stack = [];
    const go = (render, label) => { stack.push({ render, label }); paint(); };
    const back = () => { stack.pop(); paint(); };
    function paint() {
      const top = stack[stack.length - 1];
      clear(ui.body);
      ui.setTitle(top ? top.label : B('Settings', 'සැකසුම්'));
      const node = top ? top.render() : rootPage();
      if (top) node.insertBefore(h('button.btn.text', { style: { marginBottom: '8px' }, onclick: back, html: `${icon('left', 15)} ${B('All settings', 'සියලු සැකසුම්')}` }), node.firstChild);
      ui.body.appendChild(node);
    }
    const set = (k, v) => { ctx.api.settings.set(k, v); config.set(k, v); };
    const get = (k) => config.get(k);

    // ---------- pages ----------
    function rootPage() {
      const st = power.status;
      const df = vfs.df();
      return h('div',
        h('div.card', { style: { background: 'linear-gradient(150deg,rgba(18,183,162,.18),transparent)', display: 'flex', gap: '12px', alignItems: 'center' } },
          h('span', { style: { width: '44px', height: '44px', borderRadius: '16px', display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: '20px', fontWeight: '700' }, text: 'ධ' }),
          h('div', { style: { flex: '1' } },
            h('div', { style: { fontWeight: '800' } }, get('device.name') || 'Dahat One'),
            h('div.tiny.muted', `Dahat OS 1.0.0 · ${pm.installedIds.length} ${B('apps', 'ඇප්')} · ${B('up', 'ක්‍රියාකාරී')} ${fmtDur(log.uptime)}`)),
          h('span', { html: icon('right', 16), style: { color: 'var(--text-3)' } })),
        group(
          row({ icon: 'wifi', color: ['#4cc4ff', '#0d2c3f'], title: B('Network & radios', 'ජාලය සහ රේඩියෝ'), sub: `${st.online ? B('Online', 'බැඳී ඇත') : B('Offline', 'බැඳී නැත')}${get('net.airplane') ? ' · ' + B('airplane', 'ගුවන්') : ''}`, onTap: () => go(netPage, B('Network', 'ජාලය')) }),
          row({ icon: 'palette', color: ['#8b7bff', '#221d42'], title: B('Display & wallpaper', 'තිරය සහ තිරපසය'), sub: `${get('display.theme')} · ${WALLPAPERS[get('display.wallpaper')].label}`, onTap: () => go(displayPage, B('Display', 'තිරය')) }),
          row({ icon: 'volume', color: ['#f2b134', '#5c3a06'], title: B('Sound & haptics', 'ශබ්දය සහ කම්පන'), sub: `${get('input.sound') === false ? B('silent', 'නිහඬ') : B('sound on', 'ශබ්දය සක්‍රීය')} · ${get('input.haptics') === false ? B('no haptics', 'කම්ප නැත') : B('haptics on', 'කම්ප සක්‍රීය')}`, onTap: () => go(soundPage, B('Sound', 'ශබ්දය')) }),
          row({ icon: 'apps', color: ['#12b7a2', '#05362f'], title: B('Apps', 'ඇප්'), sub: `${pm.installedIds.length} ${B('installed', 'ස්ථාපිත')}${notif.count() ? ` · ${notif.count()} ${B('notifications', 'දැනුම්දීම්')}` : ''}`, onTap: () => go(appsPage, B('Apps', 'ඇප්')) }),
          row({ icon: 'shield', color: ['#37c978', '#0a3d24'], title: B('Permissions', 'අවසර'), sub: permSummary(), onTap: () => go(permPage, B('Permissions', 'අවසර')) }),
          row({ icon: 'lock', color: ['#ff7a59', '#4a1a10'], title: B('Security', 'ආරක්ෂාව'), sub: pm2(get('security.pin')) ? B('PIN lock on', 'පින් අගුළු සක්‍රීය') : B('Swipe to unlock', 'අරින්න'), onTap: () => go(securityPage, B('Security', 'ආරක්ෂාව')) }),
          row({ icon: 'storage', color: ['#ff5fa2', '#3d0d26'], title: B('Storage', 'ගබඩාව'), sub: `${fmtBytes(df.used)} / ${fmtBytes(df.total)} (${df.percent}%)`, onTap: () => go(storagePage, B('Storage', 'ගබඩාව')) }),
          row({ icon: 'battery', color: ['#5ad1c8', '#0c3f3a'], title: B('Battery', 'බැටරිය'), sub: `${Math.round((st.level ?? 0.8) * 100)}%${st.charging ? ' ⚡' : ''} · ${get('power.doze') === false ? B('doze off', 'නිදාගැනීම අක්‍රීය') : B('doze on', 'නිදාගැනීම සක්‍රීය')}`, onTap: () => go(batteryPage, B('Battery', 'බැටරිය')) }),
          row({ icon: 'language', color: ['#5b6b80', '#1b222c'], title: B('Language', 'භාෂාව'), sub: get('ui.lang') === 'si' ? 'සිංහල' : 'English', onTap: () => go(langPage, B('Language', 'භාෂාව')) }),
          row({ icon: 'monitor', color: ['#f5626c', '#3d1114'], title: B('Developer options', 'සංවර්ධක විකල්ප'), sub: `${bus.stats().services} ${B('syscalls', 'සිස්ටම් කল')} · ${storage.mode}`, onTap: () => go(developerPage, B('Developer', 'සංවර්ධක')) }),
          row({ icon: 'info', color: ['#2c3644', '#0d1117'], title: B('About this device', 'මෙම උපාංගය ගැන'), sub: 'Dahat 1.0.0 · DHS1.240612.001', onTap: () => go(aboutPage, B('About', 'ගැන')) })
        ));
    }

    function displayPage() {
      const themeSeg = seg([{ id: 'dark', label: B('Dark', 'අඳුරු') }, { id: 'light', label: B('Light', 'දීප්ත') }], get('display.theme'), (v) => set('display.theme', v));
      const scale = h('input', { type: 'range', min: '85', max: '130', value: String(Math.round(get('display.fontScale') * 100)), oninput: (e) => { e.target.previousSibling.querySelector('b').textContent = `${e.target.value}%`; }, onchange: (e) => set('display.fontScale', Number(e.target.value) / 100) });
      const blur = h('input', { type: 'range', min: '0', max: '40', value: String(get('display.blur') ?? 18), onchange: (e) => set('display.blur', Number(e.target.value)) });
      const wall = h('div.grid3', ...Object.entries(WALLPAPERS).map(([id, w]) => h('button', {
        style: { height: '74px', borderRadius: '16px', background: w.css, border: `2px solid ${get('display.wallpaper') === id ? 'var(--accent)' : 'var(--line)'}`, cursor: 'pointer' },
        title: w.label,
        onclick: () => { set('display.wallpaper', id); [...wall.children].forEach((c, i) => c.style.borderColor = Object.keys(WALLPAPERS)[i] === id ? 'var(--accent)' : 'var(--line)'); },
      })));
      const accents = h('div.row-flex', { style: { gap: '9px', flexWrap: 'wrap' } }, ...ACCENTS.map((c) => h('button', {
        'aria-label': c,
        style: { width: '30px', height: '30px', borderRadius: '50%', background: c, border: get('display.accent') === c ? '3px solid var(--text)' : '2px solid var(--line)', cursor: 'pointer' },
        onclick: () => { set('display.accent', c); [...accents.children].forEach((b, i) => b.style.border = ACCENTS[i] === c ? '3px solid var(--text)' : '2px solid var(--line)'); },
      })));
      return h('div',
        section(B('Mode', 'ප්‍රකාරය'), themeSeg,
          h('div.row-flex', { style: { gap: '8px' } },
            h('span.tiny.muted', { style: { flex: '1' } }, B('Rounded app icons', 'වට්ටල ඇප් අයිකන')),
            switchEl(get('display.roundIcons'), (v) => { set('display.roundIcons', v); })),
          h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } },
            h('span.tiny.muted', { style: { flex: '1' } }, B('Show seconds in status bar', 'තත්පර පෙන්වන්න')),
            switchEl(get('display.showSeconds'), (v) => set('display.showSeconds', v)))),
        section(B('Wallpaper', 'තිරපසය'), wall),
        section(B('Accent colour', 'ප්‍රධාන වර්ණය'), accents),
        section(B('Text size', 'අකුරු ප්‍රමාණය'), h('div', h('div.tiny.muted', { html: `Zoom <b>${Math.round(get('display.fontScale') * 100)}%</b>` }), scale)),
        section(B('Backdrop blur', 'බොහොර බ්ලර්'), h('div.tiny.muted', { text: B('0 = fastest on old phones', '0 = පැරණි දුරකථන වලට වේගවත්') }), blur));
    }

    function soundPage() {
      const volVal = h('b', { text: `${Math.round((get('input.volume') ?? 1) * 100)}%` });
      const vol = h('input', {
        type: 'range', min: '0', max: '100', value: String(Math.round((get('input.volume') ?? 1) * 100)),
        oninput: (e) => { volVal.textContent = `${e.target.value}%`; bus.emit('volume', { v: Number(e.target.value) / 100 }); },
        onchange: (e) => set('input.volume', Number(e.target.value) / 100),
      });
      const feed = section(B('Feedback', 'ප්‍රතිචාර'),
        h('div.row-flex', { style: { gap: '8px' } }, h('span', { style: { flex: '1' } }, B('Interface sounds', 'අතුරුමුහුණත් ශබ්ද')), switchEl(get('input.sound') !== false, (v) => set('input.sound', v))),
        h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } }, h('span', { style: { flex: '1' } }, B('Haptics', 'කම්පන')), switchEl(get('input.haptics') !== false, (v) => { set('input.haptics', v); if (v) actuate('heavy'); })),
        h('div', { style: { marginTop: '12px' } }, h('div.tiny.muted', h('span', B('Volume', 'පරිමාව')), ' ', volVal), vol));
      const test = section(B('Test', 'පරීක්ෂාව'), h('div.row-flex', { style: { gap: '8px' } },
        h('button.btn', { onclick: () => actuate('tap'), text: B('Light', 'හালක') }),
        h('button.btn', { onclick: () => actuate('heavy'), text: B('Heavy', 'බර') }),
        h('button.btn', { onclick: () => actuate('error'), text: B('Error', 'දෝෂ') })));
      return h('div', feed, test, h('p.tiny.muted', B('Sounds are synthesised by the OS — no audio files are shipped or downloaded.', 'ශබ්දයන් OS විසින්ම නිපදවේ — ගොනු ඒවා නැත.')));
    }

    function netPage() {
      const ua = navigator.userAgent;
      const radio = section(B('Radio state', 'රේඩියෝ තත්ත්වය'),
        kv(B('Connectivity', 'සම්බන්ධතාව'), navigator.onLine ? 'online' : 'offline'),
        kv(B('Airplane (kernel)', 'ගුවන් (කර්නල්)'), String(!!get('net.airplane'))),
        kv('Bluetooth', navigator.bluetooth ? 'adapter present' : 'not exposed'),
        kv(B('Secure context', 'සුරැකි පරිසරය'), String(window.isSecureContext)),
        h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } },
          h('span', { style: { flex: '1' } }, B('Airplane mode', 'ගුවන් ප්‍රකාරය')),
          switchEl(!!get('net.airplane'), (v) => {
            set('net.airplane', v);
            log.info('net', `airplane ${v ? 'on' : 'off'} — network capability ${v ? 'denied' : 'allowed'} kernel-wide`);
          })));
      const explainer = section(B('What airplane mode really does here', 'ගුවන් ප්‍රකාරය මෙහි කරන්නේ කුමක්ද'),
        h('p.tiny.muted', {
          style: { margin: 0 },
          text: B('While it is on, the kernel refuses the "network" capability for every app, so openUrl() and any browser hand-off return EPERM. Everything inside the OS still works offline.',
            'මෙය සක්‍රීය වසමින් සෑම ඇප් එකකටම "network" අයිතිවාසිකම ප්‍රතික්ෂේප වේ. OS තුළ සියල්ල නොබැඳිව ක්‍රියා කරයි.'),
        }));
      const linkRow = row({
        icon: 'globe',
        title: B('Open a link externally', 'බාහිර සබැඳියක් විවෘත කරන්න'),
        sub: 'app.openUrl("https://example.com")',
        onTap: async () => {
          const v = await prompt({ title: 'openUrl', placeholder: 'https://…', hint: B('uses the network capability', 'ජාල අවසරය යොදයි') });
          if (!v) return;
          try { const r = await ctx.api.app.openUrl(v); toast(`ok via ${r.via}`); } catch (e) { toast(e.message); }
        },
      });
      const advanced = section(B('Advanced', 'උසස්'), linkRow,
        h('div.tiny.muted', { style: { marginTop: '6px' }, text: `UA: ${ua.slice(0, 90)}…` }));
      return h('div', radio, explainer, advanced);
    }

    function appsPage() {
      const list = PKGS.filter((p) => pm.isInstalled(p.id)).map((p) => row({
        icon: p.icon, color: p.color, title: nameOf(p, i18n.lang), sub: `${p.version} · ${fmtBytes(p.size)}${p.kind === 'system' ? ' · ' + B('system', 'පද්ධති') : ''}`,
        onTap: () => go(() => appPage(p.id), nameOf(p, i18n.lang)),
      }));
      return h('div', section(B(`${pm.installedIds.length} packages`, `${pm.installedIds.length} පැකේජ`), h('div.list', ...list)),
        section(B('Install journal', 'ස්ථාපන ලඝුපොත'), pm.history.length
          ? h('div', ...pm.history.slice(-6).reverse().map((hh) => kv(new Date(hh.at).toLocaleTimeString(), `${hh.action} ${hh.id}`)))
          : h('div.tiny.muted', B('nothing installed or removed yet', 'තවම කිසිවක් ස්ථාපනය කර නැත'))));
    }

    function appPage(appId) {
      const p = pm.manifest(appId);
      if (!p) return empty2();
      const grantRows = Object.entries(CAPS).map(([cap, meta]) => {
        const wants = p.caps?.includes(cap);
        const state = caps.state(appId, cap);
        const sw = switchEl(state === 'grant', (v) => { caps.set(appId, cap, v ? 'grant' : 'deny'); caps.emit(); toast(`${nameOf(p, i18n.lang)} · ${meta[i18n.lang] || meta.en} → ${v ? 'allow' : 'deny'}`); });
        return h('div.row-flex', { style: { gap: '8px', padding: '7px 0', borderBottom: '1px solid var(--line)' } },
          h('span', { style: { flex: '1' } }, h('div', { style: { fontSize: '13px', fontWeight: '600', opacity: wants ? 1 : 0.5 } }, meta[i18n.lang] || meta.en), h('div.tiny.muted', i18n.bi(meta.desc))),
          wants ? null : h('span.chip', B('not requested', 'ඉල්ල නැත')), sw);
      });
      const df = vfs.usedIn(`/apps/${appId}`);
      return h('div',
        h('div.card', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
          h('span.r-ico', { style: { width: '46px', height: '46px', borderRadius: '15px', background: `linear-gradient(150deg,${p.color[0]},${p.color[1]})`, display: 'grid', placeItems: 'center', color: '#fff' }, html: icon(p.icon, 22) }),
          h('div', { style: { flex: '1' } }, h('div', { style: { fontWeight: '800', fontSize: '16px' } }, nameOf(p, i18n.lang)), h('div.tiny.muted', `${p.id} · v${p.version} · ${p.kind}`))),
        section(B('Details', 'විස්තර'), kv(B('Description', 'විස්තර'), i18n.bi(p.desc)), kv(B('Data', 'දත්ත'), `${fmtBytes(df)} in /apps/${appId}`), kv(B('Process', 'ක්‍රියාවලිය'), p.running ? 'running' : B('stopped', 'නැවතී')), kv(B('Signed by', 'අත්සන් කළේ'), p.kind === 'bazaar' ? (p.author || 'third party') : B('Dahat OS (preinstalled)', 'දහත් OS'))),
        section(B('Capabilities', 'අයිතිවාසිකම්'), ...grantRows,
          h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } }, h('button.btn.text', { onclick: () => { p.caps?.forEach((c) => caps.set(appId, c, 'grant')); caps.emit(); paint(); }, text: B('Allow all requested', 'ඉල්ලූ සියල්ලට') }),
            h('button.btn.text', { onclick: () => { caps.reset(appId); caps.emit(); paint(); }, text: B('Reset to ask', 'නැවත අසන්න') }))),
        section(B('Actions', 'ක්‍රියා'),
          row({ icon: 'apps', title: B('Open', 'විවෘත කරන්න'), onTap: () => { ctx.api.app.open(appId); back(); } }),
          row({ icon: 'trash', title: B('Clear data', 'දත්ත මකන්න'), sub: '/apps/' + appId + '/data', onTap: async () => { if (await confirm({ title: B('Clear app data?', 'ඇප් දත්ත මකන්නද?'), danger: true, ok: B('Clear', 'මකන්න') })) { await pm.clearData(appId); toast(B('data cleared', 'දත්ත මකා දමන ලදී')); } } }),
          row({ icon: 'power', title: B('Force stop', 'බලෙන් නවත්වන්න'), onTap: () => { const pid = sched.pidOf(appId); if (pid) { sched.kill(pid, 'force stop from Settings'); toast(`${nameOf(p, i18n.lang)} ${B('stopped', 'නවතවා ඇත')}`); } else toast(B('not running', 'ක්‍රියාත්මක නොවේ')); } }),
          row({ icon: 'x', title: B('Uninstall', 'ඉවත් කරන්න'), danger: p.kind !== 'system', sub: p.kind === 'system' ? B('part of the OS — cannot be removed', 'පද්ධතියේ කොටසකි') : '', onTap: async () => {
            if (p.kind === 'system') { toast(B('System packages are protected', 'පද්ධති පැකේජ ආරක්ෂිතයි')); return; }
            if (await confirm({ title: `${B('Uninstall', 'ඉවත් කරන්න')} ${nameOf(p, i18n.lang)}?`, body: B('Its sandbox and data are deleted.', 'එහි සැඟවුණු දත්ත මකා දමනු ලැබේ.'), danger: true, ok: B('Uninstall', 'ඉවත් කරන්න') })) { await pm.uninstall(appId); back(); }
          } })));
    }

    function permPage() {
      const matrix = Object.entries(CAPS).map(([cap, meta]) => {
        const granted = PKGS.filter((p) => pm.isInstalled(p.id) && caps.state(p.id, cap) === 'grant').map((p) => p.id);
        const denied = PKGS.filter((p) => pm.isInstalled(p.id) && caps.state(p.id, cap) === 'deny').map((p) => p.id);
        return row({
          icon: meta.icon, title: meta[i18n.lang] || meta.en,
          sub: `${granted.length} ${B('allowed', 'අවසර ලත්')}${denied.length ? ` · ${denied.length} denied` : ''}`,
          trailing: granted.length ? h('span.chip.ok', `${granted.length}`) : h('span.chip', '0'),
          onTap: () => go(() => capDetail(cap, meta, granted, denied), meta.en),
        });
      });
      return h('div',
        h('div.card', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          h('span', { html: icon('shield', 20), style: { color: 'var(--accent)' } }),
          h('div', h('div', { style: { fontWeight: '700' } }, B('One capability at a time', 'එක වරකට එක් අයිතිවාසිකමක්')),
            h('div.tiny.muted', B('Apps are asked in the foreground, at the moment they need it. System apps are pre-trusted because they are the OS.', 'ඇප් අවශ්‍ය වන මොහොතේදී පමණක් අසයි.')))),
        section(B('All capabilities', 'සියලු අයිතිවාසිකම්'), h('div.list', ...matrix)));
    }
    function capDetail(cap, meta, granted, denied) {
      return h('div',
        section(meta.en, h('p.tiny.muted', { style: { margin: 0 }, text: i18n.bi(meta.desc) })),
        section(B('Allowed', 'අවසර ලත්'), granted.length ? h('div.list', ...granted.map((id) => row({ icon: byIdSafe(id)?.icon, color: byIdSafe(id)?.color, title: nameOf(byIdSafe(id), i18n.lang), onTap: () => { caps.deny(id, cap); caps.emit(); paint(); } }))) : h('div.tiny.muted', B('none', 'කිසිවක් නැත')),
          granted.length ? h('button.btn.text', { style: { marginTop: '8px' }, onclick: () => { granted.forEach((id) => caps.deny(id, cap)); caps.emit(); paint(); }, text: B('Revoke all', 'සියල්ල අහෝසි') }) : null),
        section(B('Denied', 'ප්‍රතික්ෂේපිත'), denied.length ? h('div.list', ...denied.map((id) => row({ icon: byIdSafe(id)?.icon, title: nameOf(byIdSafe(id), i18n.lang), onTap: () => { caps.grant(id, cap); caps.emit(); paint(); } }))) : h('div.tiny.muted', B('none', 'කිසිවක් නැත'))));
    }

    function securityPage() {
      const pinRow = row({
        icon: 'key', title: B('Screen PIN', 'තිර පින් අංකය'),
        sub: get('security.pin') ? B('4 digits, hashed on device', 'ඉලක්කම් 4ක්, උපාංගයේ හැෂ්') : B('not set', 'සකසා නැත'),
        onTap: async () => {
          const v = await prompt({ title: B('Set a 4-digit PIN', 'ඉලක්කම් 4ක පින් අංකයක්'), type: 'password', placeholder: '••••', hint: B('Leave empty to remove the lock', 'අගුළු ඉවත් කිරීමට හිස්ව තබන්න') });
          if (v == null) return;
          const m = await import('../shell/lock.js');
          if (!v) { await m.lockscreen.setPin(null); toast(B('PIN removed', 'පින් ඉවත් කෙරිණි')); }
          else if (!/^\d{4}$/.test(v)) toast(B('use exactly 4 digits', 'ඉලක්කම් 4ක් පමණි'));
          else { await m.lockscreen.setPin(v); toast(B('PIN set', 'පින් සකසා ඇත')); }
          paint();
        },
      });
      const pinInput = h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', class: 'input', placeholder: '0000' });
      return h('div',
        group(pinRow,
          row({ icon: 'shield', title: B('Ask for PIN after every lock', 'සෑම අගුළු දැමීමකදීම පින් අසන්න'), trailing: switchEl(get('security.requirePinOnWake') !== false, (v) => set('security.requirePinOnWake', v)) }),
          row({ icon: 'clock', title: B('Auto-lock after', 'ස්වයංක්‍රීයව අගුළු දමන්න'), sub: `${get('security.autoLockMinutes') ?? 5} ${B('minutes', 'විනාඩි')}`, onTap: () => {
            const opts = [1, 2, 5, 15, 0];
            const rows = opts.map((m) => h('button.row', {
              onclick: () => { document.querySelector('.scrim')?.__done?.(); set('security.autoLockMinutes', m); paint(); },
            },
              h('span.r-main',
                h('span.r-title', B(`after ${m} min of inactivity`, `${m} විනාඩියක් නොතැමින්`)),
                h('span.r-sub', B('locks the screen and asks for the PIN', 'තිරය අගුළු දායි'))),
              h('span.r-end', m ? `${m}m` : B('never', 'කවදාවත්'))));
            sheet(h('div.list', ...rows), { title: B('Auto-lock', 'ස්වයං අගුළු') });
          } }),
          row({ icon: 'lock', title: B('Lock now', 'දැන් අගුළු දමන්න'), onTap: async () => { back(); (await import('../shell/lock.js')).lockscreen.lock('settings'); } })),
        section(B('Change the code', 'කේතය වෙනස් කරන්න'),
          h('div.card', { style: { margin: 0 } }, pinInput,
            h('button.btn.primary.block', { style: { marginTop: '10px' }, text: B('Save PIN', 'පින් සුරකින්න'), onclick: async () => {
              if (!/^\d{4}$/.test(pinInput.value)) { toast(B('4 digits only', 'ඉලක්කම් 4ක් පමණි')); return; }
              const m = await import('../shell/lock.js');
              await m.lockscreen.setPin(pinInput.value);
              toast(B('PIN updated — it never leaves this device', 'පින් යාවත්කාලීන කෙරිණි'));
              paint();
            } }))),
        section(B('Audit', 'විගරණය'), ...log.tail(6, { domain: 'security' }).map((e) => kv(new Date(e.ts).toLocaleTimeString(), e.msg))));
    }

    function storagePage() {
      const df = vfs.df();
      const report = pm.storageReport().filter((r) => r.size || r.data).sort((a, b) => (b.size + b.data) - (a.size + a.data));
      return h('div',
        section(B('Dahat volume', 'දහත් පරිමාව'),
          h('div.row-flex', { style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('b', fmtBytes(df.used)), h('span.tiny.muted', `${fmtBytes(df.free)} ${B('free', 'හිස්')}`)),
          progressbar(df.percent, df.percent > 85 ? 'var(--err)' : 'var(--accent)'),
          h('div.tiny.muted', { style: { marginTop: '8px' }, text: `${B('backend', 'පසුබිම')}: ${storage.mode} · quota ${fmtBytes(df.total)}` })),
        section(B('Per app', 'ඇප් අනුව'), h('div.list', ...report.map((r) => row({
          icon: byIdSafe(r.id)?.icon, color: byIdSafe(r.id)?.color, title: nameOf(byIdSafe(r) || { name: r.name }, i18n.lang),
          sub: `${fmtBytes(r.size)} code · ${fmtBytes(r.data)} data`,
          trailing: fmtBytes(r.size + r.data),
        })))),
        section(B('Tools', 'මෙවලම්'),
          row({ icon: 'download', title: B('Export /sdcard as JSON', '/sdcard JSON ලෙස යවන්න'), sub: B('downloads a portable backup of your files', 'ඔබේ ගොනුගේ සුරැකුම් පිටපතක්'), onTap: async () => {
            const dump = {};
            for (const e of vfs.tree('/sdcard', '/', 8)) if (e.type === 'file') dump[e.path] = { mime: e.mime, data: vfs.read(e.path) };
            const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `dahat-sdcard-${Date.now()}.json`, style: { display: 'none' } });
            document.body.appendChild(a); a.click(); a.remove();
            toast(`${Object.keys(dump).length} ${B('files exported', 'ගොනු යවන ලදී')}`);
          } }),
          row({ icon: 'upload', title: B('Import a text file into /sdcard', 'පෙළ ගොනුවක් ආයත කරන්න'), onTap: () => importFile() }),
          row({ icon: 'trash', title: B('Format /sdcard', '/sdcard ප්‍රारම්භ කරන්න'), sub: B('keeps apps, wipes shared files', 'ඇප් රඳවා ගොනු මකයි'), danger: true, onTap: async () => {
            if (!await confirm({ title: B('Format shared storage?', 'හවුම් ගබඩාව ප්‍රාරම්භ කරන්නද?'), body: B('All files under /sdcard are deleted. This cannot be undone.', '/sdcard යටතේ සියලු ගොනු මැකෙයි.'), danger: true, ok: B('Format', 'ප්‍රාරම්භ') })) return;
            try { vfs.rm('/sdcard', '/', { recursive: true }); } catch { /* already gone */ }
            vfs.mkdir('/sdcard/DCIM', '/', { recursive: true }); vfs.mkdir('/sdcard/Documents', '/', { recursive: true }); vfs.mkdir('/sdcard/Notes', '/', { recursive: true });
            toast(B('storage formatted', 'ගබඩාව ප්‍රාරම්භ කෙරිණි'));
            paint();
          } })));
    }
    function importFile() {
      const inp = h('input', { type: 'file', style: { display: 'none' }, onchange: async () => {
        const f = inp.files?.[0];
        if (!f) return;
        const buf = await f.arrayBuffer();
        const path = `/sdcard/Download/${f.name}`;
        if (f.type.startsWith('image/') || f.type.startsWith('audio/')) vfs.write(path, `data:${f.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`, '/', { mime: f.type });
        else vfs.write(path, new TextDecoder().decode(buf), '/', { mime: f.type || 'text/plain' });
        toast(`${B('imported', 'ආයත කෙරිණි')}: ${path}`);
        inp.remove();
      } });
      document.body.appendChild(inp);
      inp.click();
    }

    function batteryPage() {
      const st = power.status;
      const lvl = Math.round((st.level ?? 0.8) * 100);
      const now = section(B('Now', 'දැන්'),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
          h('span', { style: { fontSize: '42px', fontWeight: '200' }, text: `${lvl}%` }),
          h('span.chip', st.charging ? B('charging', 'බැටරි ගසමින්') : B('discharging', 'භාවිතයෙන්')),
          progressbar(lvl, lvl < 20 ? 'var(--err)' : 'var(--ok)')),
        h('div', { style: { marginTop: '10px' } },
          kv(B('Battery API', 'බැටරි API'), st.level == null ? B('simulated gauge', 'අනුකරණ මිනුම') : B('Battery Status API', 'Battery Status API')),
          kv(B('Idle', 'නිෂ්ක්‍රීය'), `${Math.round(st.idleMs / 1000)}s`),
          kv(B('Screen state', 'තිර තත්ත්වය'), st.screen),
          kv(B('Wake lock', 'වේක් ලොක්'), st.wakelock ? B('held', 'රඳවා ඇත') : B('none', 'නැත')),
          kv(B('Power save', 'බල සුරැකීම'), st.powerSave ? B('active', 'ක්‍රියාත්මක') : B('off', 'අක්‍රීය'))));
      const behaviour = section(B('Behaviour', 'හැසිරීම'),
        toggleRow(B('Doze background apps', 'පසුබිම් ඇප් නිදාගන්න'), get('power.doze') !== false, (v) => set('power.doze', v)),
        toggleRow(B('Auto power-save under 20%', 'ස්වයංක්‍රීය බල සුරැකීම (20%)'), get('power.autoPowerSave') !== false, (v) => set('power.autoPowerSave', v)),
        toggleRow(B('Power save now', 'දැන් බල සුරැකීම'), !!get('power.manualSave'), (v) => { set('power.manualSave', v); power.setPowerSave(v); }));
      const explains = section(B('What power-save changes', 'බල සුරැකීම වෙනස් කරන්නේ'),
        h('ul.tiny.muted', { style: { margin: 0, paddingLeft: '18px' } },
          h('li', B('backdrop blur is switched off', 'බ්ලර් අක්‍රීය කෙරේ')),
          h('li', B('background processes get 0.6ms per tick instead of a frame', 'පසුබිම් ක්‍රියාවලීන්ට රාමුවක් නොව 0.6ms ක්'),),
          h('li', B('notification banners are shorter', 'දැනුම්දීම් බැනර් කෙටි කෙරේ'))));
      const usage = section(B('Per-app CPU', 'ඇප් අනුව CPU'), ...table());
      return h('div', now, behaviour, explains, usage);
      function toggleRow(label, val, fn) {
        return h('div.row-flex', { style: { gap: '8px', padding: '6px 0' } }, h('span', { style: { flex: '1' } }, label), switchEl(val, fn));
      }
      function table() {
        const rows = sched.table().sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 6);
        if (!rows.length) return [h('div.tiny.muted', B('no processes running', 'ක්‍රියාවලීන් නැත'))];
        return rows.map((r) => kv(r.name, `${(r.cpuMs / 1000).toFixed(2)}s · ${r.syscalls} syscalls · ${r.state}`));
      }
    }

    function langPage() {
      const langs = [['en', 'English', 'English (US)'], ['si', 'සිංහල', 'Sinhala']];
      const grid = h('div.grid2', ...langs.map(([id, label, sub]) => h('button.btn', {
        style: { minHeight: '62px', flexDirection: 'column', gap: '2px', borderColor: get('ui.lang') === id ? 'var(--accent)' : 'var(--line)', justifyContent: 'center' },
        onclick: () => { set('ui.lang', id); toast(B('language updated', 'භාෂාව යාවත්කාලීන කෙරිණි')); paint(); },
      },
        h('span', { style: { fontWeight: '800', fontSize: '16px' } }, label),
        h('span.tiny.muted', sub))));
      const note = h('p.tiny.muted', {
        style: { margin: 0 },
        text: B('Sinhala strings ship inside the OS, together with a Noto Sans Sinhala subset, so they render even on devices with no Sinhala font installed.',
          'සිංහල පෙළ OS එක තුළම, Noto Sans Sinhala සමඟ ලැබේ.'),
      });
      const regional = h('div',
        kv(B('Locale', 'දේශීය'), navigator.language),
        kv('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone),
        kv(B('First day of week', 'සතිපතේ පළමු දිනය'), B('Monday', 'සඳුදා')));
      return h('div',
        section(B('Language', 'භාෂාව'), grid),
        section(B('About the script', 'අකුරු ගැන'), note),
        section(B('Regional', 'ප්‍රාදේශීය'), regional));
    }

    function developerPage() {
      const counters = Object.entries(bus.counters()).sort((a, b) => b[1] - a[1]);
      const bench = h('div.tiny.mono', { style: { whiteSpace: 'pre-wrap', marginTop: '8px' } }, B('run a benchmark to see numbers', 'ඉලක්කම් සඳහා benchmark එකක් ධාවනය කරන්න'));
      return h('div',
        section(B('Kernel', 'කර්නලය'),
          kv('storage', storage.mode), kv('syscalls', bus.stats().services), kv('calls', bus.stats().calls),
          kv('topics', bus.stats().topics), kv('processes', sched.list.length), kv('jank frames', sched.jank),
          kv(B('tick budget', 'ටික් අයවැය'), `${sched.budget}ms`), kv(B('frame', 'රාමුව'), `${sched.frameMs.toFixed(1)}ms`),
          h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } },
            h('button.btn', { text: B('Run benchmark', 'බෙංච්මාර්ක්'), onclick: async () => { bench.textContent = B('running…', 'ධාවනය වෙමින්…'); const r = await benchRun(); bench.textContent = r; } }),
            h('button.btn', { text: B('Simulate low battery', 'අඩු බැටරියක්'), onclick: () => { power.touchBatterySim(-0.7); toast('battery → 12%'); } }))),
        section(B('Syscalls by volume', 'syscall ගණන අනුව'), counters.length ? h('div', ...counters.slice(0, 14).map(([k, v]) => kv(k, v))) : h('div.tiny.muted', B('no calls yet', 'තවම හැඳින්වීම් නැත'))),
        section(B('Kernel log', 'කර්නල් ලඝුපොත'),
          h('div.mono', { style: { whiteSpace: 'pre-wrap', maxHeight: '220px', overflow: 'auto', lineHeight: '1.5' } }, log.dump().slice(-1800) || '—'),
          h('div.row-flex', { style: { gap: '8px', marginTop: '8px' } },
            h('button.btn', { text: B('Copy', 'පිටපත්'), onclick: async () => { await ctx.api.bus.call('clip.set', { text: log.dump() }, { appId: 'settings', pid: ctx.pid }); toast(B('log copied', 'ලඝුපොත පිටපත් කෙරිණි')); } }),
            h('button.btn', { text: B('Bug report', 'දෝෂ වාර්තාව'), onclick: () => shareBugReport(ctx) }))),
        section(B('Bench results', 'ප්‍රතිඵල'), bench),
        section(B('Danger zone', 'අනතුරු කලාපය'),
          row({ icon: 'refresh', title: B('Reset all preferences', 'සියලු සැකසුම් යළි සකසන්න'), onTap: async () => { if (await confirm({ title: B('Reset preferences?', 'සැකසුම් යළි සකසන්නද?'), danger: true })) { await config.reset(); toast(B('restarting…', 'නැවත ආරම්භ වෙමින්…')); setTimeout(() => location.reload(), 700); } } }),
          row({ icon: 'trash', title: B('Factory reset', 'කර්මාන්ත ශාලා යළි සකසන්න'), sub: '/sdcard, app data, permissions', danger: true, onTap: async () => {
            if (!await confirm({ title: B('Factory reset Dahat OS?', 'දහත් OS යළි සකසන්නද?'), body: B('Files, notes, installs and permissions are erased. Android is not touched.', 'ගොනු, සටහන්, ස්ථාපන, අවසර මැකෙයි. Android ස්පර්ශ නොකරයි.'), danger: true, ok: B('Erase', 'මකන්න') })) return;
            await storage.clear();
            location.reload();
          } })));
    }

    function aboutPage() {
      // real hardware detail, when the launcher APK is hosting us
      let host = 'browser / PWA', extra = {};
      try {
        if (self.DahatBridge?.info) {
          extra = JSON.parse(self.DahatBridge.info()) || {};
          host = `Dahat Launcher ${extra.versionName || '?'} (build ${extra.versionCode || '?'})`;
        }
      } catch { /* bridge answered nonsense */ }
      const hero = h('div.card', { style: { textAlign: 'center', padding: '22px 12px' } },
        h('div', { style: { fontSize: '40px', fontWeight: '700', color: 'var(--accent)', lineHeight: 1 }, text: 'ධ' }),
        h('div', { style: { fontWeight: '800', fontSize: '17px', marginTop: '8px' } }, 'Dahat OS'),
        h('div.tiny.muted', B('clean by design · දහත්ව සිතන්න', 'දහත්ව සිතන්න · clean by design')));
      const info = {
        'OS': 'Dahat OS 1.0.0', 'Build': 'DHS1.240612.001', 'Kernel': 'dahat-kernel (userspace, ES2022)',
        'UI shell': 'Dahat Glass Shell 1.0', 'Device name': get('device.name'), 'Packages': `${pm.installedIds.length} installed / ${PKGS.length} in index`,
        'Syscalls': bus.stats().services, 'Persistence': storage.mode, 'Screen': `${screen.width}×${screen.height} @${(devicePixelRatio || 1).toFixed(1)}x`,
        'Cores': navigator.hardwareConcurrency || '?', 'Memory': navigator.deviceMemory ? `${navigator.deviceMemory} GB (reported)` : 'not reported',
        'Host': host, 'Secure context': String(window.isSecureContext),
        ...(extra.androidSdk ? { 'Android': `API ${extra.androidSdk} · patch ${extra.securityPatch || '?'}`, 'Device': `${extra.manufacturer || ''} ${extra.model || ''}`.trim(), 'ABI': extra.abi || '?' } : {}),
        'Time zone': Intl.DateTimeFormat().resolvedOptions().timeZone, 'Uptime': fmtDur(log.uptime),
      };
      const rows = Object.entries(info).map(([k, v]) => kv(k, v ?? '—'));
      const nameRow = row({
        icon: 'edit', title: B('Device name', 'උපාංග නම'), sub: String(get('device.name') || ''),
        onTap: async () => {
          const v = await prompt({ title: B('Device name', 'උපාංග නම'), value: String(get('device.name') || '') });
          if (v) { set('device.name', v); paint(); }
        },
      });
      const legal = h('p.tiny.muted', {
        style: { margin: 0 },
        text: B('No analytics, no ad IDs, no accounts. Your files stay in this device’s storage layer. Typeface: Noto Sans Sinhala (OFL).',
          'විශ්ලේෂණ, දැන්වීම් හැඳුනුම්පත්, ගිණුම් කිසිවක් නැත.'),
      });
      const tryRows = h('div.list',
        row({ icon: 'terminal', title: B('Open Terminal', 'ටර්මිනලය විවෘත කරන්න'), sub: 'neofetch · dmesg · pm list', onTap: () => ctx.api.app.open('terminal') }),
        row({ icon: 'store', title: B('Open Bazaar', 'බාසාරය විවෘත කරන්න'), sub: B('8 apps in the index', 'දර්ශකයේ ඇප් 8ක්'), onTap: () => ctx.api.app.open('bazaar') }),
        row({
          icon: 'refresh', title: B('Run first-time setup again', 'පළමු සැකසුම නැවත'),
          onTap: async () => { await config.set('ui.onboarded', false); toast(B('restarting…', 'නැවත ආරම්භ වෙමින්…')); setTimeout(() => location.reload(), 600); },
        }));
      return h('div', hero, section(B('Device', 'උපාංගය'), nameRow, rows), section(B('Legal & philosophy', 'නීතිමය'), legal), section(B('Try', 'අත්හදා බලන්න'), tryRows));
    }

    // ---------- helpers ----------
    function empty2() { return h('div.empty', 'app not found'); }
    function byIdSafe(id) { return PKGS.find((p) => p.id === id); }
    function pm2(v) { return !!v; }
    function permSummary() {
      let g = 0;
      for (const p of PKGS) if (pm.isInstalled(p.id)) g += Object.values(caps.for(p.id)).filter((x) => x === 'grant').length;
      return g ? `${g} ${B('grants across installed apps', 'ස්ථාපිත ඇප් හරහා අවසර')}` : B('nothing granted yet', 'තවම කිසිවක් නැත');
    }
    async function benchRun() {
      const t = [];
      let x = await timed('fs.write 500 files', () => { for (let i = 0; i < 500; i++) vfs.write(`/tmp/bench/${i}.txt`, 'x'.repeat(200)); });
      t.push(x);
      t.push(await timed('vfs.ls /tmp/bench', () => vfs.ls('/tmp/bench').length));
      t.push(await timed('vfs.tree /sdcard d6', () => vfs.tree('/sdcard', '/', 6).length));
      t.push(await timed('syscall bus round-trip ×500', () => { for (let i = 0; i < 500; i++) bus.call('sys.time', {}, { appId: 'settings', pid: ctx.pid }); }));
      t.push(await timed('JSON snapshot 800 nodes', () => JSON.stringify(vfs.nodes).length, true));
      try { vfs.rm('/tmp/bench', '/', { recursive: true }); } catch { /* cleanup */ }
      return t.join('\n');
    }
    async function timed(label, fn, len = false) {
      const a = performance.now();
      const r = fn();
      const ms = performance.now() - a;
      return `${label.padEnd(30)} ${ms.toFixed(ms < 10 ? 2 : 1)}ms${len ? `  (payload ${fmtBytes(r)})` : ''}`;
    }
    async function shareBugReport(c) {
      const body = [
        'Dahat OS bug report', `time: ${new Date().toISOString()}`, `ua: ${navigator.userAgent}`,
        `screen: ${screen.width}x${screen.height}@${devicePixelRatio}`, `storage: ${storage.mode}`,
        `packages: ${pm.installedIds.join(',')}`, '', '--- kernel log ---', log.dump(), '', '--- procs ---', JSON.stringify(sched.table(), null, 1),
      ].join('\n');
      try { await c.api.app.share({ title: 'Dahat OS report', text: body }); toast(B('shared', 'බෙදාගන්නා ලදී')); } catch (e) { toast(e.message); }
    }

    return {
      el: ui.el,
      onParams: (p) => { if (p?.appId) { go(() => appPage(p.appId), nameOf(byIdSafe(p.appId) || { name: p.appId }, i18n.lang)); } },
      onResume: paint,
    };
  },
};
