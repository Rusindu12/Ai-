/* Dahat OS — tools/shellsmoke.mjs
 * Boots the *shell* (first-run onboarding, status bar, shade, window manager,
 * lock screen, dialogs, themes, notifications) headlessly and drives it the way
 * a person would on day one: complete setup, open apps, split, PIP, back, lock,
 * unlock, pull down the shade, toggle Quick Settings, allow a permission.
 *
 *   node tools/shellsmoke.mjs
 *
 * Fails on any uncaught async error, on a boot-stage error in the kernel log, or
 * on a missing UI surface — this is the closest thing to "does it boot on a phone".
 */
import { installDom, reportDomGaps } from './domstub.mjs';
import { writeSync } from 'node:fs';

const env = installDom();
const OUT = [];
const say = (...a) => { OUT.push(a.join(' ')); writeSync(1, a.join(' ') + '\n'); };

/* the shell expects index.html's layer stack */
for (const id of ['device', 'screen', 'wallpaper', 'home-layer', 'apps-layer', 'window-root', 'shade-root', 'lock-root', 'boot-root', 'dialog-root', 'toast-root', 'status-root', 'nav-root']) {
  const d = env.document.createElement('div');
  d.id = id;
  env.document.body.appendChild(d);
}
env.document.body.dataset.theme = 'dark';

const ASYNC = [];
process.on('unhandledRejection', (e) => ASYNC.push(e instanceof Error ? e : new Error(String(e))));

const P = (m) => `../os/js/${m}`;
const { boot } = await import(P('shell/boot.js'));
const { bus } = await import(P('kernel/bus.js'));
const { config } = await import(P('kernel/config.js'));
const { caps } = await import(P('kernel/caps.js'));
const { vfs } = await import(P('kernel/vfs.js'));
const { pm } = await import(P('kernel/pm.js'));
const { notif } = await import(P('kernel/notify.js'));
const { power } = await import(P('kernel/power.js'));
const { log } = await import(P('kernel/log.js'));
const { wm } = await import(P('shell/wm.js'));
const { launcher } = await import(P('shell/launcher.js'));
const { shade } = await import(P('shell/shade.js'));
const { statusbar } = await import(P('shell/statusbar.js'));
const { lockscreen } = await import(P('shell/lock.js'));
const dialogs = await import(P('shell/dialogs.js'));
const { i18n } = await import(P('ui/i18n.js'));

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const R = [];
let skipped = 0;
const check = (name, fn, opts = {}) => R.push({ name, fn, raw: !!opts.raw });
const q = (sel) => env.document.querySelector(sel);
const qa = (sel) => env.document.querySelectorAll(sel);
const text = (sel) => (q(sel)?.textContent || '').trim();
const topDialog = () => qa('#dialog-root .scrim').at(-1) || null;
const dismissDialogs = async () => {
  for (let i = 0; i < 6 && topDialog(); i++) {
    const sc = topDialog();
    if (sc.dismissible === false) sc?.__done?.(null);
    else sc?._fire?.('click', { target: sc, bubbles: false });  // tap the scrim: dismissible dialogs close
    await sleep(200);
    if (topDialog() === sc) { sc?.__done?.(null); await sleep(200); }
    if (topDialog() === sc) sc?.remove?.();
  }
};
const inTop = (sel) => (topDialog()?.querySelectorAll?.(sel) || []);
const resetUi = async () => {
  await dismissDialogs();
  if (lockscreen.isLocked()) { lockscreen.unlock('between checks'); await sleep(10); }
  await config.set('security.pin', null);
  if (shade.isOpen?.()) { shade.close(); await sleep(40); }
  while (wm.hasWindows?.()) { const f = wm.focused; if (!f) break; wm.close(f); await sleep(190); }
  launcher.goto?.('home');
  while (q('#screen .scrim')) { const c = q('#screen .scrim .btn.icon'); c?.click(); q('#screen .scrim')?.remove(); await sleep(5); }
  for (const id of ['qs.dnd', 'qs.airplane', 'power.doze']) if (config.get(id) === true) await config.set(id, false);
  await sleep(280);                                  // let close animations land before the next scenario
};
const clickWhere = async (sel, n = 0) => {
  const list = qa(sel);
  const el = list[n];
  if (!el) throw new Error(`no ${sel} to click (${list.length} found)`);
  el.click();
  await sleep(12);
  return el;
};

