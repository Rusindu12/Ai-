/* Dahat OS — kernel/notify.js
 * Notification manager: post, group per app, badge counts, tap actions,
 * heads-up banners, and a channel-ish "importance" model (min/low/def/max).
 */
import { log } from './log.js';
import { bus } from './bus.js';
import { storage } from './storage.js';
import { byId } from './packages.js';
import { config } from './config.js';

/** notifications may be written bilingually: {en, si} resolves against the UI language */
const lang = () => (config.get('ui.lang') === 'si' ? 'si' : 'en');
const txt = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? String(v[lang()] ?? v.en ?? v.si ?? '') : String(v));

const MAX = 60;
const items = [];
const listeners = new Set();
let loaded = false;

class NotifMgr {
  async load() {
    if (loaded) return;
    const saved = await storage.get('notifications', []);
    items.push(...(Array.isArray(saved) ? saved : []));
    loaded = true;
  }
  save() { storage.set('notifications', items.slice(-30)); }
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  emit() { listeners.forEach((f) => { try { f(); } catch { /* ignore */ } }); }
  all() { return [...items].sort((a, b) => b.at - a.at); }
  for(appId) { return this.all().filter((n) => n.appId === appId); }
  count(appId) { return this.all().filter((n) => !n.read && (!appId || n.appId === appId)).length; }
  badge(appId) { return this.all().filter((n) => n.appId === appId && !n.read).length; }

  post({ appId, title, body = '', importance = 'default', actions = [], sticky = false, tapTo = null, silent = false, icon = null, channel = null }) {
    const pkg = byId(appId);
    const n = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      appId, title: txt(title).slice(0, 120), body: txt(body).slice(0, 600),
      at: Date.now(), importance, actions, sticky, read: false, icon: icon || pkg?.icon || 'bell',
      color: pkg?.color, tapTo, channel,
    };
    items.push(n);
    if (items.length > MAX) items.shift();
    this.save(); this.emit();
    log.info('notify', `[${appId}] ${n.title}`);
    if (!silent) bus.emit('notif.heads', n);
    mirrorToHost(n, 'post');
    return n;
  }
  markRead(id) { const n = items.find((x) => x.id === id); if (n) { n.read = true; this.save(); this.emit(); } }
  markAllRead() { items.forEach((n) => { n.read = true; }); this.save(); this.emit(); }
  dismiss(id) {
    const i = items.findIndex((n) => n.id === id);
    if (i < 0) return false;
    mirrorToHost(items[i], 'cancel');
    if (items[i].sticky) log.warn('notify', `${id} is sticky — dismissed anyway (user action)`);
    items.splice(i, 1); this.save(); this.emit();
    return true;
  }
  clear(appId) {
    const before = items.length;
    for (let i = items.length - 1; i >= 0; i--) if (!appId || items[i].appId === appId) items.splice(i, 1);
    this.save(); this.emit();
    return before - items.length;
  }
}
/** Inside the launcher APK the shade is Android's, so every notification is
 * mirrored out; in a browser this is a no-op (no DahatBridge on window). */
function mirrorToHost(n, op) {
  const bridge = globalThis.DahatBridge;
  if (!bridge) return;
  try {
    if (op === 'cancel') { bridge.cancelNotification(String(n.id)); return; }
    if (n.silent || !bridge.notify) return;
    bridge.notify(JSON.stringify({ id: n.id, title: n.title, body: n.body, channel: n.channel || (n.importance === 'max' ? 'alarm' : 'os'), appId: n.appId }));
  } catch { /* the host bridge is best-effort by design */ }
}

export const notif = new NotifMgr();

bus.register('notif.post', ({ title, body, importance, actions, sticky, silent, tapTo }, { appId }) =>
  notif.post({ appId, title, body, importance, actions, sticky, silent, tapTo }),
{ cap: 'notifications', desc: 'Show you a notification' });
bus.register('notif.list', ({ appId } = {}) => (appId ? notif.for(appId) : notif.all()));
bus.register('notif.clear', ({ appId }, { appId: me, trust }) => {
  if (appId && appId !== me && !trust) throw new Error('EPERM: cannot clear another app\'s notifications');
  return { cleared: notif.clear(appId) };
});
bus.register('notif.badge', ({ appId }) => notif.badge(appId));
