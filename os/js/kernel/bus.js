/* Dahat OS — kernel/bus.js
 * The syscall router + IPC bus. Apps never touch another app's internals:
 * they cross this boundary, which stamps the caller, checks capabilities and
 * writes an audit line.
 *
 *   await bus.call('fs.write', { path, data }, { pid })
 */
import { log } from './log.js';
import { caps } from './caps.js';

const services = new Map();   // "name" -> { fn, cap, trust, desc }
const topics = new Map();     // "topic" -> Set<handler>
const counters = new Map();   // "name" -> count

export const bus = {
  /** Observability hooks (set by the scheduler, cleared by tests). */
  hooks: { onCall: null },
  /** Set by boot: appId => true for OS-signed packages that skip runtime prompts. */
  trustFn: null,
  /** Register a syscall. opts: { cap, trust, desc } */
  register(name, fn, opts = {}) {
    if (services.has(name)) log.warn('kernel', `syscall re-registered: ${name}`);
    services.set(name, { fn, cap: opts.cap || null, trust: !!opts.trust, desc: opts.desc || '' });
    return () => services.delete(name);
  },
  has: (name) => services.has(name),
  list() { return [...services.entries()].map(([name, s]) => ({ name, cap: s.cap, trust: s.trust, desc: s.desc, calls: counters.get(name) || 0 })); },
  counters() { return Object.fromEntries(counters); },

  async call(name, args = {}, ctx = {}) {
    const svc = services.get(name);
    if (!svc) { log.error('kernel', `unknown syscall ${name}`); throw new Error(`ENOSYS: ${name}`); }
    counters.set(name, (counters.get(name) || 0) + 1);
    const pid = ctx.pid || 'kernel:0';
    const appId = ctx.appId || 'system';
    if (svc.cap) {
      const trusted = svc.trust || appId === 'system' || !!bus.trustFn?.(appId);
      const ok = await caps.check(appId, svc.cap, { trust: trusted, why: svc.desc });
      if (!ok) { log.warn('kernel', `${pid} blocked from ${name} (needs ${svc.cap})`); const e = new Error(`EACCES: ${name} requires ${svc.cap}`); e.code = 'EACCES'; throw e; }
    }
    const t = performance.now();
    try {
      const out = await svc.fn(args, { pid, appId, ...ctx });
      const ms = performance.now() - t;
      bus.hooks.onCall?.(pid, name, ms, 'ok');
      if (ms > 60) log.debug('kernel', `${name} took ${ms.toFixed(1)}ms`);
      return out;
    } catch (err) {
      bus.hooks.onCall?.(pid, name, performance.now() - t, 'err');
      if (err.code !== 'EACCES') log.error('kernel', `${name} failed: ${err.message}`);
      throw err;
    }
  },

  on(topic, fn) {
    if (!topics.has(topic)) topics.set(topic, new Set());
    topics.get(topic).add(fn);
    return () => topics.get(topic)?.delete(fn);
  },
  /** Broadcast to every subscriber (fire and forget). */
  emit(topic, data) {
    topics.get(topic)?.forEach((f) => { try { f(data); } catch (e) { log.error('ipc', `${topic}: ${e.message}`); } });
  },
  /** Request/reply across processes: every handler answers, first answer wins. */
  async request(topic, data) {
    const set = topics.get(topic);
    if (!set || !set.size) return null;
    return [...set][0](data);
  },
  stats() { return { services: services.size, topics: topics.size, calls: [...counters.values()].reduce((a, b) => a + b, 0) }; },
};
