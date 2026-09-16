/* Dahat OS — kernel/log.js  (the kernel ring buffer, i.e. dmesg)
 * Every syscall, permission decision, crash and lifecycle event lands here.
 */
const CAP = 600;
const buf = [];
let seq = 0;
const listeners = new Set();
const t0 = Date.now();

export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, err: 3 };

function push(level, domain, msg, extra) {
  const e = { id: ++seq, ts: Date.now(), up: Date.now() - t0, level, domain, msg, extra };
  buf.push(e);
  if (buf.length > CAP) buf.shift();
  listeners.forEach((f) => { try { f(e); } catch { /* keep logging */ } });
  if (LOG_LEVELS[level] >= LOG_LEVELS.warn) console[level === 'err' ? 'error' : level](`[${domain}] ${msg}`);
  return e;
}

export const log = {
  get uptime() { return Date.now() - t0; },
  debug: (d, m, x) => push('debug', d, m, x),
  info: (d, m, x) => push('info', d, m, x),
  warn: (d, m, x) => push('warn', d, m, x),
  error: (d, m, x) => push('err', d, m, x),
  /** subscribe to new lines; returns unsubscribe */
  watch(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  tail(n = 80, { level, domain } = {}) {
    let out = buf;
    if (level) out = out.filter((e) => LOG_LEVELS[e.level] >= LOG_LEVELS[level]);
    if (domain) out = out.filter((e) => e.domain === domain);
    return out.slice(-n);
  },
  count() { return { total: buf.length, warn: buf.filter((e) => e.level === 'warn').length, err: buf.filter((e) => e.level === 'err').length }; },
  /** plain-text dmesg dump, used by the terminal app */
  dump(opts) {
    return this.tail(1000, opts).map((e) => {
      const up = (e.up / 1000).toFixed(3).padStart(9, ' ');
      return `[${up}] ${e.level.toUpperCase().padEnd(5)} ${e.domain}: ${e.msg}`;
    }).join('\n');
  },
  clear() { buf.length = 0; push('info', 'log', 'kernel log cleared'); },
};

// Uncaught errors become kernel faults in the log and reach the user as a toast.
self.addEventListener?.('error', (ev) => {
  log.error('fault', `${ev.message || 'unknown error'} @ ${(ev.filename || '').split('/').pop()}:${ev.lineno || 0}`);
});
self.addEventListener?.('unhandledrejection', (ev) => {
  log.error('fault', `unhandled rejection: ${ev.reason?.message || ev.reason}`);
});
