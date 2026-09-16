/* Dahat OS — shell/boot.js
 * Boot sequence. Every stage below is a real init step (the log lines are the
 * kernel's own, not a canned animation); the splash lingers just long enough
 * to be readable, then hands over to the launcher.
 */
import { h, icon, clear } from '../ui/dom.js';
import { storage } from '../kernel/storage.js';
import { config } from '../kernel/config.js';
import { registerSyscalls, isTrusted } from '../kernel/syscalls.js';
import { bus } from '../kernel/bus.js';
import { caps } from '../kernel/caps.js';
import { vfs } from '../kernel/vfs.js';
import { pm } from '../kernel/pm.js';
import { notif } from '../kernel/notify.js';
import { power } from '../kernel/power.js';
import { sched } from '../kernel/sched.js';
import { log } from '../kernel/log.js';
import { i18n } from '../ui/i18n.js';
import { applyTheme, watchTheme } from './theme.js';
import { statusbar } from './statusbar.js';
import { shade } from './shade.js';
import { wm } from './wm.js';
import { launcher } from './launcher.js';
import { lockscreen } from './lock.js';
import { onboarding } from './onboarding.js';
import { initHeadsUp } from './heads-up.js';
import { permPrompt, toast } from './dialogs.js';

const T0 = performance.now();
const STAGES = [
  ['storage', 'bring up persistent store'],
  ['config', 'load settings'],
  ['kernel', 'install syscall table'],
  ['vfs', 'mount dahat-fs'],
  ['pm', 'scan package index'],
  ['shell', 'start window manager'],
  ['power', 'attach battery + radio'],
  ['net', 'register offline cache'],
];

export async function boot() {
  const bootRoot = document.getElementById('boot-root');
  const logEl = h('div.boot-log');
  const bar = h('div.boot-bar', h('i'));
  const el = h('div#boot',
    h('div.boot-mark', h('span', 'ධ')),
    h('div.boot-name', 'Dahat OS'),
    h('div.boot-sub', h('span', { id: 'boot-stage' }, i18n.t('boot.kernel'))),
    bar, logEl);
  bootRoot.appendChild(el);
  const setStage = async (i, msg) => {
    document.getElementById('boot-stage').textContent = msg;
    bar.firstChild.style.width = `${((i + 1) / STAGES.length) * 100}%`;
    await new Promise((r) => setTimeout(r, 70));
  };
  const unwatch = log.watch((e) => {
    const line = h('div', { class: e.level === 'err' ? 'wr' : '', text: `[${(e.up / 1000).toFixed(3).padStart(7)}] ${e.domain}: ${e.msg}` });
    logEl.appendChild(line);
    while (logEl.children.length > 7) logEl.firstChild.remove();
  });

  // ---- 0. persistence
  await setStage(0, 'kernel: opening storage');
  const mode = await storage.init();
  log.info('kernel', `persistence backend: ${mode}`);

  // ---- 1. settings
  await setStage(1, 'config: loading settings');
  await config.load();
  applyTheme();
  watchTheme();

  // ---- 2. kernel
  await setStage(2, 'kernel: installing syscalls');
  registerSyscalls();
  await caps.load();
  caps.prompter = (appId, cap, why) => permPrompt(appId, cap, why);
  bus.trustFn = (appId) => isTrusted(appId);
  caps.onChange(() => bus.emit('caps.change', {}));

  // ---- 3. filesystem
  await setStage(3, 'vfs: mounting /sdcard');
  await vfs.mount();
  vfs.onChange(({ ev, path }) => bus.emit('fs.change', { ev, path }));
  const df = vfs.df();
  log.info('vfs', `/sdcard ${Math.round(df.used / 1024)}KiB used of ${Math.round(df.total / 1048576)}MiB`);

  // ---- 4. packages + notifications
  await setStage(4, 'pm: scanning packages');
  await pm.load();
  await notif.load();
  log.info('pm', `${pm.installedIds.length}/${pm.all.length} packages installed, ${notif.all().length} notifications retained`);

  // ---- 5. shell
  await setStage(5, 'shell: window manager + launcher');
  shade.init();
  statusbar.init(shade);
  wm.init();
  initHeadsUp();
  launcher.init();
  lockscreen.init();
  wm.on('home', () => { launcher.paintHome(); });
  wm.on('change', () => launcher.paintBadges());
  bus.on('theme.change', () => launcher.paintHome());
  bus.on('ui.toast', ({ message }) => { if (message) toast(message); });

  // ---- 6. power
  await setStage(6, 'power: battery + radios');
  await power.init();

  // ---- 7. offline cache (PWA)
  await setStage(7, 'net: service worker');
  registerSW();
  attachHostBridge();

  const ms = Math.round(performance.now() - T0);
  log.info('kernel', `boot complete in ${ms}ms — ${pm.installedIds.length} packages, ${bus.stats().services} syscalls`);
  const wait = Math.max(0, 1250 - ms);
  if (wait) await new Promise((r) => setTimeout(r, wait));
  unwatch();
  el.classList.add('done');
  setTimeout(() => clear(bootRoot), 520);
  window.__dahatBooted = true;

  await onboarding();
  firstRunHello(ms);
  exposeDebugApi();
  return { ms, procs: sched.list.length };
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { log.debug('net', 'service worker unavailable (insecure context) — relying on host cache'); return; }
  navigator.serviceWorker.register('sw.js').then((reg) => {
    log.info('net', `service worker registered (scope ${reg.scope})`);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'activated') log.info('net', 'OS cache updated to a new revision'); });
    });
  }).catch((e) => log.warn('net', `service worker failed: ${e.message}`));
}