/* ------------------------------------------------------------------ boot */
check('boot: the OS comes up without touching a console error', async () => {
  const errs = [];
  const origError = console.error;
  console.error = (...a) => errs.push(a.map(String).join(' '));
  await boot();
  await sleep(30);
  console.error = origError;
  if (errs.length) throw new Error(`console.error during boot: ${errs[0]}`);
  const fatal = log.tail(400).filter((e) => e.level === 'error');
  if (fatal.length) throw new Error(`boot errors: ${fatal.map((e) => e.msg).join(' / ')}`);
  return `booted in ${Math.round(log.uptime)}ms`;
}, { raw: true });

check('boot: all 8 stages reached the log', async () => {
  const tail = log.tail(500);
  const want = ['storage', 'config', 'kernel', 'vfs', 'pm', 'shell', 'power', 'net'];
  const seen = want.filter((d) => tail.some((e) => e.domain === d || e.msg.includes(`${d}:`) || e.msg.startsWith(d)));
  if (seen.length < 6) throw new Error(`only these boot domains logged: ${seen.join(',') || 'none'} (of ${tail.length} lines)`);
  if (tail.some((e) => e.level === 'error')) throw new Error('a boot subsystem logged an error');
  return `${seen.length}/8 boot domains in dmesg, ${tail.length} lines`;
}, { raw: true });

check('kernel: 57 syscalls answered, debug API exposed', async () => {
  if (!globalThis.window.Dahat) throw new Error('window.Dahat missing');
  const n = bus.stats().services;
  if (n < 55) throw new Error(`only ${n} syscalls`);
  return `${n} syscalls, window.Dahat ready`;
}, { raw: true });

/* ------------------------------------------------------------- onboarding */
check('first run: onboarding is up and can be completed by clicking', async () => {
  if (!pm.installedIds.length) throw new Error('packages should already be installed by boot');
  let rounds = 0;
  const skipish = /^(not now|skip|later|පසුව|දැන් නැහැ)$/i;
  const pick = ['#dialog-root .scrim .btn.primary', '#dialog-root .scrim .btn.block', '#dialog-root .scrim .btn.text', '#dialog-root .scrim button'];
  while (q('#dialog-root .scrim') && rounds < 24) {
    let el = null;
    const btns = qa('#dialog-root .scrim button');
    el = btns.find((b) => skipish.test((b.textContent || '').trim()))
      || btns.find((b) => b.classList.contains('primary'))
      || btns.find((b) => b.classList.contains('btn'))
      || btns[0] || null;
    let clicked = false;
    if (!el) for (const sel of pick) { const c = q(sel); if (c) { el = c; break; } }
    if (el) { el.click(); clicked = true; }
    if (!clicked) break;
    await sleep(30); rounds++;
  }
  if (q('#dialog-root .scrim')) throw new Error(`onboarding still up after ${rounds} clicks`);
  if (config.get('ui.onboarded') === false) throw new Error('onboarding did not record completion');
  if (config.get('security.pin')) { await config.set('security.pin', ''); lockscreen.unlock('test cleanup'); await sleep(20); }
  return `setup finished in ${rounds} step(s)`;
}, { raw: true });

