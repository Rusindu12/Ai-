/* Dahat OS — shell/dialogs.js
 * Alerts, text prompts, bottom sheets, permission prompts and the toast rail.
 * Everything is modal-over-the-OS (not inside a window) so a crashed app can
 * never trap the user.
 */
import { h, icon, clear, fmtAgo } from '../ui/dom.js';
import { CAPS } from '../kernel/caps.js';
import { byId } from '../kernel/packages.js';
import { log } from '../kernel/log.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';

let root = null;

function ensureRoot() {
  if (!root || !root.isConnected) root = document.getElementById('dialog-root');
  return root;
}
function close() {
  const r = ensureRoot();
  if (r) clear(r);
}

/** low-level: mount a scrim with a node, resolve on dismiss.
 * Each dialog owns its scrim: dismissing one must never strand another (and must
 * never leave its caller awaiting a promise that can no longer resolve). */
export function modal(node, { dismissible = true, onDismiss } = {}) {
  return new Promise((resolve) => {
    const r = ensureRoot();
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      scrim.remove();
      onDismiss?.(v);
      resolve(v);            // even if a newer dialog already replaced us
    };
    const done = (v) => {
      if (settled) return;
      if (!scrim.isConnected) return finish(v);
      scrim.classList.add('out');
      setTimeout(() => finish(v), 160);
    };
    const scrim = h('div.scrim', { onclick: (e) => { if (e.target === scrim && dismissible) done(null); } }, node);
    node.__done = done;
    scrim.__done = done;      // callers elsewhere use document.querySelector('.scrim')?.__done?.()
    r.appendChild(scrim);
  });
}

export function confirm({ title, body = '', ok = null, cancel = null, danger = false, html = null }) {
  return new Promise((resolve) => {
    const d = h('div.dialog',
      h('h3', title),
      body ? h('p', body) : null,
      html,
      h('div.actions',
        h('button.btn.text', { onclick: () => { d.__done(false); } }, cancel || i18n.t('common.cancel')),
        h(`button.btn${danger ? '' : '.primary'}`, { style: danger ? { color: 'var(--err)', borderColor: 'var(--err)' } : null, onclick: () => { d.__done(true); } }, ok || i18n.t('common.ok')))
    );
    modal(d).then((v) => resolve(v === true));
  });
}

export function prompt({ title, label = '', value = '', placeholder = '', multiline = false, type = 'text', ok = null, hint = '' }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea.input', { rows: 6, placeholder, value })
      : h('input.input', { type, placeholder, value, autocomplete: 'off' });
    const d = h('div.dialog',
      h('h3', title),
      label ? h('p', label) : null,
      input,
      hint ? h('p.tiny.muted', { style: { margin: '8px 0 0' } }, hint) : null,
      h('div.actions', { style: { marginTop: '14px' } },
        h('button.btn.text', { onclick: () => d.__done(null) }, i18n.t('common.cancel')),
        h('button.btn.primary', { onclick: () => d.__done(input.value) }, ok || i18n.t('common.ok')))
    );
    modal(d).then((v) => { input.remove(); resolve(v); });
    setTimeout(() => input.focus(), 60);
  });
}

export function sheet(content, { title = '', actions = [] } = {}) {
  return new Promise((resolve) => {
    const s = h('div.sheet', h('div.grab'), title ? h('h3', { style: { margin: '0 0 10px', fontSize: '17px' } }, title) : null, content,
      actions.length ? h('div.row-flex', { style: { gap: '8px', marginTop: '12px' } }, ...actions.map((a) => h('button.btn', { onclick: () => { s.__done(a.id ?? true); } }, a.label))) : null);
    modal(s, { dismissible: true }).then(resolve);
  });
}

/** the capability prompt — the most important dialog in the OS */
export function permPrompt(appId, cap, why = '') {
  const pkg = byId(appId) || { name: appId, icon: 'apps' };
  const c = CAPS[cap] || { en: cap, si: cap, desc: { en: why, si: why } };
  return new Promise((resolve) => {
    let decided = false;
    const d = h('div.dialog',
      h('div.row-flex', { style: { gap: '10px', marginBottom: '10px' } },
        h('span.r-ico', { style: { '--c1': pkg.color?.[0] || '#33404f', '--c2': pkg.color?.[1] || '#1a212a', width: '40px', height: '40px', borderRadius: '13px', background: `linear-gradient(150deg,${pkg.color?.[0] || '#33404f'},${pkg.color?.[1] || '#1a212a'})`, display: 'grid', placeItems: 'center' }, html: icon(pkg.icon || 'apps', 20) }),
        h('div', h('div', { style: { fontWeight: '700', fontSize: '15px' } }, i18n.t('perm.title', { app: i18n.bi(pkg.name) })), h('div.tiny.muted', pkg.kind === 'bazaar' ? 'installed by you · 3rd-party' : 'part of Dahat OS'))
      ),
      h('div.card', { style: { margin: '0 0 12px', display: 'flex', gap: '10px', alignItems: 'center' } },
        h('span.r-ico', { html: icon(c.icon || 'shield', 18), style: { background: 'var(--surface-3)', color: 'var(--accent)' } }),
        h('div', h('div', { style: { fontWeight: '700' } }, i18n.bi({ en: c.en, si: c.si })), h('div.tiny.muted', i18n.bi(c.desc)))),
      why ? h('p.tiny.muted', { style: { margin: '0 0 12px' } }, why) : null,
      h('div.actions',
        h('button.btn', { onclick: () => { decided = true; d.__done(false); } }, i18n.t('perm.deny')),
        h('button.btn.primary', { onclick: () => { decided = true; d.__done(true); } }, i18n.t('perm.allow')))
    );
    modal(d, { dismissible: true, onDismiss: () => { if (!decided) { log.info('caps', `${appId} ignored the ${cap} prompt → denied`); resolve(false); } } }).then((v) => resolve(v === true));
    actuate('notify');
  });
}

export function logSheet(domain) {
  const lines = log.tail(120, domain ? { domain } : {}).map((e) =>
    h('div.mono', { style: { padding: '3px 0', borderBottom: '1px solid var(--line)', color: e.level === 'err' ? 'var(--err)' : e.level === 'warn' ? 'var(--warn)' : 'var(--text-2)' } },
      `${fmtAgo(e.ts, i18n.lang)} · ${e.domain}: ${e.msg}`));
  return sheet(h('div', lines.length ? lines : h('div.empty', 'log is empty')), { title: domain ? `log · ${domain}` : 'kernel log' });
}

export function listSheet(title, items) {
  const rows = items.map((it) => h('button.row', {
    onclick: () => {
      const d = document.querySelector('.scrim');
      d?.__done?.(it.id);
      it.onTap?.();
    },
  },
    it.icon ? h('span.r-ico', { html: icon(it.icon, 17), style: { background: 'var(--surface-3)', color: 'var(--text)' } }) : null,
    h('span.r-title', it.label)));
  return sheet(h('div.list', ...rows), { title });
}

export function initToasts() {
  const r = document.getElementById('toast-root');
  bus_onToast((msg, ms) => {
    const el = h('div.snack', msg);
    r.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s,transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 300); }, ms || 1800);
    while (r.children.length > 3) r.firstChild.remove();
  });
}
let toastHandler = null;
function bus_onToast(fn) { toastHandler = fn; }
export function toast(message, ms) { toastHandler?.(String(message), ms); }

// wire the bus topic (kept out of the kernel to avoid an import cycle)
import { bus } from '../kernel/bus.js';
bus.on('ui.toast', ({ message, ms }) => toast(message, ms));
