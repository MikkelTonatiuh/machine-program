// Close-ups of a joint in the real engine's pose, both bodies side by side (software render).
//   node tools/sim_close.mjs <exercise> <phase|peak> <bone> <spanM> <out.png> [az] [el]  (az / el default: the exercise's camera)
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeScene, sceneMesh, drawTile, cameraFor } from './engine_sim.mjs';
import { HERE } from './paths.mjs';
import { readFileSync } from 'node:fs';
import { PNG_join } from './png_join.mjs';
const [ex, phase, bone, span, outp, azA, elA] = process.argv.slice(2);
const out = join(HERE, outp); mkdirSync(dirname(out), { recursive: true });
const tiles = [];
for (const body of ['sdf', 'mpfb']) {
  const S = makeScene(ex, { body }), t = phase === 'peak' ? S.inst.motion.peak : +phase, m = sceneMesh(S, t, { machine: process.env.MACHINE === '1' }), cam = cameraFor(S);
  const p = S.inst.skel.bones[bone].obj.getWorldPosition(new globalThis.THREE.Vector3());
  const f = out.replace(/\.png$/, `_${body}.png`);
  drawTile(m, { az: azA != null ? +azA : cam.az, el: elA != null ? +elA : cam.el, center: [p.x, p.y, p.z], span: +span }, 460, f, [[14, 24, 33], [38, 58, 72]]);
  tiles.push(f);
}
await PNG_join(tiles, out);
console.log('wrote', out);