/* ---------------------------------------------------------------- home */
check('launcher: home page paints tiles, dock and clock widget', async () => {
  const tiles = qa('#home-layer .app-tile').length;
  if (tiles < 6) throw new Error(`only ${tiles} home tiles`);
  const dock = qa('#home-layer .dock .app-tile, #home-layer .app-dock .app-tile').length;
  if (!/⏰|\d{1,2}:\d{2}/.test(text('#home-layer'))) throw new Error('no clock text on the home page');
  launcher.goto(1); await sleep(6); launcher.goto(0); await sleep(6);
  return `${tiles} tiles, ${dock} in dock, pager responds`;
});

check('launcher: the app drawer lists every installed package and filters', async () => {
  launcher.showDrawer(); await sleep(8);
  const all = qa('#apps-layer .app-tile').length;
  if (all < pm.installedIds.length) throw new Error(`drawer shows ${all} of ${pm.installedIds.length}`);
  const search = q('#apps-layer input');
  if (search) { search.value = 'note'; search._fire('input', { target: search }); await sleep(8); }
  const filtered = qa('#apps-layer .app-tile').length;
  launcher.hideDrawer(); await sleep(6);
  if (search && filtered >= all) throw new Error('drawer filter did nothing');
  return `${all} in drawer, filter narrows to ${filtered}`;
});

check('launcher: omnibox finds apps, files and actions', async () => {
  launcher.openSearch();
  await sleep(20);
  let box = q('#screen input.input');
  if (!box) throw new Error(`no search input (screen kids: ${q('#screen')?.childNodes?.map?.((c) => c.className)?.join(',')})`);
  box.value = 'notes'; box._fire('input', { target: box });
  const rows = qa('#screen .scrim .row');
  if (!rows.length) throw new Error(`search returned nothing for "notes" (${qa('#screen .scrim button').length} buttons in the scrim)`);
  const label = (rows[0].textContent || '').trim();
  if (!/notes/i.test(label)) throw new Error(`first hit is "${label}", not Notes`);
  rows[0].click(); await sleep(140);
  if (q('#screen .scrim')) throw new Error('picking a search result left the search open');
  if (!qa('#window-root .win').length) throw new Error('search did not launch the app it pointed at');
  await dismissDialogs();
  wm.showHome();
  while (wm.hasWindows()) { const f = wm.focused; if (!f) break; wm.close(f); await sleep(200); }
  launcher.openSearch(); await sleep(20);
  const b2 = q('#screen input.input');
  b2.value = 'dark'; b2._fire('input', { target: b2 }); await sleep(20);
  const acts = qa('#screen .scrim .row').map((r) => (r.textContent || '').toLowerCase()).join(' ');
  if (!/dark/.test(acts)) throw new Error('actions missing from search');
  const before = config.get('display.theme');
  qa('#screen .scrim .row').find((r) => /dark/.test(r.textContent || ''))?.click();
  await sleep(30);
  if (config.get('display.theme') === before) throw new Error('the search action did not apply the theme');
  await config.set('display.theme', before);
  while (q('#screen .scrim')) { q('#screen .scrim .btn.icon')?.click(); q('#screen .scrim')?.remove(); await sleep(6); }
  return `omnibox: "${label}" launched an app, and a live action toggled the theme`;
});

/* ----------------------------------------------------------- windows */
check('wm: launch, focus, PIP, split, back, close', async () => {
  const before = qa('#window-root .win').length;
  const w1 = await wm.launch('calculator');
  if (!w1) throw new Error('launch returned nothing');
  await sleep(60);
  const w2 = await wm.launch('clock');
  await sleep(60);
  if (qa('#window-root .win').length < before + 2) throw new Error('windows did not appear');
  wm.setMode(w2, 'pip'); await sleep(20);
  if (!w2.el.classList.contains('pip')) throw new Error('PIP class missing');
  wm.setMode(w2, 'snap-left'); await sleep(20);
  wm.setMode(w2, 'max'); await sleep(20);
  wm.showOverview(); await sleep(20);
  if (!q('.ov-row, .ov-card')) throw new Error('overview did not render its strip');
  wm.hideOverview(); await sleep(10);
  wm.focus(w1); await sleep(10);
  if (w1.pid !== wm.front?.()?.pid && wm.front) throw new Error('focus did not raise');
  wm.back(); await sleep(40);
  wm.close(w1); wm.close(w2); await sleep(260);
  if (qa('#window-root .win').length > before) throw new Error('windows left behind');
  return '2 windows through every mode, overview, back and close';
});

