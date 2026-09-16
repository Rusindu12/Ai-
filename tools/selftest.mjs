#!/usr/bin/env node
/* tools/selftest.mjs — runs the Dahat kernel in Node with a stubbed DOM.
 * The OS has no build step, so this is the test layer: it boots storage, the
 * VFS, the syscall bus, the package manager and the permission system, then
 * hammers every registered syscall. CI runs this before it builds the APK.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const el = () => ({ style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, insertAdjacentHTML() {}, remove() {}, setAttribute() {}, addEventListener() {}, click() {}, querySelector: () => null, querySelectorAll: () => [], firstChild: null, scrollTop: 0, innerHTML: '', textContent: '' });
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });

def('document', {
  createElement: el, getElementById: () => el(), execCommand: () => true, querySelector: () => null, querySelectorAll: () => [],
  body: el(), addEventListener() {}, documentElement: el(), execCommand: () => true,
});
def('navigator', {
  onLine: true, hardwareConcurrency: 4, deviceMemory: 8, userAgent: 'Node/Dahat-selftest', language: 'en-US',
  vibrate: () => true, maxTouchPoints: 0, clipboard: { writeText: async () => {}, readText: async () => '' },
});
def('screen', { width: 411, height: 891 });
def('devicePixelRatio', 2.625);
def('addEventListener', () => {});
def('self', globalThis);
def('window', globalThis);
def('location', { href: 'http://localhost/', reload() {} });
def('requestAnimationFrame', (fn) => setTimeout(() => fn(performance.now()), 8));
def('cancelAnimationFrame', clearTimeout);
def('Image', class { });
def('URL', Object.assign(globalThis.URL || class {}, { createObjectURL: () => 'blob:stub', revokeObjectURL() {} }));
def('Blob', globalThis.Blob || class { constructor(p) { this.parts = p; } });
if (!globalThis.crypto) def('crypto', (await import('node:crypto')).webcrypto);

globalThis.cancelAnimationFrame = clearTimeout;

const R = [];
/** queue a case; cases run in declaration order (they share kernel state) */
const ok = (name, fn) => R.push({ name, fn });

const { storage } = await import('../os/js/kernel/storage.js');
const { config } = await import('../os/js/kernel/config.js');
const { bus } = await import('../os/js/kernel/bus.js');
const { caps, CAPS } = await import('../os/js/kernel/caps.js');
const { vfs } = await import('../os/js/kernel/vfs.js');
const { pm } = await import('../os/js/kernel/pm.js');
const { sched } = await import('../os/js/kernel/sched.js');
const { notif } = await import('../os/js/kernel/notify.js');
const { power } = await import('../os/js/kernel/power.js');
const { registerSyscalls, uname } = await import('../os/js/kernel/syscalls.js');
const { createApi } = await import('../os/js/kernel/api.js');
const { PKGS } = await import('../os/js/kernel/packages.js');

// ---------------------------------------------------------------- boot
await ok('storage init', async () => (await storage.init()));
await ok('config load', async () => { await config.load(); return `${config.keys().length} keys`; });
await ok('vfs mount', async () => { await vfs.mount(); return `${vfs.nodes.size} inodes`; });
await ok('syscalls registered', async () => { registerSyscalls(); if (bus.stats().services < 30) throw new Error('too few syscalls'); return `${bus.stats().services} entries`; });
await ok('pm load', async () => { await pm.load(); return `${pm.installedIds.length} core packages`; });
await ok('notify load', async () => { await notif.load(); return `${notif.all().length} retained`; });
await ok('power init', async () => (await power.init(), power.status.screen));
await ok('caps load', async () => { await caps.load(); return `${Object.keys(CAPS).length} capabilities`; });

// ---------------------------------------------------------------- filesystem
const trusted = { appId: 'files', pid: 'kernel:1' };
const stranger = { appId: 'snake', pid: 'kernel:2' };
let promptCount = 0, lastPrompt = null;
const autoApprove = () => { caps.prompter = async (app, cap) => { promptCount++; lastPrompt = `${app}:${cap}`; return true; }; };
const autoDeny = () => { caps.prompter = async (app, cap) => { promptCount++; lastPrompt = `${app}:${cap}`; return false; }; };
autoApprove();

