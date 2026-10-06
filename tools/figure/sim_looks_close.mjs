// Look study without a browser: a close view of the figure (torso front, back, legs) under several finish settings, with the
// sculpted body for reference. node tools/sim_looks_close.mjs <exercise> <phase> out/looklab [az el dist target...]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, engineTile } from './engine_sim.mjs';
import { savePNG } from './engine_shade.mjs';
import { PNG_join } from './png_join.mjs';
import { HERE } from './paths.mjs';
const [ex, phase, outRel] = process.argv.slice(2), out = join(HERE, outRel || 'out/looklab'); mkdirSync(out, { recursive: true });
const LOOKS = [['plain', { normalScale: 1, knee: 0.135, keep: 0.25 }], ['a', { normalScale: 1, knee: 0.17, keep: 0.45 }], ['b', { normalScale: 1.3, knee: 0.17, keep: 0.45 }], ['c', { normalScale: 1.6, knee: 0.17, keep: 0.45 }], ['d', { normalScale: 1.3, knee: 0.2, keep: 0.6 }]];
const VIEWS = [['front', { az: 25, el: 5, center: null, span: 0.78, bone: 'thorax' }], ['back', { az: 205, el: 5, center: null, span: 0.78, bone: 'thorax' }]];
const S = { mpfb: makeScene(ex, { body: 'mpfb' }), sdf: makeScene(ex, { body: 'sdf' }) };
const t = phase === 'peak' ? S.mpfb.inst.motion.peak : +phase;
for (const [vn, V] of VIEWS) {
  const files = [];
  const p = S.mpfb.inst.skel.bones[V.bone].obj.getWorldPosition(new globalThis.THREE.Vector3());
  const view = { az: V.az, el: V.el, center: [p.x, p.y + 0.02, p.z], span: V.span };
  // the sculpted body, then the figure under each look; the lights stay where the app has them (yaw of the exercise camera)
  const sdfI = engineTile(S.sdf, t, view, 440, { yawDeg: -V.az }); const f0 = join(out, `${ex}_${vn}_sdf.png`); savePNG(f0, 440, sdfI); files.push(f0);
  for (const [ln, L] of LOOKS) { const f = join(out, `${ex}_${vn}_${ln}.png`); savePNG(f, 440, engineTile(S.mpfb, t, view, 440, { ...L, texPng: join(HERE, 'out/figure/nrm.png'), yawDeg: -V.az })); files.push(f); }
  await PNG_join(files, join(out, `${ex}_${vn}_strip.png`));
  console.log('wrote', join(out, `${ex}_${vn}_strip.png`));
}
