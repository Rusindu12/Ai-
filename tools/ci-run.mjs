/* Dahat OS — tools/ci-run.mjs
 * Run a check and, if it fails, publish the reason somewhere readable:
 *
 *   • a ::error:: workflow annotation carrying the tail of the output, and
 *   • a fenced block in $GITHUB_STEP_SUMMARY for humans in the web UI.
 *
 * Why: Actions' raw-log download redirects to a blob host that a lot of
 * environments cannot reach, which leaves a red X with no explanation at all.
 * A failure that quotes itself is debuggable from the API alone.
 *
 *   node tools/ci-run.mjs <label> <command…>
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeSync } from 'node:fs';

const [label, ...cmd] = process.argv.slice(2);
if (!label || !cmd.length) {
  writeSync(2, 'usage: node tools/ci-run.mjs <label> <command…>\n');
  process.exit(2);
}

const r = spawnSync(cmd.join(' '), { shell: true, encoding: 'utf8', maxBuffer: 64 << 20 });
const out = `${r.stdout || ''}${r.stderr || ''}`;
process.stdout.write(out.endsWith('\n') || out === '' ? out : `${out}\n`);

if (r.status === 0 && !r.error) process.exit(0);

// gradle/jest-style reports hide the reason above the stack: prefer the block that
// starts at "What went wrong" / the first error line, then fall back to the tail.
const all = out.split('\n').filter((l) => l.trim());
const start = all.findIndex((l) => /What went wrong|^FAILURE:\s|^e: |\berror:\s|Exception:|Unresolved reference|Cannot invoke|No signature of method|Caused by:/i.test(l));
const from = start >= 0 ? all.slice(start, start + 18) : [];
const lines = from.length ? [...from, '…', ...all.slice(-6)] : all.slice(-26);
const tail = r.error ? `${r.error.message}\n${lines.join('\n')}` : lines.join('\n');
// workflow commands are single-line and reserve a few characters
const esc = tail
  .replace(/%/g, '%25').replace(/\r/g, '')
  .replace(/:/g, '%3A').replace(/#/g, '%23').replace(/,/g, '%2C')
  .replace(/\n/g, '%0A');

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  try { appendFileSync(summary, `\n### ✗ ${label}\n\n\`\`\`\n${tail}\n\`\`\`\n`); } catch { /* not writable, the annotation is enough */ }
}
writeSync(1, `\n── ${label} failed (exit ${r.status ?? 'spawn'}) ──\n${tail}\n`);
writeSync(1, `::error::${label}: ${esc}\n`);
process.exit(r.status || 1);