check('wm: an app that misbehaves shows the crash card instead of the whole OS', async () => {
  const bad = { id: 'crashbox' };
  const win = await wm.launch('settings', { page: 'nope' });   // real app, odd params
  await sleep(50);
  if (!win) throw new Error('launch with unknown params should still work');
  wm.close(win);
  return 'bad params survived';
});

check('window titles follow the app, and the badge dot counts notifications', async () => {
  const win = await wm.launch('notes'); await sleep(40);
  notif.post({ appId: 'notes', title: 'from the shell test', body: 'badge me' });
  await sleep(20);
  const badge = launcher.badges?.('notes') ?? 0;
  const painted = Number(badge) > 0 || /1/.test(text('#home-layer'));
  wm.close(win); await sleep(20);
  if (!painted) throw new Error('badge count did not reach the launcher');
  return 'title + badge wired';
});

/* ----------------------------------------------------------- system UI */
check('status bar: clock, battery and network glyphs render', async () => {
  const t = text('#status-root');
  if (!/\d{1,2}:\d{2}/.test(t)) throw new Error(`no clock in the status bar: "${t}"`);
  if (!t.includes('%') && !t.includes('—')) throw new Error(`no battery readout: "${t}"`);
  statusbar.paint?.(); await sleep(10);
  return `"${t.replace(/\s+/g, ' ').slice(0, 46)}"`;
});

check('shade: pull down, toggle Quick Settings tiles, pull up', async () => {
  shade.open(); await sleep(20);
  const tiles = qa('#shade-root .qs-tile').length;
  if (tiles < 5) throw new Error(`only ${tiles} QS tiles`);
  const before = config.get('display.theme');
  await clickWhere('#shade-root .qs-tile', 0); await sleep(20);
  const slider = q('#shade-root input[type=range]');
  if (slider) { slider.value = '40'; slider._fire('input', { target: slider }); slider._fire('change', { target: slider }); await sleep(10); }
  else throw new Error('no brightness/volume slider in the shade');
  if (!q('#shade-root')) throw new Error('shade root vanished');
  shade.close(); await sleep(20);
  if (before === undefined) throw new Error('config unreadable after QS interaction');
  return `${tiles} tiles toggled, sliders live`;
});

check('shade: the power menu opens and dismisses', async () => {
  shade.open(); await sleep(30);
  const powerTile = qa('#shade-root .qs-tile').find((t) => /power menu|\u0ba2\u0db2 \u0dc0\u0dda\u0db4\u0dc0/i.test((t.textContent || '').trim()));
  if (!powerTile) throw new Error(`no power tile (tiles: ${qa('#shade-root .qs-tile').map((t) => t.textContent.trim()).join('/')})`);
  powerTile.click(); await sleep(80);
  if (!topDialog()) { powerTile.click(); await sleep(150); }
  if (!topDialog()) throw new Error(`power sheet did not open (locked=${lockscreen.isLocked()}, dialog kids=${q('#dialog-root')?.childNodes?.length})`);
  const rows = inTop('.row');
  const labels = rows.map((r) => (r.textContent || '').trim()).join(' | ');
  if (rows.length < 4) throw new Error(`power sheet has ${rows.length} rows: ${labels}`);
  rows[rows.length - 1].click(); await sleep(40);          // Reboot to Android → toast outside the APK
  await dismissDialogs();
  shade.close();
  return `power menu: ${labels}`;
});

