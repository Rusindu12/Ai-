/* Dahat OS — kernel/caps.js
 * Runtime permissions. Every syscall declares the capability it needs; the
 * kernel asks the user the first time an app touches it and remembers the
 * answer. Denials are audited to the kernel log.
 */
import { log } from './log.js';
import { storage } from './storage.js';

export const CAPS = {
  notifications: { si: 'දැනුම්දීම්', en: 'Notifications', desc: { si: 'ඇප්පයට දැනුම්දීමක් යැවිය හැක', en: 'Let this app post notifications' }, icon: 'bell' },
  storage: { si: 'ගබඩාව', en: 'Shared storage', desc: { si: '/sdcard යටතේ ගොනු කියවා ලියන්න', en: 'Read and write files under /sdcard' }, icon: 'storage' },
  camera: { si: 'කැමරාව', en: 'Camera', desc: { si: 'ඡායාරූප ගැනීමට', en: 'Capture photos with the camera' }, icon: 'camera' },
  mic: { si: 'මයික්‍රොෆෝනය', en: 'Microphone', desc: { si: 'හඬ පටිගත කිරීමට', en: 'Record audio' }, icon: 'mic' },
  phone: { si: 'දුරකථනය', en: 'Dialer', desc: { si: 'අංකයක් අමතන්න ( ඇප් එකක් විවෘත කරයි)', en: 'Place a call via the system dialer' }, icon: 'phone' },
  network: { si: 'ජාලය', en: 'Network', desc: { si: 'බාහිර වෙබ් අඩවි වෙත යාමට', en: 'Open external URLs / reach the network' }, icon: 'globe' },
  clipboard: { si: 'ක්ලිප්බෝඩ්', en: 'Clipboard', desc: { si: 'පිටපත් කිරීම සහ ඇලවීම', en: 'Read and write the clipboard' }, icon: 'copy' },
  settings: { si: 'සැකසුම්', en: 'System settings', desc: { si: 'OS සැකසුම් වෙනස් කිරීම', en: 'Change OS-wide settings' }, icon: 'settings' },
  process: { si: 'ක්‍රියාවලීන්', en: 'Process control', desc: { si: 'වෙනත් ඇප් නවත්වීම / නැවත ආරම්භ කිරීම', en: 'Launch or stop other apps' }, icon: 'cpu' },
  wakelock: { si: 'තිරය සැරවීම', en: 'Keep screen awake', desc: { si: 'තිරය නිවහන්සල් නොකිරීම', en: 'Prevent the screen from sleeping' }, icon: 'zap' },
  alarm: { si: 'ඇලාරම්', en: 'Alarms', desc: { si: 'උපාංගය නිවා දමා තිබියදීත් අවදි කරවන ඇලාරමක් සැකසීම', en: 'Arm an alarm that fires even when the app is closed' }, icon: 'clock' },
  vibrate: { si: 'කම්පනය', en: 'Haptics', desc: { si: 'කෙටි කම්පන දැනීම්', en: 'Short haptic pulses' }, icon: 'volume' },
};
export const CAP_IDS = Object.keys(CAPS);

class Caps {
  constructor() {
    this.grants = new Map(); // appId -> Map(cap -> 'grant'|'deny')
    this.loaded = false;
    this.listeners = new Set();
    this.prompter = null; // installed by the shell: (appId, cap, why) => Promise<boolean>
  }
  async load() {
    if (this.loaded) return;
    const raw = await storage.get('caps', {});
    for (const [app, map] of Object.entries(raw)) this.grants.set(app, new Map(Object.entries(map)));
    this.loaded = true;
    log.info('caps', `loaded ${Object.keys(raw).length} app permission records`);
  }
  save() {
    const out = {};
    for (const [app, map] of this.grants) out[app] = Object.fromEntries(map);
    storage.set('caps', out);
  }
  state(appId, cap) {
    return this.grants.get(appId)?.get(cap) || 'prompt';
  }
  /** Trusted system apps never get prompted (they define the OS itself). */
  async check(appId, cap, { trust = false, why = '' } = {}) {
    if (!cap) return true;
    await this.load();
    if (trust) return true;
    const st = this.state(appId, cap);
    if (st === 'grant') return true;
    if (st === 'deny') { log.warn('caps', `${appId} denied ${cap} (previously refused)`); return false; }
    if (!this.prompter) { log.debug('caps', `no prompter, auto-deny ${appId}→${cap}`); return false; }
    log.info('caps', `prompting ${appId} for ${cap}`);
    const ok = await this.prompter(appId, cap, why);
    this.set(appId, cap, ok ? 'grant' : 'deny');
    this.emit();
    return ok;
  }
  set(appId, cap, val) {
    if (!this.grants.has(appId)) this.grants.set(appId, new Map());
    this.grants.get(appId).set(cap, val);
    this.save();
  }
  grant(appId, cap) { this.set(appId, cap, 'grant'); this.emit(); }
  deny(appId, cap) { this.set(appId, cap, 'deny'); this.emit(); }
  reset(appId) { this.grants.delete(appId); this.save(); this.emit(); }
  for(appId) { return Object.fromEntries(this.grants.get(appId) || []); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((f) => { try { f(); } catch (e) { log.error('caps', e.message); } }); }
}
export const caps = new Caps();
