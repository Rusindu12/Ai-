/* Dahat OS — shell/statusbar.js
 * The 30px strip of truth: time, radio state, capability activity, battery.
 * Drag down from the top (or tap) to open the shade.
 */
import { h, icon, fmtTime, pad2, drag } from '../ui/dom.js';
import { power } from '../kernel/power.js';
import { bus } from '../kernel/bus.js';
import { config } from '../kernel/config.js';
import { log } from '../kernel/log.js';
import { i18n } from '../ui/i18n.js';
import { EN_DAYS, EN_MONTHS, SI_DAYS, SI_MONTHS } from '../ui/dom.js';

let el = null, clock = null, sysicons = null, bat = null, batFill = null, timer = null;
let shadeRef = null;

export const statusbar = {
  init(shade) {
    shadeRef = shade;
    el = document.getElementById('status-root');
    clock = h('span.num', { style: { fontWeight: '700' } });
    sysicons = h('span.row-flex', { style: { gap: '5px' } });
    batFill = h('i.bat-fill');
    bat = h('span.bat', h('span.bat-body', batFill), h('span.num', { style: { fontSize: '11px' } }));
    el.appendChild(clock);
    el.appendChild(h('span.grow'));
    el.appendChild(sysicons);
    el.appendChild(bat);

    const paint = () => this.update();
    this.update();
    timer = setInterval(paint, 1000);
    power.onChange(paint);
    bus.on('net.change', paint);
    bus.on('caps.change', paint);
    bus.on('theme.change', paint);

    drag(el, {
      onMove: (dx, dy) => { if (dy > 6 && !shadeRef.isOpen()) shadeRef.preview(Math.min(1, dy / (el.clientHeight + 260))); },
      onEnd: ({ dy, dt }) => { shadeRef.snap(dy > 90 || (dy > 24 && dt < 300)); },
    });
    el.addEventListener('click', () => shadeRef.toggle());
    log.info('shell', 'status bar online');
    return this;
  },
  update() {
    if (!el) return;
    const d = new Date();
    const secs = config.get('display.showSeconds');
    clock.textContent = fmtTime(d, secs);
    const si = i18n.lang === 'si';
    if (!secs) {
      clock.parentElement.querySelector('.clock-date')?.remove();
      const dt = h('span.clock-date.tiny', { style: { opacity: '.8', fontWeight: '600' } },
        si ? `${SI_DAYS[d.getDay()]} ${d.getDate()} ${SI_MONTHS[d.getMonth()]}` : `${EN_DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${EN_MONTHS[d.getMonth()].slice(0, 3)}`);
      dt.style.fontSize = '10.5px';
      el.insertBefore(dt, clock.nextSibling);
    } else el.querySelector('.clock-date')?.remove();

    const on = navigator.onLine !== false && !config.get('net.airplane');
    const ic = [];
    if (config.get('net.airplane')) ic.push(sw('zap', 'airplane mode — kernel denies `network`'));
    else ic.push(sw('wifi', on ? 'network up' : 'network down'));
    if (config.get('qs.dnd')) ic.push(sw('bell-off', 'focus mode'));
    if (config.get('power.wakelockOn')) ic.push(sw('zap', 'screen held awake'));
    if (config.get('net.bluetooth')) ic.push(sw('bluetooth', 'bluetooth on'));
    sysicons.innerHTML = ic.join('');

    const st = power.status;
    const lvl = st.level == null ? 0.82 : st.level;
    bat.style.setProperty('--lvl', `${Math.round(lvl * 100)}%`);
    bat.classList.toggle('charging', !!st.charging);
    bat.querySelector('.num').textContent = `${Math.round(lvl * 100)}%`;
    bat.title = st.charging ? 'charging' : 'on battery';
  },
  destroy() { clearInterval(timer); },
};
const sw = (name, title) => `<span class="sys-ico" title="${title}">${icon(name, 15)}</span>`;
export { pad2 };
