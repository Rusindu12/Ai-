/* Dahat OS — shell/onboarding.js
 * First-run flow: language → what a capability means → optional PIN.
 * Runs once; Settings ▸ System ▸ "Run setup again" resets the flag.
 */
import { h, icon, clear } from '../ui/dom.js';
import { config } from '../kernel/config.js';
import { i18n } from '../ui/i18n.js';
import { log } from '../kernel/log.js';
import { modal, prompt, toast } from './dialogs.js';
import { WALLPAPERS, ACCENTS } from '../kernel/config.js';
import { applyTheme } from './theme.js';

export async function onboarding() {
  if (config.get('ui.onboarded')) return false;
  log.info('shell', 'first run — starting setup');
  let step = 0;
  const node = h('div.dialog', { style: { width: 'min(380px,100%)' } });
  const scrim = h('div.scrim', { style: { alignItems: 'flex-end', padding: '14px' } }, node);
  document.getElementById('dialog-root').appendChild(scrim);

  const paint = () => {
    clear(node);
    const dots = h('div.row-flex', { style: { gap: '5px', justifyContent: 'center', marginBottom: '12px' } },
      ...[0, 1, 2, 3].map((i) => h('i', { style: { width: i === step ? '18px' : '6px', height: '6px', borderRadius: '9px', background: i === step ? 'var(--accent)' : 'var(--text-3)' } })));
    if (step === 0) {
      node.appendChild(h('div.center',
        h('div', { style: { fontSize: '30px', marginBottom: '2px' } }, '☸'),
        h('h3', { style: { margin: '0 0 2px', fontSize: '21px' } }, i18n.t('onb.welcome')),
        h('p', { style: { margin: 0 }, text: i18n.bi({ en: 'a small, honest operating system', si: 'කුඩා, ප්‍රාමාණික මෙහෙයුම් පද්ධතියක්' }) })));
      node.appendChild(h('hr.hr'));
      node.appendChild(h('h4', { style: { margin: '0 0 8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)' } }, i18n.t('onb.lang')));
      node.appendChild(h('div.grid2',
        ...['en', 'si'].map((l) => h('button.btn', {
          style: { justifyContent: 'space-between', borderColor: config.get('ui.lang') === l ? 'var(--accent)' : '', minHeight: '54px' },
          onclick: () => { config.set('ui.lang', l, { silent: true }); applyTheme(); paint(); },
        }, h('span', { style: { fontWeight: '700' } }, i18n.bi({ en: 'English', si: 'ඉංග්‍රීසි' })[l] || l),
          h('span.tiny.muted', { text: l === 'en' ? 'English' : 'සිංහල' }),
          config.get('ui.lang') === l ? h('span', { html: icon('check', 16), style: { color: 'var(--accent)' } }) : null))));
      node.appendChild(h('p.tiny.muted', { style: { marginTop: '8px' } }, i18n.t('onb.langSub')));
      node.appendChild(next(i18n.bi({ en: 'Continue', si: 'ඉදිරියට' })));
    } else if (step === 1) {
      node.appendChild(h('h3', { style: { margin: '0 0 4px' } }, i18n.t('onb.trust')));
      node.appendChild(h('p', { style: { margin: '0 0 12px' } }, i18n.t('onb.trustSub')));
      node.appendChild(h('div.list', ...[
        ['bell', i18n.bi({ en: 'Notifications', si: 'දැනුම්දීම්' }), i18n.bi({ en: 'asked on first use', si: 'පළමු වරට භාවිතයේදී අසයි' })],
        ['storage', i18n.bi({ en: 'Shared storage', si: 'ගබඩාව' }), i18n.bi({ en: '/sdcard only, revocable', si: '/sdcard පමණයි, අහෝසි කළ හැක' })],
        ['zap', i18n.bi({ en: 'Airplane mode', si: 'ගුවන් ප්‍රකාරය' }), i18n.bi({ en: 'kernel denies network', si: 'කර්නලය ජාලය ප්‍රතික්ෂේප කරයි' })],
      ].map(([ic, a, b]) => h('div.row', h('span.r-ico', { html: icon(ic, 17), style: { background: 'var(--surface-3)', color: 'var(--accent)' } }), h('span.r-main', h('span.r-title', a), h('span.r-sub', b))))));
      node.appendChild(next(i18n.bi({ en: 'Got it', si: 'හරි' })));
    } else if (step === 2) {
      node.appendChild(h('h3', { style: { margin: '0 0 4px' } }, i18n.t('onb.pin')));
      node.appendChild(h('p', { style: { margin: '0 0 12px' } }, i18n.bi({ en: 'Four digits, hashed on this device. Nothing is sent anywhere.', si: 'ඉලක්කම් හතරක්, උපාංගයේම හැෂ් කෙරේ.' })));
      node.appendChild(h('div.row-flex', { style: { gap: '8px' } },
        h('button.btn.block', { onclick: async () => { const v = await prompt({ title: i18n.t('onb.pin'), type: 'password', placeholder: '••••', hint: '4 digits', multiline: false }); if (v && /^\d{4}$/.test(v)) { const m = await import('./lock.js'); await m.lockscreen.setPin(v); step = 3; paint(); } else if (v !== null) toast(i18n.bi({ en: 'use exactly 4 digits', si: 'ඉලක්කම් 4ක් යොදන්න' })); } }, i18n.t('onb.pinSet'),),
        h('button.btn.text', { onclick: () => { step = 3; paint(); } }, i18n.t('onb.pinSkip'))));
      node.appendChild(h('p.tiny.muted', { style: { marginTop: '10px' } }, i18n.bi({ en: 'Tip: you can also change the wallpaper and accent right away.', si: 'ඉඟිය: තිරපසය සහ වර්ණය ද වහාම වෙනස් කළ හැක.' })));
    } else {
      node.appendChild(h('h3', { style: { margin: '0 0 4px' } }, i18n.t('onb.offline')));
      node.appendChild(h('p', { style: { margin: '0 0 12px' } }, i18n.t('onb.offlineSub')));
      node.appendChild(h('h4', { style: { margin: '14px 0 8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)' } }, i18n.bi({ en: 'Wallpaper', si: 'තිරපසය' })));
      node.appendChild(h('div.grid3', ...Object.entries(WALLPAPERS).slice(0, 6).map(([id, w]) => h('button', {
        style: { height: '58px', borderRadius: '14px', border: `1px solid var(--line)`, background: w.css, cursor: 'pointer' },
        onclick: () => { config.set('display.wallpaper', id); applyTheme(); },
      }))));
      node.appendChild(h('div.row-flex', { style: { gap: '7px', margin: '12px 0 4px', flexWrap: 'wrap' } },
        ...ACCENTS.map((c) => h('button', { 'aria-label': c, style: { width: '26px', height: '26px', borderRadius: '50%', background: c, border: '2px solid transparent', cursor: 'pointer' }, onclick: () => { config.set('display.accent', c); applyTheme(); } }))))
      ;
      node.appendChild(next(i18n.t('onb.done'), true));
    }
  };
  const next = (label, finish = false) => h('button.btn.primary.block', {
    style: { marginTop: '14px' },
    onclick: async () => {
      if (finish) { await config.set('ui.onboarded', true); scrim.remove(); log.info('shell', 'setup complete'); return; }
      step++; paint();
    },
  }, label, h('span', { html: icon('right', 15) }));
  paint();
  return true;
}
