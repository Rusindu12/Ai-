/* Dahat OS — apps/registry.js
 * entry name → code. Apps are lazily imported, so the boot image only parses
 * what the user actually opens (this is why the shell starts fast on a
 * low-end phone).
 */
const LOADERS = {
  settings: () => import('../apps/settings.js'),
  files: () => import('../apps/files.js'),
  notes: () => import('../apps/notes.js'),
  terminal: () => import('../apps/terminal.js'),
  calculator: () => import('../apps/calculator.js'),
  clock: () => import('../apps/clock.js'),
  phone: () => import('../apps/phone.js'),
  camera: () => import('../apps/camera.js'),
  gallery: () => import('../apps/gallery.js'),
  monitor: () => import('../apps/monitor.js'),
  bazaar: () => import('../apps/bazaar.js'),
  assistant: () => import('../apps/assistant.js'),
  todo: () => import('../apps/todo.js'),
  game2048: () => import('../apps/game2048.js'),
  snake: () => import('../apps/snake.js'),
  paint: () => import('../apps/paint.js'),
  converter: () => import('../apps/converter.js'),
  piano: () => import('../apps/piano.js'),
  memo: () => import('../apps/memo.js'),
};
export const ENTRIES = Object.keys(LOADERS);

export async function loadApp(entry) {
  const fn = LOADERS[entry];
  if (!fn) throw new Error(`ENOAPE: no code registered for entry "${entry}"`);
  const mod = await fn();
  if (!mod.default?.create) throw new Error(`EFORMAT: app "${entry}" has no create(ctx)`);
  return mod.default;
}
