/* Dahat OS — kernel/power.js
 * Battery, connectivity, wake-lock and doze. When nothing is visible the
 * kernel suspends background tasks; `wakelock` holds them awake (used by the
 * music/synth app, navigation-ish stuff and the stopwatch).
 */
import { log } from './log.js';
import { bus } from './bus.js';

const state = {
  level: null, charging: null, batteryApi: false,
  online: navigator.onLine !== false,
  screen: 'on',            // on | dim | doze | off
  wakeLock: false, wlToken: null,
  lastActivity: Date.now(), idleMs: 0,
  powerSave: false,
};
const listeners = new Set();
let batt = null, timer = null;

function emit() { listeners.forEach((f) => { try { f(status()); } catch { /* ignore */ } }); }

function status() {
  return {
    level: state.level, charging: state.charging, online: state.online, screen: state.screen,
    wakelock: state.wakeLock, idleMs: state.idleMs, powerSave: state.powerSave,
    estimate: state.level == null ? '—' : `${Math.round(state.level * 100)}%${state.charging ? ' ⚡' : ''}`,
  };
}

/** DahatBridge.battery() answers with a JSON string (WebView bridges are string-only). */
function readBridgeBattery() {
  const bridge = self.DahatBridge;
  if (!bridge?.battery) return false;
  try {
    const b = typeof bridge.battery === 'function' ? JSON.parse(bridge.battery()) : null;
    if (!b || typeof b.level !== 'number' || b.level < 0) return false;
    const changed = state.level !== b.level || state.charging !== !!b.charging;
    state.level = b.level; state.charging = !!b.charging; state.batteryApi = true;
    if (changed) emit();
    return true;
  } catch { return false; }
}

export const power = {
  get status() { return status(); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async init() {
    try {
      if (navigator.getBattery) {
        batt = await navigator.getBattery();
        state.level = batt.level; state.charging = batt.charging; state.batteryApi = true;
        const sync = () => { state.level = batt.level; state.charging = batt.charging; emit(); };
        batt.addEventListener('levelchange', sync);
        batt.addEventListener('chargingchange', () => {
          sync();
          if (batt.charging) log.info('power', 'charger connected — leaving power-save');
          else log.info('power', 'on battery');
        });
        log.info('power', `battery ${Math.round(batt.level * 100)}% ${batt.charging ? 'charging' : 'discharging'}`);
      } else if (self.DahatBridge?.battery) {
        // Android WebView has no Battery Status API: read it from the host instead.
        readBridgeBattery();
        log.info('power', `battery via DahatBridge ${Math.round((state.level ?? 0) * 100)}% ${state.charging ? '⚡' : ''}`.trim());
      } else log.warn('power', 'Battery Status API unavailable — using simulated gauge');
    } catch (e) { log.warn('power', `battery unavailable: ${e.message}`); }

    addEventListener('online', () => { state.online = true; log.info('power', 'network up'); emit(); bus.emit('net.change', { online: true }); });
    addEventListener('offline', () => { state.online = false; log.warn('power', 'network down'); emit(); bus.emit('net.change', { online: false }); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setScreen('doze'); else this.setScreen('on');
    });
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (!batt && !state.batteryApi) readBridgeBattery();  // keep the host gauge live
      state.idleMs = Date.now() - state.lastActivity;
      const deep = state.idleMs > 45000 && !state.wakeLock && !state.charging;
      const next = deep ? 'off' : document.hidden ? 'doze' : state.charging && state.level > 0.8 ? 'on' : 'on';
      if (next !== state.screen) { state.screen = next; log.debug('power', `screen state → ${next}`); emit(); }
      if (state.level != null && state.level <= 0.2 && !state.charging && !state.powerSave) {
        state.powerSave = true; log.warn('power', 'low battery → power-save on (doze aggressive, blur off)');
        bus.emit('power.save', { on: true }); emit();
      }
      if (state.charging && state.powerSave) { state.powerSave = false; bus.emit('power.save', { on: false }); emit(); }
    }, 3000);
    return status();
  },
  activity() { state.lastActivity = Date.now(); if (state.screen !== 'on') { state.screen = 'on'; emit(); } },
  setScreen(s) { state.screen = s; emit(); },
  touchBatterySim(delta = -0.01) {
    if (state.batteryApi || batt) return;
    state.level = Math.max(0, Math.min(1, (state.level ?? 0.82) + delta));
    emit();
  },
  async wakeLock(on) {
    state.wakeLock = !!on;
    log.info('power', `wakelock ${on ? 'held' : 'released'}`);
    try {
      if (on && navigator.wakeLock) {
        state.wlToken = await navigator.wakeLock.request('screen');
        state.wlToken.addEventListener('release', () => { state.wlToken = null; });
      } else if (!on && state.wlToken) { await state.wlToken.release(); state.wlToken = null; }
    } catch (e) { log.debug('power', `native wake lock refused (${e.message}) — OS-level hold only`); }
    if (self.DahatBridge?.keepAwake) { try { self.DahatBridge.keepAwake(!!on); } catch { /* bridge missing */ } }
    emit();
  },
  setPowerSave(on) { state.powerSave = !!on; bus.emit('power.save', { on: !!on }); emit(); },
};

bus.register('power.status', () => status(), { desc: 'battery + screen state' });
bus.register('power.wake', ({ on }) => { power.wakeLock(!!on); return { wakelock: !!on }; }, { cap: 'wakelock', desc: 'keep the screen awake' });
bus.register('power.info', () => ({ ...status(), api: state.batteryApi ? 'Battery Status' : 'simulated' }), { desc: 'battery source of truth' });