/** The Android launcher APK injects window.DahatBridge; wire the callbacks. */
function attachHostBridge() {
  /* The launcher APK routes the hardware/gesture back through here. Returning
   * false tells Android "I did not consume it", so the home button still works. */
  window.dahatOnBack = () => {
    if (lockscreen.isLocked()) { lockscreen.unlock('back'); return true; }
    if (shade.isOpen()) { shade.close(); return true; }
    if (document.querySelector('.scrim')) return true;  // a dialog is up: it eats the key
    if (wm.hasWindows()) { wm.back(); return true; }
    return false;
  };
  /** HOME press: pull the user back to the launcher page, no matter what is open */
  window.dahatGoHome = () => { wm.showHome(); power.activity(); return true; };
  window.dahatOnIntent = (json) => {
    try {
      const d = JSON.parse(json);
      // the launcher fires host-side events at us too: an alarm that went off
      // while the OS was closed arrives here when the user taps the notification
      if (d.type === 'alarm') {
        const f = await0(() => import('../kernel/syscalls.js'));
        bus.emit('alarm.fire', { key: d.key, appId: d.appId || 'clock', label: d.label || '' });
        if (d.key) f.then((m) => m.fireAlarm(d.key));
        wm.launch(d.appId || 'clock');
        power.activity();
        return;
      }
      if (d.type === 'voice') { bus.emit('assistant.voice', { text: String(d.text || '') }); return; }
      const where = '/sdcard/Inbox';
      vfs.mkdir(where, '/', { recursive: true });
      const name = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${(d.title || 'shared').replace(/[^\w.-]+/g, '_').slice(0, 40)}.txt`;
      vfs.write(`${where}/${name}`, [d.title, d.text, d.url].filter(Boolean).join('\n\n'));
      notif.post({ appId: 'files', title: i18n.bi({ en: 'Received from Android', si: 'Android වෙතින් ලැබුණි' }), body: `${name}`, tapTo: { open: `${where}/${name}` } });
      log.info('shell', `shared text received → ${where}/${name}`);
    } catch (e) { log.warn('shell', `intent parse failed: ${e.message}`); }
  };
  window.dahatOnResume = () => { power.activity(); bus.emit('host.resume', {}); };
  window.dahatOnPause = () => { bus.emit('host.pause', {}); };
  const b = self.DahatBridge;
  if (b) log.info('shell', 'android host bridge attached');
}

/** tiny helper: dynamic import that never rejects before the shell is up */
const await0 = (fn) => fn().catch((e) => { log.warn('shell', `module load failed: ${e.message}`); return { fireAlarm: () => false }; });

async function firstRunHello(ms) {
  if (config.get('ui.greeted')) return;
  await config.set('ui.greeted', true);
  setTimeout(() => {
    notif.post({
      appId: 'assistant', sticky: true,
      title: i18n.bi({ en: 'Welcome to Dahat OS', si: 'දහත් OS වෙත සාදරයෙන් පිළිගනිමු' }),
      body: i18n.bi({ en: `Booted in ${ms}ms. Try: open Terminal and type "neofetch", or Bazaar to install more apps.`, si: `${ms}ms කින් ආරම්භ විය. ටර්මිනලය විවෘත කර "neofetch" ටයිප් කර බලන්න.` }),
    });
    log.info('shell', 'welcome message queued');
  }, 900);
}

function exposeDebugApi() {
  window.Dahat = { bus, vfs, pm, config, caps, notif, power, sched, log, wm, launcher, i18n, storage };
  if (!config.get('dev.developer')) log.debug('dev', 'debug API exposed as window.Dahat (enable developer options for syscalls)');
}
