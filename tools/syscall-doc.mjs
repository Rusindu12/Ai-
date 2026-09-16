/* Dahat OS — tools/syscall-doc.mjs
 * Prints the syscall table for docs/kernel-api.md, read out of the live registry
 * (kernel modules need a DOM/localStorage shim, so we boot them headless).
 *   node tools/syscall-doc.mjs            → markdown table
 *   node tools/syscall-doc.mjs --tsv      → name<TAB>cap<TAB>desc
 */
const store = new Map();
const el = () => {
  const n = {
    style: {}, dataset: {}, attributes: new Map(), children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { n.children.push(c); return c; },
    remove() {}, setAttribute(k, v) { n.attributes.set(k, v); }, getAttribute: (k) => n.attributes.get(k) ?? null,
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ x: 0, y: 0, width: 400, height: 800, top: 0, left: 0 }),
    set innerHTML(v) { n._h = v; }, get innerHTML() { return n._h || ''; },
    set textContent(v) { n._t = v; }, get textContent() { return n._t || ''; },
  };
  return n;
};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
def('document', { createElement: el, createTextNode: (t) => ({ nodeType: 3, data: t }), getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], body: el(), head: el(), documentElement: el(), addEventListener() {}, fonts: { load: async () => {}, ready: Promise.resolve() } });
def('navigator', { onLine: true, userAgent: 'dahat-doc', hardwareConcurrency: 4, vibrate: () => true, language: 'en-GB', clipboard: { writeText: async () => {}, readText: async () => '' } });
def('screen', { width: 412, height: 915 });
def('window', globalThis); def('self', globalThis);
def('addEventListener', () => {}); def('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
def('requestAnimationFrame', (fn) => setTimeout(fn, 16)); def('cancelAnimationFrame', (id) => clearTimeout(id));

const here = new URL('.', import.meta.url).pathname;
const { bus } = await import(`${here}../os/js/kernel/bus.js`);
const { config } = await import(`${here}../os/js/kernel/config.js`);
await import(`${here}../os/js/kernel/notify.js`);
await import(`${here}../os/js/kernel/pm.js`);
const { registerSyscalls } = await import(`${here}../os/js/kernel/syscalls.js`);
await config.load();
registerSyscalls();

const rows = bus.list().map((s) => ({ name: s.name, cap: s.cap || '', desc: s.desc || '' })).sort((a, b) => a.name.localeCompare(b.name));
if (process.argv.includes('--tsv')) {
  process.stdout.write(rows.map((r) => `${r.name}\t${r.cap || '-'}\t${r.desc}`).join('\n') + '\n');
} else {
  const out = ['| syscall | capability | what it does |', '| --- | --- | --- |'];
  for (const r of rows) out.push(`| \`${r.name}\` | ${r.cap ? '`' + r.cap + '`' : '—'} | ${r.desc || '—'} |`);
  out.push('', `_${rows.length} syscalls — regenerate with \`node tools/syscall-doc.mjs\`._`);
  process.stdout.write(out.join('\n') + '\n');
}
