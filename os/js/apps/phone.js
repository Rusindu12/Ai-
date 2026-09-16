/* Dahat OS — Phone: a dial pad that hands the call to the system dialer.
 * Dahat never reads your call log or SMS — it has no capability for that.
 */
import { h, icon, clear } from '../ui/dom.js';
import { scaffold, row, section, empty } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { prompt, toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });
const KEYS = '123456789*0#'.split('');
const SUB = { 2: 'abc', 3: 'def', 4: 'ghi', 5: 'jkl', 6: 'mno', 7: 'pqrs', 8: 'tuv', 9: 'wxyz' };

export default {
  id: 'phone',
  create(ctx) {
    const num = h('div.num', { style: { fontSize: '32px', fontWeight: '300', textAlign: 'center', padding: '16px 8px 6px', minHeight: '52px', wordBreak: 'break-all' } }, '');
    let log = [];
    const logBox = h('div');
    const pad = h('div.grid3', { style: { gap: '10px', padding: '8px 4px' } });
    const entry = { current: '' };

    const press = (k) => {
      actuate('keyboard');
      entry.current += k;
      num.textContent = pretty(entry.current);
    };
    const pretty = (s) => s.replace(/(\d{3})(\d{3})(\d{0,4}).*/, '$1 $2 $3').trim() || s;
    KEYS.forEach((k) => pad.appendChild(h('button.pin-key', {
      onclick: () => press(k),
    }, h('div', { text: k, style: { fontSize: '24px', lineHeight: '1.1' } }), k in SUB ? h('div.tiny', { text: SUB[k].toUpperCase(), style: { letterSpacing: '2px', fontSize: '9px', opacity: .7 } }) : null)));
    const callBtn = h('button', {
      style: { width: '62px', height: '62px', borderRadius: '50%', background: 'var(--ok)', color: '#04150c', display: 'grid', placeItems: 'center', border: '0', cursor: 'pointer', margin: '6px auto', boxShadow: '0 8px 20px rgba(55,201,120,.35)' },
      html: icon('phone', 26),
      onclick: () => placeCall(),
    });
    const tools = h('div.row-flex', { style: { justifyContent: 'space-around', alignItems: 'center', padding: '4px 20px 10px' } },
      h('button.btn.icon', { onclick: () => { entry.current = entry.current.slice(0, -1); num.textContent = pretty(entry.current); }, html: icon('backspace', 19) }),
      callBtn,
      h('button.btn.icon', { onclick: () => addContact(), html: icon('users', 19), title: B('Contacts', 'සම්බන්ධතා') }));

    async function placeCall(raw) {
      const to = raw || entry.current;
      if (to.length < 3) { toast(B('enter a number first', 'මුලින්ම අංකයක් ඇතුළත් කරන්න')); return; }
      const ok = await ctx.requestCap('phone', B('Dahat hands the dialer to Android — it never logs or records calls.', 'දුරකථන ඇමතුම් Android වෙත භාර දේ.'));
      if (!ok) return;
      try {
        const r = await ctx.api.app.dial(to);
        log.unshift({ n: to, at: Date.now(), via: r.via });
        save(); paintLog();
        entry.current = '';
        num.textContent = '';
        toast(r.via === 'android' ? B('sent to the system dialer', 'Android ඩයලර් වෙත යවන ලදී') : B('browser will ask to open the dialer', 'බ්‍රවුසරය ඩයලර් අසයි'));
      } catch (e) { toast(e.message); }
    }
    const save = () => ctx.api.store.set('log', log.slice(0, 40));
    ctx.api.store.get('log').then((v) => { if (Array.isArray(v)) { log = v; paintLog(); } });

    function paintLog() {
      clear(logBox);
      if (!log.length) { logBox.appendChild(empty('phone', B('no calls from this OS yet', 'තවම ඇමතුම් නැත'))); return; }
      log.forEach((c) => logBox.appendChild(row({
        icon: 'arrowup', color: ['#37c978', '#0a3d24'], title: c.n,
        sub: `${new Date(c.at).toLocaleString()} · via ${c.via}`,
        onTap: () => placeCall(c.n),
      })));
    }
    async function addContact() {
      const name = await prompt({ title: B('Add a shortcut', 'කෙටි මාර්ගයක්'), placeholder: B('name', 'නම') });
      if (!name) return;
      const n = await prompt({ title: B('Number', 'අංකය'), placeholder: '07…', type: 'tel' });
      if (!n) return;
      contacts.push({ name, n });
      ctx.api.store.set('contacts', contacts);
      paintContacts();
    }
    let contacts = [];
    ctx.api.store.get('contacts').then((v) => { if (Array.isArray(v)) { contacts = v; paintContacts(); } });
    const contactBox = h('div');
    function paintContacts() {
      clear(contactBox);
      if (!contacts.length) { contactBox.appendChild(h('div.tiny.muted', B('no shortcuts', 'කෙටි මාර්ග නැත'))); return; }
      contacts.forEach((c, i) => contactBox.appendChild(row({
        icon: 'users', title: c.name, sub: c.n,
        onTap: () => { entry.current = c.n; num.textContent = pretty(c.n); },
      })));
    }

    const content = h('div',
      h('div.card', { style: { padding: '4px 8px' } }, num, pad, tools),
      section(B('Shortcuts', 'කෙටි මාර්ග'), contactBox),
      section(B('Recent', 'මෑත'), logBox),
      h('p.tiny.muted', { style: { textAlign: 'center' } },
        B('Calls are handed to the Android dialer by the launcher APK. Dahat holds no call, SMS or contact permission — there is nothing here to leak.',
          'ඇමතුම් Android ඩයලර් වෙත භාර දේ. දහත් OS හට ඇමතුම්, SMS, සම්බන්ධතා අවසර කිසිවක් නැත.')));
    const ui = scaffold(ctx, { title: B('Phone', 'දුරකථනය'), back: false, body: [content] });
    return {
      el: ui.el,
      onBack: () => { if (entry.current) { entry.current = ''; num.textContent = ''; return true; } return false; },
    };
  },
};
