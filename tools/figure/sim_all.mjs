// The figure on every exercise at the bottom (phase 0) and top (peak) frame, software render with the app's skin shading emulated, in the
// exercise's own camera, one phone-shaped crop (412 x 660): out/<dir>/<id>_bottom.png, <id>_top.png and results.json (frames_sheet.py).
//   node tools/sim_all.mjs [out dir] [--ex a,b] [--nrm out/figure/nrm.png] [--size 660] [--body mpfb|sdf]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, engineTile, cameraFor, sceneMesh, boundsInView } from './engine_sim.mjs';
import { savePNG } from './engine_shade.mjs';
import { writePNG } from './raster.mjs';
import { HERE, REPO } from './paths.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const out = join(HERE, process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'out/sim28'), size = +arg('size', 660), body = arg('body', 'mpfb');
const ids = arg('ex', null) ? arg('ex').split(',') : readdirSync(join(REPO, 'exercises')).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.replace('.json', ''));
mkdirSync(out, { recursive: true });
const opts = { texPng: join(HERE, arg('nrm', 'out/figure/nrm.png')), normalScale: 1.6, knee: 0.17, keep: 0.45 };
const shots = [];
for (const ex of ids) {
  const S = makeScene(ex, { body }), cam = cameraFor(S);
  let b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }, r, u;
  for (const t of [0, S.inst.motion.peak]) { const bb = boundsInView(sceneMesh(S, t), cam.az, cam.el); b = { x0: Math.min(b.x0, bb.x0), x1: Math.max(b.x1, bb.x1), y0: Math.min(b.y0, bb.y0), y1: Math.max(b.y1, bb.y1) }; r = bb.r; u = bb.u; }
  const span = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * 412 / 660) * 1.12 * 660 / 412 * 0.62 + 0.0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, center = [r[0] * cx + u[0] * cy, r[1] * cx + u[1] * cy, r[2] * cx + u[2] * cy];
  for (const [t, tag] of [[0, 'bottom'], [S.inst.motion.peak, 'top']]) {
    const img = engineTile(S, t, { az: cam.az, el: cam.el, center, span: Math.max(span, 0.9) }, size, { ...opts, yawDeg: S.inst.cam.az + (S.inst.cam.dAz || 0) });
    const f = join(out, `${ex}_${tag}.png`), W = Math.round(size * 412 / 660), x0 = Math.floor((size - W) / 2), crop = Buffer.alloc(W * size * 3); // the phone's width: the centre of the square
    for (let y = 0; y < size; y++) img.copy(crop, y * W * 3, (y * size + x0) * 3, (y * size + x0 + W) * 3);
    writePNG(f, W, size, crop); shots.push({ id: ex, t: tag === 'bottom' ? '0' : 'peak', file: f });
  }
  console.log(ex, 'done');
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ body, shots }, null, 1));
