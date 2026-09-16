/* Dahat OS — kernel/vfs.js
 * A small virtual filesystem: flat path table, per-app sandboxes, one shared
 * volume (/sdcard) that needs the `storage` capability, and durability via
 * kernel/storage.js. Text, JSON and data-URL blobs live side by side.
 */
import { log } from './log.js';
import { storage } from './storage.js';

export const QUOTA_BYTES = 96 * 1024 * 1024; // advertised user-space for this device
const SEED = {
  '/': { type: 'dir' },
  '/apps': { type: 'dir' },
  '/system': { type: 'dir' },
  '/system/etc': { type: 'dir' },
  '/system/etc/os-release': { type: 'file', data: ['NAME="Dahat OS"', 'VERSION="1.0 (Dahat)"', 'ID=dahat', 'BUILD_ID=DHS1.240612.001', 'VARIANT=Launcher', 'SLOGAN=dahatva · clean by design'].join('\n'), mime: 'text/plain' },
  '/system/etc/hostname': { type: 'file', data: 'dahat-phone', mime: 'text/plain' },
  '/system/etc/fstab': { type: 'file', data: 'sdcard /sdcard dahat-fs rw,relatime 0 0\ntmpfs /tmp tmpfs rw,size=8m 0 0\n', mime: 'text/plain' },
  '/system/usr': { type: 'dir' },
  '/tmp': { type: 'dir' },
  '/sdcard': { type: 'dir' },
  '/sdcard/DCIM': { type: 'dir' },
  '/sdcard/Documents': { type: 'dir' },
  '/sdcard/Documents/welcome.md': { type: 'file', mime: 'text/markdown', data: '# Dahat OS\n\nThis is your home.\n\n- **Files** shows everything you own under /sdcard\n- **Terminal** talks to the kernel directly (`help`)\n- **Bazaar** installs more apps\n\nEverything you write stays on this device.\n' },
  '/sdcard/Download': { type: 'dir' },
  '/sdcard/Notes': { type: 'dir' },
  '/sdcard/Music': { type: 'dir' },
};
const joinPath = (a, b) => {
  const base = a.startsWith('/') ? a : `/${a}`;
  const stack = `${base}/${b}`.split('/').filter(Boolean);
  const out = [];
  for (const seg of stack) {
    if (seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`.replace(/\/$/g, '') || '/';
};
const norm = (p) => joinPath('/', String(p || '/'));

class VFS {
  constructor() {
    this.nodes = new Map();
    this.listeners = new Set();
    this._dirty = 0;
    this._timer = null;
    for (const [p, n] of Object.entries(SEED)) {
      const ro = p.startsWith('/system');
      this.nodes.set(p, { path: p, type: n.type, data: n.data, mime: n.mime, ctime: Date.now(), mtime: Date.now(), size: n.data ? n.data.length : 0, ro });
    }
  }
  async mount() {
    const saved = await storage.get('vfs', null);
    if (saved && saved.nodes) {
      this.nodes = new Map(saved.nodes.map(([k, v]) => [k, v]));
      log.info('vfs', `mounted ${this.nodes.size} inodes (saved ${new Date(saved.at).toLocaleString()})`);
    } else {
      log.info('vfs', 'fresh filesystem image created');
      await this.persist(true);
    }
    return this;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  touched() {
    this._dirty++;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._dirty = 0; this.persist(); }, 350);
  }
  async persist(now = false) {
    if (!now && this._dirty === 0) return;
    await storage.set('vfs', { at: Date.now(), nodes: [...this.nodes.entries()] });
  }
  // ---- helpers
  node(p) { return this.nodes.get(norm(p)); }
  resolve(p, cwd = '/') { return p && p.startsWith('/') ? norm(p) : joinPath(cwd, p || '.'); }
  sizeOf(p) {
    const path = norm(p);
    const n = this.nodes.get(path);
    if (!n) return 0;
    if (n.type === 'file') return n.size || (n.data ? n.data.length : 0);
    let sum = 0;
    for (const [k, v] of this.nodes) if (k !== path && k.startsWith(`${path}/`) && v.type === 'file') sum += v.size || (v.data ? v.data.length : 0);
    return sum;
  }
  totalUsed() { let s = 0; for (const [, v] of this.nodes) if (v.type === 'file') s += v.size || (v.data ? v.data.length : 0); return s; }
  usedIn(prefix) { let s = 0; for (const [k, v] of this.nodes) if (v.type === 'file' && k.startsWith(prefix)) s += v.size || (v.data ? v.data.length : 0); return s; }

  // ---- operations
  stat(p, cwd) {
    const path = this.resolve(p, cwd), n = this.nodes.get(path);
    if (!n) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
    return { path, type: n.type, size: n.type === 'dir' ? this.sizeOf(path) : n.size, mime: n.mime, ctime: n.ctime, mtime: n.mtime, name: path.split('/').pop() || '/', mode: n.ro ? 'r--r--r--' : 'rw-rw-rw-' };
  }
  exists(p, cwd) { try { this.stat(p, cwd); return true; } catch { return false; } }
  ls(p = '/', cwd = '/') {
    const path = this.resolve(p, cwd);
    if (!this.nodes.has(path)) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
    const out = [];
    for (const [k, v] of this.nodes) {
      if (k === path || !k.startsWith(`${path}/`)) continue;
      if (k.slice(path.length + 1).includes('/')) continue;
      out.push({ name: k.split('/').pop(), type: v.type, size: v.type === 'dir' ? this.sizeOf(k) : v.size, mtime: v.mtime, mime: v.mime, path: k });
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }
  mkdir(p, cwd = '/', { recursive = true } = {}) {
    const path = this.resolve(p, cwd);
    if (this.nodes.has(path)) { const n = this.nodes.get(path); if (n.type === 'dir') return path; }
    const parent = this.nodes.get(joinPath('/', path.split('/').slice(1, -1).join('/')));
    if (!parent && !recursive) { const e = new Error(`ENOTDIR: parent of ${path}`); e.code = 'ENOTDIR'; throw e; }
    if (!parent) this.mkdir(joinPath('/', path.split('/').slice(1, -1).join('/')), '/', { recursive: true });
    this.nodes.set(path, { path, type: 'dir', ctime: Date.now(), mtime: Date.now(), size: 0 });
    this.touched(); this.emit('mkdir', path);
    return path;
  }
  write(p, data, cwd = '/', { mime, ro = false, force = false } = {}) {
    const path = this.resolve(p, cwd);
    if (!force && (path === '/system' || path.startsWith('/system/'))) {
      const e = new Error(`EROFS: ${path} sits on the read-only system volume`); e.code = 'EROFS'; throw e;
    }
    if (!force && (path === '/' || path === '/apps')) { const e = new Error(`EROFS: ${path} is owned by the OS`); e.code = 'EROFS'; throw e; }
    const parentPath = joinPath('/', path.split('/').slice(1, -1).join('/'));
    if (!this.nodes.has(parentPath)) this.mkdir(parentPath, '/', { recursive: true });
    const prev = this.nodes.get(path);
    if (prev?.ro) { const e = new Error(`EROFS: ${path} is read-only`); e.code = 'EROFS'; throw e; }
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const node = { path, type: 'file', data: str, mime: mime || (str.startsWith('data:') ? 'image/*' : 'text/plain'), size: str.length, ctime: prev?.ctime || Date.now(), mtime: Date.now(), ro };
    this.nodes.set(path, node);
    this.touched(); this.emit('write', path);
    return { path, size: node.size };
  }
  read(p, cwd = '/') {
    const path = this.resolve(p, cwd), n = this.nodes.get(path);
    if (!n) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
    if (n.type === 'dir') { const e = new Error(`EISDIR: ${path}`); e.code = 'EISDIR'; throw e; }
    return n.data;
  }
  rm(p, cwd = '/', { recursive = false, force = false } = {}) {
    const path = this.resolve(p, cwd);
    const n = this.nodes.get(path);
    if (!n) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
    if (!force && (path === '/system' || path.startsWith('/system/'))) { const e = new Error(`EROFS: ${path} is on the read-only system volume`); e.code = 'EROFS'; throw e; }
    if (n.ro && !force) { const e = new Error(`EROFS: ${path}`); e.code = 'EROFS'; throw e; }
    const kids = [...this.nodes.keys()].filter((k) => k.startsWith(`${path}/`));
    if (n.type === 'dir' && kids.length && !recursive) { const e = new Error(`ENOTEMPTY: ${path}`); e.code = 'ENOTEMPTY'; throw e; }
    this.nodes.delete(path);
    kids.forEach((k) => this.nodes.delete(k));
    this.touched(); this.emit('rm', path);
    return { removed: 1 + kids.length };
  }
  move(from, to, cwd = '/') {
    const a = this.resolve(from, cwd), b = this.resolve(to, cwd);
    const n = this.nodes.get(a);
    if (!n) { const e = new Error(`ENOENT: ${a}`); e.code = 'ENOENT'; throw e; }
    if (b.startsWith(`${a}/`)) { const e = new Error('EINVAL: cannot move into itself'); throw e; }
    this.nodes.delete(a);
    const kids = [...this.nodes.keys()].filter((k) => k.startsWith(`${a}/`));
    const moved = new Map();
    for (const k of kids) { const v = this.nodes.get(k); this.nodes.delete(k); moved.set(b + k.slice(a.length), v); }
    n.path = b; this.nodes.set(b, n);
    for (const [k, v] of moved) { v.path = k; this.nodes.set(k, v); }
    this.mkdir(joinPath('/', b.split('/').slice(1, -1).join('/')), '/', { recursive: true });
    this.touched(); this.emit('move', b);
    return b;
  }
  copy(from, to, cwd = '/') {
    const a = this.resolve(from, cwd);
    this.write(this.resolve(to, cwd), this.read(a), '/', { mime: this.nodes.get(a).mime });
    return this.resolve(to, cwd);
  }
  appDataDir(appId) { const p = `/apps/${appId}`; if (!this.nodes.has(p)) this.mkdir(p, '/', { recursive: true }); return p; }
  df() {
    const used = this.totalUsed();
    return { total: QUOTA_BYTES, used, free: Math.max(0, QUOTA_BYTES - used), mount: '/sdcard', fs: 'dahat-fs' };
  }
  tree(root = '/', cwd = '/', depth = 2) {
    const out = [];
    const walk = (p, prefix, d) => {
      if (d > depth) return;
      for (const e of this.ls(p, cwd)) {
        out.push({ ...e, label: prefix + e.name + (e.type === 'dir' ? '/' : '') });
        if (e.type === 'dir') walk(e.path, `${prefix}  `, d + 1);
      }
    };
    walk(this.resolve(root, cwd), '', 1);
    return out;
  }
  reset() { this.nodes.clear(); for (const [p, n] of Object.entries(SEED)) this.nodes.set(p, { path: p, ...n, size: n.data ? n.data.length : 0, ctime: Date.now(), mtime: Date.now() }); this.persist(true); this.emit('reset', '/'); }
  emit(ev, path) { this.listeners.forEach((f) => { try { f({ ev, path }); } catch { /* listener error */ } }); }
}
export const vfs = new VFS();
export { norm as normPath, joinPath };