await ok('fs: mkdir + write + read', async () => {
  await bus.call('fs.mkdir', { path: '/sdcard/Documents/selftest' }, trusted);
  await bus.call('fs.write', { path: '/sdcard/Documents/selftest/a.txt', data: 'hello dahat' }, trusted);
  const { data } = await bus.call('fs.read', { path: '/sdcard/Documents/selftest/a.txt' }, trusted);
  if (data !== 'hello dahat') throw new Error('round-trip mismatch');
  return data;
});
await ok('fs: ls sees the new entry', async () => {
  const { entries } = await bus.call('fs.ls', { path: '/sdcard/Documents/selftest' }, trusted);
  if (!entries.find((e) => e.name === 'a.txt')) throw new Error('a.txt missing');
  return entries.map((e) => e.name).join(',');
});
await ok('fs: rename via move', async () => {
  await bus.call('fs.move', { from: '/sdcard/Documents/selftest/a.txt', to: '/sdcard/Documents/selftest/b.txt' }, trusted);
  const { entries } = await bus.call('fs.ls', { path: '/sdcard/Documents/selftest' }, trusted);
  if (entries.find((e) => e.name === 'a.txt')) throw new Error('old name survived');
  return 'a.txt → b.txt';
});
await ok('fs: /system is read-only', async () => {
  try { await bus.call('fs.write', { path: '/system/etc/os-release', data: 'hacked' }, trusted); throw new Error('write to /system succeeded'); }
  catch (e) { if (!/EROFS/.test(e.message)) throw e; return 'EROFS as expected'; }
});
await ok('fs: another app\'s sandbox is refused', async () => {
  try { await bus.call('fs.read', { path: '/apps/files/data/x' }, stranger); throw new Error('read of /apps/files succeeded'); }
  catch (e) { if (!/EPERM|ENOENT/.test(e.message)) throw e; return e.code || 'EPERM'; }
});
await ok('fs: recursive delete', async () => {
  const r = await bus.call('fs.rm', { path: '/sdcard/Documents/selftest', recursive: true }, trusted);
  if (r.removed < 1) throw new Error('nothing removed');
  return `removed ${r.removed}`;
});

// ---------------------------------------------------------------- persistence
await ok('persist: writes survive a remount', async () => {
  await bus.call('fs.write', { path: '/sdcard/Notes/persist.md', data: '# kept\n' }, trusted);
  await vfs.persist(true);
  const saved = await storage.get('vfs', null);
  if (!saved || !saved.nodes.find(([p]) => p === '/sdcard/Notes/persist.md')) throw new Error('snapshot missing the file');
  return 'snapshot contains /sdcard/Notes/persist.md';
});

// ---------------------------------------------------------------- permissions
await ok('perms: untrusted app gets prompted once, then cached', async () => {
  caps.reset('snake');
  promptCount = 0;
  await bus.call('fs.write', { path: '/sdcard/Notes/from-snake.md', data: 'x' }, stranger);
  await bus.call('fs.write', { path: '/sdcard/Notes/from-snake2.md', data: 'x' }, stranger);
  if (promptCount !== 1) throw new Error(`expected 1 prompt, got ${promptCount}`);
  return lastPrompt;
});
await ok('perms: denial is enforced (EACCES)', async () => {
  caps.reset('snake');
  autoDeny();
  try { await bus.call('fs.write', { path: '/sdcard/Notes/nope.md', data: 'x' }, stranger); throw new Error('write should have been denied'); }
  catch (e) { if (e.message.includes('should have')) throw e; return e.code === 'EACCES' ? 'EACCES' : e.message; }
});
await ok('perms: settings writes need the capability', async () => {
  autoApprove();
  caps.reset('snake');
  await bus.call('settings.set', { key: 'display.accent', value: '#12b7a2' }, stranger);
  if (lastPrompt !== 'snake:settings') throw new Error(`expected a settings prompt, saw ${lastPrompt}`);
  return 'snake:settings';
});
await ok('perms: public settings stay readable', async () => {
  const r = await bus.call('settings.get', { key: 'display.theme' }, stranger);
  return `display.theme=${r.value}`;
});
await ok('perms: private settings are refused to strangers', async () => {
  try { await bus.call('settings.get', { key: 'security.pin' }, stranger); throw new Error('pin was readable'); }
  catch (e) { if (!/EPERM/.test(e.message)) throw e; return 'EPERM as expected'; }
});

