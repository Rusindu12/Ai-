/* Dahat OS — Calculator: hand-written recursive-descent parser (no eval, so a
 * note typed into the terminal can never execute anything).
 */
import { h, icon } from '../ui/dom.js';
import { scaffold } from './kit.js';
import { i18n } from '../ui/i18n.js';
import { actuate } from '../ui/audio.js';

const B = (en, si) => i18n.bi({ en, si });

function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[\d.]/.test(c)) { let n = ''; while (i < src.length && /[\d._]/.test(src[i])) { if (src[i] !== '_') n += src[i]; i++; } t.push({ t: 'num', v: parseFloat(n) }); continue; }
    if ('+-*/%^(),'.includes(c)) { t.push({ t: c }); i++; continue; }
    const fn = ['sin', 'cos', 'tan', 'ln', 'log', 'sqrt', 'abs', 'round'].find((f) => src.startsWith(f, i));
    if (fn) { t.push({ t: 'fn', v: fn }); i += fn.length; continue; }
    if (src.startsWith('pi', i)) { t.push({ t: 'num', v: Math.PI }); i += 2; continue; }
    if (c === 'π') { t.push({ t: 'num', v: Math.PI }); i++; continue; }
    if (c === 'e') { t.push({ t: 'num', v: Math.E }); i++; continue; }
    throw new Error(`bad token "${c}"`);
  }
  return t;
}
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (tokens[p]?.t === t) return tokens[p++].t; throw new Error(`expected ${t}`); };
  function primary() {
    const tk = peek();
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === '(') { p++; const v = expr(); eat(')'); return v; }
    if (tk.t === '-') { p++; return -primary(); }
    if (tk.t === '+') { p++; return primary(); }
    if (tk.t === 'fn') { p++; eat('('); const a = expr(); eat(')'); return FN[tk.v](a); }
    throw new Error(`unexpected ${tk.t}`);
  }
  function power() { let base = primary(); if (peek()?.t === '^') { p++; base **= power(); } return base; }
  function unary() { let v = power(); while (peek()?.t === '!') { p++; v = fact(v); } return v; }
  function term() { let v = unary(); while (peek() && '*/%'.includes(peek().t)) { const op = tokens[p++].t; const r = unary(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; }
  function expr() { let v = term(); while (peek() && '+-'.includes(peek().t)) { const op = tokens[p++].t; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
  const v = expr();
  if (p < tokens.length) throw new Error(`unexpected ${tokens[p].t}`);
  return v;
}
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs, round: Math.round };
const fact = (n) => { if (n < 0 || !Number.isInteger(n)) throw new Error('factorial needs a whole number'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
export const evaluate = (src) => parse(tokenize(src));

export default {
  id: 'calculator',
  create(ctx) {
    const disp = h('div', { style: { fontSize: '40px', fontWeight: '250', textAlign: 'right', padding: '14px 10px 2px', minHeight: '54px', wordBreak: 'break-all' } }, '0');
    const exprLine = h('div.tiny.mono.muted', { style: { textAlign: 'right', padding: '0 10px', minHeight: '16px' } }, B('history below ↓', 'ඉතිහාසය පහළින් ↓'));
    let cur = '', justResult = false;
    const hist = { items: [] };
    ctx.api.store.get('hist').then((v) => { if (Array.isArray(v)) { hist.items.push(...v); paintHist(); } });
    const histBox = h('div', { style: { marginTop: '8px' } });

    const KEYS = [
      ['C', 'del', '(', ')', '÷'],
      ['7', '8', '9', '×', '%'],
      ['4', '5', '6', '−', '√'],
      ['1', '2', '3', '+', '!'],
      ['0', '.', 'π', 'ANS', '='],
    ];
    const pad = h('div.kbd-pad');
    KEYS.flat().forEach((k) => {
      const cls = k === '=' ? 'eq' : '+-×÷%!√()delCπANS'.includes(k) ? 'op' : '';
      const b = h(`button${cls ? `.${cls}` : ''}`, { text: k === 'del' ? '⌫' : k, onclick: () => press(k) });
      pad.appendChild(b);
    });
    const SCI_FNS = ['sin(', 'cos(', 'tan(', 'ln(', 'log(', 'round('];
    const fnChips = SCI_FNS.map((f) => h('button.chip', { text: f.replace('(', ''), onclick: () => { cur += f; render(); } }));
    const copyChip = h('button.chip', {
      text: B('copy', 'පිටපත්'),
      onclick: async () => { await ctx.api.bus.call('clip.set', { text: disp.textContent }, { appId: 'calculator', pid: ctx.pid }); ctx.toast(B('copied', 'පිටපත් කෙරිණි')); },
    });
    const sci = h('div.row-flex', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '10px' } }, ...fnChips, copyChip);

    function render() { disp.textContent = cur === '' ? '0' : cur.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−'); }
    function press(k) {
      actuate('tap');
      if (k === 'C') { cur = ''; justResult = false; render(); return; }
      if (k === 'del') { cur = cur.slice(0, -1); render(); return; }
      if (k === '=') { doEquals(); return; }
      if (k === 'ANS') { cur += String(lastAns()); render(); return; }
      if (k === 'π') { cur += 'π'; render(); return; }
      if (k === '√') { cur += 'sqrt('; render(); return; }
      if (k === '%') { cur += '/100'; render(); return; }
      const map = { '÷': '/', '×': '*', '−': '-' };
      if (map[k]) { cur = (cur || String(lastAns())) + map[k]; render(); return; }
      if (k === '!') { cur += '!'; render(); return; }
      if (k === '(' || k === ')') { cur += k; render(); return; }
      if (justResult && /\d/.test(k)) cur = '';
      justResult = false;
      cur += k;
      render();
    }
    function lastAns() { return hist.items[0]?.v ?? 0; }
    function doEquals() {
      try {
        const v = evaluate(cur || String(lastAns()));
        if (!isFinite(v)) throw new Error(B('not a number', 'සංඛ්‍යාවක් නොවේ'));
        hist.items.unshift({ e: cur, v });
        hist.items = hist.items.slice(0, 40);
        ctx.api.store.set('hist', hist.items);
        cur = String(+v.toFixed(10));
        justResult = true;
        render();
        exprLine.textContent = `${cur} ${B('← answer', '← පිළිතුර')}`;
        paintHist();
      } catch (e) {
        exprLine.textContent = `⚠ ${e.message}`;
        actuate('error');
      }
    }
    function paintHist() {
      histBox.innerHTML = '';
      hist.items.slice(0, 12).forEach((it) => {
        histBox.appendChild(h('button.row', {
          onclick: () => { cur = String(it.e); render(); },
        }, h('span.r-main', h('span.r-title', { style: { fontFamily: 'ui-monospace,monospace', fontSize: '12.5px' }, text: it.e }), h('span.r-sub', `= ${it.v}`)), h('span.r-end', { html: icon('arrowright', 14) })));
      });
      if (!hist.items.length) histBox.appendChild(h('div.tiny.muted', { style: { textAlign: 'center', padding: '10px' } }, B('no history yet', 'ඉතිහාසයක් නැත')));
    }
    paintHist();

    const body = h('div.app-body', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('div.card', { style: { padding: '6px' } }, exprLine, disp), pad, sci,
      h('h4', { style: { margin: '16px 0 4px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)' } }, B('History', 'ඉතිහාසය')), histBox);
    const el = h('div.app', h('div.app-bar', h('button.btn.icon', { onclick: () => ctx.close(), html: icon('left', 19) }), h('span.title', B('Calculator', 'ගණක යන්ත්‍රය')), h('span', { style: { flex: '1' } }),
      h('button.btn.icon', { onclick: () => { hist.items = []; ctx.api.store.set('hist', []); paintHist(); }, html: icon('trash', 17) })), body);
    render();
    addEventListener('keydown', onKey);
    function onKey(e) {
      const k = e.key;
      if (/[\d.()]/.test(k)) press(k);
      else if (k === '+' || k === '-') press(k);
      else if (k === '*') press('×');
      else if (k === '/') { e.preventDefault(); press('÷'); }
      else if (k === '^') press('^');
      else if (k === 'Enter' || k === '=') doEquals();
      else if (k === 'Backspace') press('del');
      else if (k === 'Escape') press('C');
    }
    return { el, destroy: () => removeEventListener('keydown', onKey) };
  },
};
