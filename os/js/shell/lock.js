/* Dahat OS — shell/lock.js
 * Lock screen: clock, notification peek, PIN keypad (hash stored in the
 * settings store), emergency dialer that bypasses the lock like a real phone.
 */
import { h, icon, clear, drag, fmtTime, pad2, EN_DAYS, EN_MONTHS, SI_DAYS, SI_MONTHS } from '../ui/dom.js';
import { config } from '../kernel/config.js';
import { bus } from '../kernel/bus.js';
import { log } from '../kernel/log.js';
import { power } from '../kernel/power.js';
import { notif } from '../kernel/notify.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { notifNode } from './shade.js';
import { toast } from './dialogs.js';

const EMERGENCY = [
  { n: '119', label: { en: 'Police', si: 'පොලිසිය' } },
  { n: '1990', label: { en: 'Suwasariya (ambulance)', si: 'සුවසිරිය (ඇම්බුලන්ස්)' } },
  { n: '110', label: { en: 'Fire', si: 'ගිනි නිවීම' } },
];

let root = null, node = null, locked = false, pinEntry = '', timer = null, tries = 0;

async function pinHash(pin) {
  const s = `dahat:${pin}`;
  if (crypto?.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  let hsh = 0;
  for (const ch of s) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return hsh.toString(16);
}

export const lockscreen = {
  init() {
    root = document.getElementById('lock-root');
    bus.register('sys.lock', ({ reason = 'api' } = {}) => { this.lock(reason); return { locked: true }; }, { cap: 'settings', desc: 'lock the screen' });
    bus.register('sys.locked', () => ({ locked }));
    let idleTimer = null;
    const arm = () => {
      clearTimeout(idleTimer);
      const mins = Number(config.get('security.autoLockMinutes') ?? 5);
      if (!mins || !config.get('security.pin')) return;
      idleTimer = setTimeout(() => this.lock('idle'), mins * 60000);
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { power.activity(); arm(); }, { passive: true }));
    arm();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && config.get('security.requirePinOnWake') !== false && config.get('security.pin')) this.lock('suspend');
    });
    return this;
  },
  isLocked: () => locked,
  lock(reason = 'user') {
    if (locked) return;
    locked = true; pinEntry = '';
    log.info('shell', `screen locked (${reason})`);
    bus.emit('screen.lock', { reason });
    this.paint();
    root.style.pointerEvents = 'auto';
    root.style.opacity = '1';
  },
  unlock(reason = 'user') {
    locked = false;
    clearInterval(timer); timer = null;
    root.style.pointerEvents = 'none';
    root.style.opacity = '0';
    node?.classList.add('unlock');
    setTimeout(() => { node && clear(root); node = null; }, 340);
    log.info('shell', `screen unlocked (${reason})`);
    bus.emit('screen.unlock', {});
  },
  paint() {
    clear(root);
    const hasPin = !!config.get('security.pin');
    node = h('div#lock');
    const time = h('div.lock-time.num');
    const date = h('div.lock-date');
    const tick = () => {
      const d = new Date();
      time.textContent = fmtTime(d, false);
      const si = i18n.lang === 'si';
      date.textContent = si
        ? `${SI_DAYS[d.getDay()]} ${d.getDate()} ${SI_MONTHS[d.getMonth()]}`
        : `${EN_DAYS[d.getDay()]}, ${EN_MONTHS[d.getMonth()]} ${d.getDate()}`;
    };
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 5000);

    const peek = h('div.lock-body');
    const items = notif.all().filter((n) => !n.read).slice(0, 3);
    if (config.get('qs.dnd')) peek.appendChild(h('div.chip', { style: { alignSelf: 'center' }, html: `${icon('bell-off', 12)} ${i18n.t('qs.dnd')}` }));
    items.forEach((n) => peek.appendChild(notifNode(n, () => this.paint())));

    const hint = h('div.lock-hint', h('span', { html: icon('up', 14) }), hasPin ? i18n.t('lock.enter') : i18n.t('lock.swipe'));

    if (hasPin) {
      const dots = h('div.pin-dots');
      const render = () => { clear(dots); for (let i = 0; i < 4; i++) dots.appendChild(h('i', { class: i < pinEntry.length ? 'on' : '' })); };
      const press = (d) => {
        actuate('tap');
        if (d === 'del') pinEntry = pinEntry.slice(0, -1);
        else if (d === 'ok') submit();
        else if (pinEntry.length < 4) pinEntry += d;
        render();
      };
      const submit = async () => {
        const ok = (await pinHash(pinEntry)) === config.get('security.pin');
        if (ok) { tries = 0; actuate('open'); this.unlock('pin'); }
        else {
          tries++;
          actuate('error');
          pad.classList.remove('shake'); void pad.offsetWidth; pad.classList.add('shake');
          toast(`${i18n.t('lock.wrong')}${tries > 2 ? ` · ${tries - 2}` : ''}`);
          pinEntry = ''; render();
          if (tries === 5) log.warn('shell', '5 failed unlock attempts');
        }
      };
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
      const pad = h('div.pin-pad', ...keys.map((k) => h('button.pin-key', {
        onclick: () => press(k),
        html: k === 'del' ? icon('backspace', 22) : k === 'ok' ? icon('check', 22) : k,
      })));
      node.appendChild(h('div', { style: { height: '18px' } }));
      node.appendChild(time); node.appendChild(date);
      node.appendChild(h('div', { style: { marginTop: '26px', fontWeight: '700', fontSize: '13px' } }, i18n.t('lock.enter')));
      node.appendChild(dots); render();
      node.appendChild(pad);
      node.appendChild(h('div.lock-foot', { style: { marginTop: '18px' } },
        h('button.btn.text', { onclick: () => emergency(), html: `${icon('phone', 15)} ${i18n.t('lock.emergency')}` })));
      root.appendChild(node);
    } else {
      node.appendChild(h('div', { style: { height: '8vh' } }));
      node.appendChild(time); node.appendChild(date);
      node.appendChild(peek);
      node.appendChild(h('div.lock-foot', hint,
        h('div.row-flex', { style: { gap: '10px' } },
          h('button.btn.icon', { style: { background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)' }, onclick: () => { const m = import('./shade.js'); m.then((x) => { this.unlock('shade'); x.shade.open(); }); }, html: icon('apps', 18) }),
          h('button.btn.icon', { style: { background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)' }, onclick: () => emergency(), html: icon('phone', 18) }))));
      drag(node, {
        axis: 'y',
        onMove: (dx, dy) => { if (dy < 0) node.style.transform = `translateY(${dy * 0.6}px)`; },
        onEnd: ({ dy, dt }) => {
          node.style.transform = '';
          if (dy < -60 || (dy < -22 && dt < 300)) { actuate('open'); this.unlock('swipe'); }
        },
      });
      root.appendChild(node);
    }
  },
  async setPin(pin) {
    if (!pin) { await config.set('security.pin', null); log.info('security', 'PIN removed'); return; }
    await config.set('security.pin', await pinHash(String(pin)));
    log.info('security', `screen PIN set (${String(pin).length} digits)`);
  },
  hasPin: () => !!config.get('security.pin'),
};

async function emergency() {
  const { sheet } = await import('./dialogs.js');
  const v = await sheet(h('div.list', ...EMERGENCY.map((e) => h('button.row', {
    onclick: () => { document.querySelector('.scrim')?.__done?.(e.n); },
  }, h('span.r-ico', { html: icon('phone', 17), style: { background: 'rgba(245,98,108,.18)', color: 'var(--err)' } }),
    h('span.r-main', h('span.r-title', i18n.bi(e.label)), h('span.r-sub', `+94 ${e.n}`)), h('span.r-end', `${e.n}`)))),
  { title: i18n.t('lock.emergency') });
  if (v) {
    power.activity();
    bus.call('app.dial', { number: String(v) }, { appId: 'system', pid: 'kernel' });
  }
}
export { pad2 };