// ---------------------------------------------------------------- packages
await ok('pm: install registers and seeds the sandbox', async () => {
  const r = await pm.install('todo', { from: 'selftest' });
  if (r.already) throw new Error('todo should start uninstalled');
  if (!pm.isInstalled('todo')) throw new Error('not marked installed');
  if (!vfs.exists('/apps/todo/package.json')) throw new Error('no package.json in sandbox');
  return `installed todo, ${Object.keys(CAPS).length} caps known`;
});
await ok('pm: uninstall deletes data but keeps the index', async () => {
  await pm.install('snake', { from: 'selftest' });
  await bus.call('fs.write', { path: '/apps/snake/data/keep.txt', data: '1' }, { appId: 'snake', pid: 'x' });
  await pm.uninstall('snake');
  if (vfs.exists('/apps/snake')) throw new Error('sandbox survived uninstall');
  if (!pm.all.find((p) => p.id === 'snake')) throw new Error('package vanished from index');
  return 'sandbox cleaned, index intact';
});
await ok('pm: system packages refuse uninstall', async () => {
  try { await pm.uninstall('settings'); throw new Error('settings was uninstalled'); }
  catch (e) { if (!/ESystemPackage/.test(e.message)) throw e; return 'EBUSY protected'; }
});
await ok('pm: home layout has no ghosts', async () => {
  const pages = pm.pages();
  const ids = pages.flat();
  const ghosts = ids.filter((id) => !pm.isInstalled(id));
  if (ghosts.length) throw new Error(`uninstalled ids on home: ${ghosts}`);
  return `${pages.length} page(s), ${ids.length} tiles`;
});

// ---------------------------------------------------------------- scheduler
await ok('sched: spawn → beat → kill', async () => {
  const p = sched.spawn('clock', { name: 'Clock' });
  sched.beat(p.pid);
  if (sched.info(p.pid).state !== 'running') throw new Error('process not running after beat');
  const ok2 = sched.kill(p.pid, 'selftest');
  if (!ok2 || sched.info(p.pid)) throw new Error('kill failed');
  return 'lifecycle ok';
});
await ok('sched: syscall accounting works', async () => {
  const p = sched.spawn('calculator', { name: 'Calc' });
  await bus.call('sys.time', {}, { appId: 'calculator', pid: p.pid });
  await bus.call('sys.uptime', {}, { appId: 'calculator', pid: p.pid });
  const info = sched.info(p.pid);
  if (info.syscalls < 2) throw new Error(`expected ≥2 syscalls, got ${info.syscalls}`);
  sched.kill(p.pid, 'selftest');
  return `${info.syscalls} calls, ${info.cpuMs}ms cpu`;
});
await ok('sched: stall detection', async () => {
  const p = sched.spawn('notes', { name: 'Notes' });
  p.lastBeat = Date.now() - 9000;
  sched.tickFrame(16);
  const st = sched.info(p.pid).state;
  sched.kill(p.pid, 'selftest');
  if (st !== 'unresponsive') throw new Error(`expected unresponsive, got ${st}`);
  return 'unresponsive after 9s silence';
});

// ---------------------------------------------------------------- notifications
await ok('notif: post → badge → dismiss', async () => {
  caps.prompter = async () => true;
  caps.reset('todo');
  await bus.call('notif.post', { title: 'hello', body: 'from selftest' }, { appId: 'todo', pid: 'y' });
  if (notif.badge('todo') !== 1) throw new Error('badge not 1');
  const all = notif.all();
  notif.markRead(all[0].id);
  if (notif.badge('todo') !== 0) throw new Error('read did not clear badge');
  if (!notif.dismiss(all[0].id)) throw new Error('dismiss failed');
  return 'post/badge/read/dismiss';
});
await ok('notif: an app cannot clear another app', async () => {
  notif.post({ appId: 'notes', title: 'x' });
  try { await bus.call('notif.clear', { appId: 'notes' }, { appId: 'todo', pid: 'z' }); throw new Error('cleared another app'); }
  catch (e) { if (!/EPERM/.test(e.message)) throw e; return 'EPERM as expected'; }
});

