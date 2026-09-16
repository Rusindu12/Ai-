/* Dahat OS — kernel/syscalls.js
 * Registers the syscall surface of the kernel. Every entry states the
 * capability it needs, so the capability system, the log and the process
 * accounting apply uniformly to first-party and installed apps alike.
 */
import { bus } from './bus.js';
import { vfs, normPath } from './vfs.js';
import { caps, CAPS } from './caps.js';
import { config } from './config.js';
import { log } from './log.js';
import { power } from './power.js';
import { sched } from './sched.js';
import { byId } from './packages.js';
import { storage } from './storage.js';
import { play, actuate } from '../ui/audio.js';

const BOOT = Date.now();

/** path sandbox: /apps/<id> is private, /sdcard is shared, /system is read-only.
 * OS-signed packages (kind: 'system') are pre-trusted — they *are* the system —
 * exactly like an app signed with the platform key on Android. */
async function gate(appId, path, { write = false, trust = false } = {}) {
  trust = trust || appId === 'system' || isTrusted(appId);
  const p = normPath(path);
  if (p === `/apps/${appId}` || p.startsWith(`/apps/${appId}/`)) return p;
  if (p === '/tmp' || p.startsWith('/tmp/')) return p;
  if (trust) return p;
  if (p.startsWith('/sdcard')) {
    const ok = await caps.check(appId, 'storage', { trust, why: 'Read/write your shared files' });
    if (!ok) throw Object.assign(new Error('EACCES: storage capability required'), { code: 'EACCES' });
    return p;
  }
  if (p === '/' || p.startsWith('/apps') || p.startsWith('/system')) {
    if (write) throw Object.assign(new Error(`EROFS: ${p} is owned by the OS`), { code: 'EROFS' });
    return p;
  }
  throw Object.assign(new Error(`EPERM: ${appId} may not touch ${p}`), { code: 'EPERM' });
}
const cwdOf = (ctx) => ctx.cwd || '/';

/** alarms armed while running without a host bridge (browser/PWA) */
const alarms = new Map();

/** called by the shell when the host (or the alarm loop) says an alarm is due */
export function fireAlarm(key) {
  const a = alarms.get(key);
  if (!a) return false;
  log.info('alarm', `firing ${key}`);
  bus.call('notif.post', { id: `alarm-${key}`, title: a.label, body: '⏰', channel: 'alarm', silent: false, tapTo: { app: a.appId } }, { appId: 'system', pid: 'kernel' }).catch(() => {});
  bus.emit('alarm.fire', { key, appId: a.appId, label: a.label });
  if (!a.repeat) alarms.delete(key);
  return true;
}
export const alarmTable = () => [...alarms.entries()].map(([k, v]) => ({ key: k, ...v }));

