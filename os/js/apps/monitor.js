/* Dahat OS — System Monitor: the process table, syscall counters and dmesg.
 * Written against the public syscall surface, so it shows exactly what a third
 * -party app could see — nothing more.
 */
import { h, icon, clear, fmtDur } from '../ui/dom.js';
import { scaffold, section, kv, progressbar } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { bus } from '../kernel/bus.js';
import { sched } from '../kernel/sched.js';
import { log } from '../kernel/log.js';
import { power } from '../kernel/power.js';
import { storage } from '../kernel/storage.js';
import { vfs } from '../kernel/vfs.js';
import { pm } from '../kernel/pm.js';
import { toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });
const spark = (arr, max) => {
  const bars = arr.map((v) => '▁▂▃▄▅▆▇█'[Math.min(7, Math.round((v / (max || 1)) * 7))]).join('');
  return bars;
};

export default {
  id: 'monitor',
  create(ctx) {
    const ui = scaffold(ctx, { title: B('System Monitor', 'පද්ධති නිරීක්ෂකය'), back: false, subtitle: `pid ${ctx.pid}` });
    const procs = h('div');
    const perf = h('div');
    const counters = h('div');
    const logs = h('div.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11.5px', maxHeight: '240px', overflow: 'auto', lineHeight: '1.5' } });
    const cpuHist = [], fpsHist = [];
    ui.setBody(
      section(B('Live', 'සජීවී'), perf),
      section(B('Processes', 'ක්‍රියාවලීන්'), procs),
      section(B('Syscalls', 'සිස්ටම් කল'), counters),
      section(B('Kernel log', 'කර්නල් ලඝුපොත'), logs,
        h('div.row-flex', { style: { gap: '8px', marginTop: '8px' } },
          h('button.btn', { onclick: () => { ctx.api.bus.call('clip.set', { text: log.dump() }, { appId: 'monitor', pid: ctx.pid }); toast(B('copied', 'පිටපත් කෙරිණි')); }, text: B('Copy', 'පිටපත්') }),
          h('button.btn', { onclick: () => { log.clear(); paint(); }, text: B('Clear', 'මකන්න') }))),
    );

    let raf = null, running = false, last = performance.now(), frames = 0, fpsT = performance.now(), fps = 60;
    function loop() {
      if (!running) return;
      const now = performance.now();
      frames++;
      if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
      if (now - last > 600) { last = now; paint(); }
      raf = requestAnimationFrame(loop);
    }
    /** one loop per window: start/stop are idempotent so pause+resume can't fork the frame clock */
    const startLoop = () => { if (running) return; running = true; raf = requestAnimationFrame(loop); };
    const stopLoop = () => { running = false; if (raf != null) cancelAnimationFrame(raf); raf = null; };
    function paint() {
      const t = sched.table();
      const total = Math.max(1, sched.totalCpuMs());
      cpuHist.push(Math.min(100, (total / 600) * 100)); if (cpuHist.length > 40) cpuHist.shift();
      fpsHist.push(Math.min(120, fps)); if (fpsHist.length > 40) fpsHist.shift();
      const df = vfs.df();
      clear(perf);
      perf.appendChild(h('div', { style: { fontFamily: 'ui-monospace,monospace', fontSize: '12px', whiteSpace: 'pre' }, text: `cpu  ${spark(cpuHist, 100)}\nfps  ${spark(fpsHist, 120)}` }));
      const cells = [
        [B('Frame rate', 'රාමු අනුපාතය'), `${fps.toFixed(0)} fps · ${sched.frameMs.toFixed(1)}ms`],
        [B('Jank frames', 'පැහැදිලි නොවූ රාමු'), sched.jank],
        [B('Tasks', 'කාර්යයන්'), `${t.length} running / ${pm.installedIds.length} installed`],
        [B('Syscall total', 'මුළු හැඳින්වීම්'), bus.stats().calls],
        [B('Storage backend', 'ගබඩා පසුබිම'), storage.mode],
        [B('Volume used', 'පරිමාව භාවිත'), `${(df.used / 1024).toFixed(0)} KiB / ${(df.total / 1048576).toFixed(0)} MiB`],
        [B('Battery', 'බැටරිය'), `${power.status.level == null ? '—' : Math.round(power.status.level * 100)}% ${power.status.charging ? '⚡' : ''}`],
        [B('Uptime', 'ක්‍රියා කාලය'), fmtDur(log.uptime)],
      ];
      cells.forEach(([k, v]) => perf.appendChild(kv(k, v)));
      perf.appendChild(h('div', { style: { marginTop: '8px' } }, progressbar(fps / 0.6, fps > 50 ? 'var(--ok)' : 'var(--warn)')));

      clear(procs);
      if (!t.length) procs.appendChild(h('div.tiny.muted', B('no processes — open an app', 'ක්‍රියාවලීන් නැත — ඇප් එකක් විවෘත කරන්න')));
      t.forEach((p) => {
        const line = h('div.row-flex', { style: { padding: '7px 0', borderBottom: '1px solid var(--line)', gap: '8px', alignItems: 'center' } },
          h('span.chip', { style: { fontFamily: 'ui-monospace,monospace' } }, `${p.pid}`),
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { style: { fontWeight: '700', fontSize: '13px' }, text: p.name }),
            h('div.tiny.mono.muted', { text: `${p.state} · ${(p.cpuMs / 1000).toFixed(2)}s cpu · ${p.syscalls} sys · ${p.errs} err${p.window ? ` · ${p.window}` : ''}` }),
            progressbar((p.cpuMs / total) * 100, p.state === 'unresponsive' ? 'var(--err)' : 'var(--accent)')),
          h('button.btn.icon', { onclick: () => { sched.kill(p.pid, 'killed from System Monitor'); toast(`${p.name} ${B('killed', 'නැවතී')}`); paint(); }, html: icon('x', 15), title: B('kill', 'මරන්න') }));
        procs.appendChild(line);
      });
      clear(counters);
      const cc = Object.entries(bus.counters()).sort((a, b) => b[1] - a[1]);
      if (!cc.length) counters.appendChild(h('div.tiny.muted', B('no syscalls yet', 'තවම හැඳින්වීම් නැත')));
      const max = cc.length ? cc[0][1] : 1;
      cc.slice(0, 10).forEach(([k, v]) => {
        counters.appendChild(h('div', { style: { padding: '3px 0' } },
          h('div.row-flex', { style: { justifyContent: 'space-between', fontSize: '11.5px' } }, h('span.mono', k), h('b', String(v))),
          progressbar((v / max) * 100, 'var(--accent-2)')));
      });
      const lines = log.tail(24).reverse();
      logs.textContent = lines.map((e) => `+${(e.up / 1000).toFixed(1).padStart(6)} ${e.level.padEnd(5)} ${e.domain.padEnd(8)} ${e.msg}`).join('\n') || '—';
    }
    startLoop();
    return {
      el: ui.el,
      destroy: stopLoop,
      onPause: stopLoop,
      onResume: startLoop,
    };
  },
};
