/* Dahat OS — shell/wm.js
 * Window manager. One window per process; modes are max | snap-left |
 * snap-right | pip. Handles launch, focus, suspension, recents and crashes.
 */
import { h, icon, clear, drag, Sig } from '../ui/dom.js';
import { bus } from '../kernel/bus.js';
import { sched } from '../kernel/sched.js';
import { pm } from '../kernel/pm.js';
import { byId } from '../kernel/packages.js';
import { log } from '../kernel/log.js';
import { createApi } from '../kernel/api.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { loadApp } from '../apps/registry.js';

const windows = new Map();   // pid -> win record
const focusOrder = [];       // pid stack, top last
const emitter = new Sig();
let root = null, overviewEl = null;

export const wm = {
  on: (ev, fn) => emitter.on(ev, fn),
  get windows() { return [...windows.values()]; },
  get focused() { return focusOrder.length ? windows.get(focusOrder[focusOrder.length - 1]) : null; },
  init() {
    root = document.getElementById('window-root');
    bus.register('wm.launch', ({ appId, params }) => this.launch(appId, params), { cap: 'process', desc: 'open another app' });
    bus.register('wm.close', ({ pid }) => { const w = windows.get(pid || this.focused?.pid); if (w) this.close(w); return { ok: !!w }; });
    bus.register('win.mode', ({ pid, mode }) => { const w = windows.get(pid); if (w) this.setMode(w, mode); return { mode: w?.mode }; });
    bus.register('win.list', () => this.windows.map((w) => ({ pid: w.pid, appId: w.appId, mode: w.mode, title: w.title })));
    bus.register('win.title', ({ pid, title }) => { const w = windows.get(pid); if (w) { w.title = title; w.titleEl.textContent = title; } });
    bus.on('ui.toast', ({ message, ms }) => emitter.emit('toast', { message, ms }));
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (overviewEl) this.closeOverview(); else this.back(); }
      if (e.key === 'F1') { e.preventDefault(); this.showOverview(); }
    });
    return this;
  },

  async launch(appId, params) {
    const pkg = byId(appId);
    if (!pkg) { emitter.emit('toast', { message: `no such app: ${appId}` }); return null; }
    if (!pm.isInstalled(appId)) { emitter.emit('toast', { message: `${appId} is not installed` }); return null; }
    const existing = [...windows.values()].find((w) => w.appId === appId);
    if (existing) { this.focus(existing); if (params) existing.ctx.params = params; existing.instance?.onParams?.(params); return existing; }
    this.hideOverview();
    document.getElementById('apps-layer')?.classList.add('hidden');
    const proc = sched.spawn(appId, { name: i18n.bi(pkg.name) });
    const win = this.makeWindow(proc, pkg);
    this.focus(win);
    win.body.appendChild(h('div.empty', { html: `${icon(pkg.icon, 26)}<span>${i18n.bi(pkg.name)}…</span>` }, ));
    try {
      const mod = await loadApp(pkg.entry);
      const ctx = this.makeCtx(proc, win, params);
      const inst = await mod.create(ctx);
      clear(win.body);
      win.instance = inst;
      inst.el.classList?.add('app');
      win.body.appendChild(inst.el);
      proc.instance = inst;
      sched.beat(proc.pid);
      inst.onCreate?.();
      log.info('wm', `pid ${proc.pid} mounted ${appId} (${(Date.now() - proc.startedAt).toFixed(0)}ms)`);
    } catch (err) {
      log.error('wm', `launch ${appId} failed: ${err.message}`);
      clear(win.body);
      win.body.appendChild(crashNode(appId, err, () => { this.close(win); this.launch(appId, params); }));
    }
    emitter.emit('change');
    return win;
  },

  makeWindow(proc, pkg) {
    const titleEl = h('span.title', i18n.bi(pkg.name));
    const head = h('div.win-head',
      h('span.r-ico', { style: { '--c1': pkg.color[0], '--c2': pkg.color[1], width: '26px', height: '26px', borderRadius: '8px', background: `linear-gradient(150deg,${pkg.color[0]},${pkg.color[1]})` }, html: icon(pkg.icon, 15) }),
      titleEl,
      btn('split', 'layers', () => this.toggleSplit(win)),
      btn('pip', 'image', () => this.setMode(win, win.mode === 'pip' ? 'max' : 'pip')),
      btn('close', 'x', () => this.close(win))
    );
    const body = h('div.win-body');
    const el = h('div.win', { dataset: { pid: String(proc.pid), app: pkg.id } }, head, body);
    const win = { el, body, head, titleEl, pid: proc.pid, appId: pkg.id, pkg, mode: 'max', proc, instance: null, title: i18n.bi(pkg.name), snapSide: null };
    windows.set(proc.pid, win);
    root.appendChild(el);
    head.addEventListener('dblclick', () => this.setMode(win, win.mode === 'max' ? 'pip' : 'max'));
    // PIP dragging
    drag(head, {
      onMove: (dx, dy) => {
        if (win.mode !== 'pip') return;
        const nx = clampN(win.px + dx, -60, root.clientWidth - 90);
        const ny = clampN(win.py + dy, -20, root.clientHeight - 60);
        win.px = nx; win.py = ny;
        el.style.left = `${nx}px`; el.style.top = `${ny}px`; el.style.right = 'auto'; el.style.bottom = 'auto';
      },
    });
    return win;
  },

  makeCtx(proc, win, params) {
    const api = createApi({ pid: proc.pid, appId: proc.appId, getcwd: () => win.cwd || `/apps/${proc.appId}` });
    const ctx = {
      pid: proc.pid, appId: proc.appId, pkg: win.pkg, params: params || {},
      api, bus, t: i18n.t, bi: i18n.bi, lang: () => i18n.lang,
      icon: (n, s) => icon(n, s),
      toast: (m, ms) => emitter.emit('toast', { message: m, ms }),
      haptic: (p) => actuate(p || 'tap'),
      sfx: (n) => api.ui.sfx(n),
      close: () => this.close(win),
      setTitle: (s) => { win.title = s; win.titleEl.textContent = s; },
      setMode: (m) => this.setMode(win, m),
      requestCap: (cap, why) => api.caps.request(cap, why),
      openApp: (id, p) => this.launch(id, p),
      on: (ev, fn) => emitter.on(ev, fn),
      watch: (fn) => bus.on(`proc.${fn}`, () => fn()),
      root: win.body,
      size: () => ({ w: win.body.clientWidth, h: win.body.clientHeight }),
      prompt: (opts) => import('./dialogs.js').then((m) => m.prompt(opts)),
      confirm: (opts) => import('./dialogs.js').then((m) => m.confirm(opts)),
      sheet: (content, opts) => import('./dialogs.js').then((m) => m.sheet(content, opts)),
    };
    win.ctx = ctx;
    proc.cwd = '/';
    return ctx;
  },

  setMode(win, mode, side) {
    const el = win.el;
    win.mode = mode;
    el.classList.toggle('snapped', mode !== 'max');
    el.classList.toggle('pip', mode === 'pip');
    el.style.cssText = '';
    if (mode === 'max') { win.instance?.onResize?.(); return; }
    if (mode === 'pip') {
      win.px = Math.max(8, root.clientWidth - 182); win.py = Math.max(8, root.clientHeight - 380);
      el.style.left = `${win.px}px`; el.style.top = `${win.py}px`; el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    if (mode.startsWith('snap')) {
      const s = side || (mode === 'snap-left' ? 'left' : 'right');
      win.snapSide = s;
      const half = `calc(50% - 6px)`;
      el.style.width = half; el.style.height = 'calc(100% - 0px)';
      el.style.left = s === 'left' ? '6px' : 'auto'; el.style.right = s === 'right' ? '6px' : 'auto';
      el.style.top = '0'; el.style.bottom = '0'; el.style.position = 'absolute';
    }
    requestAnimationFrame(() => win.instance?.onResize?.());
    log.debug('wm', `pid ${win.pid} mode → ${mode}`);
  },
  toggleSplit(win) {
    if (win.mode.startsWith('snap')) { this.windows.forEach((w) => this.setMode(w, 'max')); return; }
    const others = this.windows.filter((w) => w !== win);
    this.setMode(win, 'snap-left', 'left');
    if (others[0]) this.setMode(others[0], 'snap-right', 'right');
    else {
      const hint = byId('notes');
      this.launch(hint.id).then((w) => w && this.setMode(w, 'snap-right', 'right'));
    }
    emitter.emit('toast', { message: i18n.t('wm.split') });
  },
  focus(win) {
    if (!win) return;
    const i = focusOrder.indexOf(win.pid);
    if (i >= 0) focusOrder.splice(i, 1);
    focusOrder.push(win.pid);
    windows.forEach((w) => {
      w.el.style.zIndex = w === win ? '5' : '1';
      if (w !== win) { sched.suspend(w.pid, 'background'); w.instance?.onPause?.(); }
    });
    sched.resume(win.pid);
    win.instance?.onResume?.();
    win.el.style.opacity = '1';
    emitter.emit('focus', { pid: win.pid, appId: win.appId });
  },
  close(win) {
    if (!win) return;
    win.el.classList.add('closing');
    actuate('close');
    const pid = win.pid;
    setTimeout(() => {
      windows.delete(pid);
      win.el.remove();
      sched.kill(pid, 'window closed');
      if (!windows.size && overviewEl === null) this.showHome();
      emitter.emit('change');
    }, 170);
  },
  back() {
    const f = this.focused;
    if (!f) { this.showHome(); return false; }
    if (f.mode !== 'max') { this.setMode(f, 'max'); return true; }
    if (f.instance?.onBack?.() === true) return true;
    this.close(f);
    return true;
  },
  showHome() {
    focusOrder.length = 0;
    windows.forEach((w) => { sched.suspend(w.pid, 'home'); w.instance?.onPause?.(); });
    emitter.emit('home');
  },
  minimize(win) {
    this.showHome();
    log.debug('wm', `pid ${win.pid} minimized`);
  },
  showOverview() {
    if (overviewEl) return;
    const list = this.windows;
    const bar = h('div.ov-bar', h('button.btn.text', { onclick: () => { list.forEach((w) => this.close(w)); this.closeOverview(); } }, i18n.t('wm.clearAll')));
    const row = h('div.ov-row');
    if (!list.length) row.appendChild(h('div.empty', { style: { width: '100%' } }, icon('layers', 30), h('span', i18n.t('wm.nWindows', { n: 0 }))));
    list.forEach((win) => {
      const thumb = h('div.thumb');
      thumb.appendChild(win.el);                       // live preview, re-parented
      win.el.classList.add('no-anim');
      const card = h('div.ov-card',
        thumb,
        h('div.row-flex', { style: { gap: '6px', padding: '6px 2px 0' } },
          h('span.tiny', { style: { flex: '1', fontWeight: '700' } }, i18n.bi(win.pkg.name)),
          h('button.btn.icon', { style: { width: '30px', height: '30px' }, onclick: () => { this.close(win); setTimeout(() => this.showOverview(), 200); }, html: icon('x', 15) })
        )
      );
      thumb.addEventListener('click', () => { this.closeOverview(); this.focus(win); });
      row.appendChild(card);
    });
    overviewEl = h('div.overview',
      h('div.row-flex', { style: { justifyContent: 'space-between' } },
        h('span', { style: { fontWeight: '800', fontSize: '15px' } }, i18n.t('wm.recents')),
        h('span.chip', i18n.t('wm.nWindows', { n: list.length }))),
      row, bar);
    root.appendChild(overviewEl);
    row.scrollLeft = (row.scrollWidth - row.clientWidth) / 2;
    log.debug('wm', `overview opened with ${list.length} tasks`);
  },
  hideOverview() {
    if (!overviewEl) return;
    windows.forEach((w) => { w.el.classList.remove('no-anim'); root.appendChild(w.el); });
    clear(overviewEl).remove();
    overviewEl = null;
  },
  closeOverview() { this.hideOverview(); },
  /** used by the APK's back button and by the nav bar */
  hasWindows() { return windows.size > 0; },
  badges(appId) { return bus.request('notif.badge', { appId }); },
};

const btn = (name, ico, fn) => h('button.btn.icon', { title: name, 'aria-label': name, onclick: fn, html: icon(ico, 17) });
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

function crashNode(appId, err, restart) {
  return h('div.card', { style: { margin: '16px' } },
    h('h3', { style: { margin: '0 0 6px' } }, `${i18n.bi(byId(appId)?.name || appId)} stopped`),
    h('p.mono', { style: { color: 'var(--err)', wordBreak: 'break-word' } }, String(err?.stack || err?.message || err)),
    h('div.row-flex', { style: { gap: '8px', marginTop: '10px' } },
      h('button.btn.primary', { onclick: restart }, 'Restart'),
      h('a.btn.text', { href: '#logs', onclick: (e) => { e.preventDefault(); import('../shell/dialogs.js').then((m) => m.logSheet(appId)); } }, 'Kernel log'))
  );
}