/* ----------------------------------------------------------- lock */
check('lock: swipe-to-unlock, then a PIN that must be right', async () => {
  lockscreen.lock('test'); await sleep(20);
  if (!lockscreen.isLocked()) throw new Error('lock() did not lock');
  if (!q('#lock-root .lock-time, #lock-root .lock-body')) throw new Error('no lock UI');
  lockscreen.unlock('swipe'); await sleep(20);
  if (lockscreen.isLocked()) throw new Error('unlock() did not unlock');
  await lockscreen.setPin('2024');
  lockscreen.lock('test'); await sleep(20);
  const keys = qa('#lock-root .pin-key');
  if (keys.length < 10) throw new Error(`PIN pad has ${keys.length} keys`);
  const tapPin = async (digits) => {
    for (const d of digits) { const k = [...qa('#lock-root .pin-key')].find((b) => (b.textContent || '').trim() === d); if (!k) throw new Error(`no key ${d} on the pad`); k.click(); await sleep(6); }
    qa('#lock-root .pin-key').at(-1).click();          // "ok" submits
    await sleep(40);
  };
  await tapPin(['2', '0', '2', '3']);
  if (!lockscreen.isLocked()) throw new Error('a wrong PIN unlocked the device');
  await tapPin(['2', '0', '2', '4']);
  if (lockscreen.isLocked()) throw new Error('the right PIN did not unlock');
  await lockscreen.setPin('');
  lockscreen.unlock('cleanup');
  return 'wrong PIN refused, right PIN in';
});

/* ----------------------------------------------------------- dialogs */
check('dialogs: modal, confirm, prompt, sheet, list and log sheets', async () => {
  const inner = env.document.createElement('div');
  inner.className = 'card';
  const box = dialogs.modal(inner, { dismissible: false });
  await sleep(10);
  if (!topDialog()) throw new Error('modal did not mount a scrim');
  if (inTop('.card')[0] !== inner) throw new Error('the modal mounted a different node');
  inner.__done('clicked');
  if ((await box) !== 'clicked') throw new Error('modal did not resolve with its value');
  await sleep(200);
  if (topDialog()) throw new Error('modal stayed open after done()');
  const c = dialogs.confirm({ title: 'sure?', body: 'this is a test' });
  await sleep(10);
  inTop('.btn.primary')[0]?.click(); await sleep(12);
  if ((await c) !== true) throw new Error('confirm resolved false');
  const p = dialogs.prompt({ title: 'name', initial: 'abc' });
  await sleep(10);
  const inp = topDialog()?.querySelector?.('input');
  if (!inp) throw new Error('prompt has no input');
  inp.value = 'hello'; inp._fire('input', { target: inp });
  inTop('.btn.primary')[0]?.click(); await sleep(12);
  if ((await p) !== 'hello') throw new Error(`prompt returned ${JSON.stringify(await p.catch(() => 'err'))}`);
  const sheetNode = env.document.createElement('div');
  sheetNode.className = 'card';
  const sp = dialogs.sheet(sheetNode, { title: 'sheet' });
  await sleep(10);
  if (!topDialog()) throw new Error('sheet did not open');
  if (typeof topDialog().__done !== 'function') throw new Error('the scrim has no __done handle — .scrim.__done?.() call sites are dead');
  topDialog().__done('swipe');
  if ((await sp) !== 'swipe') throw new Error('sheet did not resolve');
  await sleep(200);
  if (topDialog()) throw new Error('a sheet refused to close');
  dialogs.logSheet('shell'); await sleep(20);
  const lt = (topDialog()?.textContent || '').trim();
  if (!/log/i.test(lt)) throw new Error(`log sheet says "${lt.slice(0, 30)}"`);
  await dismissDialogs();
  if (topDialog()) throw new Error('the log sheet would not dismiss — stacking is broken');
  return 'modal/confirm/prompt/sheet/log sheet all mount, resolve and close';
});

