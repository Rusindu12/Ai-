/* Dahat OS — shell/shade.js
 * Notification shade + quick settings. Tiles that can act on the real world do
 * (dark mode, haptics, sound, torch, doze, wake-lock, rotation, dimmer); the
 * airplane tile is a genuine kernel switch — while it is on, the `network`
 * capability is refused for every app.
 */
import { h, icon, drag, fmtAgo, clear } from '../ui/dom.js';
import { bus } from '../kernel/bus.js';
import { notif } from '../kernel/notify.js';
import { power } from '../kernel/power.js';
import { config } from '../kernel/config.js';
import { log } from '../kernel/log.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { byId } from '../kernel/packages.js';
import { confirm } from './dialogs.js';

let root = null, panel = null, listEl = null, open = false, dragPx = 0, torchTrack = null, dimmer = null;
const tiles = [];

export const shade = {
  init() {
    root = document.getElementById('shade-root');
    panel = h('div#shade');
    root.appendChild(panel);
    const dragHandle = h('div', { style: { position: 'absolute', top: '0', left: '0', right: '0', height: '46px', zIndex: '2', cursor: 'grab' } });
    drag(dragHandle, {
      axis: 'y',
      onStart: () => { dragPx = open ? 0 : -9999; },
      onMove: (dx, dy) => { if (open) { if (dy > 0) this.translate(-dy); } else if (dy > 0) this.preview(dy / (innerHeight * 0.62)); },
      onEnd: ({ dy, dt }) => {
        if (open) this.snap(dy < -70 || (dy < -20 && dt < 260) ? false : true);
        else this.snap(this.percent > 0.32 || dy > 40);
        this.translate(0);
      },
    });
    root.appendChild(dragHandle);
    notif.onChange(() => { if (open) this.paint(); });
    config.onChange(() => { if (open) this.paint(); });
    power.onChange(() => { if (open) this.paint(); });
    return this;
  },
  isOpen: () => open,
  percent: 0,
  translate(px) { if (panel) panel.style.transform = `translateY(${px}px)`; },
  preview(p) { this.percent = Math.max(0, Math.min(1, p)); panel.classList.add('open'); panel.style.transform = `translateY(${-100 + this.percent * 100}%)`; panel.style.transition = 'none'; },
  snap(shouldOpen) { if (shouldOpen) this.open(); else this.close(); },
  toggle() { open ? this.close() : this.open(); },
  open() {
    open = true; this.percent = 1;
    this.paint();
    panel.style.transition = '';
    panel.style.transform = '';
    panel.classList.add('open');
    panel.scrollIntoView?.();
  },
  close() {
    open = false; this.percent = 0;
    panel.style.transition = '';
    panel.classList.remove('open');
    panel.style.transform = '';
  },
  paint() {
    const p = panel;
    clear(p);
    p.appendChild(h('div.row-flex', { style: { justifyContent: 'space-between', alignItems: 'center' } },
      h('span', { style: { fontWeight: '800', fontSize: '14px' } }, i18n.t('shade.notifs')),
      h('div.row-flex', { style: { gap: '6px' } },
        h('button.btn.text', { style: { minHeight: '30px', padding: '4px 8px', fontSize: '12px' }, onclick: () => { notif.markAllRead(); this.paint(); } }, i18n.t('notif.readAll')),
        h('button.btn.text', { style: { minHeight: '30px', padding: '4px 8px', fontSize: '12px' }, onclick: async () => { if (await confirm({ title: i18n.t('notif.clearAll'), body: i18n.bi({ en: 'Remove every notification?', si: 'සියලු දැනුම්දීම් ඉවත් කරන්නද?' }) })) { notif.clear(); this.paint(); } } }, i18n.t('notif.clearAll')))));
    listEl = h('div.notif-list');
    const items = notif.all();
    if (!items.length) listEl.appendChild(h('div.empty', icon('bell', 30), h('span', i18n.t('notif.none'))));
    items.slice(0, 24).forEach((n) => listEl.appendChild(notifNode(n, () => this.paint())));
    p.appendChild(listEl);

    // ---- quick settings grid
    const grid = h('div.qs-grid');
    tiles.length = 0;
    const T = (id, ico, label, on, onTap, wide) => tiles.push({ id, ico, label, on, onTap, wide });
    T('dark', config.get('display.theme') === 'dark' ? 'moon' : 'sun', i18n.t('qs.dark'), config.get('display.theme') === 'dark',
      () => config.set('display.theme', config.get('display.theme') === 'dark' ? 'light' : 'dark'));
    T('dnd', 'bell-off', i18n.t('qs.dnd'), !!config.get('qs.dnd'), () => config.set('qs.dnd', !config.get('qs.dnd')));
    T('airplane', 'zap', i18n.t('qs.airplane'), !!config.get('net.airplane'), async () => {
      const next = !config.get('net.airplane');
      if (next) {
        const ok = await confirm({ title: i18n.t('qs.airplane'), body: i18n.bi({ en: 'The kernel will refuse the “network” capability for every app and links stop opening externally.', si: 'සියලු ඇප් වලට “ජාලය” අයිතිවාසිකම ප්‍රතික්ෂේප කෙරේ. බාහිර සබැඳි විවෘත නොවේ.' }), ok: next ? 'Turn on' : 'OK' });
        if (!ok) return;
      }
      config.set('net.airplane', next);
      log.info('power', next ? 'airplane mode ON — network capability denied kernel-wide' : 'airplane mode OFF');
      bus.emit('ui.toast', { message: next ? i18n.bi({ en: 'Airplane: apps cannot reach the network', si: 'ගුවන් ප්‍රකාරය: ඇප් ජාලයට යා නොහැක' }) : '' });
    });
    T('save', 'battery', i18n.t('qs.save'), !!config.get('power.manualSave'), () => {
      const next = !config.get('power.manualSave');
      config.set('power.manualSave', next);
      power.setPowerSave(next);
    });
    T('doze', 'moon', i18n.t('qs.doze'), config.get('power.doze') !== false, () => config.set('power.doze', !(config.get('power.doze') !== false)));
    T('haptics', 'volume', i18n.t('qs.haptics'), config.get('input.haptics') !== false, () => config.set('input.haptics', !(config.get('input.haptics') !== false)));
    T('sound', 'music', i18n.t('qs.sound'), config.get('input.sound') !== false, () => config.set('input.sound', !(config.get('input.sound') !== false)));
    T('wake', 'eye', i18n.bi({ en: 'Keep awake', si: 'තිරය සජීවී' }), !!config.get('power.wakelockOn'), async () => {
      const next = !config.get('power.wakelockOn');
      config.set('power.wakelockOn', next);
      await power.wakeLock(next);
    });
    T('rotate', 'refresh', i18n.t('qs.rotate'), !!config.get('display.rotateLock'), async () => {
      const next = !config.get('display.rotateLock');
      config.set('display.rotateLock', next);
      try { if (next && screen.orientation?.lock) await screen.orientation.lock(screen.orientation.type.replace(/(-reverse)?$/, '')); if (!next && screen.orientation?.unlock) screen.orientation.unlock(); }
      catch (e) { log.debug('shell', `orientation lock unavailable (${e.message})`); }
    });
    T('torch', 'sun', i18n.t('qs.torch'), !!config.get('qs.torch'), async () => {
      const next = !config.get('qs.torch');
      try {
        if (next) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          torchTrack = stream.getVideoTracks()[0];
          await torchTrack.applyConstraints({ advanced: [{ torch: true }] });
          config.set('qs.torch', true);
          log.info('shell', 'torch enabled via camera track');
        } else {
          if (torchTrack) { await torchTrack.applyConstraints({ advanced: [{ torch: false }] }); torchTrack.stop(); torchTrack = null; }
          config.set('qs.torch', false);
        }
      } catch (e) {
        bus.emit('ui.toast', { message: i18n.bi({ en: 'This device exposes no torch to the OS', si: 'මෙම උපාංගයේ දීප්තිය OS වෙත ලබා දෙන්නේ නැත' }) });
        log.debug('shell', `torch unavailable: ${e.message}`);
      }
      this.paint();
    });
    T('lock', 'lock', i18n.bi({ en: 'Lock', si: 'අගුළු' }), false, async () => {
      this.close();
      const m = await import('./lock.js');
      m.lockscreen.lock('quick settings');
    }, true);
    T('power', 'power', i18n.bi({ en: 'Power menu', si: 'බල මෙනුව' }), false, async () => {
      this.close();
      const m = await import('./dialogs.js');
      await m.sheet(h('div.list',
        rowBtn('lock', i18n.bi({ en: 'Lock screen', si: 'තිරය අගුළු දමන්න' }), async () => { document.querySelector('.scrim')?.__done?.(); const l = await import('./lock.js'); l.lockscreen.lock('power menu'); }),
        rowBtn('settings', i18n.bi({ en: 'Open Settings', si: 'සැකසුම් විවෘත කරන්න' }), async () => { document.querySelector('.scrim')?.__done?.(); bus.call('app.open', { id: 'settings' }, { appId: 'system', pid: 'kernel' }); }),
        rowBtn('restart', i18n.bi({ en: 'Restart OS', si: 'OS නැවත ආරම්භ කරන්න' }), async () => { location.reload(); }),
        rowBtn('power', i18n.bi({ en: 'Reboot to Android', si: 'Android වෙත යන්න' }), async () => {
          if (self.DahatBridge?.exitLauncher) { self.DahatBridge.exitLauncher(); return; }
          document.querySelector('.scrim')?.__done?.();
          bus.emit('ui.toast', { message: i18n.bi({ en: 'Only available inside the Dahat Launcher APK', si: 'දහත් ලෝන්චර් APK එකේදී පමණක් ලබා ගත හැක' }) });
        })
      ), { title: i18n.bi({ en: 'Power', si: 'බලය' }) });
    });
    tiles.filter((t) => t.id !== 'torch').forEach((t) => {
      const node = h(`button.qs-tile${t.wide ? '.wide' : ''}${t.on ? '.on' : ''}`, { onclick: () => { actuate('toggle'); t.onTap(); this.paint(); } },
        h('span', { html: icon(t.ico, 18) }), h('span', t.label),
        t.wide ? h('span', { style: { fontSize: '10px', opacity: '.8' }, text: t.on ? 'ON' : 'OFF' }) : null);
      grid.appendChild(node);
    });
    p.appendChild(grid);

    // ---- sliders
    const sliders = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
    sliders.appendChild(h('div.qs-slider', h('span', { html: icon('sun', 17) }),
      h('input', { type: 'range', min: '35', max: '100', value: String(config.get('display.brightness') ?? 100), oninput: (e) => setDim(e.target.value), onchange: (e) => { config.set('display.brightness', Number(e.target.value)); } })));
    sliders.appendChild(h('div.qs-slider', h('span', { html: icon('volume', 17) }),
      h('input', { type: 'range', min: '0', max: '100', value: String(Math.round((config.get('input.volume') ?? 1) * 100)), oninput: (e) => { config.set('input.volume', Number(e.target.value) / 100, { silent: true }); bus.emit('volume', { v: Number(e.target.value) / 100 }); }, onchange: (e) => { config.set('input.volume', Number(e.target.value) / 100); actuate('tap'); } })));
    p.appendChild(sliders);
  },
};
function rowBtn(ico, label, onclick) {
  return h('button.row', { onclick }, h('span.r-ico', { html: icon(ico, 17), style: { background: 'var(--surface-3)', color: 'var(--text)' } }), h('span.r-title', label));
}
function setDim(v) {
  const pct = Number(v);
  if (!dimmer) {
    dimmer = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '999', background: '#000', opacity: '0', transition: 'opacity .18s' } });
    document.getElementById('screen').appendChild(dimmer);
  }
  dimmer.style.opacity = String(Math.max(0, (100 - pct) / 220));
}
export function notifNode(n, refresh) {
  const pkg = byId(n.appId);
  const node = h('div.notif',
    h('span.n-ico', { style: { '--c1': pkg?.color?.[0], '--c2': pkg?.color?.[1], background: `linear-gradient(150deg,${pkg?.color?.[0] || '#33404f'},${pkg?.color?.[1] || '#1a212a'})` }, html: icon(n.icon || pkg?.icon || 'bell', 15) }),
    h('div.n-body',
      h('div.row-flex', { style: { gap: '6px' } }, h('span.n-title', { style: { flex: '1' } }, n.title), h('span.n-time', fmtAgo(n.at, i18n.lang))),
      h('div.n-text', n.body),
      n.actions?.length ? h('div.row-flex', { style: { gap: '6px', marginTop: '7px' } }, ...n.actions.map((a) =>
        h('button.btn', { style: { minHeight: '30px', padding: '5px 10px', fontSize: '12px' }, onclick: () => { a.run?.(n); notif.dismiss(n.id); refresh?.(); } }, a.label))) : null),
    h('button.n-x', { onclick: () => { notif.dismiss(n.id); refresh?.(); }, html: icon('x', 14) }));
  node.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    notif.markRead(n.id);
    if (n.appId) bus.call('app.open', { id: n.appId, params: n.tapTo || null }, { appId: 'system', pid: 'kernel' });
    refresh?.();
  });
  drag(node, {
    axis: 'x',
    onMove: (dx) => { node.style.transform = `translateX(${dx * 0.6}px)`; node.style.opacity = String(1 - Math.min(1, Math.abs(dx) / 260)); },
    onEnd: ({ dx }) => {
      if (Math.abs(dx) > 90) { notif.dismiss(n.id); }
      node.style.transform = ''; node.style.opacity = '';
      refresh?.();
    },
  });
  return node;
}

