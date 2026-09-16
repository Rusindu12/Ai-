/* Dahat OS — apps/kit.js
 * Shared scaffolding for first-party + installed apps: bars, rows, switches,
 * segmented controls, empty states. Anything that could be a design decision
 * lives here once, not 19 times.
 */
import { h, icon, clear } from '../ui/dom.js';
import { actuate } from '../ui/audio.js';
import { i18n } from '../ui/i18n.js';

/** app([barTitle], body...) → standard column layout with a scrollable body */
export function scaffold(ctx, { title, subtitle = '', actions = [], body = [], tabs = null, fab = null, onBack = null, back = true } = {}) {
  const titleEl = h('span.title', title);
  const bar = h('div.app-bar',
    back ? h('button.btn.icon', { onclick: () => { actuate('close'); onBack ? onBack() : ctx.close(); }, html: icon('left', 19), 'aria-label': i18n.t('common.back') }) : null,
    titleEl,
    subtitle ? h('span.sub', { text: subtitle }) : null,
    h('span', { style: { flex: '1' } }),
    ...actions.map((a) => h('button.btn.icon', {
      title: typeof a.label === 'string' ? a.label : i18n.bi(a.label), 'aria-label': a.id,
      onclick: () => { actuate('tap'); a.run(ctx, bodyEl); },
      html: a.icon ? icon(a.icon, 19) : `<span style="font-size:13px;font-weight:700">${typeof a.label === 'string' ? a.label : i18n.bi(a.label)}</span>`,
    })));
  const bodyEl = h('div.app-body', ...body.flat(3));
  const el = h('div.app', bar, tabs, bodyEl, fab ? h('button.app-fab', { onclick: () => { actuate('tap'); fab.run(ctx); }, html: icon(fab.icon || 'plus', 22) }) : null);
  ctx.setTitle(i18n.bi(title) || title);
  return {
    el, bar, body: bodyEl, titleEl,
    setTitle: (t) => { titleEl.textContent = t; ctx.setTitle(t); },
    setSubtitle: (s) => { const n = bar.querySelector('.sub'); if (n) n.textContent = s; },
    setBody: (...nodes) => { clear(bodyEl); bodyEl.append(...nodes.flat(3)); },
  };
}

export const section = (title, ...nodes) => h('div.card', title ? h('h4', i18n.bi(title)) : null, ...nodes.flat(3));
export const group = (...nodes) => h('div.card', { style: { padding: '2px 6px' } }, ...nodes.flat(3));

export function row({ icon: ic = null, title, sub = '', trailing = null, onTap = null, color, danger = false }) {
  const main = h('div.r-main', h('div.r-title', i18n.bi(title)), sub ? h('div.r-sub', i18n.bi(sub)) : null);
  const node = h('button.row', {
    onclick: onTap ? () => { actuate('tap'); onTap(node); } : undefined,
    style: danger ? { color: 'var(--err)' } : null,
  },
    ic ? h('span.r-ico', { style: color ? { background: `linear-gradient(150deg,${color[0]},${color[1]})` } : null, html: icon(ic, 17) }) : null,
    main,
    trailing ? h('span.r-end', trailing) : h('span.r-end', { html: icon('right', 15) }));
  node.setTitle = (t) => { main.querySelector('.r-title').textContent = t; };
  node.setSub = (t) => { const s = main.querySelector('.r-sub'); if (s) s.textContent = t; else main.appendChild(h('div.r-sub', t)); };
  node.setTrailing = (t) => { const e = node.querySelector('.r-end'); e.innerHTML = ''; e.append(typeof t === 'string' ? document.createTextNode(t) : t); };
  return node;
}

export function switchEl(value, onChange) {
  const s = h('button.switch', { class: value ? 'on' : '', role: 'switch', 'aria-checked': String(!!value), type: 'button' });
  s.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = !s.classList.contains('on');
    s.classList.toggle('on', next);
    s.setAttribute('aria-checked', String(next));
    actuate('toggle');
    onChange?.(next);
  });
  s.setValue = (v) => { s.classList.toggle('on', !!v); s.setAttribute('aria-checked', String(!!v)); };
  return s;
}

export function seg(items, active, onPick) {
  const el = h('div.seg', ...items.map((it) => {
    const id = it.id ?? it;
    const label = it.label ?? it;
    const b = h('button', { class: id === active ? 'on' : '', onclick: () => { actuate('toggle'); onPick?.(id); [...el.children].forEach((c) => c.classList.toggle('on', c === b)); } });
    b.append(typeof label === 'string' ? label : i18n.bi(label));
    b.dataset.id = id;
    return b;
  }));
  el.setActive = (id) => [...el.children].forEach((c) => c.classList.toggle('on', c.dataset.id === id));
  return el;
}

export const empty = (ic = 'layers', text = i18n.t('common.empty'), action = null) =>
  h('div.empty', icon(ic, 32), h('span', text), action);

export const kv = (k, v) => h('div.row-flex', { style: { justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: '12.5px' } },
  h('span.muted', k), h('span', { style: { fontWeight: '650', fontFamily: 'ui-monospace,monospace', textAlign: 'right' } }, String(v)));

export function progressbar(pct, color = 'var(--accent)') {
  return h('div', { style: { height: '7px', borderRadius: '9px', background: 'var(--surface-3)', overflow: 'hidden', border: '1px solid var(--line)' } },
    h('i', { style: { display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: 'width .35s' } }));
}

/** Guard wrapper: shows a friendly in-window state when a capability is denied. */
export function needCap(ctx, cap, why, render) {
  return async () => {
    const ok = await ctx.requestCap(cap, why);
    if (!ok) return h('div.empty', icon('shield', 32),
      h('span', i18n.bi({ en: `${cap} permission is required`, si: `${cap} අවසරය අවශ්‍යයි` })),
      h('button.btn.primary', { onclick: () => render()?.then?.((x) => x) || location.reload(), text: i18n.t('common.retry') }));
    return render ? render() : null;
  };
}

export function fmtList(items, { key = 'name', onTap } = {}) {
  return h('div.list', ...items.map((it) => row({ title: it[key], sub: it.sub, onTap: () => onTap?.(it) })));
}
export const i18nBi = (o) => i18n.bi(o);
