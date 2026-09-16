#!/usr/bin/env node
/* tools/check.mjs — syntax + import-graph check for the whole OS, no build step.
 * Copies every module to a scratch dir as .mjs and runs V8's parser on it,
 * then resolves each relative import to make sure nothing dangles.
 */
import { readdirSync, statSync, copyFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative, extname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SCRATCH = join(ROOT, '.check-tmp');
const SKIP = new Set(['node_modules', '.git', 'android', '.github', 'tools']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(name) === '.js') out.push(p);
  }
  return out;
}

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
const files = [...walk(join(ROOT, 'os')), ...walk(join(ROOT, 'tools'))].filter((f) => existsSync(dirname(f)));
let fail = 0;
for (const f of files) {
  const flat = join(SCRATCH, relative(ROOT, f).replaceAll('/', '_') + '.mjs');
  copyFileSync(f, flat);
  try { execFileSync(process.execPath, ['--check', flat], { stdio: 'pipe' }); }
  catch (e) { fail++; console.error(`✗ ${relative(ROOT, f)}\n${e.stderr.toString().split('\n').slice(0, 6).join('\n')}`); }
}
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+[^'"]*?from\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) { fail++; console.error(`✗ ${relative(ROOT, f)}: unresolved import "${m[1]}"`); }
  }
  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) { fail++; console.error(`✗ ${relative(ROOT, f)}: unresolved dynamic import "${m[1]}"`); }
  }
}
rmSync(SCRATCH, { recursive: true, force: true });
console.log(fail ? `\n${fail} problem(s) in ${files.length} modules` : `✓ ${files.length} modules parse, all relative imports resolve`);
process.exit(fail ? 1 : 0);
