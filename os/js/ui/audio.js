/* Dahat OS — ui/audio.js
 * Synthesised UI sound: no asset files, no downloads, respects the sound
 * toggle in Settings. Chromium needs a gesture before audio can start, so the
 * context is created lazily on the first tap.
 */
let ctx = null, master = null, ready = false;
/* the shell's volume slider owns this: 0..1, multiplied into the master gain */
let volScale = 1;
const BASE_GAIN = 0.09;
const applyGain = () => { if (master) master.gain.value = BASE_GAIN * volScale; };
/** setVolume(0..1) — wired to the `volume` bus topic (Quick Settings slider) */
export function setVolume(v) { volScale = Math.max(0, Math.min(1, Number(v))); applyGain(); }

function ensure() {
  if (ready) return ctx;
  const AC = self.AudioContext || self.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  volScale = num(self.dahatConfig?.get?.('input.volume'), 1);
  master.gain.value = BASE_GAIN * volScale;
  master.connect(ctx.destination);
  ready = true;
  return ctx;
}
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt; }
function blip({ f = 440, to = f, t = 0.09, type = 'sine', gain = 1, delay = 0 } = {}) {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  const now = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + t);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.9 * gain, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + t);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + t + 0.02);
}

export const SFX = {
  tap: () => blip({ f: 880, to: 640, t: 0.05, type: 'triangle', gain: 0.5 }),
  toggleOn: () => blip({ f: 520, to: 900, t: 0.1, type: 'sine' }),
  toggleOff: () => blip({ f: 700, to: 420, t: 0.09, type: 'sine', gain: 0.7 }),
  open: () => { blip({ f: 420, to: 700, t: 0.11 }); blip({ f: 700, to: 980, t: 0.09, delay: 0.06, gain: 0.6 }); },
  close: () => blip({ f: 620, to: 300, t: 0.11 }),
  notify: () => { blip({ f: 990, to: 1320, t: 0.1, type: 'triangle' }); blip({ f: 1320, t: 0.14, type: 'triangle', gain: 0.5, delay: 0.1 }); },
  error: () => blip({ f: 300, to: 160, t: 0.22, type: 'sawtooth', gain: 0.6 }),
  boot: () => {[0, 1, 2].forEach((i) => blip({ f: [392, 523, 784][i], t: 0.5, type: 'sine', gain: 0.5 - i * 0.1, delay: i * 0.12 })) },
  keyboard: () => blip({ f: 1600, to: 1200, t: 0.03, type: 'square', gain: 0.25 }),
};
export function play(name) {
  try {
    if (self.dahatConfig?.get?.('input.sound') === false) return;
    setVolume(num(self.dahatConfig?.get?.('input.volume'), volScale)); // follow Settings even without a bus event
    if (volScale <= 0) return;
    SFX[name]?.();
  } catch { /* audio not permitted yet */ }
}
/** Haptics + optional sound in one call — the standard "actuation" of Dahat UI. */
export function actuate(kind = 'tap') {
  play(kind);
  try {
    if (self.dahatConfig?.get?.('input.haptics') !== false && navigator.vibrate) {
      const map = { tap: 8, toggle: 12, open: [6, 22, 10], close: 14, notify: [10, 40, 10], error: [26, 40, 26], heavy: 24 };
      navigator.vibrate(map[kind] ?? 8);
    }
  } catch { /* no vibration on this platform */ }
}
