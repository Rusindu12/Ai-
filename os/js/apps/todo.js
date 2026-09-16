/* Tasks — a Bazaar app. It ships as a package with two declared capabilities,
 * so it is a good example of what "installed" means on Dahat: /apps/todo/data
 * for its own state, and a notification prompt the first time it schedules one.
 */
import { h, icon, clear, fmtAgo } from '../ui/dom.js';
import { scaffold, seg, row, empty } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { confirm, prompt } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'todo',
  create(ctx) {
    let items = [];
    let tab = 'today';
    const ui = scaffold(ctx, { title: { en: 'Tasks', si: 'කාර්යයන්' }, back: false });
    const segEl = seg([{ id: 'today', label: B('Today', 'අද') }, { id: 'next', label: B('Upcoming', 'ඉදිරිය') }, { id: 'someday', label: B('Someday', 'දවසක්') }, { id: 'done', label: B('Done', 'නිම') }], tab, (v) => { tab = v; paint(); });
    const list = h('div');
    const input = h('input', { class: 'input', placeholder: B('add a task and press ↵', 'කාර්යයක් එක් කර ↵ ඔබන්න') });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) add(input.value.trim()); });
    ui.setBody(segEl, h('div.row-flex', { style: { gap: '8px', marginBottom: '12px' } }, input, h('button.btn.primary', { onclick: () => { if (input.value.trim()) { add(input.value.trim()); input.value = ''; } }, html: icon('plus', 17) })), list);

    ctx.api.store.get('items').then((v) => { if (Array.isArray(v)) { items = v; paint(); } });
    const save = () => ctx.api.store.set('items', items);

    function add(text) {
      items.unshift({ id: Date.now(), text, done: false, when: tab === 'today' ? 'today' : tab === 'next' ? 'next' : 'someday' });
      actuate('tap');
      save(); paint();
    }
    function paint() {
      const shown = items.filter((i) => tab === 'done' ? i.done : (!i.done && i.when === tab));
      clear(list);
      if (!shown.length) {
        list.appendChild(empty('todo', tab === 'today' ? B('nothing due today — nice', 'අද කිසිවක් නැත') : B('empty', 'හිස්'),
          tab === 'today' && items.some((i) => !i.done) ? h('button.btn', { text: B('pull tomorrow forward', 'හෙටට ඇති දේ අදට'), onclick: pullForward }) : null));
      }
      shown.forEach((it) => {
        const cb = h('button', {
          style: { width: '26px', height: '26px', borderRadius: '9px', border: `2px solid ${it.done ? 'var(--ok)' : 'var(--text-3)'}`, background: it.done ? 'var(--ok)' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: '0 0 auto', color: '#04150c' },
          html: it.done ? icon('check', 15) : '',
          onclick: () => { it.done = !it.done; actuate('toggle'); save(); paint(); schedule(it); },
        });
        const node = h('div.row', { style: { gap: '10px' } }, cb,
          h('div.r-main', h('div.r-title', { style: { textDecoration: it.done ? 'line-through' : 'none', opacity: it.done ? 0.6 : 1 }, text: it.text }), h('div.r-sub', `${it.when} · ${fmtAgo(it.id, i18n.lang)}`)),
          h('button.btn.icon', { onclick: async (e) => { e.stopPropagation(); if (await confirm({ title: B('Delete task?', 'කාර්යය මකන්නද?'), danger: true })) { items = items.filter((x) => x.id !== it.id); save(); paint(); } }, html: icon('trash', 15) }));
        node.addEventListener('click', (e) => { if (e.target.closest('button')) return; edit(it); });
        list.appendChild(node);
      });
      ui.setSubtitle(`${items.filter((i) => !i.done).length} ${B('open', 'විවෘත')} · ${items.filter((i) => i.done).length} ${B('done', 'නිම')}`);
    }
    async function edit(it) {
      const v = await prompt({ title: B('Edit task', 'කාර්යය සංස්කරණය'), value: it.text });
      if (v) { it.text = v; save(); paint(); }
    }
    function pullForward() {
      items.forEach((i) => { if (!i.done && i.when === 'next') i.when = 'today'; });
      save(); paint();
    }
    async function schedule(it) {
      if (!it.done || !it.remind) return;
      const ms = new Date(it.remind) - Date.now();
      if (ms <= 0) return;
      setTimeout(() => ctx.api.notif.post({ title: B('Task', 'කාර්යය'), body: it.text }).catch(() => {}), ms);
    }

    const n = items.filter((i) => !i.done).length;
    if (n) ctx.api.ui.setBadge?.(n);
    return { el: ui.el, onResume: paint };
  },
};