export function registerSyscalls() {
  // ---- filesystem -------------------------------------------------------
  bus.register('fs.read', async ({ path }, ctx) => {
    const p = await gate(ctx.appId, path);
    return { path: p, data: vfs.read(p, cwdOf(ctx)) };
  }, { desc: 'read a file' });
  bus.register('fs.write', async ({ path, data, mime }, ctx) => {
    const p = await gate(ctx.appId, path, { write: true });
    const df = vfs.df();
    if (df.free < 0) throw new Error('ENOSPC: storage full');
    return vfs.write(p, data, cwdOf(ctx), { mime });
  }, { desc: 'write a file' });
  bus.register('fs.ls', async ({ path = '/' }, ctx) => {
    const p = await gate(ctx.appId, path);
    return { path: p, entries: vfs.ls(p, cwdOf(ctx)) };
  }, { desc: 'list a directory' });
  bus.register('fs.mkdir', async ({ path }, ctx) => ({ path: vfs.mkdir(await gate(ctx.appId, path, { write: true }), cwdOf(ctx)) }), { desc: 'create a folder' });
  bus.register('fs.rm', async ({ path, recursive = false }, ctx) => vfs.rm(await gate(ctx.appId, path, { write: true }), cwdOf(ctx), { recursive }), { desc: 'delete a file' });
  bus.register('fs.move', async ({ from, to }, ctx) => {
    const a = await gate(ctx.appId, from, { write: true });
    const b = await gate(ctx.appId, to, { write: true });
    return { path: vfs.move(a, b) };
  }, { desc: 'move or rename' });
  bus.register('fs.stat', async ({ path }, ctx) => vfs.stat(await gate(ctx.appId, path), cwdOf(ctx)), { desc: 'stat one path' });
  bus.register('fs.df', () => ({ ...vfs.df(), percent: Math.round((vfs.totalUsed() / vfs.df().total) * 100) }), { desc: 'quota and usage' });
  bus.register('fs.tree', async ({ path = '/', depth = 2 }, ctx) => vfs.tree(await gate(ctx.appId, path), cwdOf(ctx), depth), { desc: 'recursive listing' });

  // ---- private per-app key-value store ---------------------------------
  bus.register('store.get', ({ key }, { appId }) => storage.get(`app:${appId}:${key}`, null), { desc: 'read app-private key/value' });
  bus.register('store.set', ({ key, value }, { appId }) => storage.set(`app:${appId}:${key}`, value), { desc: 'write app-private key/value' });
  bus.register('store.del', ({ key }, { appId }) => storage.del(`app:${appId}:${key}`), { desc: 'drop one app-private key' });

  // ---- settings ---------------------------------------------------------
  bus.register('settings.get', ({ key }, { appId }) => {
    if (!config.isPublic(key) && !isTrusted(appId)) throw new Error(`EPERM: setting "${key}" is not readable by ${appId}`);
    return { key, value: config.get(key) };
  }, { desc: 'read a setting (private keys need OS trust)' });
  bus.register('settings.list', ({ appId } = {}, ctx) => {
    const id = appId || ctx.appId;
    const all = config.all();
    if (isTrusted(id)) return all;
    return Object.fromEntries(Object.entries(all).filter(([k]) => config.isPublic(k)));
  }, { desc: 'public settings, or all of them for the shell' });
  bus.register('settings.set', async ({ key, value }, { appId }) => {
    if (!isTrusted(appId) && appId !== 'system') {
      const ok = await caps.check(appId, 'settings', { why: 'Change system settings' });
      if (!ok) throw Object.assign(new Error('EACCES: settings capability required'), { code: 'EACCES' });
    }
    await config.set(key, value);
    log.info('settings', `${appId} set ${key} = ${JSON.stringify(value)}`);
    return { key, value };
  }, { desc: 'change system settings' });

  // ---- capabilities -----------------------------------------------------
  bus.register('caps.list', () => Object.entries(CAPS).map(([id, c]) => ({ id, ...c })), { desc: 'every capability the OS knows' });
  bus.register('caps.status', ({ appId }, ctx) => ({ app: appId, grants: caps.for(appId || ctx.appId) }), { desc: 'this app’s granted / denied capabilities' });
  bus.register('caps.request', async ({ cap, why = '' }, { appId }) => {
    const ok = await caps.check(appId, cap, { why });
    return { cap, granted: ok };
  }, { desc: 'ask the user for one capability' });
  bus.register('caps.reset', ({ appId }, { trust }) => {
    if (!trust) throw new Error('EPERM: only the shell may reset permissions');
    caps.reset(appId);
    return { ok: true };
  }, { desc: 'forget an app’s grants (shell only)' });

  // ---- process / window -------------------------------------------------
  bus.register('app.open', ({ id, params }, { pid }) => {
    const p = byId(id);
    if (!p) throw new Error(`ENOENT: no such app ${id}`);
    return bus.request('wm.launch', { appId: id, params, from: pid });
  }, { cap: 'process', desc: 'open another app' });
  bus.register('app.closeSelf', ({ pid }) => bus.request('wm.close', { pid }), { desc: 'ask the shell to close this window' });
  bus.register('app.info', ({ pid }) => ({ pid, cwd: cwdOf({ pid }) }), { trust: true, desc: 'what the window manager knows about this pid' });

  // ---- device / connectivity -------------------------------------------
  bus.register('sys.uname', () => uname(), { desc: 'name, version, build of this OS' });
  bus.register('sys.info', () => ({ ...uname(), ...power.status, procs: sched.table().length, caps: bus.stats() }), { desc: 'one-shot system summary' });
  bus.register('sys.uptime', () => ({ ms: Date.now() - BOOT, kernelMs: log.uptime }), { desc: 'time since boot' });
  bus.register('sys.time', () => ({ epoch: Date.now(), iso: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language }), { desc: 'clock, zone and locale' });
  bus.register('sys.log', ({ n = 50, level, domain } = {}, { appId }) => {
    if (isTrusted(appId)) return log.dump({ level, domain });
    return log.tail(n, { level, domain }).filter((e) => e.domain === appId || e.msg.includes(appId)).map((e) => `${e.level} ${e.domain}: ${e.msg}`).join('\n');
  }, { desc: 'read the kernel log' });
  bus.register('sys.dmesg', ({ n = 200 } = {}) => log.dump({ n }), { cap: 'settings', desc: 'read the whole kernel log' });
  bus.register('sys.stats', () => ({ ...bus.stats(), storageMode: storage.mode }), { desc: 'bus + storage counters' });

  // ---- media / feedback -------------------------------------------------
  bus.register('ui.haptic', ({ pattern = 'tap' }) => { actuate(pattern); return { ok: true }; }, { cap: 'vibrate', desc: 'short haptic pulse' });
  bus.register('ui.sfx', ({ name = 'tap' }) => { play(name); return { ok: true }; }, { desc: 'play a synthesised UI sound' });
  bus.register('ui.toast', ({ message, ms = 1800 }) => { bus.emit('ui.toast', { message, ms }); return { ok: true }; }, { desc: 'transient message in the shell' });

  // ---- clipboard / share / external ------------------------------------
  bus.register('clip.set', async ({ text }) => {
    try { await navigator.clipboard.writeText(String(text)); return { ok: true }; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = String(text); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand?.('copy') ?? false;
      ta.remove();
      return { ok, fallback: true };
    }
  }, { cap: 'clipboard', desc: 'copy to the clipboard' });
  bus.register('clip.get', async () => {
    try { return { text: await navigator.clipboard.readText() }; } catch { return { text: '', denied: true }; }
  }, { cap: 'clipboard', desc: 'read the clipboard' });
  bus.register('app.setAlarm', async ({ id, hour, minute, label, repeat }, ctx) => {
    const { appId, pid } = ctx;
    const ok = await caps.check(appId, 'alarm', { trust: appId === 'system' || isTrusted(appId), why: 'Wake the device at a set time' });
    if (!ok) throw Object.assign(new Error('EACCES: alarm capability required'), { code: 'EACCES' });
    const key = `${appId}:${id}`;
    const bridge = self.DahatBridge;
    if (bridge?.scheduleAlarm) {
      try {
        bridge.scheduleAlarm(JSON.stringify({ key, hour: Number(hour) | 0, minute: Number(minute) | 0, label: String(label || 'Dahat alarm'), repeat: !!repeat, appId }));
        log.info('alarm', `armed in Android for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (from ${appId})`);
        return { via: 'native', key };
      } catch (e) { log.warn('alarm', `host refused: ${e.message}`); }
    }
    /* no host bridge (browser / PWA): the app keeps ticking in its own loop.
     * Returning 'in-app' instead of failing keeps the UI honest about what it promised. */
    alarms.set(key, { appId, hour: Number(hour) | 0, minute: Number(minute) | 0, label: String(label || 'Dahat alarm'), repeat: !!repeat, armedAt: Date.now() });
    return { via: 'in-app', key };
  }, { desc: 'arm an alarm (host bridge when available)', cap: null });
  bus.register('app.cancelAlarm', ({ id }, ctx) => {
    const key = `${ctx.appId}:${id}`;
    try { self.DahatBridge?.cancelAlarm?.(key); } catch { /* host may already be gone */ }
    alarms.delete(key);
    return { ok: true };
  }, { desc: 'cancel an alarm this app armed', cap: null });

  bus.register('app.openUrl', async ({ url }) => {
    const u = String(url);
    if (!/^(https?:|tel:|mailto:|geo:|intent:)/.test(u)) throw new Error('EINVAL: only http/https/tel/mailto/geo links');
    if (self.DahatBridge?.openUrl) { try { self.DahatBridge.openUrl(u); return { ok: true, via: 'android' }; } catch { /* fall through */ } }
    if (typeof self.open === 'function') {
      const w = self.open(u, '_blank', 'noopener');
      if (w) return { ok: true, via: 'popup' };
    }
    const a = document.createElement('a');
    a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click?.();
    a.remove();
    return { ok: true, via: 'anchor' };
  }, { cap: 'network', desc: 'open an external link' });
  bus.register('app.dial', async ({ number }) => {
    const clean = String(number).replace(/[^\d+*#]/g, '');
    if (!/^\+?[\d*#-]{3,}$/.test(clean)) throw new Error('EINVAL: not a phone number');
    if (self.DahatBridge?.dial) { try { self.DahatBridge.dial(clean); return { ok: true, via: 'android' }; } catch { /* fall through */ } }
    location.href = `tel:${clean}`;
    return { ok: true, via: 'tel:' };
  }, { cap: 'phone', desc: 'dial a phone number' });
  bus.register('app.share', async ({ title = '', text = '', url = null }) => {
    const payload = [title, text, url].filter(Boolean).join('\n');
    if (self.DahatBridge?.share) { try { self.DahatBridge.share(title || 'Dahat OS', payload); return { ok: true, via: 'android' }; } catch { /* fall through */ } }
    if (navigator.share) { try { await navigator.share({ title, text, url }); return { ok: true, via: 'web-share' }; } catch (e) { if (e.name === 'AbortError') return { ok: false, cancelled: true }; } }
    await bus.call('clip.set', { text: payload });
    return { ok: true, via: 'clipboard' };
  }, { desc: 'share text out of the OS', cap: null });

  log.info('kernel', `syscall table built (${bus.stats().services} entries)`);
}

export function isTrusted(appId) {
  const p = byId(appId);
  return !!p && p.kind === 'system';
}

export function uname() {
  const ua = navigator.userAgent;
  const android = /Android\s([\d.]+)/.exec(ua);
  const chrome = /(Chrome|CriOS)\/([\d.]+)/.exec(ua);
  const host = self.DahatBridge ? 'Dahat Launcher (Android)' : 'Dahat Web Kernel';
  return {
    sysname: 'Dahat', release: '1.0.0', version: '#1 SMP PREEMPT (userspace kernel)',
    machine: /arm64|aarch64/i.test(ua) ? 'aarch64' : /x86_64|Win64|Linux x86_64/.test(ua) ? 'x86_64' : 'wasm-ish',
    nodename: config.get('device.name') || 'dahat-one',
    host, chrome: chrome ? chrome[2] : '—', androidBase: android ? android[1] : 'none (web)',
    cores: navigator.hardwareConcurrency || 1, memoryGB: navigator.deviceMemory || '—',
    screen: `${screen.width}x${screen.height}@${(devicePixelRatio || 1).toFixed(1)}x`,
    touch: navigator.maxTouchPoints || 0, secureCtx: window.isSecureContext,
    storage: storage.mode, lang: i18nLang(),
  };
}
const i18nLang = () => config.get('ui.lang');