// ---------------------------------------------------------------- power + device
await ok('power: status shape', async () => {
  const s = power.status;
  for (const k of ['online', 'screen', 'idleMs', 'wakelock']) if (!(k in s)) throw new Error(`missing ${k}`);
  await power.wakeLock(true); await power.wakeLock(false);
  return `online=${s.online} wake-lock ok`;
});
await ok('uname: describes the OS', async () => {
  const u = uname();
  if (u.sysname !== 'Dahat' || u.release !== '1.0.0') throw new Error(JSON.stringify(u));
  return `${u.sysname} ${u.release} ${u.machine}`;
});
await ok('vfs: quota is reported', async () => {
  const d = vfs.df();
  if (d.total <= 0 || d.free > d.total) throw new Error(JSON.stringify(d));
  return `${(d.used / 1024).toFixed(1)}KiB used / ${(d.total / 1048576).toFixed(0)}MiB`;
});

// ---------------------------------------------------------------- app api
await ok('api: app facade round-trips through the bus', async () => {
  autoApprove();
  caps.reset('todo');
  await pm.install('todo', { from: 'selftest' }).catch(() => {});
  const p = sched.spawn('todo', { name: 'Tasks' });
  const api = createApi({ pid: p.pid, appId: 'todo', getcwd: () => '/apps/todo' });
  await api.store.set('items', [{ text: 'x', done: false }]);
  const v = await api.store.get('items');
  if (v?.[0]?.text !== 'x') throw new Error('store round-trip failed');
  await api.fs.mkdir('/sdcard/Tasks');
  await api.fs.write('/sdcard/Tasks/selftest.md', '# ok');
  const back = await api.fs.read('/sdcard/Tasks/selftest.md');
  if (back !== '# ok') throw new Error('fs write/read failed');
  const t = await api.sys.time();
  if (!t.epoch) throw new Error('sys.time failed');
  await api.app.open('notes').catch(() => {});
  sched.kill(p.pid, 'selftest');
  await pm.uninstall('todo');
  return 'store, fs, sys, app all answered';
});

// ---------------------------------------------------------------- syscall sweep
await ok('syscall sweep: every entry answers or fails cleanly', async () => {
  const cases = {
    'fs.read': { path: '/system/etc/os-release' }, 'fs.write': { path: '/tmp/sweep.txt', data: 'x' }, 'fs.ls': { path: '/sdcard' },
    'fs.mkdir': { path: '/tmp/sweepdir' }, 'fs.rm': { path: '/tmp/sweepdir' }, 'fs.stat': { path: '/sdcard' }, 'fs.df': {},
    'fs.tree': { path: '/sdcard', depth: 1 }, 'fs.move': { from: '/tmp/sweep.txt', to: '/tmp/sweep2.txt' },
    'store.get': { key: 'k' }, 'store.set': { key: 'k', value: 1 }, 'store.del': { key: 'k' },
    'settings.get': { key: 'ui.lang' }, 'settings.list': {}, 'settings.set': { key: 'display.blur', value: 12 },
    'caps.list': {}, 'caps.status': { appId: 'notes' }, 'caps.request': { cap: 'notifications' },
    'app.info': { pid: 'kernel:1' }, 'sys.uname': {}, 'sys.info': {}, 'sys.uptime': {}, 'sys.time': {}, 'sys.log': { n: 3 },
    'sys.dmesg': { n: 5 }, 'sys.stats': {}, 'sys.perf': {}, 'sys.procs': {}, 'sys.locked': {}, 'sys.lock': { reason: 'selftest' }, 'sys.kill': { pid: 99999 },
    'ui.haptic': { pattern: 'tap' }, 'ui.sfx': { name: 'tap' }, 'ui.toast': { message: 'selftest' },
    'clip.set': { text: 'x' }, 'clip.get': {}, 'app.share': { title: 't', text: 'b' }, 'app.openUrl': { url: 'https://example.com' },
    'app.dial': { number: '+94112223333' }, 'app.closeSelf': { pid: 'kernel:1' }, 'app.open': { id: 'settings' },
    'power.status': {}, 'power.info': {}, 'power.wake': { on: false },
    'notif.post': { title: 'x', body: 'y' }, 'notif.list': {}, 'notif.badge': { appId: 'zzz' }, 'notif.clear': {},
    'pm.list': {}, 'pm.available': {}, 'pm.info': { id: 'notes' }, 'pm.setLayout': { pages: [['notes']] }, 'pm.pin': { id: 'notes' },
    'pm.clearData': { id: 'notes' }, 'pm.install': { id: 'todo' }, 'pm.uninstall': { id: 'todo' },
    'win.list': {}, 'win.mode': { pid: 1, mode: 'max' }, 'win.title': { pid: 1, title: 'x' }, 'wm.close': { pid: 99999 }, 'wm.launch': { appId: 'notes' },
    'bus.missing': {},
  };
  const ctxTrusted = { appId: 'settings', pid: 'kernel:9', cwd: '/' };
  const problems = [];
  let answered = 0, expected = 0;
  for (const s of bus.list()) {
    expected++;
    const args = cases[s.name] ?? {};
    try { await bus.call(s.name, args, ctxTrusted); answered++; }
    catch (e) {
      const benign = /ENOSYS|EACCES|ENOENT|EPERM|EROFS|ESRCH|EINVAL|not running|no such|wm\.|win\./.test(`${e.code || ''} ${e.message}`);
      if (!benign) problems.push(`${s.name}: ${e.message}`);
      else answered++;
    }
  }
  if (bus.has('bus.missing')) problems.push('bus.missing should not exist');
  if (answered < expected - 2) problems.push(`only ${answered}/${expected} syscalls answered`);
  if (problems.length) throw new Error(problems.join(' | '));
  return `${answered}/${expected} syscalls answered or failed with a documented errno`;
});

