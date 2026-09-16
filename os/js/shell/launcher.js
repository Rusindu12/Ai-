/* Dahat OS — shell/launcher.js
 * Home screen (pages + dock + widget), app drawer, and the omnibox search.
 * Layout is persisted through pm, so removing/adding apps survives a reboot.
 */
import { h, icon, clear, drag, fmtTime, EN_MONTHS, SI_MONTHS, SI_DAYS, EN_DAYS } from '../ui/dom.js';
import { pm } from '../kernel/pm.js';
import { sched } from '../kernel/sched.js';
import { power } from '../kernel/power.js';
import { byId, nameOf } from '../kernel/packages.js';
import { bus } from '../kernel/bus.js';
import { config } from '../kernel/config.js';
import { log } from '../kernel/log.js';
import { notif } from '../kernel/notify.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { wm } from './wm.js';
import { vfs } from '../kernel/vfs.js';
import { listSheet, confirm, prompt, toast } from './dialogs.js';

let home = null, drawer = null, track = null, dots = null, page = 0, pages = [];
let clockTimer = null, searchEl = null;

export const launcher = {
  init() {
    home = document.getElementById('home-layer');
    drawer = document.getElementById('apps-layer');
    this.paintHome();
    pm.onChange(() => { this.paintHome(); this.paintDrawer(); });
    notif.onChange(() => this.paintBadges());
    i18n.onLangChange?.(() => this.paintHome());
    config.onChange((k) => { if (k === 'ui.lang' || k === '*') { this.paintHome(); this.paintDrawer(); this.paintClock(); } });
    clockTimer = setInterval(() => this.paintClock(), 1000);
    addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' && !wm.hasWindows()) this.goto(page - 1);
      if (e.key === 'ArrowRight' && !wm.hasWindows()) this.goto(page + 1);
      if (e.key === '/' && !wm.hasWindows()) { e.preventDefault(); this.openSearch(); }
    });
    log.info('shell', 'launcher ready');
    return this;
  },

  paintClock() {
    const c = home.querySelector('.widget-clock .time');
    if (!c) return;
    const d = new Date();
    c.textContent = fmtTime(d, !!config.get('display.showSeconds'));
    const si = i18n.lang === 'si';
    const sub = home.querySelector('.widget-clock .date');
    if (sub) sub.textContent = si ? `${SI_DAYS[d.getDay()]} · ${d.getDate()} ${SI_MONTHS[d.getMonth()]}` : `${EN_DAYS[d.getDay()]}, ${EN_MONTHS[d.getMonth()]} ${d.getDate()}`;
    const stat = home.querySelector('.widget-status');
    if (stat) stat.innerHTML = widgetStatus();
  },

  paintHome() {
    clear(home);
    pages = pm.pages();
    page = Math.min(page, Math.max(0, pages.length - 1));

    home.appendChild(h('div.widget-clock',
      h('div.time.num'), h('div.date'),
      h('div.widget-status.tiny', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } })));

    track = h('div.pager-track');
    pages.forEach((ids) => track.appendChild(h('div.pager-page', ...ids.map((id, i) => this.tile(id, i)))));
    if (!pages.length) track.appendChild(h('div.pager-page', h('div.empty', icon('apps', 30), 'no apps installed')));
    const pager = h('div.pager', track);
    dots = h('div.dots', ...pages.map((_, i) => h('i', { class: i === page ? 'on' : '' })));
    drag(pager, {
      axis: 'x',
      onMove: (dx) => { track.style.transition = 'none'; track.style.transform = `translateX(${-page * 100 + (dx / pager.clientWidth) * 100}%)`; },
      onEnd: ({ dx, dt }) => {
        track.style.transition = '';
        const w = pager.clientWidth;
        if (dx < -w * 0.22 || (dx < -34 && dt < 300)) this.goto(page + 1);
        else if (dx > w * 0.22 || (dx > 34 && dt < 300)) this.goto(page - 1);
        else this.goto(page);
      },
    });
    home.appendChild(pager);
    if (pages.length > 1) home.appendChild(dots);

    const dockApps = pm.dock.filter((id) => pm.isInstalled(id));
    home.appendChild(h('div.dock', ...dockApps.map((id, i) => this.tile(id, i, true))));
    home.appendChild(h('button.search-pill', { onclick: () => this.openSearch(), html: `${icon('search', 15)}<span>${i18n.t('home.search')}</span>` }));
    this.paintClock();
    this.paintBadges();
  },

  tile(appId, i = 0, inDock = false) {
    const p = byId(appId);
    if (!p) return h('span');
    const node = h('button.app-tile', {
      style: { animationDelay: `${i * 22}ms` },
      onclick: () => { actuate('open'); wm.launch(appId); this.hideDrawer(); },
      oncontextmenu: (e) => { e.preventDefault(); this.appMenu(appId); },
    },
      h('span.app-ico' + (config.get('display.roundIcons') || p.round ? '.b2' : ''), { style: { '--c1': p.color[0], '--c2': p.color[1], background: `linear-gradient(150deg,${p.color[0]},${p.color[1]})` }, html: icon(p.icon, 26) }),
      h('span.app-name', nameOf(p, i18n.lang)));
    node.dataset.appId = appId;
    if (inDock) node.style.setProperty('--dock', '1');
    let lp = null;
    node.addEventListener('pointerdown', () => { lp = setTimeout(() => this.appMenu(appId), 420); });
    ['pointerup', 'pointermove', 'pointerleave', 'pointercancel'].forEach((ev) => node.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    return node;
  },

  paintBadges() {
    home.querySelectorAll('.app-tile').forEach((t) => {
      const id = t.dataset.appId;
      const n = notif.badge(id);
      t.querySelector('.badge')?.remove();
      if (n > 0) t.querySelector('.app-ico').insertAdjacentHTML('beforeend', `<span class="badge">${n > 9 ? '9+' : n}</span>`);
    });
  },

  goto(p) {
    page = Math.max(0, Math.min(pages.length - 1, p));
    if (track) { track.style.transition = ''; track.style.transform = `translateX(${-page * 100}%)`; }
    if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('on', i === page));
  },

  appMenu(appId) {
    const p = byId(appId);
    if (!p) return;
    const items = [
      { id: 'info', icon: 'info', label: i18n.t('home.appInfo'), onTap: () => wm.launch('settings', { appId }) },
      {
        id: 'stop', icon: 'power', label: i18n.t('home.forceStop'),
        onTap: () => {
          const pid = pidOf(appId);
          if (pid == null) { toast(i18n.bi({ en: 'not running', si: 'ක්‍රියාත්මක නොවේ' })); return; }
          sched.kill(pid, 'force stopped from launcher');
          toast(`${i18n.bi(p.name)} ${i18n.bi({ en: 'stopped', si: 'නවතවා ඇත' })}`);
        },
      },
      {
        id: 'home', icon: 'home',
        label: pages[page]?.includes(appId) ? i18n.t('home.removeHome') : i18n.t('home.addHome'),
        onTap: () => {
          const pg = pages.map((x) => x.filter((id) => id !== appId));
          pg[page] = [...(pg[page] || []), appId].slice(0, 8);
          pm.setLayout({ pages: pg.filter((x) => x.length) });
        },
      },
    ];
    if (p.kind !== 'system') items.push({
      id: 'uninstall', icon: 'trash', label: i18n.bi({ en: 'Uninstall', si: 'ඉවත් කරන්න' }),
      onTap: async () => {
        const ok = await confirm({ title: i18n.bi({ en: `Uninstall ${nameOf(p, i18n.lang)}?`, si: `${nameOf(p, i18n.lang)} ඉවත් කරන්නද?` }), body: i18n.bi({ en: 'Its private data under /apps is deleted too.', si: '/apps යට ඇති එහි දත්ත ද මකා දමනු ලැබේ.' }), ok: i18n.t('common.uninstall'), danger: true });
        if (ok) await pm.uninstall(appId);
      },
    });
    listSheet(nameOf(p, i18n.lang), items);
  },

  // ---- drawer ----
  toggleDrawer() { drawer.classList.contains('hidden') ? this.showDrawer() : this.hideDrawer(); },
  showDrawer() { drawer.classList.remove('hidden'); this.paintDrawer(); },
  hideDrawer() { drawer.classList.add('hidden'); },
  paintDrawer(filter = '') {
    clear(drawer);
    const input = h('input', { placeholder: i18n.t('home.search'), value: filter, oninput: (e) => this.paintDrawer(e.target.value), focus: !filter });
    drawer.appendChild(h('div.drawer-search', h('span', { html: icon('search', 16) }), input,
      h('button.btn.icon', { onclick: () => this.hideDrawer(), html: icon('x', 16) })));
    const all = pm.all.filter((p) => pm.isInstalled(p.id))
      .filter((p) => !filter || `${nameOf(p, 'en')} ${nameOf(p, 'si')} ${p.id}`.toLowerCase().includes(filter.toLowerCase()));
    drawer.appendChild(h('div.drawer-grid', ...all.map((p, i) => this.tile(p.id, i))));
    if (!all.length) drawer.appendChild(h('div.empty', icon('search', 26), i18n.t('common.empty')));
    setTimeout(() => filter && input.focus(), 30);
  },

  // ---- omnibox ----
  openSearch() {
    if (searchEl) return;
    const input = h('input.input', { placeholder: i18n.t('home.search'), focus: true });
    const results = h('div.list');
    const run = () => {
      const q = input.value.trim().toLowerCase();
      const out = [];
      pm.all.filter((p) => pm.isInstalled(p.id)).filter((p) => !q || `${nameOf(p, 'en')} ${nameOf(p, 'si')} ${p.cat}`.toLowerCase().includes(q))
        .slice(0, 6).forEach((p) => out.push(row(p.icon, nameOf(p, i18n.lang), p.cat, p.color, () => { close(); wm.launch(p.id); })));
      if (q.length > 1) {
        try {
          vfs.tree('/sdcard', '/', 3)
            .filter((e) => e.type === 'file' && e.name.toLowerCase().includes(q))
            .slice(0, 5)
            .forEach((f) => out.push(row('file', f.name, f.path, ['#4cc4ff', '#123845'], () => { close(); wm.launch('files', { open: f.path }); })));
        } catch { /* vfs not mounted yet */ }
      }
      const acts = [
        { k: 'dark', ico: 'moon', label: i18n.bi({ en: 'Toggle dark mode', si: 'අඳුරු ප්‍රකාරය' }), fn: () => config.set('display.theme', config.get('display.theme') === 'dark' ? 'light' : 'dark') },
        { k: 'lock', ico: 'lock', label: i18n.bi({ en: 'Lock screen', si: 'තිරය අගුළු දමන්න' }), fn: async () => (await import('./lock.js')).lockscreen.lock('search') },
        { k: 'bazaar', ico: 'store', label: i18n.bi({ en: 'Open Bazaar', si: 'බාසාරය විවෘත කරන්න' }), fn: () => wm.launch('bazaar') },
        { k: 'term', ico: 'terminal', label: i18n.bi({ en: 'Open Terminal', si: 'ටර්මිනලය විවෘත කරන්න' }), fn: () => wm.launch('terminal') },
      ].filter((a) => !q || a.label.toLowerCase().includes(q));
      acts.slice(0, 3).forEach((a) => out.push(row(a.ico, a.label, i18n.bi({ en: 'action', si: 'ක්‍රියාව' }), ['#12b7a2', '#053b35'], () => { close(); a.fn(); })));
      clear(results);
      results.appendChild(out.length ? h('div', ...out) : h('div.empty', icon('search', 24), i18n.t('common.empty')));
    };
    const row = (ico, title, sub, color, onTap) => h('button.row', { onclick: onTap },
      h('span.r-ico', { style: { background: `linear-gradient(150deg,${color?.[0] || '#33404f'},${color?.[1] || '#1a212a'})` }, html: icon(ico, 16) }),
      h('span.r-main', h('span.r-title', title), h('span.r-sub', sub)), h('span.r-end', { html: icon('right', 15) }));
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = results.querySelector('button.row'); first?.click(); } });
    const close = () => { searchEl.remove(); searchEl = null; };
    searchEl = h('div.scrim', { style: { alignItems: 'flex-start', padding: '0' }, onclick: (e) => { if (e.target === searchEl) close(); } },
      h('div', { style: { width: '100%', background: 'var(--bg)', borderRadius: '0 0 26px 26px', padding: '14px', borderBottom: '1px solid var(--line)' } },
        h('div.row-flex', { style: { gap: '8px' } }, h('button.btn.icon', { onclick: close, html: icon('left', 18) }), input),
        h('div', { style: { marginTop: '10px', maxHeight: '60vh', overflow: 'auto' } }, results)));
    document.getElementById('screen').appendChild(searchEl);
    run();
  },
};
function widgetStatus() {
  const st = power.status;
  const p = pm.installedIds.length;
  const n = notif.count();
  return [
    `<span class="chip">${icon('zap', 11)} ${Math.round((st.level ?? 1) * 100)}%${st.charging ? ' ⚡' : ''}</span>`,
    `<span class="chip">${icon('apps', 11)} ${p} apps</span>`,
    n ? `<span class="chip warn">${icon('bell', 11)} ${n}</span>` : `<span class="chip ok">${icon('check', 11)} ${i18n.bi({ en: 'quiet', si: 'නිහතමානී' })}</span>`,
  ].join('');
}
const pidOf = (appId) => sched.pidOf(appId);