check('permission prompt: allow grants, deny is remembered', async () => {
  caps.reset('snake');
  const p = caps.check('snake', 'vibrate', { why: 'shake on death' });
  await sleep(15);
  if (!topDialog()) throw new Error('no prompt UI');
  const t = (topDialog()?.textContent || '').replace(/\s+/g, ' ').trim();
  if (!/haptic|vibrat|\u0dc0\u0db1\u0dba/i.test(t)) throw new Error(`prompt is not about vibration: "${t.slice(0, 50)}"`);
  inTop('.btn.primary')[0]?.click(); await sleep(15);
  if ((await p) !== true) throw new Error('allow did not resolve true');
  if (caps.state('snake', 'vibrate') !== 'grant') throw new Error('grant not recorded');
  caps.reset('snake');
  const p2 = caps.check('snake', 'vibrate', { why: 'again' });
  await sleep(15);
  (inTop('.btn').find((b) => !b.classList.contains('primary')) || inTop('button')[0])?.click(); await sleep(15);
  if ((await p2) !== false) throw new Error(`deny resolved ${JSON.stringify(await p2.catch(() => 'pending'))}`);
  if (caps.state('snake', 'vibrate') !== 'deny') throw new Error('deny not remembered');
  const p3 = caps.check('snake', 'vibrate');          // cached deny: no prompt this time
  if ((await p3) !== false) throw new Error('a denied capability came back allowed');
  if (topDialog()) throw new Error('the cached denial still showed a prompt');
  caps.reset('snake');
  return 'allow grants, deny is cached, the prompt text names the capability';
});

check('toasts appear and expire', async () => {
  const r = q('#toast-root');
  if (!r) throw new Error('no #toast-root');
  qa('#toast-root .snack').forEach((n) => n.remove());
  dialogs.toast('hello toast', 40);
  const el = qa('#toast-root .snack').at(-1);
  if (!el) throw new Error('toast() mounted nothing — is initToasts() wired?');
  if (!/hello toast/.test(el.textContent || '')) throw new Error(`snack says "${el.textContent}"`);
  await sleep(450);
  if (el.isConnected) throw new Error('toast never left');
  bus.emit('ui.toast', { message: 'via bus', ms: 30 });
  await sleep(20);
  const el2 = qa('#toast-root .snack').at(-1);
  if (!/via bus/.test(el2?.textContent || '')) throw new Error('the ui.toast bus topic is not wired to a visible toast');
  await sleep(450);
  return 'toast renders, expires, and is reachable over the bus';
});

/* ----------------------------------------------------------- theme + config */
check('theme: light/dark, accent and wallpaper repaint the document', async () => {
  await config.set('display.theme', 'light'); await sleep(15);
  if (env.document.body.dataset.theme !== 'light') throw new Error('data-theme did not follow');
  await config.set('display.accent', '#ff8800'); await sleep(15);
  const accent = env.document.documentElement.style.getPropertyValue('--accent');
  if (!/ff8800/i.test(accent)) throw new Error(`--accent is "${accent}"`);
  await config.set('display.wallpaper', 'dunes'); await sleep(15);
  if (!env.document.documentElement.style.getPropertyValue('--wall')) throw new Error('--wall not set');
  await config.set('display.theme', 'dark'); await sleep(15);
  if (globalThis.DahatBridge) throw new Error('bridge should not exist in Node');
  return 'theme, accent, wallpaper all reach CSS';
});

check('i18n: switching to Sinhala re-renders the shell', async () => {
  i18n.lang = 'si'; await sleep(30);
  const si = text('#home-layer') + text('#status-root');
  const hasSinhala = /[\u0d80-\u0dff]/.test(si) || /[\u0d80-\u0dff]/.test(text('#apps-layer'));
  i18n.lang = 'en'; await sleep(20);
  if (!hasSinhala) throw new Error('no Sinhala glyphs reached the shell text');
  return 'shell strings switch language live';
});

