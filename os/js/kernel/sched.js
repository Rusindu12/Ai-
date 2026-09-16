/* Dahat OS — kernel/sched.js
 * A process table with a cooperative time-slice budget. Each visible app gets
 * one "task"; the kernel gives it a slice per frame and accounts for what it
 * used. Background tasks are suspended (doze) and can be killed from the
 * overview, the System Monitor, or `kill` in the terminal.
 */
import { log } from './log.js';
import { bus } from './bus.js';

let nextPid = 100;
const procs = new Map();     // pid -> proc
const byApp = new Map();     // appId -> pid
const listeners = new Set();
const FRAME_BUDGET_MS = 16.7;
let tickTimer = null, lastTick = Date.now(), frameMs = 0, jank = 0;

function emit(reason) { listeners.forEach((f) => { try { f(reason); } catch { /* listener down */ } }); }

export const sched = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get list() { return [...procs.values()]; },
  get budget() { return FRAME_BUDGET_MS; },
  get frameMs() { return frameMs; },
  get jank() { return jank; },

  spawn(appId, meta = {}) {
    let pid = byApp.get(appId);
    if (pid && procs.has(pid)) { procs.get(pid).lastBeat = Date.now(); procs.get(pid).state = 'running'; emit('reuse'); return procs.get(pid); }
    pid = ++nextPid;
    const proc = {
      pid, appId, name: meta.name || appId, state: 'starting', startedAt: Date.now(), lastBeat: Date.now(),
      cpuMs: 0, syscalls: 0, errs: 0, win: null, ...meta,
    };
    procs.set(pid, proc); byApp.set(appId, pid);
    if (!this._running) this.start();
    log.info('sched', `pid ${pid} started (${proc.name})`);
    bus.emit('proc.spawn', { pid, appId });
    emit('spawn');
    return proc;
  },
  beat(pid) {
    const p = procs.get(pid);
    if (!p) return;
    p.lastBeat = Date.now();
    if (p.state === 'starting') p.state = 'running';
  },
  suspend(pid, why = 'background') {
    const p = procs.get(pid);
    if (!p || p.state === 'suspended') return;
    p.state = 'suspended'; p.suspendReason = why;
    log.debug('sched', `pid ${pid} suspended (${why})`);
    bus.emit('proc.suspend', { pid, appId: p.appId });
    emit('suspend');
  },
  resume(pid) {
    const p = procs.get(pid);
    if (!p) return;
    p.state = 'running'; p.lastBeat = Date.now();
    bus.emit('proc.resume', { pid, appId: p.appId });
    emit('resume');
  },
  kill(pid, reason = 'killed') {
    const p = procs.get(pid);
    if (!p) return false;
    p.state = 'zombie';
    try { p.instance?.destroy?.(reason); } catch (e) { log.error('sched', `destroy() threw: ${e.message}`); }
    procs.delete(pid); byApp.delete(p.appId);
    log.info('sched', `pid ${pid} exited (${reason})`);
    bus.emit('proc.exit', { pid, appId: p.appId, reason });
    emit('kill');
    return true;
  },
  killApp(appId, reason) {
    const pid = byApp.get(appId);
    return pid ? this.kill(pid, reason) : false;
  },
  pidOf(appId) { return byApp.get(appId) ?? null; },
  info(pid) {
    const p = procs.get(pid);
    if (!p) return null;
    return {
      pid: p.pid, appId: p.appId, name: p.name, state: p.state, cpuMs: Math.round(p.cpuMs), syscalls: p.syscalls,
      errs: p.errs, uptimeMs: Date.now() - p.startedAt, suspendReason: p.suspendReason || null, window: p.win?.mode || null,
    };
  },
  table() { return [...procs.values()].map((p) => this.info(p.pid)).sort((a, b) => a.pid - b.pid); },
  totalCpuMs() { return [...procs.values()].reduce((s, p) => s + p.cpuMs, 0); },
  note(pid, name, ms, status) {
    const p = procs.get(pid);
    if (!p) return;
    p.syscalls++;
    p.cpuMs += Math.max(0, ms);
    if (status === 'err') p.errs++;
  },
  /** the accounting loop: called by the shell's rAF pump */
  tickFrame(deltaMs) {
    frameMs = frameMs * 0.8 + deltaMs * 0.2;
    if (deltaMs > FRAME_BUDGET_MS * 1.8) jank++;
    const now = Date.now();
    for (const p of procs.values()) {
      if (p.state === 'running') p.cpuMs += Math.min(deltaMs, FRAME_BUDGET_MS);
      else p.cpuMs += Math.min(deltaMs, 0.6); // housekeeping cost while dozing
      const hung = now - p.lastBeat > 5000 && (p.state === 'running' || p.state === 'starting');
      if (hung) {
        p.state = 'unresponsive';
        log.warn('sched', `pid ${p.pid} (${p.name}) missed 5s of heartbeats — marked unresponsive`);
        bus.emit('proc.stalled', { pid: p.pid, appId: p.appId });
      }
    }
    emit('tick');
  },
  start() {
    if (tickTimer) return;
    this._running = true;
    lastTick = Date.now();
    tickTimer = setInterval(() => {
      const now = Date.now();
      this.tickFrame(now - lastTick);
      lastTick = now;
    }, 500);
    bus.hooks.onCall = (pid, name, ms, status) => this.note(pid, name, ms, status);
    log.info('sched', 'accounting loop online (500ms tick)');
  },
  stop() { clearInterval(tickTimer); tickTimer = null; this._running = false; },
};

bus.register('sys.procs', () => sched.table(), { cap: 'process', desc: 'list running processes' });
bus.register('sys.perf', () => ({ frameMs: +sched.frameMs.toFixed(2), budgetMs: sched.budget, jank: sched.jank, procs: sched.list.length }));
bus.register('sys.kill', ({ pid }, { pid: me }) => {
  const target = sched.info(pid);
  if (!target) throw new Error(`ESRCH: no such process ${pid}`);
  if (target.appId === 'settings' && me !== 'system' && target.pid !== me) throw new Error('EPERM: only the shell may stop Settings');
  return { killed: sched.kill(pid, `requested by ${me}`) };
}, { cap: 'process', desc: 'stop another app' });
