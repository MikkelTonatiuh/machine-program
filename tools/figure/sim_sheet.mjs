// The preview tiles without a browser: the engine's own solve, IK, skin and glow in node, software-rendered next to the machine
// parts (same camera for both bodies). Not the app's shading: a check of geometry, contact and glow placement.
//   node tools/sim_sheet.mjs chest_press,leg_press,lateral_raise,hip_thrust out/sim [size=520]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, sceneMesh, drawTile, cameraFor, boundsInView } from './engine_sim.mjs';
import { HERE } from './paths.mjs';
const exs = (process.argv[2] || 'chest_press,leg_press,lateral_raise,hip_thrust').split(','), out = join(HERE, process.argv[3] || 'out/sim'), size = +(process.argv[4] || 520);
mkdirSync(out, { recursive: true });
const BG = [[14, 24, 33], [38, 58, 72]];
for (const ex of exs) {
  const Ss = { sdf: makeScene(ex, { body: 'sdf' }), mpfb: makeScene(ex, { body: 'mpfb' }) }, cam = cameraFor(Ss.mpfb);
  const meshes = {}; let b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }, r, u;
  for (const body of ['sdf', 'mpfb']) for (const ph of ['0', 'peak']) {
    const t = ph === 'peak' ? Ss[body].inst.motion.peak : 0, m = meshes[body + ph] = sceneMesh(Ss[body], t), bb = boundsInView(m, cam.az, cam.el);
    b = { x0: Math.min(b.x0, bb.x0), x1: Math.max(b.x1, bb.x1), y0: Math.min(b.y0, bb.y0), y1: Math.max(b.y1, bb.y1) }; r = bb.r; u = bb.u;
  }
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.08, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, center = [r[0] * cx + u[0] * cy, r[1] * cx + u[1] * cy, r[2] * cx + u[2] * cy];
  for (const body of ['sdf', 'mpfb']) for (const ph of ['0', 'peak']) drawTile(meshes[body + ph], { az: cam.az, el: cam.el, center, span }, size, join(out, `${ex}_${body}_${ph === '0' ? 'stretch' : 'peak'}.png`), BG);
  console.log(ex, 'camera az', cam.az.toFixed(0), 'el', cam.el.toFixed(0), 'span', span.toFixed(2));
}
