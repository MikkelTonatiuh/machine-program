// The engine's pure parts in node (no browser, no three.js): core.js helpers (the first inline script of index.html),
// skinbuild.js (the mesher and the muscle painter) and instance.js (prepBody / prepMuscles). Used by the figure tools,
// which read exactly what the app runs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { REPO } from './paths.mjs';

let loaded = false;
export function loadEngine() {
  if (loaded) return globalThis.MCE;
  globalThis.MCE = globalThis.MCE || {};
  const html = readFileSync(join(REPO, 'index.html'), 'utf8'), i = html.indexOf('// Machine Coach figure engine - core helpers'), j = html.indexOf('</script>', i);
  if (i < 0 || j < 0) throw new Error('core.js not found in index.html');
  vm.runInThisContext(html.slice(i, j), { filename: 'core.js' });
  for (const f of ['skinbuild.js', 'instance.js']) vm.runInThisContext(readFileSync(join(REPO, 'engine', f), 'utf8'), { filename: f });
  loaded = true;
  return globalThis.MCE;
}
