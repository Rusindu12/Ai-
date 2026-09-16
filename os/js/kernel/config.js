/* Dahat OS — kernel/config.js
 * The single reactive settings object. Keys are namespaced; only the listed
 * "public" keys may be read by third-party apps, and display-level writes
 * require the `settings` capability (enforced in kernel/syscalls.js).
 */
import { storage } from './storage.js';
import { log } from './log.js';

export const WALLPAPERS = {
  'dusk': { label: 'Dahat Dusk', css: 'radial-gradient(120% 100% at 15% 0%,#12414d 0%,#0b1622 45%,#05070a 100%)' },
  'sigiri': { label: 'Sigiriya', css: 'linear-gradient(180deg,#2b4d3e 0%,#3f6b46 38%,#c07a3c 78%,#4a2a1c 100%)' },
  'lagoon': { label: 'Negombo Lagoon', css: 'linear-gradient(170deg,#0b4d63 0%,#12a5b0 42%,#7fd6c1 72%,#f2d29b 100%)' },
  'cinnamon': { label: 'Cinnamon', css: 'linear-gradient(160deg,#3a0f0c 0%,#7a2a17 42%,#c05621 74%,#f0a860 100%)' },
  'tea': { label: 'Tea Country', css: 'linear-gradient(180deg,#12351f 0%,#1e5b34 45%,#5fa15d 100%)' },
  'moon': { label: 'Rawana Moon', css: 'radial-gradient(60% 40% at 70% 18%,#2b3b63 0%,#101a30 50%,#05070a 100%)' },
  'paper': { label: 'Ola Leaf', css: 'linear-gradient(180deg,#f3ead6 0%,#e6d7b8 60%,#d9c69f 100%)' },
  'custom': { label: 'Your photo', css: 'linear-gradient(180deg,#0d1a22,#05070a)' },
};
export const ACCENTS = ['#12b7a2', '#4cc4ff', '#8b7bff', '#ff7a59', '#f2b134', '#37c978', '#ff5fa2', '#f5626c'];

export const DEFAULTS = {
  'ui.lang': 'en',
  'display.theme': 'dark',
  'display.accent': '#12b7a2',
  'display.wallpaper': 'dusk',
  'display.wallpaperData': null,
  'display.fontScale': 1,
  'display.blur': 18,
  'display.roundIcons': false,
  'display.showSeconds': false,
  'input.haptics': true,
  'input.sound': true,
  'security.pin': null,
  'security.requirePinOnWake': true,
  'power.doze': true,
  'power.autoPowerSave': true,
  'device.name': 'Dahat One',
  'device.nickname': '',
  'dev.developer': false,
  'dev.showFps': false,
  'home.hints': true,
  'assistant.provider': '',   // optional: an OpenAI-compatible endpoint the user owns
  'assistant.model': '',
};
/** Apps may read these without the settings capability. */
export const PUBLIC_KEYS = ['ui.lang', 'display.theme', 'display.accent', 'display.fontScale', 'display.wallpaper'];

const overrides = {};
const listeners = new Set();
let loaded = false;

export const config = {
  async load() {
    if (loaded) return;
    Object.assign(overrides, (await storage.get('config', {})) || {});
    loaded = true;
    log.info('config', `restored ${Object.keys(overrides).length} settings`);
  },
  get(k) { return k in overrides ? overrides[k] : DEFAULTS[k]; },
  all() { return { ...DEFAULTS, ...overrides }; },
  async set(k, v, { silent = false } = {}) {
    overrides[k] = v;
    await storage.set('config', overrides);
    if (!silent) this.emit(k, v);
    return v;
  },
  async unset(k) { delete overrides[k]; await storage.set('config', overrides); this.emit(k, undefined); },
  async reset() { for (const k of Object.keys(overrides)) delete overrides[k]; await storage.set('config', overrides); this.emit('*', undefined); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(k, v) { listeners.forEach((f) => { try { f(k, v); } catch { /* ignore */ } }); },
  isPublic: (k) => PUBLIC_KEYS.includes(k),
  keys: () => Object.keys(DEFAULTS),
};
