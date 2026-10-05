// The default (sculpted) body must be untouched by the figure option: build every exercise's skin and pose it at several
// phases with the engine of a given repo root, and hash the skin arrays and the dual-quaternion uniforms.
//   node tools/regress_default.mjs <repo root> [exercises] > out.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { join, resolve } from 'node:path';
import * as THREE from './three_shim.mjs';
const root = resolve(process.argv[2]);
globalThis.THREE = { ...THREE }; globalThis.MCE = {};
const html = readFileSync(join(root, 'index.html'), 'utf8'), i = html.indexOf('// Machine Coach figure engine - core helpers'), j = html.indexOf('</script>', i);
vm.runInThisContext(html.slice(i, j), { filename: 'core.js' });
for (const f of ['rig.js', 'motion.js', 'machine.js', 'shading.js', 'skinbuild.js', 'instance.js']) vm.runInThisContext(readFileSync(join(root, 'engine', f), 'utf8'), { filename: f });
const M = globalThis.MCE, json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const exs = (process.argv[3] || readdirSync(join(root, 'exercises')).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.replace(/\.json$/, '')).join(',')).split(',');
const h = (...arrs) => { const x = createHash('sha256'); for (const a of arrs) x.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return x.digest('hex').slice(0, 16); };
const out = {};
for (const ex of exs) {
  const rig = json('data/rig.json'), D = { rig, body: M.prepBody(json('data/body.json')), muscles: M.prepMuscles(json('data/muscles.json')) };
  const stage = { opts: {}, mats: M.shading.machineMaterials(), cur: null, phase: 0 };
  const inst = new M.Instance(stage, ex, json('exercises/' + ex + '.json'), D);
  M.shading.setFinish(inst.U, 'clay');
  const R = M.SKIN_MODULE().buildSkin(inst.compileJob());
  inst.attachSkin(R); stage.cur = inst;
  const rec = { skin: h(R.pos, R.nor, R.skI, R.skW, R.musA, R.hd, R.bm, R.idx), poses: [] };
  for (const t of [0, 0.2, 0.45, 0.7, 1]) {
    inst.frame(t);
    const U = inst.U, flat = new Float32Array(U.uQr.value.length * 8 + U.uHB.value.length * 2);
    U.uQr.value.forEach((q, k) => flat.set([q.x, q.y, q.z, q.w], k * 8)); U.uQd.value.forEach((q, k) => flat.set([q.x, q.y, q.z, q.w], k * 8 + 4)); U.uHB.value.forEach((v, k) => flat.set([v.x, v.y], U.uQr.value.length * 8 + k * 2));
    rec.poses.push(h(flat));
  }
  out[ex] = rec;
}
console.log(JSON.stringify(out, null, 1));
