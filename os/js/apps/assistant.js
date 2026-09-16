/* Dahat OS — Sahan, the on-device assistant.
 * Every skill below is executed locally against the kernel API. If you point
 * it at your own OpenAI-compatible endpoint (Settings ▸ Developer ▸ provider)
 * it will use that for free-form chat — and only then does text leave.
 */
import { h, icon, clear } from '../ui/dom.js';
import { scaffold } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { bus } from '../kernel/bus.js';
import { pm } from '../kernel/pm.js';
import { PKGS, nameOf } from '../kernel/packages.js';
import { vfs } from '../kernel/vfs.js';
import { log } from '../kernel/log.js';
import { toast } from '../shell/dialogs.js';
import { evaluate } from './calculator.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'assistant',
  create(ctx) {
    let chat = [];
    ctx.api.store.get('chat').then((v) => { if (Array.isArray(v)) { chat = v.slice(-40); paintChat(); } });
    const logBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0 12px' } });
    const input = h('input', { class: 'input', placeholder: B('ask, or type a command…', 'අසන්න, හෝ විධානයක්…'), autocomplete: 'off' });
    const sendBtn = h('button.btn.primary', { onclick: () => submit(), style: { minWidth: '44px' }, html: icon('send', 17) });
    const micBtn = h('button.btn.icon', { onclick: () => voice(), html: icon('mic', 18), title: B('voice (if the browser allows)', 'හඬ') });
    const chips = h('div.row-flex', { style: { gap: '7px', flexWrap: 'wrap', padding: '6px 0 10px' } },
      ...[B('open terminal', 'ටර්මිනලය විවෘත කරන්න'), B('battery?', 'බැටරිය?'), B('note: buy pol sambol', 'සටහන: පොල් සම්බෝල'), B('find welcome', 'welcome සොයන්න'), B('5*12+800', '5*12+800'), B('dmesg', 'dmesg'), B('why Dahat?', 'දහත් ඇයි?')]
        .map((c) => h('button.chip', { text: c, onclick: () => { input.value = c; submit(); } })));
    const ui = scaffold(ctx, {
      title: { en: 'Sahan', si: 'සහන්' }, back: false, subtitle: B('on-device', 'උපාංගයේම'),
      body: [h('div.tiny.muted', { style: { marginBottom: '8px' } }, B('no account, no cloud, no memory of you', 'ගිණුමක් නැත, වලාකුළක් නැත')), logBox, chips],
    });
    ui.el.appendChild(h('div.row-flex', { style: { gap: '8px', padding: '10px 12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface)' } }, input, micBtn, sendBtn));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    const say = (who, text) => { chat.push({ who, text, at: Date.now() }); paintChat(); ctx.api.store.set('chat', chat.slice(-40)); };
    function paintChat() {
      clear(logBox);
      chat.forEach((m) => {
        const mine = m.who === 'me';
        logBox.appendChild(h('div', { style: { display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' } },
          h('div', {
            style: {
              maxWidth: '84%', padding: '9px 13px', borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: mine ? 'var(--accent)' : 'var(--surface-2)', color: mine ? 'var(--accent-ink)' : 'var(--text)',
              border: '1px solid var(--line)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13.5px',
            },
            text: m.text,
          })));
      });
      if (!chat.length) {
        logBox.appendChild(h('div.card', { style: { textAlign: 'center', padding: '22px 14px' } },
          h('div', { style: { fontSize: '28px', color: 'var(--accent)' }, text: 'ධ' }),
          h('div', { style: { fontWeight: '800', margin: '8px 0 4px' } }, B('Sahan is here', 'සහන් මෙතැනයි')),
          h('div.tiny.muted', B('It can open apps, write notes, search files, run shell commands and read the kernel — all offline.',
            'ඇප් විවෘත කිරීම, සටහන් ලිවීම, ගොනු සොයා බැලීම, විධාන ධාවනය — සියල්ල නොබැඳිව.'))));
      }
      const body = ui.el.querySelector('.app-body');
      if (body) body.scrollTop = body.scrollHeight;
    }

    async function submit() {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      say('me', q);
      const answer = await respond(q);
      setTimeout(() => say('sahan', answer), 90);
    }
    async function respond(q) {
      const t = q.toLowerCase().trim();
      try {
        let m;
        if ((m = /^(open|launch|විවෘත කරන්න|හිල්ලා)\s+(.+)/.exec(t))) {
          const want = m[2];
          const hit = PKGS.filter((p) => pm.isInstalled(p.id)).find((p) => p.id === want || nameOf(p, 'en').toLowerCase().includes(want) || nameOf(p, 'si').includes(want));
          if (!hit) return `${B('no app called', 'නම් ඇති ඇප් එකක් නැත')} "${want}". ${B('installed:', 'ස්ථාපිත:')}\n${pm.installedIds.join(', ')}`;
          ctx.api.app.open(hit.id);
          return `${B('opening', 'විවෘත වෙමින්')} ${nameOf(hit, i18n.lang)}…`;
        }
        if ((m = /^(note|remember|සටහන|මතක තබාගන්න)[:\s]+(.+)/.exec(t))) {
          const name = `note-${Date.now().toString(36)}.md`;
          const path = `/sdcard/Notes/${name}`;
          await bus.call('fs.mkdir', { path: '/sdcard/Notes' }, { appId: ctx.appId, pid: ctx.pid }).catch(() => {});
          await bus.call('fs.write', { path, data: `---\ntitle: ${m[2].slice(0, 40)}\npinned: 0\nat: ${Date.now()}\n---\n# ${m[2]}\n` }, { appId: ctx.appId, pid: ctx.pid });
          return `${B('saved to', 'සුරකින ලද්දේ')} ${path}`;
        }
        if ((m = /^(find|search|සොය)[\s:]+(.+)/.exec(t))) {
          const hits = vfs.tree('/sdcard', '/', 6).filter((e) => e.name.toLowerCase().includes(m[2]));
          return hits.length ? `${hits.length} ${B('matches', 'ගැළපීම්')}:\n${hits.slice(0, 10).map((x) => x.path).join('\n')}` : B('nothing found', 'කිසිවක් සොයාගත නොහැක');
        }
        if (/^[\d\s+\-*/^().a-z]+$/.test(t) && /[\d]/.test(t) && /[+\-*/^]/.test(t) && !/^\w+$/.test(t.replace(/\s/g, ''))) {
          try { return `= ${evaluate(t)}`; } catch (e) { return `⚠ ${e.message}`; }
        }
        if (/^(battery|බැටරිය|power)/.test(t)) { const p = await bus.call('power.status', {}, { appId: ctx.appId, pid: ctx.pid }); return `${p.level == null ? B('not reported', 'වාර්තා නොකරයි') : Math.round(p.level * 100) + '%'} · ${p.charging ? B('charging', 'බැටරි ගසමින්') : B('discharging', 'භාවිතයෙන්')} · ${B('screen', 'තිරය')} ${p.screen}`; }
        if (/^(storage|ගබඩාව|space)/.test(t)) { const d = vfs.df(); return `${(d.used / 1048576).toFixed(1)} MiB ${B('used of', 'භාවිත')} ${(d.total / 1048576).toFixed(0)} MiB (${d.percent}%)`; }
        if (/^(time|වේලාව)/.test(t)) return new Date().toLocaleTimeString();
        if (/^(date|දවස)/.test(t)) return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
        if ((m = /^(alarm|ඇලාරම්)\s+(\d{1,2}):(\d{2})/.exec(t))) {
          const at = new Date(); at.setHours(+m[2], +m[3], 0, 0);
          const ms = at - Date.now();
          setTimeout(() => bus.call('notif.post', { title: `⏰ ${at.toLocaleTimeString()}`, body: B('your alarm', 'ඔබේ ඇලාරම') }, { appId: 'assistant', pid: ctx.pid }), Math.max(500, ms));
          return `${B('I will wake you in', 'විනිවිදීමට', 'විනාඩි')} ${Math.round(ms / 60000)} ${B('min (while Dahat stays open)', 'විනාඩි (දහත් විවෘතව තිබියදී)')}`;
        }
        if ((m = /^(kill|නවත්ව)\s+(.+)/.exec(t))) {
          const rows = await bus.call('sys.procs', {}, { appId: ctx.appId, pid: ctx.pid });
          const hit = rows.find((r) => r.appId === m[2] || r.name.toLowerCase().includes(m[2]));
          if (!hit) return B('not running', 'ක්‍රියාත්මක නොවේ');
          await bus.call('sys.kill', { pid: hit.pid }, { appId: ctx.appId, pid: ctx.pid });
          return `${hit.name} ${B('stopped (pid', 'නවතවා ඇත (pid')} ${hit.pid})`;
        }
        if ((m = /^(install|ස්ථාපනය කරන්න)\s+(.+)/.exec(t))) {
          if (!pm.all.find((p) => p.id === m[2])) return `unknown package "${m[2]}". ${B('available:', 'ලබා ගත හැක්කේ:')} ${pm.bazaar().map((p) => p.id).join(', ')}`;
          await pm.install(m[2], { from: 'assistant' });
          return `${m[2]} ${B('installed and pinned to your home screen', 'ස්ථාපනය කෙරිණි')}`;
        }
        if (/^(dark|අඳුරු)/.test(t)) { await bus.call('settings.set', { key: 'display.theme', value: 'dark' }, { appId: ctx.appId, pid: ctx.pid }); return B('dark mode on', 'අඳුරු ප්‍රකාරය සක්‍රීය'); }
        if (/^(light|දීප්ත)/.test(t)) { await bus.call('settings.set', { key: 'display.theme', value: 'light' }, { appId: ctx.appId, pid: ctx.pid }); return B('light mode on', 'දීප්ත ප්‍රකාරය සක්‍රීය'); }
        if ((m = /^(run|shell|ධාවනය කරන්න)\s+(.+)/.exec(t))) {
          const parts = m[2].split(' ');
          const name = parts[0];
          if (!bus.has(name)) return `${B('not a syscall:', 'syscall එකක් නොවේ:')} ${name}`;
          const r = await bus.call(name, {}, { appId: ctx.appId, pid: ctx.pid });
          return typeof r === 'string' ? r.slice(0, 500) : JSON.stringify(r).slice(0, 500);
        }
        if (/^(dmesg|log|ලඝුපොත)/.test(t)) return log.tail(6).map((e) => `${e.level[0].toUpperCase()} ${e.domain}: ${e.msg}`).join('\n') || B('log is clean', 'ලඝුපොත පිරිසිදුයි');
        if (/(why|what is|කෙන්|මොකද)\s*(dahat|දහත්)?/.test(t)) {
          return B('Dahat means "clean, clear, transparent" in Sinhala. The idea: a phone OS where an app starts with zero rights, your notes are just files, and the whole permission story is two taps deep.',
            'දහත් යනු පිරිසිදු, පැහැදිලි යන්නයි. ඇප්පක් අවසර රහිතව ආරම්භ වේ; ඔබේ සටහන් සුදුසු ගොනු පමණි.');
        }
        if (/(joke|හාස්‍ය)/.test(t)) return B('Why did the kernel cross the road? It was chasing a process. (sorry)', 'ක්‍රියාවලියක් දිග්ගෙන ගිය නිසායි. 😄');
        return await remoteChat(q);
      } catch (e) {
        return `⚠ ${e.code ? e.code + ': ' : ''}${e.message}`;
      }
    }

    /** optional: a chat endpoint the user configured themselves */
    async function remoteChat(q) {
      const provider = await ctx.api.settings.get('assistant.provider').catch(() => null);
      if (!provider) {
        return B('I only know the local skills: open <app>, note: …, find …, install …, kill …, battery, storage, alarm HH:MM, run <syscall>, dmesg. Add a provider in Settings ▸ Developer to chat with a model you host.',
          'මට දන්නේ මෙම කුසලතා පමණයි: open <app>, note: …, find …, install …, battery, storage, alarm HH:MM, run <syscall>, dmesg.');
      }
      const model = (await ctx.api.settings.get('assistant.model').catch(() => null)) || 'local';
      const r = await fetch(`${provider.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are Sahan, an on-device assistant for Dahat OS. Answer briefly.' }, ...chat.slice(-8).map((m) => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text })), { role: 'user', content: q }] }),
      });
      if (!r.ok) throw new Error(`provider said ${r.status}`);
      const j = await r.json();
      return j.choices?.[0]?.message?.content || B('the model returned nothing', 'ආකෘතිය කිසිවක් නොදුන්නාය');
    }

    function voice() {
      const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
      if (!SR) { toast(B('this browser has no speech recognition', 'බ්‍රවුසරයට හඬ හඳුනාගැනීමක් නැත')); return; }
      const rec = new SR();
      rec.lang = i18n.lang === 'si' ? 'si-LK' : 'en-LK';
      rec.onresult = (e) => { input.value = e.results[0][0].transcript; submit(); };
      rec.onerror = (e) => toast(B('microphone said', 'මයික්‍රොෆෝනය කියියි') + ` ${e.error}`);
      try { rec.start(); toast(B('listening…', 'සවන් දෙමින්…')); } catch (e) { toast(e.message); }
    }
    paintChat();
    return { el: ui.el, destroy: () => clear(logBox) };
  },
};
