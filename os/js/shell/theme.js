/* Dahat OS — shell/theme.js
 * Turns config keys into CSS custom properties. One function, called on boot
 * and whenever `config` changes, so Settings, Quick Settings and any app that
 * writes a display setting all repaint through the same path.
 */
import { config, WALLPAPERS } from '../kernel/config.js';
import { bus } from '../kernel/bus.js';

const root = () => document.documentElement;

export function applyTheme() {
  const r = root(), b = document.body;
  if (!r) return;
  const theme = config.get('display.theme') === 'light' ? 'light' : 'dark';
  const accent = config.get('display.accent') || '#12b7a2';
  const wp = WALLPAPERS[config.get('display.wallpaper')] ? config.get('display.wallpaper') : 'dusk';
  const scale = Number(config.get('display.fontScale')) || 1;
  const blurV = config.get('display.blur') ?? 18;
  const powerSave = self.dahatPowerSave === true;

  b.dataset.theme = theme;
  b.dataset.roundIcons = config.get('display.roundIcons') ? '1' : '';
  r.style.setProperty('--accent', accent);
  r.style.setProperty('--accent-2', shift(accent, 42));
  r.style.setProperty('--font-scale', String(scale));
  r.style.setProperty('--blur', powerSave ? '0px' : `${blurV}px`);
  r.style.setProperty('--radius', theme === 'light' ? '24px' : '26px');
  const data = config.get('display.wallpaperData');
  const wall = wp === 'custom' && data ? `url("${data}") center/cover no-repeat, ${WALLPAPERS.custom.css}` : WALLPAPERS[wp].css;
  r.style.setProperty('--wall', wall);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef1f5' : '#07090c');
  bus.emit('theme.change', { theme, accent, wp, scale, blur: powerSave ? 0 : blurV });
  // inside the launcher APK the system status/nav bar icons follow the theme too
  try { self.DahatBridge?.setSystemBars?.(JSON.stringify({ theme, bg: theme === 'light' ? '#eef1f5' : '#07090c' })); } catch { /* no bridge */ }
}
/** lighten/darken a #rrggbb by an amount, used for the secondary accent */
function shift(hex, amt) {
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return '#4cc4ff';
  const n = parseInt(m[1], 16);
  const ch = (i) => Math.max(0, Math.min(255, ((n >> i) & 255) + Math.round(amt * 1.6)));
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function watchTheme() {
  config.onChange(() => applyTheme());
  bus.on('power.save', ({ on }) => { self.dahatPowerSave = on; applyTheme(); });
}
self.dahatConfig = config; // read by ui/audio.js for sound+haptics gates
