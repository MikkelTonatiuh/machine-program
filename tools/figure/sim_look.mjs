// The preview tiles with the app's skin shading emulated (clay, definition map, glow): the four exercises, both bodies, stretch and peak.
//   node tools/sim_look.mjs [exercises] [out dir] [size] [--nrm out/<name>/nrm.png] [--scale 1.6 --knee 0.17 --keep 0.45]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, engineTile, cameraFor, sceneMesh, boundsInView } from './engine_sim.mjs';
import { savePNG } from './engine_shade.mjs';
import { HERE } from './paths.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const exs = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chest_press,leg_press,lateral_raise,hip_thrust').split(','), out = join(HERE, process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'out/simlook'), size = +(process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 520);
mkdirSync(out, { recursive: true });
const opts = { texPng: join(HERE, arg('nrm', 'out/figure/nrm.png')), normalScale: +arg('scale', 1.6), knee: +arg('knee', 0.17), keep: +arg('keep', 0.45) };
for (const ex of exs) {
  const Ss = { sdf: makeScene(ex, { body: 'sdf' }), mpfb: makeScene(ex, { body: 'mpfb' }) }, cam = cameraFor(Ss.mpfb);
  let b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }, r, u; const phases = { '0': 0, peak: null };
  for (const body of ['sdf', 'mpfb']) for (const ph of ['0', 'peak']) {
    const t = ph === 'peak' ? Ss[body].inst.motion.peak : 0, bb = boundsInView(sceneMesh(Ss[body], t), cam.az, cam.el);
    b = { x0: Math.min(b.x0, bb.x0), x1: Math.max(b.x1, bb.x1), y0: Math.min(b.y0, bb.y0), y1: Math.max(b.y1, bb.y1) }; r = bb.r; u = bb.u;
  }
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.08, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, center = [r[0] * cx + u[0] * cy, r[1] * cx + u[1] * cy, r[2] * cx + u[2] * cy];
  for (const body of ['sdf', 'mpfb']) for (const ph of ['0', 'peak']) {
    const t = ph === 'peak' ? Ss[body].inst.motion.peak : 0, img = engineTile(Ss[body], t, { az: cam.az, el: cam.el, center, span }, size, opts);
    savePNG(join(out, `${ex}_${body}_${ph === '0' ? 'stretch' : 'peak'}.png`), size, img);
  }
  console.log(ex, 'done');
}
