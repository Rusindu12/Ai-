/* Dahat OS — kernel/storage.js
 * One durable key-value store used by every other kernel service.
 * IndexedDB when available (secure contexts / app WebView), localStorage as
 * the fallback so the OS still boots in hostile embedding contexts.
 */
const DB = 'dahat-kernel', STORE = 'kv';
let handle = null, mode = 'memory';
const mem = new Map();

async function open() {
  if (handle || mode === 'memory') return handle;
  try {
    if (!self.indexedDB) throw new Error('no idb');
    handle = await new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('blocked'));
    });
    mode = 'idb';
  } catch {
    mode = self.localStorage ? 'local' : 'memory';
    handle = null;
  }
  return handle;
}
const lsKey = (k) => `dahat:${k}`;
function tx(mode_) {
  return new Promise((res, rej) => {
    const t = handle.transaction(STORE, mode_);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}

export const storage = {
  get mode() { return mode; },
  async init() { await open(); return mode; },
  async get(key, fallback = null) {
    await open();
    try {
      if (mode === 'idb') {
        const v = await new Promise((res, rej) => {
          const r = handle.transaction(STORE).objectStore(STORE).get(key);
          r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        return v === undefined ? fallback : v;
      }
      if (mode === 'local') {
        const raw = localStorage.getItem(lsKey(key));
        return raw == null ? fallback : JSON.parse(raw);
      }
    } catch (e) { console.warn('storage get', key, e); }
    return mem.has(key) ? mem.get(key) : fallback;
  },
  async set(key, value) {
    mem.set(key, value);
    await open();
    try {
      if (mode === 'idb') {
        const t = handle.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(value, key);
        await tx('readwrite');
      } else if (mode === 'local') {
        localStorage.setItem(lsKey(key), JSON.stringify(value));
      }
    } catch (e) { console.warn('storage set', key, e); }
    return value;
  },
  async del(key) {
    mem.delete(key);
    await open();
    try {
      if (mode === 'idb') { const t = handle.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); await tx('readwrite'); }
      else if (mode === 'local') localStorage.removeItem(lsKey(key));
    } catch (e) { console.warn('storage del', key, e); }
  },
  async keys() {
    await open();
    if (mode === 'idb') {
      return new Promise((res) => {
        const r = handle.transaction(STORE).objectStore(STORE).getAllKeys();
        r.onsuccess = () => res(r.result); r.onerror = () => res([]);
      });
    }
    if (mode === 'local') return Object.keys(localStorage).filter((k) => k.startsWith('dahat:')).map((k) => k.slice(6));
    return [...mem.keys()];
  },
  async clear() {
    for (const k of await this.keys()) await this.del(k);
  },
};
