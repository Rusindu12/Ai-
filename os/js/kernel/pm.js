/* Dahat OS — kernel/pm.js
 * Package manager: which packages are installed, their state, and the lifecycle
 * glue between an installed package and a running process.
 */
import { log } from './log.js';
import { storage } from './storage.js';
import { bus } from './bus.js';
import { vfs } from './vfs.js';
import { caps } from './caps.js';
import { PKGS, byId, CORE_IDS } from './packages.js';

const state = {
  installed: new Set(CORE_IDS),
  order: [],            // home-screen layout: [ [ids], [ids] ]
  dock: ['phone', 'camera', 'notes', 'bazaar'],
  pinned: [],
  history: [],          // install/uninstall journal
  loaded: false,
};
const listeners = new Set();

async function load() {
  if (state.loaded) return;
  const saved = await storage.get('pm', null);
  if (saved) {
    state.installed = new Set(saved.installed || CORE_IDS);
    state.order = saved.order || [];
    state.dock = saved.dock || state.dock;
    state.pinned = saved.pinned || [];
    state.history = saved.history || [];
  }
  CORE_IDS.forEach((id) => state.installed.add(id)); // never lose a core app
  state.loaded = true;
  log.info('pm', `${state.installed.size} packages installed`);
}
async function save() {
  await storage.set('pm', {
    installed: [...state.installed], order: state.order, dock: state.dock, pinned: state.pinned, history: state.history.slice(-40),
  });
}
function notify(reason) { listeners.forEach((f) => { try { f(reason); } catch (e) { log.error('pm', e.message); } }); }

export const pm = {
  load, save,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get all() { return PKGS; },
  get installedIds() { return [...state.installed]; },
  get dock() { return state.dock; },
  get pinned() { return state.pinned; },
  get history() { return state.history; },
  /** home-screen pages: [[id…],[id…]] padded to 8 slots per page */
  pages() {
    const flat = PKGS.filter((p) => state.installed.has(p.id) && !state.dock.includes(p.id)).map((p) => p.id);
    if (!state.order.length) {
      const pinned = state.pinned.filter((id) => flat.includes(id));
      const rest = flat.filter((id) => !pinned.includes(id));
      const first = [...pinned, ...rest].slice(0, 8);
      const extra = flat.filter((id) => !first.includes(id));
      return [first, extra.length ? extra : null].filter(Boolean);
    }
    const valid = state.order.map((pg) => pg.filter((id) => flat.includes(id)));
    const seen = new Set(valid.flat());
    const missing = flat.filter((id) => !seen.has(id));
    if (missing.length) {
      const last = valid[valid.length - 1] || [];
      const space = 8 - last.length;
      if (space > 0) last.push(...missing.splice(0, space));
      while (missing.length) valid.push(missing.splice(0, 8));
    }
    return valid.filter((p) => p.length);
  },
  setLayout({ pages, dock }) {
    if (pages) state.order = pages.map((p) => p.slice(0, 8));
    if (dock) state.dock = dock.slice(0, 4);
    save(); notify('layout');
  },
  isInstalled: (id) => state.installed.has(id),
  info: (id) => byId(id),
  manifest(id) {
    const p = byId(id);
    if (!p) return null;
    return { ...p, installed: state.installed.has(id), dataDir: `/apps/${id}`, sdDir: `/sdcard/${p.name.en}`, granted: caps.for(id), core: p.kind === 'system' };
  },
  history_() { return state.history; },

  async install(id, { from = 'bazaar', progress = () => {} } = {}) {
    const p = byId(id);
    if (!p) throw new Error(`package not found: ${id}`);
    if (state.installed.has(id)) return { id, already: true };
    // Simulated streaming install: verify + unpack + register.
    const steps = [
      [12, 'resolving package'], [34, 'downloading payload'], [58, 'verifying signature'],
      [76, 'unpacking dex/assets'], [92, 'registering manifest'], [100, 'committing'],
    ];
    for (const [pct, msg] of steps) {
      await new Promise((r) => setTimeout(r, 130));
      progress(pct, msg);
      log.debug('pm', `install ${id}: ${msg}`);
    }
    state.installed.add(id);
    vfs.mkdir(`/apps/${id}/data`, '/', { recursive: true });
    vfs.write(`/apps/${id}/package.json`, JSON.stringify({ ...p, installedAt: Date.now() }, null, 2), '/', { mime: 'application/json', ro: true });
    state.history.push({ at: Date.now(), action: 'install', id, from });
    await save();
    log.info('pm', `installed ${id} (from ${from})`);
    bus.emit('pm.installed', { id });
    notify('install');
    return { id };
  },

  async uninstall(id) {
    const p = byId(id);
    if (!p) throw new Error(`package not found: ${id}`);
    if (p.kind === 'system') { const e = new Error('ESystemPackage: this app is part of Dahat OS'); e.code = 'EBUSY'; throw e; }
    state.installed.delete(id);
    state.order = state.order.map((pg) => pg.filter((x) => x !== id)).filter((pg) => pg.length);
    state.dock = state.dock.filter((x) => x !== id);
    state.pinned = state.pinned.filter((x) => x !== id);
    try { vfs.rm(`/apps/${id}`, '/', { recursive: true }); } catch { /* no data dir */ }
    caps.reset(id);
    state.history.push({ at: Date.now(), action: 'uninstall', id });
    await save();
    log.info('pm', `uninstalled ${id}`);
    bus.emit('pm.uninstalled', { id });
    notify('uninstall');
    return { id };
  },

  async clearData(id) {
    try { vfs.rm(`/apps/${id}/data`, '/', { recursive: true }); vfs.mkdir(`/apps/${id}/data`, '/', { recursive: true }); } catch { /* already empty */ }
    await storage.del(`app:${id}`);
    log.info('pm', `cleared data for ${id}`);
    notify('data');
  },
  bazaar(lang = 'en') {
    return PKGS.filter((p) => p.kind === 'bazaar').map((p) => ({ ...p, installed: state.installed.has(p.id) }));
  },
  storageReport() {
    return PKGS.filter((p) => state.installed.has(p.id)).map((p) => ({
      id: p.id, name: p.name, size: p.size, data: vfs.usedIn(`/apps/${p.id}`), sd: vfs.usedIn(`/sdcard/${p.name.en}`),
    }));
  },
};

// ---- syscalls -------------------------------------------------------------
bus.register('pm.list', () => PKGS.filter((p) => state.installed.has(p.id)).map((p) => pm.manifest(p.id)));
bus.register('pm.available', () => pm.bazaar());
bus.register('pm.info', ({ id }) => pm.manifest(id));
bus.register('pm.install', ({ id }, { appId }) => pm.install(id, { from: `app:${appId}` }), { cap: 'process', desc: 'install a new package' });
bus.register('pm.uninstall', ({ id }) => pm.uninstall(id), { cap: 'process', desc: 'remove a package' });
bus.register('pm.clearData', ({ id }) => pm.clearData(id), { cap: 'process' });
bus.register('pm.setLayout', ({ pages, dock }) => pm.setLayout({ pages, dock }), { cap: 'settings', trust: false });
bus.register('pm.pin', ({ id, page = 0, index = 0 }) => {
  const pages_ = pm.pages();
  pages_[page] = pages_[page] || [];
  pages_[page] = [id, ...pages_[page].filter((x) => x !== id)].slice(0, 8);
  pm.setLayout({ pages: pages_ });
  state.pinned = [...new Set([id, ...state.pinned])];
  save();
}, { cap: 'process' });
