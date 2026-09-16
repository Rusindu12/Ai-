/* Dahat OS — Terminal
 * A real shell over the kernel syscall table. Every command here goes through
 * bus.call with this app's pid, so a denied capability shows up as EACCES
 * exactly like it would for a third-party app.
 */
import { h, icon, esc, clear } from '../ui/dom.js';
import { i18n } from '../ui/i18n.js';
import { pm } from '../kernel/pm.js';
import { caps, CAPS } from '../kernel/caps.js';
import { log } from '../kernel/log.js';
import { bus } from '../kernel/bus.js';
import { nameOf, PKGS } from '../kernel/packages.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'terminal',
  create(ctx) {
    const term = h('div', { style: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '12px', lineHeight: '1.55', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } });
    const line = h('div.row-flex', { style: { alignItems: 'center', gap: '6px' } });
    const input = h('input', {
      style: { flex: '1', border: '0', background: 'none', outline: '0', fontFamily: 'inherit', fontSize: '12.5px', color: 'var(--text)', padding: '6px 0' },
      autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: 'type “help”',
    });
    const promptEl = h('span', { style: { color: 'var(--accent)', fontWeight: '700' } });
    line.append(promptEl, input);
    const screen = h('div.app-body', { style: { padding: '10px 12px 90px', background: 'linear-gradient(180deg,#060a0d,#04070a)', color: '#cfe3df' }, onclick: () => input.focus() }, term, line);
    const el = h('div.app', { style: { background: '#04070a' } }, h('div.app-bar', { style: { background: '#0a1014', borderColor: '#16222b' } },
      h('button.btn.icon', { onclick: () => ctx.close(), html: icon('left', 19) }),
      h('span.title', { text: `dahat · pid ${ctx.pid}` }), h('span', { style: { flex: '1' } }),
      h('button.btn.icon', { onclick: () => { clear(term); banner(); }, html: icon('trash', 17), title: 'clear' }),
      h('button.btn.icon', { onclick: () => { input.value = 'neofetch'; submit(); }, html: icon('info', 17), title: 'neofetch' })),
      screen);

    let cwd = '/sdcard';
    const hist = { items: [], i: 0 };
    let busy = false;

    const out = (txt, cls = '') => { term.appendChild(h('div', { class: cls, style: cls === 'err' ? { color: '#ff8a8a' } : cls === 'ok' ? { color: '#7fe3b6' } : cls === 'dim' ? { color: '#7e95a1' } : null, text: txt })); scroll(); };
    const outHTML = (html) => { term.appendChild(h('div', { html })); scroll(); };
    const scroll = () => { screen.scrollTop = screen.scrollHeight; };
    const setPrompt = () => { promptEl.textContent = `${shorten(cwd)} ❯`; };
    const shorten = (p) => p.replace('/sdcard', '~').replace(`/apps/${ctx.appId}`, '~');

    function banner() {
      outHTML(`<div style="color:#8fd6c9">Dahat OS shell · ${esc(`pid ${ctx.pid}`)} · ${esc(i18n.lang === 'si' ? 'විධාන 40ක්: "help" ටයිප් කරන්න' : 'type "help" for 40 commands')}</div>`);
    }
    banner();
    setPrompt();

    // ---- tokenizer + pipes ------------------------------------------------
    function tokenize(raw) {
      const s = raw.trim();
      if (!s) return [];
      const parts = [];
      let cur = '', q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q) q = null; else cur += c; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === ' ') { if (cur) { parts.push(cur); cur = ''; } continue; }
        if (c === '>' && s[i + 1] === '>') { parts.push('>>'); i++; if (cur) { parts.push(cur); cur = ''; } continue; }
        if (c === '>') { parts.push('>'); if (cur) { parts.push(cur); cur = ''; } continue; }
        if (c === '|') { parts.push('|'); if (cur) { parts.push(cur); cur = ''; } continue; }
        cur += c;
      }
      if (cur) parts.push(cur);
      const stages = [[]];
      let redir = null, append = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p === '|') { stages.push([]); continue; }
        if (p === '>' || p === '>>') { append = p === '>>'; redir = parts[++i]; continue; }
        stages[stages.length - 1].push(p.replace(/\$\{?PWD\}?/g, cwd));
      }
      return { stages, redir, append };
    }

    async function submit() {
      const raw = input.value;
      input.value = '';
      out(`${shorten(cwd)} ❯ ${raw}`, 'dim');
      if (!raw.trim()) return;
      hist.items.push(raw); hist.i = hist.items.length;
      ctx.api.store.set('hist', hist.items.slice(-60));
      const { stages, redir, append } = tokenize(raw);
      if (!stages.length || !stages[0].length) return;
      busy = true;
      let stdin = '';
      const results = [];
      try {
        for (const argv of stages) {
          const r = await run(argv, stdin);
          stdin = typeof r === 'string' ? r : JSON.stringify(r, null, 1);
          results.push(stdin);
        }
        let text = results[results.length - 1] ?? '';
        if (redir) { await ctx.api.fs.write(resolve(redir), text); out(`${B('wrote', 'ලිවීය')} ${redir}`, 'ok'); }
        else if (text) { text.split('\n').slice(0, 400).forEach((l) => out(l)); }
      } catch (e) {
        out(`${e.code ? `${e.code}: ` : ''}${e.message || e}`, 'err');
        log.debug('terminal', `error: ${e.message}`);
      }
      busy = false;
      scroll();
    }
    const resolve = (p) => (p.startsWith('/') ? p : `${cwd === '/' ? '' : cwd}/${p}`);

    async function run(argv, stdin) {
      const [cmd, ...a] = argv;
      const flags = a.filter((x) => x.startsWith('-')).join('');
      const args = a.filter((x) => !x.startsWith('-'));
      const fs = ctx.api.fs;
      const C = CMDS[cmd];
      if (!C) return `${B('command not found', 'විධානය සොයාගත නොහැක')}: ${cmd}\n${B("try 'help'", "'help' ටයිප් කර බලන්න")}`;
      return C({ ctx, fs, args, flags, stdin, cwd: () => cwd, chdir: (p) => { cwd = p; setPrompt(); }, out, resolve });
    }

    // ---- commands ---------------------------------------------------------
    const CMDS = {
      help: () => {
        const groups = [
          [B('files', 'ගොනු'), 'ls cd pwd cat head tail touch mkdir rm mv cp df du tree find stat wc grep sort rev'],
          [B('system', 'පද්ධතිය'), 'ps top kill uptime uname date cal whoami id free mount mountpoints battery theme lang'],
          [B('packages', 'පැකේජ'), 'pm open caps notify settings'],
          [B('kernel', 'කර්නලය'), 'dmesg log syscall stats storage api reboot clear history echo write'],
          [B('fun', 'විනෝදජනක'), 'neofetch sudo cowsay say random flip roll benchmark sl'],
        ];
        return groups.map(([g, c]) => `\x1b${g}\n  ${c}`).join('\n').replace(/\x1b(.+?)\n/g, (m, g) => `${g}\n`);
      },
      ls: async ({ fs, args, cwd, flags }) => {
        const p = args[0] ? resolvePath(args[0]) : cwd();
        const e = await fs.ls(p);
        if (flags.includes('l')) return e.map((x) => `${x.type === 'dir' ? 'd' : '-'}${x.size}`.padEnd(4) + ` ${String(x.size).padStart(8)} ${new Date(x.mtime).toISOString().slice(0, 16).replace('T', ' ')} ${x.type === 'dir' ? x.name + '/' : x.name}`).join('\n') || 'total 0';
        return e.map((x) => `${x.type === 'dir' ? '\x01' : ''}${x.name}${x.type === 'dir' ? '/' : ''}`).join('   ').replace(/\x01/g, '') || '(empty)';
      },
      cd: async ({ fs, args, cwd, chdir }) => {
        const t = args[0] === '~' ? '/sdcard' : args[0] ? resolvePath(args[0]) : '/sdcard';
        const r = resolve(t);
        const s = await fs.stat(r);
        if (s.type !== 'dir') throw new Error(`ENOTDIR: ${r}`);
        chdir(r);
        return '';
      },
      pwd: ({ cwd }) => cwd(),
      cat: async ({ fs, args, stdin }) => { if (!args[0]) return stdin; return (await Promise.all(args.map((f) => fs.read(resolvePath(f))))).join('\n'); },
      head: async ({ fs, args }) => (await fs.read(resolvePath(args[0]))).split('\n').slice(0, Number(args[1] || 10)).join('\n'),
      tail: async ({ fs, args }) => (await fs.read(resolvePath(args[0]))).split('\n').slice(-(Number(args[1] || 10))).join('\n'),
      touch: async ({ fs, args }) => { await fs.write(resolvePath(args[0]), ''); return `${B('created', 'සාදන ලදී')} ${args[0]}`; },
      write: async ({ fs, args, stdin }) => { const p = resolvePath(args[0]); await fs.write(p, stdin || args.slice(1).join(' ')); return `${B('wrote', 'ලිවීය')} ${p}`; },
      mkdir: async ({ fs, args }) => { await fs.mkdir(resolvePath(args[0])); return `ok ${args[0]}`; },
      rm: async ({ fs, args, flags }) => { const r = await fs.rm(resolvePath(args[0]), { recursive: flags.includes('r') || flags.includes('R') }); return `removed ${r.removed} inode(s)`; },
      mv: async ({ fs, args }) => { await fs.move(resolvePath(args[0]), resolvePath(args[1])); return `moved ${args[0]} → ${args[1]}`; },
      cp: async ({ fs, args }) => { const d = await fs.read(resolvePath(args[0])); await fs.write(resolvePath(args[1]), d); return `copied`; },
      df: async ({ fs }) => { const d = await fs.df(); return line2('Filesystem', 'Size', 'Used', 'Free', '%') + line2('dahat-fs', kb(d.total), kb(d.used), kb(d.free), `${d.percent}%`); },
      du: async ({ fs, args }) => { const t = await fs.tree(resolve(args[0] || '.'), 4); const byDir = {}; t.forEach((e) => { if (e.type === 'file') { const d = e.path.split('/').slice(0, -1).join('/'); byDir[d] = (byDir[d] || 0) + e.size; } }); return Object.entries(byDir).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(9)} ${k}`).join('\n') || '0  (nothing)'; },
      tree: async ({ fs, args }) => { const t = await fs.tree(resolve(args[0] || '.'), 3); return t.map((e, i) => `${i === 0 ? '' : '├─ '}${e.label}`).join('\n'); },
      find: async ({ fs, args }) => { const t = await fs.tree(resolve(args[0] || '/sdcard'), 8); const q = args[1] || ''; return t.filter((e) => e.name.includes(q)).map((e) => e.path).join('\n') || 'no matches'; },
      stat: async ({ fs, args }) => JSON.stringify(await fs.stat(resolvePath(args[0])), null, 1),
      wc: ({ stdin, args }) => { const s = stdin || ''; return `${s.split('\n').length} lines ${s.length} chars ${s.split(/\s+/).filter(Boolean).length} words`; },
      grep: ({ stdin, args }) => (stdin || '').split('\n').filter((l) => l.toLowerCase().includes((args[0] || '').toLowerCase())).join('\n') || '(no match)',
      sort: ({ stdin }) => (stdin || '').split('\n').sort().join('\n'),
      rev: ({ stdin }) => (stdin || '').split('\n').map((l) => [...l].reverse().join('')).join('\n'),
      ps: async ({ ctx }) => { const t = await ctx.api.sys.procs(); return line2('PID', 'STATE', 'CPUms', 'SYSCALLS', 'APP') + t.map((p) => line2(String(p.pid), p.state.slice(0, 6), String(p.cpuMs), String(p.syscalls), p.name)).trim(); },
      top: async ({ ctx }) => { const pf = await ctx.api.sys.perf(); const t = (await ctx.api.sys.procs()).sort((a, b) => b.cpuMs - a.cpuMs); return [`${B('frame', 'රාමුව')}: ${pf.frameMs}ms / ${pf.budgetMs}ms budget · ${B('jank', 'පැහැදිලි නැත')}: ${pf.jank} · ${B('procs', 'ක්‍රියාවලීන්')}: ${pf.procs}`, '', ...t.map((p) => `${String(p.pid).padStart(4)} ${p.name.slice(0, 18).padEnd(19)} cpu ${(p.cpuMs / 1000).toFixed(2)}s  syscalls ${p.syscalls}  ${p.state}`)].join('\n'); },
      kill: async ({ ctx, args }) => { const r = await ctx.api.sys.kill(Number(args[0])); return r?.killed ? `sent SIGKILL to ${args[0]}` : 'no such pid'; },
      uptime: async ({ ctx }) => { const u = await ctx.api.sys.uptime(); return `up ${(u.ms / 1000).toFixed(1)}s · kernel ${(u.kernelMs / 1000).toFixed(1)}s · ${navigator.hardwareConcurrency || 1} cpu`; },
      uname: async ({ ctx }) => { const u = await ctx.api.sys.uname(); return `${u.sysname} ${u.nodename} ${u.release} ${u.version} ${u.machine}`; },
      date: () => new Date().toString(),
      cal: () => { const d = new Date(), first = new Date(d.getFullYear(), d.getMonth(), 1).getDay(), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); let s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}\nSu Mo Tu We Th Fr Sa\n`; for (let i = 0; i < first; i++) s += '   '; for (let x = 1; x <= n; x++) s += `${String(x).padStart(2, '0')}${x % 7 === 0 || x === n ? '\n' : ' '}`; return s; },
      whoami: ({ ctx }) => `${ctx.appId} (uid ${ctx.pid})`,
      id: ({ ctx }) => `uid=${ctx.pid}(${ctx.appId}) gid=1000(dahat) groups=${(pm.manifest(ctx.appId)?.caps || []).join(',')}`,
      free: async ({ ctx }) => { const d = await ctx.api.fs.df(); const mem = performance.memory; return line2('', 'total', 'used', 'free') + line2(B('storage', 'ගබඩාව'), kb(d.total), kb(d.used), kb(d.free)) + line2('js-heap', mem ? mb(mem.jsHeapSizeLimit) : '?', mem ? mb(mem.usedJSHeapSize) : '?', mem ? mb(mem.totalJSHeapSize - mem.usedJSHeapSize) : '?'); },
      mount: () => 'dahat-fs on /sdcard type dahat-fs (rw)\ntmpfs on /tmp type tmpfs (rw,size=8m)\nsystem on /system type erofs (ro)',
      mountpoints: () => '/  /apps  /system  /sdcard  /tmp',
      battery: async ({ ctx }) => JSON.stringify(await ctx.api.power.status()),
      theme: async ({ ctx, args }) => { if (args[0]) { await ctx.api.settings.set('display.theme', args[0]); return `theme → ${args[0]}`; } return ctx.api.settings.get('display.theme').then(String); },
      lang: async ({ ctx, args }) => { if (args[0]) { await ctx.api.settings.set('ui.lang', args[0]); return `language → ${args[0]} (relaunch to see it)`; } return String(await ctx.api.settings.get('ui.lang')); },
      pm: async ({ args }) => {
        const sub = args[0], id = args[1];
        if (sub === 'list') return pm.installedIds.map((x) => { const p = pm.manifest(x); return `${x.padEnd(12)} ${p.version.padEnd(8)} ${p.kind.padEnd(13)} ${nameOf(p, 'en')}`; }).join('\n');
        if (sub === 'avail') return PKGS.filter((p) => p.kind === 'bazaar').map((p) => `${p.id.padEnd(12)} ${nameOf(p, 'en')}`).join('\n');
        if (sub === 'info') return JSON.stringify(pm.manifest(id), null, 1);
        if (sub === 'install') { const r = await pm.install(id); return r.already ? 'already installed' : `installed ${id}`; }
        if (sub === 'uninstall') { await pm.uninstall(id); return `uninstalled ${id}`; }
        if (sub === 'history') return pm.history.map((h2) => `${new Date(h2.at).toISOString()} ${h2.action} ${h2.id}`).join('\n') || 'no install/remove events yet';
        return 'usage: pm list|avail|info|install|uninstall|history';
      },
      open: async ({ ctx, args }) => { if (!args[0]) return 'usage: open <app>'; const r = await ctx.api.app.open(args[0]); return `launched ${args[0]}`; },
      caps: async ({ args }) => {
        const sub = args[0];
        if (sub === 'list') return Object.entries(CAPS).map(([k, v]) => `${k.padEnd(14)} ${v.en}`).join('\n');
        if (sub === 'status') return JSON.stringify(caps.for(args[1]), null, 1);
        if (sub === 'grant') { caps.grant(args[1], args[2]); return `granted ${args[2]} → ${args[1]}`; }
        if (sub === 'deny') { caps.deny(args[1], args[2]); return `denied ${args[2]} → ${args[1]}`; }
        if (sub === 'reset') { caps.reset(args[1] || ctx.appId); return 'prompts reset'; }
        return 'usage: caps list|status <app>|grant <app> <cap>|deny <app> <cap>|reset [app]';
      },
      notify: async ({ ctx, args }) => { await ctx.api.notif.post({ title: args[0] || 'Hello from the kernel', body: args.slice(1).join(' ') || 'shell notification' }); return 'notification posted (needs the notifications capability)'; },
      settings: async ({ ctx, args }) => {
        if (!args[0]) return Object.entries(await ctx.api.settings.list()).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n');
        if (args.length === 1) return String(await ctx.api.settings.get(args[0]));
        await ctx.api.settings.set(args[0], args.slice(1).join(' '));
        return `${args[0]} = ${args.slice(1).join(' ')}`;
      },
      dmesg: async ({ args }) => (await ctx.api.sys.dmesg(Number(args[0]) || 60)) || '(empty)',
      log: async ({ args }) => (await ctx.api.sys.log(Number(args[0]) || 40)) || '(nothing for this app yet)',
      stats: async ({ ctx }) => { const s = await ctx.api.sys.stats(); return Object.entries(s).map(([k, v]) => `${k.padEnd(10)} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'); },
      storage: async ({ ctx }) => { const d = await ctx.api.fs.df(); return `backend: ${storageMode()}\nused ${kb(d.used)} of ${kb(d.total)} (${d.percent}%)\ninodes: ${nodeCount()}`; },
      api: async ({ ctx, args }) => {
        const name = args[0];
        if (!name) return `available: ${bus.list().map((s) => s.name).join(' ')}`;
        if (!bus.has(name)) throw new Error(`ENOSYS: ${name}`);
        const svc = bus.list().find((s) => s.name === name);
        let payload = {};
        try { payload = args[1] ? JSON.parse(args.slice(1).join(' ')) : {}; } catch { payload = { path: args[1] }; }
        const r = await bus.call(name, payload, { pid: ctx.pid, appId: ctx.appId });
        return `${svc.cap ? `(needs ${svc.cap}) ` : ''}${JSON.stringify(r)}`.slice(0, 900);
      },
      syscall: async ({ ctx, args }) => CMDS.api({ ctx, args: ['api', ...args] }),
      clear: () => { clear(term); banner(); return ''; },
      history: () => hist.items.map((x, i) => `${String(i + 1).padStart(3)}  ${x}`).join('\n') || 'no history',
      echo: ({ args }) => args.join(' '),
      reboot: async ({ out }) => { out(B('restarting Dahat OS…', 'දහත් OS නැවත ආරම්භ වෙමින්…')); setTimeout(() => location.reload(), 450); return ''; },
      exit: ({ ctx }) => { ctx.close(); return ''; },
      // fun
      neofetch: async ({ ctx }) => {
        const u = await ctx.api.sys.uname(); const s = await ctx.api.sys.stats(); const p = await ctx.api.power.status();
        const rows = [
          ['OS', 'Dahat OS 1.0.0 (userspace kernel)'], ['Host', u.nodename], ['Kernel', `${u.sysname} ${u.release} ${u.version}`],
          ['Shell', 'dahat-sh 1.0'], ['Resolution', u.screen], ['DE', 'Dahat Glass Shell'], ['Apps', `${pm.installedIds.length} installed / ${PKGS.length} in index`],
          ['Syscalls', `${s.services} services · ${s.calls} calls`], ['CPU', `${u.cores} cores (${u.machine})`], ['Memory', u.memoryGB === '—' ? 'not reported' : `${u.memoryGB} GB`],
          ['Battery', p.level == null ? 'simulated' : `${Math.round(p.level * 100)}%${p.charging ? ' (charging)' : ''}`], ['Persistence', u.storage], ['Lang', u.lang],
        ];
        const art = ['   ▄████▄  ', '  ███  ███ ', ' ████▀████', ' ██  ▄  ██ ', '  ▀████▀  ', '   dahat    '];
        return art.map((l, i) => `${l}  ${rows[i] ? `${rows[i][0]}: ${rows[i][1]}` : (rows[i - art.length] ? `${rows[i - art.length][0]}: ${rows[i - art.length][1]}` : '')}`).join('\n')
          + rows.slice(art.length).map((r) => `${r[0]}: ${r[1]}`).join('\n');
      },
      sudo: () => 'Dahat OS has no root. Apps are unprivileged by design — use Settings ▸ Developer, or the caps command, to change permissions.',
      cowsay: ({ args }) => { const t = args.join(' ') || 'moo'; return ` _${'_'.repeat(t.length)}_\n< ${t} >\n -${'-'.repeat(t.length)}-\n   \\ (•)  < dahat says>`; },
      say: ({ args }) => CMDS.cowsay({ args }),
      random: ({ args }) => String(Math.floor(Math.random() * (Number(args[0]) || 100))),
      flip: () => Math.random() < 0.5 ? 'heads 🌶' : 'tails 🌶',
      roll: ({ args }) => { const n = Number(args[0]) || 6; return `🎲 ${1 + Math.floor(Math.random() * n)}`; },
      sl: () => '   🚂 chugga… (this is a steam locomotive, not a typo for ls)',
      benchmark: async ({ ctx, out }) => {
        out(B('measuring…', 'මැනීම…'));
        const t = [];
        let a = performance.now();
        for (let i = 0; i < 300; i++) await bus.call('sys.time', {}, { pid: ctx.pid, appId: ctx.appId });
        t.push(`syscall round-trip      ${((performance.now() - a) / 300).toFixed(3)}ms avg ×300`);
        a = performance.now();
        for (let i = 0; i < 200; i++) ctx.api.bus.call('fs.write', { path: `/tmp/bench${i}.txt`, data: 'dahat '.repeat(30) }, { pid: ctx.pid, appId: ctx.appId, cwd: '/' });
        t.push(`fs.write (200 × 180B)  ${(performance.now() - a).toFixed(1)}ms`);
        a = performance.now();
        for (let i = 0; i < 3000; i++) JSON.stringify({ i, a: [1, 2, 3], b: 'x'.repeat(32) });
        t.push(`JSON stringify ×3000   ${(performance.now() - a).toFixed(1)}ms`);
        a = performance.now();
        const p = await ctx.api.fs.ls('/sdcard');
        t.push(`fs.ls /sdcard          ${(performance.now() - a).toFixed(2)}ms (${p.length} entries)`);
        return t.join('\n');
      },
    };
    const line2 = (...c) => c.join('  ') + '\n';
    const kb = (n) => `${Math.round(n / 1024)}K`;
    const mb = (n) => `${Math.round(n / 1048576)}M`;
    const resolvePath = (p) => (p.startsWith('/') ? p : p === '.' ? cwd : `${cwd === '/' ? '' : cwd}/${p}`);
    const storageMode = () => (window.Dahat ? window.Dahat.storage.mode : 'idb');
    const nodeCount = () => (window.Dahat ? window.Dahat.vfs.nodes.size : '—');

    // ---- input handling ---------------------------------------------------
    ctx.api.store.get('hist').then((v) => { if (Array.isArray(v)) { hist.items.push(...v); hist.i = hist.items.length; } });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (!busy) submit(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hist.i = Math.max(0, hist.i - 1); input.value = hist.items[hist.i - 1] || ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); hist.i = Math.min(hist.items.length, hist.i + 1); input.value = hist.items[hist.i - 1] || ''; }
      else if (e.key === 'Tab') { e.preventDefault(); complete(); }
      else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); clear(term); banner(); }
      else if (e.key === 'c' && e.ctrlKey) { out('^C', 'dim'); input.value = ''; }
    });
    async function complete() {
      const parts = input.value.split(' ');
      const last = parts[parts.length - 1] || '';
      let pool = [];
      if (parts.length === 1) pool = Object.keys(CMDS);
      else {
        const dir = last.includes('/') ? resolvePath(last.replace(/\/[^/]*$/, '/')) : cwd;
        try { pool = (await ctx.api.fs.ls(dir)).map((e) => `${last.includes('/') ? last.replace(/[^/]*$/, '') : ''}${e.name}${e.type === 'dir' ? '/' : ''}`); } catch { pool = []; }
      }
      const hit = pool.filter((x) => x.startsWith(last));
      if (hit.length === 1) { parts[parts.length - 1] = hit[0]; input.value = parts.join(' '); }
      else if (hit.length > 1) { out(hit.join('   '), 'dim'); }
    }
    setTimeout(() => input.focus(), 80);
    const un = bus.on('fs.change', () => setPrompt());
    return { el, destroy: () => un(), onBack: () => { if (cwd !== '/sdcard') { cwd = '/sdcard'; setPrompt(); return true; } return false; } };
  },
};