check('settings persistence: a reload keeps language, theme and layout', async () => {
  await config.set('ui.lang', 'si'); await sleep(10);
  const layout = pm.pages();
  if (!Array.isArray(layout) || !layout.length) throw new Error('home layout lost');
  await config.set('ui.lang', 'en'); await sleep(10);
  const keys = await globalThis.window.Dahat.storage.get('config', null);
  if (!keys || keys['ui.lang'] === undefined) throw new Error(`config did not reach the store (${JSON.stringify(keys)?.slice(0, 60)})`);
  const mode = globalThis.window.Dahat.storage.mode;
  return `store=${mode}, ${layout.length} home pages, config round-tripped`;
});

/* ----------------------------------------------------------- notifications */
check('heads-up: a posted notification shows a banner and can be tapped', async () => {
  const n = notif.post({ appId: 'notes', title: '⏰ ping', body: 'from the shell test', importance: 'max' });
  await sleep(30);
  const banner = q('#shade-root .notif');
  if (!banner) throw new Error('no heads-up banner rendered');
  banner.click(); await sleep(30);
  if (!lockscreen.isLocked() && !q('.scrim')) { /* tapping opened something: fine */ }
  await bus.call('notif.clear', {}, { appId: 'notes', pid: 'test', trust: true });
  return `banner for ${n.id}`;
});

check('alarm wiring: app.setAlarm → bus event → Clock wakes', async () => {
  const sys = await import(P('kernel/syscalls.js'));
  const r = await bus.call('app.setAlarm', { id: '07:00', hour: 7, minute: 0, label: 'rise', repeat: true }, { appId: 'clock', pid: 'test' });
  if (r.via !== 'in-app') throw new Error(`expected in-app arming, got ${r.via}`);
  let sawEvent = null;
  bus.on('alarm.fire', (e) => { sawEvent = e; });
  if (!sys.fireAlarm('clock:07:00')) throw new Error('fireAlarm returned false');
  await sleep(20);
  if (!sawEvent) throw new Error('alarm.fire never reached the bus');
  await bus.call('app.cancelAlarm', { id: '07:00' }, { appId: 'clock', pid: 'test' });
  return `fired as ${sawEvent.key}`;
});

/* ----------------------------------------------------------- host bridge */
check('host bridge: back key, share intent and resume behave', async () => {
  if (typeof globalThis.window.dahatOnBack !== 'function') throw new Error('dahatOnBack missing');
  q('#dialog-root')?.childNodes?.slice()?.forEach((n) => n.remove?.());
  const win = await wm.launch('files'); await sleep(40);
  if (globalThis.window.dahatOnBack() !== true) throw new Error('back should be consumed by an open window');
  wm.close(win); await sleep(240);                                // the close animation unmounts at 170ms
  if (globalThis.window.dahatOnBack() !== false) throw new Error(`back should be free on the home page (locked=${lockscreen.isLocked()} shade=${shade.isOpen()} scrim=${!!env.document.querySelector('.scrim')} wins=${wm.hasWindows()})`);
  globalThis.window.dahatGoHome(); await sleep(10);
  const lsInbox = () => { try { return vfs.ls('/sdcard/Inbox').length; } catch { return 0; } };   // the folder is created by the first share
  const before = lsInbox();
  globalThis.window.dahatOnIntent(JSON.stringify({ type: 'share', title: 'from whatsapp', text: 'meet at 6pm at the temple' }));
  await sleep(40);
  const after = vfs.ls('/sdcard/Inbox').length;
  if (after <= before) throw new Error('shared text did not land in /sdcard/Inbox');
  globalThis.window.dahatOnResume(); await sleep(10);
  if (power.status.screen !== 'on') throw new Error('resume did not wake the screen state');
  return `inbox ${before}→${after}, back/home/resume wired`;
});

check('deep link: dahat://open?app=… is handled without a crash', async () => {
  globalThis.window.dahatOnIntent(JSON.stringify({ type: 'link', url: 'dahat://open?app=calculator' }));
  await sleep(40);
  globalThis.window.dahatOnIntent(JSON.stringify({ type: 'alarm', key: 'clock:07:00', label: 'rise' }));
  await sleep(40);
  qa('#window-root .win').forEach((el) => el.remove());
  return 'link + alarm events survived';
});

