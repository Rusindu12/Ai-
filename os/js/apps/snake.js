/* Snake — Bazaar port. Runs as a scheduled process and honours the haptics
 * setting through the kernel (ui.haptic), not navigator directly.
 */
import { h, icon } from '../ui/dom.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';

const B = (en, si) => i18n.bi({ en, si });
const N = 15;

export default {
  id: 'snake',
  create(ctx) {
    const cvs = h('canvas', { width: String(N * 22), height: String(N * 22), style: { width: '100%', borderRadius: '16px', border: '1px solid var(--line)', background: '#070c0a', touchAction: 'none' } });
    const c = cvs.getContext('2d');
    const scoreEl = h('b', { text: '0' }), bestEl = h('span.chip', { text: 'best 0' });
    let s, dir, nextDir, food, dead, tickMs, timer = null;

    function reset() {
      s = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
      dir = { x: 1, y: 0 }; nextDir = dir; dead = false; tickMs = 150; placeFood(); draw();
    }
    function placeFood() {
      do { food = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 }; }
      while (s.some((p) => p.x === food.x && p.y === food.y));
    }
    function step() {
      if (dead) return;
      dir = nextDir;
      const head = { x: (s[0].x + dir.x + N) % N, y: (s[0].y + dir.y + N) % N };
      if (s.some((p) => p.x === head.x && p.y === head.y)) {
        dead = true; stop(); actuate('error');
        scoreEl.textContent = B('crashed', 'ගැටුණා');
        return;
      }
      s.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score++;
        ctx.api.ui.haptic('tap').catch(() => {});
        if (tickMs > 70) { tickMs -= 4; restart(); }
        placeFood();
      } else s.pop();
      draw();
    }
    let score = 0, best = 0;
    ctx.api.store.get('best').then((v) => { best = v || 0; bestEl.textContent = `best ${best}`; });
    function draw() {
      const k = cvs.width / N;
      c.fillStyle = '#070c0a'; c.fillRect(0, 0, cvs.width, cvs.height);
      c.fillStyle = 'rgba(255,255,255,.045)';
      for (let i = 0; i < N; i += 2) for (let j = 0; j < N; j += 2) c.fillRect(i * k, j * k, k, k);
      c.fillStyle = '#f5626c';
      c.beginPath(); c.arc((food.x + 0.5) * k, (food.y + 0.5) * k, k * 0.34, 0, 7); c.fill();
      s.forEach((p, i) => {
        const t = i / s.length;
        c.fillStyle = i === 0 ? '#8ef0d8' : `rgba(18,183,162,${0.95 - t * 0.6})`;
        c.fillRect(p.x * k + 1.5, p.y * k + 1.5, k - 3, k - 3);
      });
      scoreEl.textContent = String(score);
    }
    const start = () => { stop(); timer = setInterval(step, tickMs); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const restart = () => { if (timer) start(); };
    const turn = (x, y) => { if (x === -dir.x && y === -dir.y) return; nextDir = { x, y }; };
    const onKey = (e) => {
      const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      if (m[e.key]) { e.preventDefault(); turn(...m[e.key]); }
      if (e.key === ' ') { timer ? stop() : start(); }
    };
    addEventListener('keydown', onKey);
    let sx = 0, sy = 0;
    cvs.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    cvs.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return start();
      if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0); else turn(0, dy > 0 ? 1 : -1);
    });
    const pad = h('div.kbd-pad', { style: { gridTemplateColumns: 'repeat(3,1fr)', maxWidth: '210px', margin: '12px auto' } },
      h('button', { html: icon('up', 20), onclick: () => turn(0, -1) }), h('button.op', { text: '⏯', onclick: () => (timer ? stop() : start()) }), h('button', { html: icon('down', 20), onclick: () => turn(0, 1) }),
      h('button', { html: icon('left', 20), onclick: () => turn(-1, 0) }), h('button.eq', { text: '↺', onclick: () => { score = 0; reset(); start(); } }), h('button', { html: icon('right', 20), onclick: () => turn(1, 0) }));
    const head = h('div.row-flex', { style: { justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--line)' } },
      h('button.btn.icon', { onclick: () => ctx.close(), html: icon('left', 19) }),
      h('span.title', B('Snake', 'සර්පයා')), h('span', { style: { flex: '1' } }), scoreEl, bestEl);
    reset(); start();
    ctx.api.power.wake(true).catch(() => {});
    return {
      el: h('div.app', head, h('div.app-body', { style: { padding: '10px 12px 16px' } }, cvs, pad, h('div.tiny.muted', { style: { textAlign: 'center' }, text: B('swipe, arrows or space to pause', 'ඇඟිලි, යොමු හෝ space') }))),
      onPause: stop,
      onResume: start,
      destroy: () => { stop(); removeEventListener('keydown', onKey); ctx.api.power.wake(false).catch(() => {}); if (score > best) ctx.api.store.set('best', score); },
    };
  },
};
