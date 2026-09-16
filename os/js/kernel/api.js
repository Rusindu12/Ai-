/* Dahat OS — kernel/api.js
 * The facade handed to every app as `ctx.api`. It is just the syscall table
 * with the process identity curried in — apps have no other way to reach the
 * OS, which is what makes revoking a capability actually mean something.
 */
import { bus } from './bus.js';

export function createApi({ pid, appId, getcwd }) {
  const call = (name, args = {}) => bus.call(name, args, { pid, appId, cwd: getcwd?.() || '/' });
  const data = (p) => call('fs.read', { path: p }).then((r) => r.data);
  return {
    pid, appId,
    fs: {
      read: data,
      write: (path, d, opts) => call('fs.write', { path, data: d, ...opts }),
      ls: (path = '/') => call('fs.ls', { path }).then((r) => r.entries),
      dir: (path = '/') => call('fs.ls', { path }),
      mkdir: (path) => call('fs.mkdir', { path }).then((r) => r.path),
      rm: (path, opts) => call('fs.rm', { path, ...opts }),
      move: (from, to) => call('fs.move', { from, to }).then((r) => r.path),
      stat: (path) => call('fs.stat', { path }),
      tree: (path, depth) => call('fs.tree', { path, depth }),
      df: () => call('fs.df', {}),
    },
    store: {
      get: (k) => call('store.get', { key: k }),
      set: (k, v) => call('store.set', { key: k, value: v }),
      del: (k) => call('store.del', { key: k }),
    },
    settings: {
      get: (k) => call('settings.get', { key: k }).then((r) => r.value),
      list: () => call('settings.list', {}),
      all: () => call('settings.list', {}),
      set: (k, v) => call('settings.set', { key: k, value: v }),
    },
    caps: {
      status: (appId_) => call('caps.status', { appId: appId_ }),
      request: (cap, why) => call('caps.request', { cap, why }).then((r) => r.granted),
    },
    notif: {
      post: (n) => call('notif.post', n),
      list: () => call('notif.list', {}),
      clear: () => call('notif.clear', {}),
    },
    app: {
      open: (id, params) => call('app.open', { id, params }),
      close: () => call('app.closeSelf', { pid }),
      openUrl: (url) => call('app.openUrl', { url }),
      setAlarm: (o) => call('app.setAlarm', o),
      cancelAlarm: (id) => call('app.cancelAlarm', { id }),
      dial: (number) => call('app.dial', { number }),
      share: (obj) => call('app.share', obj),
    },
    sys: {
      uname: () => call('sys.uname', {}),
      info: () => call('sys.info', {}),
      uptime: () => call('sys.uptime', {}),
      time: () => call('sys.time', {}),
      log: (n) => call('sys.log', { n }),
      dmesg: (n) => call('sys.dmesg', { n }),
      stats: () => call('sys.stats', {}),
      perf: () => call('sys.perf', {}),
      procs: () => call('sys.procs', {}),
      kill: (pid_) => call('sys.kill', { pid: pid_ }),
    },
    power: {
      status: () => call('power.status', {}),
      wake: (on) => call('power.wake', { on }),
    },
    ui: {
      haptic: (p) => call('ui.haptic', { pattern: p }),
      sfx: (n) => call('ui.sfx', { name: n }),
      toast: (m, ms) => call('ui.toast', { message: m, ms }),
      setTitle: (title) => bus.emit('win.title', { pid, title }),
      setBadge: (n) => bus.emit('win.badge', { pid, badge: n }),
      /** Ask the shell for an in-window action (snap, pip, close, recents). */
      win: (action, arg) => bus.call('win.' + action, { pid, ...(arg || {}) }),
    },
    bus, // read-only escape hatch for topics (on/emit) — used by power apps
  };
}
