/* Converter — pure arithmetic, no network. Currency uses a rate you set. */
import { h } from '../ui/dom.js';
import { scaffold, seg } from './kit.js';
import { i18n } from '../ui/i18n.js';

const B = (en, si) => i18n.bi({ en, si });
const UNITS = {
  length: { label: ['Length', 'දිග'], base: 'm', u: { m: 1, km: 1000, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 } },
  mass: { label: ['Mass', 'ස්කන්ධය'], base: 'kg', u: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523, st: 6.35029318 } },
  area: { label: ['Area', 'වර්ගඵලය'], base: 'm²', u: { 'm²': 1, 'km²': 1e6, 'ha': 1e4, 'acre': 4046.8564224, 'ft²': 0.09290304, 'in²': 0.00064516 } },
  volume: { label: ['Volume', 'පරිමාව'], base: 'L', u: { L: 1, mL: 0.001, 'm³': 1000, gal: 3.785411784, qt: 0.946352946, cup: 0.24, floz: 0.0295735296 } },
  data: { label: ['Data', 'දත්ත'], base: 'B', u: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776, bit: 0.125 } },
  speed: { label: ['Speed', 'වේගය'], base: 'm/s', u: { 'm/s': 1, 'km/h': 0.277777778, mph: 0.44704, kn: 0.514444444 } },
  temp: { label: ['Temperature', 'උෂ්ණත්වය'], base: 'C', special: true, u: { C: 1, F: 1, K: 1 } },
  money: { label: ['Money', 'මුදල්'], base: 'LKR', u: { LKR: 1, USD: 300, EUR: 325, GBP: 380, INR: 3.6, AUD: 200, JPY: 2 } },
};

const convert = (cat, from, to, v) => {
  const c = UNITS[cat];
  const n = Number(v);
  if (isNaN(n)) return NaN;
  if (cat === 'temp') {
    let c0 = from === 'C' ? n : from === 'F' ? ((n - 32) * 5) / 9 : n - 273.15;
    return to === 'C' ? c0 : to === 'F' ? (c0 * 9) / 5 + 32 : c0 + 273.15;
  }
  return (n * c.u[from]) / c.u[to];
};

export default {
  id: 'converter',
  create(ctx) {
    let cat = 'length';
    let from = 'm', to = 'ft';
    const ui = scaffold(ctx, { title: { en: 'Converter', si: 'මාපක' }, back: false });
    const segEl = seg(Object.entries(UNITS).map(([id, c]) => ({ id, label: B(c.label[0], c.label[1]) })), cat, (v) => { cat = v; const ks = Object.keys(UNITS[v].u); from = ks[0]; to = ks[1] || ks[0]; paint(); });
    const box = h('div');
    const num = h('input.input', { type: 'number', value: '1', inputmode: 'decimal', style: { fontSize: '22px', fontWeight: '600' } });
    num.addEventListener('input', () => paint());
    let rateEditor = null;

    function paint() {
      box.innerHTML = '';
      const selA = picker(Object.keys(UNITS[cat].u), from, (x) => { from = x; paint(); });
      const selB = picker(Object.keys(UNITS[cat].u), to, (x) => { to = x; paint(); });
      const out = convert(cat, from, to, num.value);
      box.appendChild(h('div.card', { style: { padding: '14px' } },
        h('div.tiny.muted', B('value', 'අගය')), num,
        h('div.row-flex', { style: { gap: '8px', marginTop: '12px', alignItems: 'stretch' } }, selA,
          h('button.btn.icon', { onclick: () => { const t = from; from = to; to = t; paint(); }, html: h('span', { html: '' }).outerHTML ? '⇄' : '⇄', style: { transform: 'rotate(90deg)' } }), selB),
        h('div', { style: { marginTop: '14px', fontSize: '28px', fontWeight: '250' } }, `${isFinite(out) ? fmt(out) : '—'} ${UNITS[cat].u[to] !== undefined ? to : ''}`),
        h('div.tiny.mono.muted', { text: `1 ${from} = ${fmt(convert(cat, from, to, 1))} ${to}` })));
      if (cat === 'money') {
        box.appendChild(h('div.card', h('h4', B('Your own rates', 'ඔබේ සුදුසු අගයන්')),
          rateInput('LKR', UNITS.money.u.LKR), rateInput('USD', UNITS.money.u.USD), rateInput('EUR', UNITS.money.u.EUR),
          h('div.tiny.muted', B('Rates are stored in this app only — the OS never fetches a price feed.', 'අගයන් මෙම ඇප් එකේම සුරැකේ.'))));
      }
      ui.setBody(segEl, box);
    }
    function rateInput(cur, val) {
      const inp = h('input.input', { type: 'number', value: String(val), style: { marginTop: '6px' } });
      inp.addEventListener('change', () => { UNITS.money.u[cur] = Number(inp.value) || UNITS.money.u[cur]; paint(); });
      return h('div.row-flex', { style: { gap: '8px', alignItems: 'center' } }, h('span', { style: { width: '46px', fontWeight: '700' } }, cur), inp);
    }
    const fmt = (v) => Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(4) : String(+v.toFixed(6));
    function picker(opts, value, onPick) {
      const wrap = h('div', { style: { flex: '1', overflow: 'auto' } });
      const row2 = h('div.row-flex', { style: { gap: '6px', flexWrap: 'nowrap' } }, ...opts.map((o) => h('button.chip', { text: o, style: o === value ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'transparent' } : null, onclick: () => onPick(o) })));
      wrap.appendChild(row2);
      return wrap;
    }
    rateEditor = null;
    paint();
    return { el: ui.el };
  },
};
