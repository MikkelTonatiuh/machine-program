// Where the glow lands on the figure, without a browser: the engine's painter on the figure's bind mesh for an exercise's
// heads, software-rendered (ember = primary, amber = secondary) in front, side and back views.
//   node tools/glow_preview.mjs <figure> <exercise,exercise,...> <out.png> [--heads]  (--heads: a colour per head)
import { loadFigure, buildGroups, exerciseHeads, paintFigure } from './figlib.mjs';
import { renderViews } from './raster.mjs';
const [name, exs, outp] = process.argv.slice(2);
const F = loadFigure(name), NB = F.mesh.NB;
const views = [{ az: 0, center: [0, 0.95, 0], span: 1.95 }, { az: 90, center: [0, 0.95, 0], span: 1.95 }, { az: 180, center: [0, 0.95, 0], span: 1.95 }, { az: 270, center: [0, 0.95, 0], span: 1.95 }];
const rows = [];
for (const ex of exs.split(',')) {
  const { ids, tiers, side } = exerciseHeads(ex);
  const job = buildGroups(F, ids, { tiers, side });
  const R = paintFigure(F, job);
  const col = new Float32Array(NB * 3);
  for (let i = 0; i < NB; i++) {
    const base = [0.74, 0.72, 0.69], fp = R.musA[i * 4], fs = R.musA[i * 4 + 1];
    let c = base;
    if (fs > 0) { const a = Math.min(1, fs * 1.2); c = c.map((x, k) => x * (1 - a) + [0.93, 0.66, 0.38][k] * a); }
    if (fp > 0) { const a = Math.min(1, 0.55 + fp * 0.6); c = c.map((x, k) => x * (1 - a) + [1.0, 0.35, 0.12][k] * a); }
    if (process.argv.includes('--heads') && (fp > 0 || fs > 0)) { const h = R.hd[i * 2]; c = [0.5 + 0.5 * Math.cos(6.283 * (h * 0.618 % 1)), 0.5 + 0.5 * Math.cos(6.283 * ((h * 0.618 % 1) + 0.33)), 0.5 + 0.5 * Math.cos(6.283 * ((h * 0.618 % 1) + 0.67))]; }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  const out = exs.includes(',') ? outp.replace(/\.png$/, `_${ex}.png`) : outp;
  renderViews({ P: Float32Array.from(F.mesh.P), N: Float32Array.from(F.mesh.N), idx: Uint32Array.from(F.mesh.idxW) }, views, out, { size: 340, colors: col });
  rows.push(out);
}
console.log(rows.join('\n'));
