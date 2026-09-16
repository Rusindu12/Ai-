/* Dahat OS — shell/heads-up.js
 * The transient banner for a new notification. Honours Focus mode (DND): while
 * it is on, notifications still land in the shade but never interrupt.
 */
import { h, icon, drag } from '../ui/dom.js';
import { bus } from '../kernel/bus.js';
import { config } from '../kernel/config.js';
import { byId } from '../kernel/packages.js';
import { i18n } from '../ui/i18n.js';
import { play, actuate } from '../ui/audio.js';
import { notif } from '../kernel/notify.js';

let host = null;

export function initHeadsUp() {
  host = document.getElementById('shade-root');
  bus.on('notif.heads', (n) => show(n));
}

export function show(n) {
  if (!host) return;
  if (config.get('qs.dnd') && n.importance !== 'max') return;
  const pkg = byId(n.appId);
  const el = h('div.notif', {
    style: {
      position: 'absolute', left: '10px', right: '10px', top: 'calc(var(--status-h) + 6px)', zIndex: '70',
      boxShadow: 'var(--shadow)', transform: 'translateY(-140%)', opacity: '0', transition: 'transform .26s cubic-bezier(.2,.9,.25,1),opacity .26s',
    },
  },
    h('span.n-ico', { style: { background: `linear-gradient(150deg,${pkg?.color?.[0] || '#33404f'},${pkg?.color?.[1] || '#1a212a'})` }, html: icon(n.icon || pkg?.icon || 'bell', 15) }),
    h('div.n-body',
      h('div.row-flex', { style: { gap: '6px' } }, h('span.n-title', { style: { flex: '1' } }, n.title), h('span.n-time', i18n.bi({ en: 'now', si: 'දැන්' }))),
      h('div.n-text', n.body)),
    h('button.n-x', { html: icon('x', 14) }));
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.transform = ''; el.style.opacity = '1'; });
  if (config.get('input.sound') !== false) play('notify');
  actuate('notify');
  let closed = false;
  const dismiss = (openShade) => {
    if (closed) return;
    closed = true;
    el.style.transform = 'translateY(-140%)'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
    if (openShade) import('./shade.js').then((m) => m.shade.open());
  };
  el.querySelector('.n-x').addEventListener('click', (e) => { e.stopPropagation(); dismiss(false); });
  el.addEventListener('click', () => {
    notif.markRead(n.id);
    dismiss(false);
    if (n.appId) bus.call('app.open', { id: n.appId, params: n.tapTo || null }, { appId: 'system', pid: 'kernel' });
  });
  drag(el, { axis: 'y', onMove: (dx, dy) => { if (dy < 0) el.style.transform = `translateY(${dy}px)`; }, onEnd: ({ dy }) => { if (dy < -40) dismiss(false); else { el.style.transform = ''; el.style.opacity = '1'; } } });
  setTimeout(() => dismiss(false), 4200);
}
