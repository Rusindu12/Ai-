/* Keerthi Synth — a WebAudio polyphone with a loop recorder.
 * It holds a wake lock while playing (an OS-level promise) and honours the
 * in-OS volume slider via the 'volume' bus topic.
 */
import { h, icon } from '../ui/dom.js';
import { i18n } from '../ui/i18n.js';
import { bus } from '../kernel/bus.js';

const B = (en, si) => i18n.bi({ en, si });
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const freq = (oct, i) => 440 * Math.pow(2, ((oct - 4) * 12 + i - 9) / 12);

export default {
  id: 'piano',
  create(ctx) {
    let ac = null, master = null, wave = 'sine', oct = 4, sustain = 0.6, volume = 0.8;
    const voices = new Map();
    let recording = false, seq = [], t0 = 0;
    const ensure = () => {
      if (ac) return ac;
      ac = new (self.AudioContext || self.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = volume;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp).connect(ac.destination);
      return ac;
    };
    const noteOn = (i) => {
      const c = ensure();
      if (c.state === 'suspended') c.resume();
      const f = freq(oct, i);
      const o = c.createOscillator(), g = c.createGain();
      o.type = wave;
      o.frequency.value = f;
      const t = c.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + sustain);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + sustain + 0.05);
      voices.set(i, o);
      paintKey(i, true);
      if (recording) seq.push({ on: performance.now() - t0, f, oct });
      setTimeout(() => { voices.delete(i); paintKey(i, false); }, sustain * 1000);
    };
    const KEYS = [];
    function paintKey(i, down) {
      const k = KEYS[i % 12];
      if (!k) return;
      k.style.transform = down ? 'translateY(3px) scale(.98)' : '';
      k.style.background = down ? 'var(--accent)' : '';
      k.style.color = down ? 'var(--accent-ink)' : '';
    }
    const octLabel = h('b', { text: `oct ${oct}` });
    const keys = h('div', { style: { display: 'flex', gap: '3px', height: '170px', padding: '10px', background: 'var(--surface-2)', borderRadius: '16px', border: '1px solid var(--line)' } });
    NOTES.forEach((n, i) => {
      const black = n.includes('#');
      const k = h('button', {
        style: {
          flex: black ? '0 0 8%' : '1', height: black ? '62%' : '100%', borderRadius: '0 0 8px 8px',
          background: black ? '#0e141b' : '#f4f7fa', color: black ? '#f4f7fa' : '#0e141b',
          border: '1px solid rgba(0,0,0,.35)', cursor: 'pointer', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontSize: '10px', fontWeight: '700', paddingBottom: '6px', transition: 'transform .06s',
        },
        text: n,
        'data-i': String(i),
      });
      KEYS[i] = k;
      k.addEventListener('pointerdown', (e) => { e.preventDefault(); noteOn(i); });
      keys.appendChild(k);
    });
    const waves = h('div.row-flex', { style: { gap: '6px', flexWrap: 'wrap' } },
      ...['sine', 'triangle', 'square', 'sawtooth'].map((w) => h(`button.chip${w === wave ? '.on' : ''}`, {
        text: w,
        onclick: (e) => {
          wave = w;
          [...waves.children].forEach((c) => c.classList.toggle('on', c === e.currentTarget));
        },
      })));
    const sus = h('input', { type: 'range', min: '10', max: '400', value: String(sustain * 100), oninput: (e) => { sustain = Number(e.target.value) / 100; } });
    const recBtn = h('button.btn', { text: B('● record', '● පටිගත'), onclick: () => { recording = !recording; seq = []; t0 = performance.now(); recBtn.textContent = recording ? B('■ stop', '■ නවත්වා') : B('● record', '● පටිගත'); ctx.api.power.wake(recording).catch(() => {}); } });
    const playBtn = h('button.btn.primary', { text: B('▶ play back', '▶ නැවත අසන්න'), onclick: () => {
      if (!seq.length) return ctx.toast(B('nothing recorded', 'පටිගත කිසිවක් නැත'));
      const c = ensure();
      const speed = 1;
      seq.forEach((ev) => setTimeout(() => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = wave; o.frequency.value = ev.f;
        const t = c.currentTime;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + sustain);
        o.connect(g).connect(master); o.start(t); o.stop(t + sustain + 0.05);
      }, ev.on / speed));
    } });
    const saveBtn = h('button.btn', { text: B('save take', 'සුරකින්න'), onclick: async () => {
      if (!seq.length) return ctx.toast(B('nothing to save', 'සුරැකීමට කිසිවක් නැත'));
      const path = `/sdcard/Music/take-${Date.now().toString(36)}.json`;
      try { await ctx.api.fs.mkdir('/sdcard/Music'); await ctx.api.fs.write(path, JSON.stringify({ wave, oct, notes: seq })); ctx.toast(`${B('saved', 'සුරැකිණි')} ${path}`); }
      catch (e) { ctx.toast(e.message); }
    } });
    const body = h('div.app-body', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div.row-flex', { style: { justifyContent: 'space-between' } },
        h('button.btn.icon', { onclick: () => { oct = Math.max(1, oct - 1); octLabel.textContent = `oct ${oct}`; }, html: icon('minus', 16) }),
        octLabel,
        h('button.btn.icon', { onclick: () => { oct = Math.min(7, oct + 1); octLabel.textContent = `oct ${oct}`; }, html: icon('plus', 16) })),
      keys,
      h('div.card', { style: { padding: '12px' } }, h('h4', B('waveform', 'තරංග හැඩය')), waves,
        h('h4', { style: { marginTop: '12px' } }, B('sustain', 'දිග')), sus,
        h('div.row-flex', { style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, recBtn, playBtn, saveBtn)),
      h('p.tiny.muted', { style: { textAlign: 'center' }, text: B('sound is synthesised live — no samples, no downloads', 'ශබ්දය සජීවීව නිපදවේ') }));
    const el = h('div.app', h('div.app-bar', h('button.btn.icon', { onclick: () => ctx.close(), html: icon('left', 19) }), h('span.title', { en: 'Keerthi Synth', si: 'කීර්ති සින්ත්' })), body);
    const offVol = bus.on('volume', ({ v }) => { volume = v; if (master) master.gain.value = v; });
    const onKey = (e) => {
      const map = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
      if (e.key.toLowerCase() in map) noteOn(map[e.key.toLowerCase()]);
    };
    addEventListener('keydown', onKey);
    return { el, destroy: () => { offVol(); removeEventListener('keydown', onKey); ctx.api.power.wake(false).catch(() => {}); ac?.close?.(); } };
  },
};
