/* Dahat OS — entry point.
 * Keep this file boring: it exists so index.html has one thing to load and so
 * the whole OS can be re-hosted (browser, PWA, Android WebView, desktop frame)
 * without touching the shell.
 */
import { boot } from './shell/boot.js';
import { log } from './kernel/log.js';

boot().catch((err) => {
  console.error('Dahat OS failed to boot', err);
  log.error('kernel', `boot failure: ${err?.message || err}`);
  const el = document.getElementById('boot');
  if (el) {
    el.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'color:#f5626c;font:13px ui-monospace,monospace;padding:20px;text-align:center';
    box.textContent = `boot failure: ${err?.message || err}`;
    el.appendChild(box);
  }
});