// ---------------------------------------------------------------- alarms
await ok('alarm: setAlarm reports the arming path honestly', async () => {
  autoApprove();
  const r = await bus.call('app.setAlarm', { id: '06:30', hour: 6, minute: 30, label: 'wake', repeat: true }, { appId: 'clock', pid: 'kernel:1' });
  if (r.via !== 'in-app') throw new Error(`expected in-app without a host bridge, got ${r.via}`);
  const f = await import('/home/user/Ai-/os/js/kernel/syscalls.js');
  if (!f.alarmTable().some((a) => a.key === 'clock:06:30')) throw new Error('alarm table empty');
  if (!f.fireAlarm('clock:06:30')) throw new Error('fireAlarm refused to fire');
  if (f.fireAlarm('nope')) throw new Error('an unknown key must not fire');
  await bus.call('app.cancelAlarm', { id: '06:30' }, { appId: 'clock', pid: 'kernel:1' });
  if (f.alarmTable().length) throw new Error('cancelAlarm left a row');
  return 'arm → fire → cancel, unknown keys refused';
});

await ok('alarm: a foreign app cannot cancel or fire another app\'s alarm', async () => {
  const f = await import('/home/user/Ai-/os/js/kernel/syscalls.js');
  await bus.call('app.setAlarm', { id: 'x', hour: 1, minute: 2 }, { appId: 'clock', pid: 'kernel:1' });
  const r = await bus.call('app.cancelAlarm', { id: 'x' }, { appId: 'snake', pid: 'kernel:2' });
  if (r.ok !== true) throw new Error('cancel should answer');
  if (!f.alarmTable().some((a) => a.key === 'clock:x')) throw new Error('namespace is not per-app — snake cancelled clock\'s alarm');
  await bus.call('app.cancelAlarm', { id: 'x' }, { appId: 'clock', pid: 'kernel:1' });
  return 'keys are namespaced by appId';
});

// ---------------------------------------------------------------- results
const results = [];
for (const { name, fn } of R) {
  const t = performance.now();
  try {
    const v = await fn();
    results.push({ name, pass: true, ms: +(performance.now() - t).toFixed(1), detail: typeof v === 'string' ? v : '' });
  } catch (e) {
    results.push({ name, pass: false, err: e.message, stack: (e.stack || '').split('\n')[1]?.trim() });
  }
}
const failed = results.filter((r) => !r.pass);
console.log(`\nDahat OS kernel self-test — ${results.length - failed.length}/${results.length} passed\n`);
for (const r of results) {
  console.log(r.pass
    ? `  ✓ ${r.name.padEnd(48)} ${r.detail ? `— ${r.detail}` : ''} (${r.ms}ms)`
    : `  ✗ ${r.name.padEnd(48)} ${r.err}${r.stack ? `  [${r.stack}]` : ''}`);
}
console.log(`\n${failed.length ? `${failed.length} FAILING` : 'all good — storage:' + storage.mode + ', vfs:' + vfs.nodes.size + ' inodes'}\n`);
process.exit(failed.length ? 1 : 0);
