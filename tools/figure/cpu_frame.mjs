// CPU cost of one frame (solve + skin uniforms) per body in node, with the three.js stand-in: relative numbers only.
import { makeScene } from './engine_sim.mjs';
const exs = (process.argv[2] || 'chest_press,leg_press,lateral_raise,hip_thrust').split(','), N = +(process.argv[3] || 300);
for (const ex of exs) {
  const row = {};
  for (const body of ['sdf', 'mpfb']) {
    const t0 = performance.now(), S = makeScene(ex, { body }), tb = performance.now() - t0;
    for (let i = 0; i < 30; i++) S.inst.frame(i / 30); // warm up
    const t1 = performance.now();
    for (let i = 0; i < N; i++) S.inst.frame((i % 100) / 100);
    row[body] = { ms: ((performance.now() - t1) / N).toFixed(3), build: tb.toFixed(0), tris: S.inst.skin.idx.length / 3, verts: S.inst.skin.NV };
  }
  console.log(ex.padEnd(14), 'frame ms  sdf', row.sdf.ms, ' mpfb', row.mpfb.ms, '| scene build ms', row.sdf.build, row.mpfb.build, '| tris', row.sdf.tris, row.mpfb.tris, '| verts', row.sdf.verts, row.mpfb.verts);
}
