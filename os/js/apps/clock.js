/* Dahat OS — Clock: alarms, stopwatch, timer, world clock.
 * Alarms are fired by this app, not by a background daemon: the kernel
 * suspends suspended processes, so the OS also warns you when doze may miss a
 * scheduled alarm (a real Android trade-off, reproduced honestly).
 */
import { h, icon, clear, fmtDur, pad2 } from '../ui/dom.js';
import { scaffold, seg, row, switchEl, section, empty } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';
import { bus } from '../kernel/bus.js';
import { prompt, confirm, toast } from '../shell/dialogs.js';

const B = (en, si) => i18n.bi({ en, si });

export default {
  id: 'clock',
  create(ctx) {
    let tab = 'alarm';
    const ui = scaffold(ctx, { title: B('Clock', 'නාලිකාව'), back: false });
    const segEl = seg([{ id: 'alarm', label: B('Alarm', 'ඇලාරම්') }, { id: 'stop', label: B('Stopwatch', 'වේග ඔරලෝසුව') }, { id: 'timer', label: B('Timer', 'ටයිමරය') }, { id: 'world', label: B('World', 'ලෝකය') }], tab, (v) => { tab = v; paint(); });
    const page = h('div');
    ui.setBody(segEl, page);
    let alarms = [];
    ctx.api.store.get('alarms').then((v) => { if (Array.isArray(v)) { alarms = v; paint(); } });

    // ---- stopwatch
    let swT = 0, swOn = false, swLaps = [], swRaf = null, swLast = 0;
    const swBig = h('div.num', { style: { fontSize: '44px', fontWeight: '200', textAlign: 'center', padding: '18px 0 4px' } }, '00:00.0');
    const lapBox = h('div', { style: { marginTop: '10px' } });
    const swLoop = (t) => {
      if (!swOn) return;
      if (!swLast) swLast = t;
      swT += t - swLast; swLast = t;
      swBig.textContent = swFmt(swT);
      swRaf = requestAnimationFrame(swLoop);
    };
    const swFmt = (ms) => `${pad2(Math.floor(ms / 60000))}:${pad2(Math.floor(ms / 1000) % 60)}.${pad2(Math.floor((ms % 1000) / 10))}`;

    // ---- timer
    let tEnd = 0, tLeft = 0, tInt = null, tWake = false;
    const tBig = h('div.num', { style: { fontSize: '50px', fontWeight: '200', textAlign: 'center', padding: '22px 0 6px' } }, '05:00');
    const tBar = h('div', { style: { height: '6px', borderRadius: '9px', background: 'var(--surface-3)', overflow: 'hidden', margin: '6px 0 12px' } }, h('i', { style: { display: 'block', height: '100%', width: '100%', background: 'var(--accent)' } }));
    const tTotal = { v: 300000 };

    function paint() {
      clear(page);
      if (tab === 'alarm') page.appendChild(alarmView());
      if (tab === 'stop') page.appendChild(stopView());
      if (tab === 'timer') page.appendChild(timerView());
      if (tab === 'world') page.appendChild(worldView());
    }

    function alarmView() {
      const list = h('div.list');
      if (!alarms.length) list.appendChild(empty('clock', B('no alarms yet', 'තවම ඇලාරම් නැත')));
      alarms.forEach((a, i) => {
        list.appendChild(row({
          icon: a.on ? 'bell' : 'bell-off',
          color: a.on ? ['#12b7a2', '#063d37'] : ['#5b6b80', '#1b222c'],
          title: a.time,
          sub: `${a.label || B('alarm', 'ඇලාරම්')} · ${(a.days || '').join(' ') || B('once', 'එක් වරක්')}${a.on && a.via === 'native' ? ` · ⏰ ${B('armed in Android', 'Android හි සැකසූ')}` : ''}`,
          trailing: switchEl(a.on, (v) => { a.on = v; save(); paint(); }),
          onTap: async () => {
            const v = await confirm({ title: `${B('Delete alarm', 'ඇලාරම් මකන්න')} ${a.time}?`, danger: true, ok: B('Delete', 'මකන්න') });
            if (v) { disarm(a); alarms.splice(i, 1); save(); paint(); }
          },
        }));
      });
      const add = h('button.btn.primary.block', {
        style: { marginTop: '14px' }, text: `＋ ${B('Add alarm', 'ඇලාරමක් එක් කරන්න')}`,
        onclick: async () => {
          const t = await prompt({ title: B('Alarm time', 'වේලාව'), placeholder: '06:30', hint: '24-hour HH:MM', value: '06:30' });
          if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return;
          const label = await prompt({ title: B('Label', 'නම'), placeholder: B('wake up', 'අවදි වන්න') });
          alarms.push({ time: t.padStart(5, '0'), label: label || '', on: true, days: [] });
          alarms.sort((x, y) => x.time.localeCompare(y.time));
          save(); paint();
          if (configDoze()) toast(B('Heads up: with Doze on and the app closed, alarms can be late. Tap the ⚡ tile to hold a wake lock.', 'සටහන: නිදාගැනීම සක්‍රීයව ඇතිවිට ඇලාරම් ප්‍රමාද විය හැක.'));
        },
      });
      const note = h('p.tiny.muted', { style: { marginTop: '10px' } },
        B(alarms.some((a) => a.on && a.via === 'native')
          ? 'These alarms are armed in Android itself — they fire even with Dahat closed. In the browser they only ring while the tab is open.'
          : 'Alarms ring while Dahat is open. Install the launcher APK and the same alarm is armed in Android, so it still fires when the OS is closed.',
          'දහත් විවෘතව තිබියදී ඇලාරම් හඬයි. ලෝන්චර් APK එක ස්ථාපනය කළ විට එම ඇලාරම Android හමෙ සකසන නිසා OS එක වසා තිබියදීත් හඬයි.'));
      return h('div', list, add, note);
    }
    const configDoze = () => true;

    function stopView() {
      const btns = h('div.row-flex', { style: { gap: '8px', justifyContent: 'center', marginTop: '10px' } },
        h('button.btn.primary', { style: { minWidth: '110px' }, text: swOn ? B('Stop', 'නවත්වා') : B('Start', 'ඇරඹුම්'), onclick: () => {
          swOn = !swOn; swLast = 0; actuate('toggle');
          if (swOn) swRaf = requestAnimationFrame(swLoop); else cancelAnimationFrame(swRaf);
          btns.querySelector('button').textContent = swOn ? B('Stop', 'නවත්වා') : B('Start', 'ඇරඹුම්');
          ctx.api.power.wake(swOn).catch(() => {});
        } }),
        h('button.btn', { text: B('Lap', 'චක්‍රය'), onclick: () => { if (!swOn) return; swLaps.unshift({ n: swLaps.length + 1, ms: swT }); paintLaps(); } }),
        h('button.btn', { text: B('Reset', 'යළි'), onclick: () => { swOn = false; swT = 0; swLaps = []; cancelAnimationFrame(swRaf); swBig.textContent = '00:00.0'; paintLaps(); } }));
      const paintLaps = () => {
        clear(lapBox);
        if (!swLaps.length) lapBox.appendChild(h('div.tiny.muted', { style: { textAlign: 'center' } }, B('no laps', 'චක්‍ර නැත')));
        swLaps.forEach((l, i) => lapBox.appendChild(h('div.row-flex', { style: { justifyContent: 'space-between', padding: '6px 2px', borderBottom: '1px solid var(--line)', fontFamily: 'ui-monospace,monospace', fontSize: '12.5px' } },
          h('span', `#${l.n}`), h('span', swFmt(l.ms)), h('span.muted', `+${swFmt(l.ms - (swLaps[i + 1]?.ms || 0))}`))));
      };
      paintLaps();
      return h('div.card', { style: { padding: '14px 12px' } }, swBig, btns, lapBox);
    }

    function timerView() {
      const pick = h('div.grid3', ...[60, 120, 300, 600, 900, 1800].map((s) => h('button.btn', { text: fmtDur(s * 1000), onclick: () => { tTotal.v = s * 1000; tLeft = s * 1000; tBig.textContent = fmtDur(tLeft); tBar.firstChild.style.width = '100%'; } })));
      const btns = h('div.row-flex', { style: { gap: '8px', justifyContent: 'center', marginTop: '10px' } },
        h('button.btn.primary', { style: { minWidth: '120px' }, text: tEnd ? B('Cancel', 'අවලංගු') : B('Start', 'ඇරඹුම්'), onclick: () => {
          if (tEnd) { clearInterval(tInt); tEnd = 0; ctx.api.power.wake(false).catch(() => {}); }
          else {
            tEnd = Date.now() + tLeft;
            ctx.api.power.wake(true).catch(() => {});
            tInt = setInterval(() => {
              tLeft = Math.max(0, tEnd - Date.now());
              tBig.textContent = fmtDur(tLeft);
              tBar.firstChild.style.width = `${(tLeft / tTotal.v) * 100}%`;
              if (tLeft <= 0) {
                clearInterval(tInt); tEnd = 0;
                actuate('notify');
                ctx.api.notif.post({ title: B('Timer finished', 'ටයිමරය ඉවරයි'), body: B('Time is up.', 'වේලාව ඉවරයි.'), importance: 'max' }).catch(() => {});
                ctx.api.power.wake(false).catch(() => {});
                tBig.textContent = '00:00';
                paint();
              }
            }, 200);
          }
          paint();
        } }),
        h('button.btn', { text: '+1:00', onclick: () => { tTotal.v += 60000; tLeft += 60000; if (tEnd) tEnd += 60000; tBig.textContent = fmtDur(tLeft); } }));
      return h('div.card', { style: { padding: '14px 12px' } }, tBig, tBar, btns,
        h('h4', { style: { margin: '16px 0 8px' } }, B('Presets', 'පෙර සැකසුම්')), pick);
    }

    function worldView() {
      const cities = [['Colombo', 'Asia/Colombo'], ['Kandy', 'Asia/Colombo'], ['Dubai', 'Asia/Dubai'], ['London', 'Europe/London'], ['New York', 'America/New_York'], ['Tokyo', 'Asia/Tokyo'], ['Singapore', 'Asia/Singapore']];
      const box = h('div.list');
      const tick = () => {
        clear(box);
        cities.forEach(([c, tz]) => {
          const d = new Date();
          const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).format(d);
          const offH = hoursDiff(tz, d);
          box.appendChild(h('div.row-flex', { style: { padding: '9px 2px', borderBottom: '1px solid var(--line)' } },
            h('span', { style: { flex: '1' } }, h('div', { style: { fontWeight: '700' }, text: c }), h('div.tiny.muted', `UTC${offH >= 0 ? '+' : ''}${offH}`)),
            h('span.num', { style: { fontSize: '19px', fontWeight: '300' }, text: local })));
        });
      };
      tick();
      const id = setInterval(tick, 15000);
      unsubFns.push(() => clearInterval(id));
      return box;
    }
    function hoursDiff(tz, d) {
      const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
      const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
      const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +parts.hour % 24, +parts.minute));
      return Math.round((utc - new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()))) / 3600000);
    }

    // ---- alarm firing loop
    /** Arm in the host (Android) when there is one; otherwise keep the in-app loop.
     *  a.via is 'native' | 'in-app' and is shown in the row, so the UI never
     *  promises a wake-up it cannot deliver. */
    async function arm(a) {
      if (!bus.has('app.setAlarm')) { a.via = 'in-app'; return; }
      const [hh, mm] = String(a.time).split(':').map(Number);
      try {
        const r = await ctx.api.app.setAlarm({ id: a.time, hour: hh, minute: mm, label: a.label || 'Dahat alarm', repeat: true });
        a.via = r?.via || 'in-app';
      } catch { a.via = 'in-app'; }
    }
    const disarm = (a) => ctx.api.app.cancelAlarm?.(a.time).catch(() => {});
    const fireLoop = setInterval(() => {
      const d = new Date();
      const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      alarms.forEach((a) => {
        if (!a.on || a.time !== hm || firedAt === `${d.toDateString()}${hm}`) return;
        firedAt = `${d.toDateString()}${hm}`;
        actuate('notify');
        ctx.api.notif.post({ title: `⏰ ${a.label || B('Alarm', 'ඇලාරම')}`, body: `${a.time} · ${B('tap to dismiss', 'අයින් ඉවත් කරන්න')}`, importance: 'max' }).catch(() => {});
        a.on = confirmKeep(a);
      });
    }, 4000);
    let firedAt = '';
    const confirmKeep = (a) => { setTimeout(() => { a.on = false; save(); if (tab === 'alarm') paint(); }, 1200); return a.on; };
    const save = () => {
      ctx.api.store.set('alarms', alarms);
      alarms.forEach((a) => (a.on ? arm(a) : disarm(a)));
    };
    /* the host fires the alarm itself and calls back in through the bridge */
    bus.on('alarm.fire', ({ key } = {}) => {
      if (!String(key || '').startsWith('clock:')) return;
      actuate('notify');
      toast(B(`⏰ ${String(key).slice(6)} — alarm from Android`, `⏰ ඇලාරමක් Android වෙතින් හඬිනි`));
    });
    const unsubFns = [() => { clearInterval(fireLoop); clearInterval(tInt); cancelAnimationFrame(swRaf); ctx.api.power.wake(false).catch(() => {}); }];
    bus.on('screen.lock', () => { if (swOn) { /* stopwatch keeps ticking: rAF pauses while dozing */ } });

    save(); // keep Android in sync with whatever was stored last time
    paint();
    return { el: ui.el, onResume: paint, destroy: () => unsubFns.forEach((f) => f()) };
  },
};