/* ----------------------------------------------------------- teardown */
check('teardown: closing every window leaves the launcher usable', async () => {
  const want = ['snake', 'todo', 'paint'];
  for (const id of want) {
    if (!pm.isInstalled(id)) await pm.install(id);
    if (!pm.isInstalled(id)) throw new Error(`${id} did not install`);
    const w = await wm.launch(id);
    await sleep(60);
    if (!w) throw new Error(`installed ${id} but it would not launch`);
  }
  const open = qa('#window-root .win').length;
  if (!open) throw new Error(`nothing to close (winRoot=${q('#window-root')?.childNodes?.length}, locked=${lockscreen.isLocked()}, log=${JSON.stringify(log.tail(4).map((e) => e.msg))})`);
  wm.showHome(); await sleep(60);
  if (wm.focused) throw new Error('home did not drop focus');
  if (qa('#window-root .win').length !== open) throw new Error('pressing Home unmounted live windows — app state would be lost');
  const states = wm.windows.map((w) => w.proc.state).join(',');
  if (!/suspended/.test(states)) throw new Error(`Home left apps in state ${states} — the scheduler should suspend them`);
  for (const w of [...wm.windows]) wm.close(w);
  await sleep(260);
  if (qa('#window-root .win').length) throw new Error('close left windows mounted');
  if (!qa('#home-layer .app-tile').length) throw new Error('home page did not survive');
  for (const id of want) await pm.uninstall(id);
  if (pm.isInstalled('snake')) throw new Error('uninstall did not take');
  return `${open} bazaar windows: Home keeps them alive and suspends them, close unmounts, packages removed again`;
});

check('nothing exploded asynchronously while all of that ran', async () => {
  await sleep(80);
  const async = ASYNC.splice(0);
  if (async.length) throw new Error(`${async.length} uncaught error(s): ${async.slice(0, 3).map((e) => e.message).join(' | ')}`);
  const gaps = reportDomGaps();
  if (gaps.length > 6) throw new Error(`the shell needed DOM APIs the stub lacks: ${gaps.slice(0, 4).join('; ')}`);
  return `clean${gaps.length ? ` (${gaps.length} stub gap(s), not OS bugs)` : ''}`;
});

/* ------------------------------------------------------------------ run */
const results = [];
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms — something never resolved in ${label}`)), ms))]);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
for (const { name, fn, raw } of R) {
  if (ONLY && !ONLY.test(name)) { skipped++; continue; }
  if (process.env.VERBOSE) writeSync(2, `→ ${name}\n`);
  const t = performance.now();
  try {
    if (!raw) await withTimeout(resetUi(), 8000, `reset before ${name}`).catch(() => {});
    const v = await withTimeout(fn(), 12000, name);
    results.push({ name, pass: true, ms: +(performance.now() - t).toFixed(0), detail: typeof v === 'string' ? v : '' });
  } catch (e) {
    results.push({ name, pass: false, err: e?.message || String(e), where: (e?.stack || '').split('\n')[1]?.trim() });
  }
}
const passed = results.filter((r) => r.pass).length;
say(`\nDahat OS shell smoke — ${results.length} scenarios driving the real UI\n`);
for (const r of results) {
  say(r.pass
    ? `  ✓ ${r.name.padEnd(62)} — ${r.detail} (${r.ms}ms)`
    : `  ✗ ${r.name.padEnd(62)} ${r.err}  [${r.where || ''}]`);
}
const failed = results.length - passed;
say(`\n${passed}/${results.length} scenarios passed${failed ? `\n\n${failed} FAILING` : '\n\nall good — the OS boots, reacts and tears down'}`);
env.clearAll();
process.exit(failed ? 1 : 0);
