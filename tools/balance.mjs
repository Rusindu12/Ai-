#!/usr/bin/env node
/* tools/balance.mjs — bracket scanner that pinpoints where a file goes
 * unbalanced (node --check only reports the first confusing symptom).
 * Handles single/double/backtick strings, template  nests, and line+block comments.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, relative, resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (extname(p) === '.js') files.push(p); } })(join(ROOT, 'os/js'));

let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const stack = [];
  let line = 1, i = 0, ok = true;
  let last = '';                       // last significant char, for regex detection
  const pairs = { ')': '(', ']': '[', '}': '{' };
  while (i < src.length) {
    const c = src[i], n = src[i + 1], prev = last;
    if (c === '\n') { line++; i++; continue; }
    if (!/\s/.test(c)) last = c;
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; } i++; continue; }
    if (c === '`') {                       // template literal: track ${ } nesting
      i++; let depth = 0;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') line++;
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          else if (src[i] === '`') { const r = consumeTpl(src, i, () => line); i = r.i; }
          i++; continue;
        }
        if (src[i] === '`') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && '([{,=:[!&|?;+-*%<>~^'.includes(prev || '(')) {   // regex literal
      i++; let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') { console.log(`${relative(ROOT, f)}:${line}: unterminated regex`); ok = false; break; }
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) { i++; while (/[gimsuyd]/.test(src[i])) i++; break; }
        i++;
      }
      last = '/';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { stack.push({ c, line }); last = c; i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      last = c;
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) { console.log(`${relative(ROOT, f)}:${line}: stray '${c}' (expected ${top ? `close of '${top.c}' opened on line ${top.line}` : 'nothing'})`); ok = false; break; }
      i++; continue;
    }
    i++;
  }
  if (ok && stack.length) { console.log(`${relative(ROOT, f)}: unclosed ${stack.map((s) => `'${s.c}'@${s.line}`).join(' ')}`); bad++; continue; }
  if (!ok) bad++;
}
function consumeTpl(src, start) { let i = start + 1, depth = 0; while (i < src.length) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; } if (depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; continue; } if (src[i] === '`') return { i: i + 1 }; i++; } return { i }; }
console.log(bad ? `${bad} file(s) unbalanced` : `✓ brackets balanced in ${files.length} files`);
process.exit(bad ? 1 : 0);
// NOTE: this is a heuristic scanner. It can false-positive on exotic nesting
// (e.g. a backtick inside a regex inside a template literal). `node --check`
// (see check.mjs) is the authority — this tool exists to say *where* to look.
