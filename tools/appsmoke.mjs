/* Dahat OS — tools/appsmoke.mjs
 * Headless UI smoke test: boots the kernel, mounts every app with a stub DOM,
 * clicks every control it can find, fires keyboard/pointer events, then
 * destroys the app. Catches the class of bug `node --check` cannot see:
 * temporal-dead-zone references, missing exports, bad DOM usage, crash on
 * destroy, leaked timers.
 *
 *   node tools/appsmoke.mjs            — all apps, en + si
 *   node tools/appsmoke.mjs clock snake
 */
import { installDom, reportDomGaps } from './domstub.mjs';

const env = installDom();
const HARNESS = [];
process.on('unhandledRejection', (e) => { const err = e instanceof Error ? e : new Error(String(e)); env.REAL.push(err); HARNESS.push(err); });

const K = (n) => `../os/js/kernel/${n}.js`;
const { bus } = await import(K('bus'));
const { storage } = await import(K('storage'));
const { config } = await import(K('config'));
const { caps } = await import(K('caps'));
const { vfs } = await import(K('vfs'));
const { pm } = await import(K('pm'));
const { notif } = await import(K('notify'));
const { power } = await import(K('power'));
const { sched } = await import(K('sched'));
const { registerSyscalls, isTrusted } = await import(K('syscalls'));
const { createApi } = await import(K('api'));
const { byId } = await import(K('packages'));
const { i18n } = await import('../os/js/ui/i18n.js');
const { loadApp, ENTRIES } = await import('../os/js/apps/registry.js');
const { icon } = await import('../os/js/ui/dom.js');

/* the shell's layer nodes — dialogs, toasts and sheets mount into these */
for (const id of ['device', 'screen', 'wallpaper', 'home-layer', 'apps-layer', 'window-root', 'shade-root', 'lock-root', 'boot-root', 'dialog-root', 'toast-root', 'status-root', 'nav-root']) {
  const d = globalThis.document.createElement('div');
  d.id = id;
  globalThis.document.body.appendChild(d);
}

const only = process.argv.slice(2);
const TARGETS = only.length ? ENTRIES.filter((e) => only.includes(e)) : ENTRIES;
const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const notes = [];
let pidSeq = 100;

/* ------------------------------------------------------------ kernel boot */
await storage.init();
await config.load();
registerSyscalls();
caps.prompter = async () => true;
await vfs.mount();
await pm.load();
await notif.load();
power.init();
i18n.lang = 'en';

const toasts = [];
const opened = [];
const closed = [];

function makeCtx(entry, params) {
  const pid = ++pidSeq;
  const pkg = byId(entry) || { id: entry, name: entry, kind: 'system', caps: [] };
  const api = createApi({ pid, appId: entry, getcwd: () => '/apps/' + entry });
  const root = env.document.createElement('div');
  root.className = 'win-body';
  env.document.body.appendChild(root);
  const ctx = {
    pid, appId: entry, pkg, params: params || {}, root,
    api, bus, t: i18n.t, bi: i18n.bi, lang: () => i18n.lang,
    icon: (n, s) => icon(n, s),
    toast: (m, ms) => toasts.push(String(m)),
    haptic: () => {}, sfx: () => {},
    close: () => closed.push(entry),
    setTitle: () => {}, setMode: () => {},
    requestCap: (cap, why) => api.caps.request(cap, why),
    openApp: (id, p) => { opened.push(id); return Promise.resolve({ pid: ++pidSeq }); },
    on: (_ev, _fn) => () => {}, watch: () => () => {},
    prompt: async (o) => ({ value: o?.initial ?? (o?.multiline ? 'smoke text' : '42'), ok: true }),
    confirm: async () => true,
    sheet: () => ({ close() {} }),
  };
  return { ctx, root };
}

const PARAMS = {
  files: { open: '/sdcard/Documents/welcome.md' },
  notes: { open: '/sdcard/Notes/welcome.md' },
  gallery: { open: '/sdcard/DCIM' },
  bazaar: { open: 'todo' },
  clock: { tab: 'timer' },
  settings: { page: 'display' },
  todo: { filter: 'active' },
};

/** every clickable / editable thing the app rendered */
function controlsOf(el) {
  const out = [];
  const push = (n) => out.push(n);
  const walk = (n) => {
    for (const c of n.children) {
      const t = c.localName;
      const cls = c.className || '';
      if (t === 'button' || t === 'input' || t === 'select' || t === 'textarea' || c.getAttribute('role') === 'button'
        || /\b(btn|chip|tab|row|pin-key|switch|seg|qs-tile|tile|kbd|pad-key)\b/.test(cls)) push(c);
      walk(c);
    }
  };
  walk(el);
  return out.slice(0, 90);
}

