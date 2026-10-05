// Turn the figure's pad-contact gaps (shots.mjs --probe results, the `fit` probe) into the fit table
// data/figure_mpfb_fit.json: for each pad a contact landmark touches, the vector (H) that brings the pad to the figure's skin,
// and the machine parts that hold it follow (a bracket's end, the beam under an inclined back pad).
//   node fit_compute.mjs shots/results.json ../../data/figure_mpfb_fit.json [--min 0.004] [--add]  (fit_offline.mjs does it all in node)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// parts that follow a pad: all of a part, or one end of it
export const FOLLOW = {
  chest_press: { back: { backarm: { from: 1 } } },
  incline_press: { back: { backarm: { from: 1 } } },
  leg_press: { back: { pbeam: 'all', headrest: 'all' } },
};
export function computeFit(R, table = {}, MIN = 0.004, log = console.log) {
  for (const [key, r] of Object.entries(R)) {
    if (!key.startsWith('mpfb:') || !r.fit) continue;
    const ex = key.slice(5), byPart = {};
    for (const [name, c] of Object.entries(r.fit)) {
      const part = name.split('->')[1];
      if (!(c.mean > MIN)) { log(ex, name, 'gap', c.mean, '(H) tol', c.tol, '-> no shift'); continue; }
      (byPart[part] = byPart[part] || []).push(c);
      log(ex, name, 'gap mean', c.mean, 'min', c.min, 'max', c.max, 'tol', c.tol, 'shift', JSON.stringify(c.shift));
    }
    const t = table[ex] = table[ex] || {};
    for (const [part, cs] of Object.entries(byPart)) {
      const prev = Array.isArray(t[part]) ? t[part] : [0, 0, 0];
      const mean = [0, 1, 2].map((k) => cs.reduce((a, c) => a + c.shift[k], 0) / cs.length);
      t[part] = mean.map((x, k) => +(prev[k] + x).toFixed(4));
      for (const [fp, how] of Object.entries((FOLLOW[ex] || {})[part] || {})) {
        if (how === 'all') t[fp] = t[part].slice();
        else { const o = {}; for (const end of Object.keys(how)) o[end] = t[part].slice(); t[fp] = o; }
      }
    }
    if (!Object.keys(t).length) delete table[ex];
  }
  return table;
}
if (process.argv[1] && process.argv[1].endsWith('fit_compute.mjs')) {
  const [src, dst] = process.argv.slice(2);
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const table = process.argv.includes('--add') && existsSync(dst) ? JSON.parse(readFileSync(dst, 'utf8')) : {};
  computeFit(JSON.parse(readFileSync(src, 'utf8')), table, +arg('min', 0.004));
  writeFileSync(dst, JSON.stringify(table, null, 1));
  console.log('wrote', dst, JSON.stringify(table));
}