async function exerciseOne(entry, { click = true } = {}) {
  const { ctx, root } = makeCtx(entry, PARAMS[entry]);
  const timersBefore = new Set(env.TIMERS.keys());
  const problems = [];
  let inst = null, mod = null;
  try { mod = await loadApp(entry); inst = await mod.create(ctx); } catch (e) { problems.push(`create: ${e?.message || e} @ ${(e?.stack || '').split('\n').slice(1, 3).join(' | ')}`); }
  if (!inst) { root.remove(); env.clearAll(); return problems; }
  root.appendChild(inst.el);
  const own = () => { const r = env.REAL.splice(0); return r.map((e) => (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))); };

  const trap = async (what, fn) => {
    try { await fn(); } catch (e) { problems.push(`${what}: ${e?.message || e} @ ${(e?.stack || '').split('\n')[1]?.trim() || ''}`); }
    for (const m of own()) problems.push(`${what} (async): ${m}`);
  };

  if (inst.el) {
    await trap('onCreate', async () => inst.onCreate?.());
    await trap('onResume', async () => inst.onResume?.());
    if (click) {
      const ctrls = controlsOf(inst.el);
      let n = 0;
      for (const c of ctrls) {
        n++;
        await trap(`click#${n} <${c.localName}${c.className ? '.' + String(c.className).split(' ')[0] : ''}>"${(c.textContent || '').slice(0, 18)}"`, async () => {
          c.click();
          if (c.localName === 'input' || c.localName === 'textarea') {
            const start = c.type === 'range' ? 1 : 0;
            if (c.type !== 'checkbox' && c.type !== 'radio') { c.value = c.type === 'number' ? '12' : 'smoke ${x} 1+1'; }
            c._fire('input', { target: c, data: 'x', isComposing: false, inputType: 'insertText' });
            c._fire('change', { target: c });
          }
          await sleep(0);
        });
      }
      notes.push(`${entry}: ${n} controls exercised`);
      await trap('keyboard', async () => {
        for (const key of ['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', ' ', 'Tab']) {
          root._fire('keydown', { key, code: 'Key' + key, target: root });
          env.document.documentElement._fire('keydown', { key, code: 'Key' + key, target: root });
        }
        await sleep(0);
      });
      await trap('pointer gesture', async () => {
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'dblclick']) {
          root._fire(type, { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 120, touches: [{ identifier: 1, clientX: 60, clientY: 120 }], changedTouches: [{ identifier: 1, clientX: 100, clientY: 260 }], deltaY: 40, target: root });
        }
        await sleep(0);
      });
    }
    await trap('onParams', async () => inst.onParams?.({ open: '/sdcard/Documents/welcome.md' }));
    await trap('onResize', async () => inst.onResize?.());
    await trap('onPause', async () => inst.onPause?.());
    await trap('onResume#2', async () => inst.onResume?.());
    await trap('onBack', async () => inst.onBack?.());
    await sleep(6);
    await trap('destroy', async () => inst.destroy?.('smoke'));
    // anything still pending after destroy belongs to this app
    const left = [...env.TIMERS.entries()].filter(([id]) => !timersBefore.has(id));
    const bad = left.filter(([, v]) => !/kernel\/(power|pm|notify|storage|sched)\.js/.test(v.at || '') && (v.kind === 'interval' || v.kind === 'raf' || v.ms > 900));
    if (bad.length) {
      const where = bad.map(([, v]) => {
        const line = (v.at || '').split('\n').find((l) => l.includes('/os/js/')) || '';
        return `${v.kind}${v.kind === 'interval' ? ' ' + v.ms + 'ms' : ''} @ ${line.trim().replace(/^at /, '').replace(/^file:\/\/.*\/os\/js\//, '')}`;
      });
      problems.push(`leaked ${bad.length} loop(s) after destroy: ${[...new Set(where)].slice(0, 4).join('; ')}`);
    }
    for (const m of own()) problems.push(`post-destroy (async): ${m}`);
  }
  root.remove();
  env.clearAll();
  return problems;
}

/* --------------------------------------------------------------- run */
const results = [];
try {
for (const entry of TARGETS) {
  const problems = await exerciseOne(entry, { click: true });
  // second pass: Sinhala strings, no clicking
  i18n.lang = 'si';
  const siProblems = await exerciseOne(entry, { click: false });
  i18n.lang = 'en';
  results.push({ entry, problems: [...problems, ...siProblems.map((p) => `[si] ${p}`)] });
}
} catch (e) {
  results.push({ entry: 'HARNESS', problems: [`smoke runner died: ${e?.message} @ ${(e?.stack || '').split('\n')[1]?.trim()}`] });
}

/* ---------------------------------------------------------------- report */
import { writeSync } from 'node:fs';
const OUT = [];
const say = (...a) => OUT.push(a.join(' '));
let fail = 0;
const _log = console.log; console.log = (...a) => say(...a);
say(`\nDahat OS headless app smoke — ${TARGETS.length} apps, kernel ${isTrusted('files') ? 'ok' : '?'}, ${bus.stats().services} syscalls live\n`);
for (const { entry, problems } of results) {
  if (problems.length) {
    fail++;
    console.log(`  ✗ ${entry.padEnd(12)} ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 8)) console.log(`        ${p}`);
    if (problems.length > 8) console.log(`        … ${problems.length - 8} more`);
  } else console.log(`  ✓ ${entry.padEnd(12)} mounts, reacts, unmounts clean`);
}
const gaps = reportDomGaps();
if (gaps.length) console.log(`\n  (stub DOM gaps, not app bugs): ${gaps.slice(0, 10).join('; ')}`);
console.log(`\n${results.reduce((n, r) => n + r.problems.length, 0)} problem(s); ${toasts.length} toasts, ${opened.length} app-to-app jumps, ${closed.length} self-closes`);
if (notes.length && process.env.VERBOSE) notes.forEach((n) => console.log('  · ' + n));
env.clearAll();
// writeSync: process.exit() would drop buffered piped stdout
writeSync(1, OUT.join('\n') + '\n');
process.exit(fail ? 1 : 0);
