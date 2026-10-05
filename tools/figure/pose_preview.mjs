// Joint-deformation check without a browser: an exercise's key poses by FK (the engine's jointQ conventions, no IK, no
// machine), the figure dual-quaternion skinned exactly as the engine does (twist helpers included), software-rendered.
//   node tools/pose_preview.mjs <figure name> <exercise> <out.png> [keys A,B] [views json]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderViews } from './raster.mjs';

const [name, exId, outp, keysArg, viewsArg] = process.argv.slice(2);
import { HERE, REPO } from './paths.mjs';
const m = JSON.parse(readFileSync(join(HERE, 'out', name, 'mesh.json'), 'utf8'));
const glb = readFileSync(join(HERE, 'out', name, name + '.glb')), X = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()).extras;
const RIG = JSON.parse(readFileSync(join(REPO, 'data/rig.json'), 'utf8')), EX = JSON.parse(readFileSync(join(REPO, 'exercises', exId + '.json'), 'utf8'));
const H = RIG.height, D2R = Math.PI / 180;
// quaternions [x, y, z, w]
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qax = (ax, deg) => { const h = deg * D2R / 2, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
const qrot = (q, v) => { const t = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [t[0], t[1], t[2]]; };
const X_ = [1, 0, 0], Y_ = [0, 1, 0], Z_ = [0, 0, 1];
const qa = (a, d) => qax(a === 'x' ? X_ : a === 'y' ? Y_ : Z_, d);
function jointQ(base, s, p) { // engine/rig.js
  const g = (k) => p[k] || 0;
  switch (base) {
    case 'pelvis': case 'lumbar': case 'thorax': case 'neck': case 'head': return qmul(qmul(qa('y', g('rot')), qa('x', g('flex'))), qa('z', -g('lat')));
    case 'clav': return qmul(qa('y', -s * g('pro')), qa('z', s * g('elev')));
    case 'arm': return qmul(qmul(qa('y', -s * g('plane')), qa('z', s * g('elev'))), qa('y', s * g('rot')));
    case 'fore': return qa('x', -g('flex'));
    case 'hand': return qmul(qmul(qa('y', -s * g('pro')), qa('x', -g('flex'))), qa('z', s * g('dev')));
    case 'thigh': return qmul(qmul(qa('x', -g('flex')), qa('z', s * g('abd'))), qa('y', s * g('rot')));
    case 'shank': return qa('x', g('flex'));
    case 'foot': return qmul(qa('x', -g('dorsi')), qa('z', -s * g('inv')));
    case 'toe': return qa('x', -g('ext'));
  }
  return [0, 0, 0, 1];
}
const bones = []; for (const b of RIG.bones) { bones.push({ id: b.id, parent: b.parent, at: b.at }); if (/_l$/.test(b.id)) bones.push({ id: b.id.replace(/_l$/, '_r'), parent: b.parent && b.parent.replace(/_l$/, '_r'), at: [-b.at[0], b.at[1], b.at[2]] }); }
const merge = (...ps) => { const o = {}; for (const p of ps) if (p) for (const [k, v] of Object.entries(p)) o[k] = k === 'root' ? v.slice() : { ...(o[k] || {}), ...v }; return o; };
const mirror = (p) => { const o = { ...p }; if (EX.motion.mirror === false) return o; for (const [k, v] of Object.entries(p)) if (/_l$/.test(k) && !p[k.replace(/_l$/, '_r')]) o[k.replace(/_l$/, '_r')] = { ...v }; return o; };
function fk(pose) {
  const W = {};
  const root = pose.root || EX.motion.root || [0, 0.53, 0];
  for (const b of bones) {
    const s = /_l$/.test(b.id) ? 1 : /_r$/.test(b.id) ? -1 : 0, base = b.id.replace(/_[lr]$/, '');
    const lq = jointQ(base, s, pose[b.id] || {});
    if (!b.parent) W[b.id] = { q: lq, p: root.map((x) => x * H) };
    else { const P = W[b.parent], pb = bones.find((x) => x.id === b.parent); const off = [0, 1, 2].map((k) => (b.at[k] - pb.at[k]) * H); const r = qrot(P.q, off); W[b.id] = { q: qmul(P.q, lq), p: [P.p[0] + r[0], P.p[1] + r[1], P.p[2] + r[2]] }; }
  }
  return W;
}
function skin(W) {
  const BN = m.bones, Q = [], T = [];
  const dq = (q, p, bq, bp) => { const r = qmul(q, qinv(bq)), rb = qrot(r, bp), t = [p[0] - rb[0], p[1] - rb[1], p[2] - rb[2]]; return { r, d: [0.5 * (t[0] * r[3] + t[1] * r[2] - t[2] * r[1]), 0.5 * (-t[0] * r[2] + t[1] * r[3] + t[2] * r[0]), 0.5 * (t[0] * r[1] - t[1] * r[0] + t[2] * r[3]), -0.5 * (t[0] * r[0] + t[1] * r[1] + t[2] * r[2])] }; };
  for (const b of BN) {
    if (b.startsWith('ftw_')) {
      const s = b.slice(-1), f = W['fore_' + s], h = W['hand_' + s], bf = X.bind['fore_' + s], bh = X.bind['hand_' + s];
      const L = qmul(qinv(f.q), h.q), Lb = qmul(qinv(bf.q), bh.q), Dq = qmul(L, qinv(Lb));
      let th = 2 * Math.atan2(Dq[1], Dq[3]); if (th > Math.PI) th -= 2 * Math.PI; if (th < -Math.PI) th += 2 * Math.PI;
      const qt = qmul(f.q, qax(Y_, th * (X.twist.share ?? 0.55) / D2R));
      const o = dq(qt, f.p, bf.q, bf.p); Q.push(o.r); T.push(o.d); continue;
    }
    const o = dq(W[b].q, W[b].p, X.bind[b].q, X.bind[b].p); Q.push(o.r); T.push(o.d);
  }
  const n = m.NB, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const r0 = Q[m.skI[v * 4]]; let qr = [0, 0, 0, 0], qd = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { const w = m.skW[v * 4 + k]; if (!w) continue; const bi = m.skI[v * 4 + k], rq = Q[bi], d = T[bi]; const s = r0[0] * rq[0] + r0[1] * rq[1] + r0[2] * rq[2] + r0[3] * rq[3] < 0 ? -w : w; for (let c = 0; c < 4; c++) { qr[c] += rq[c] * s; qd[c] += d[c] * s; } }
    const l = Math.hypot(...qr); qr = qr.map((x) => x / l); qd = qd.map((x) => x / l);
    const p = [m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]], nn = [m.N[v * 3], m.N[v * 3 + 1], m.N[v * 3 + 2]];
    const rp = qrot(qr, p), rn = qrot(qr, nn);
    const t = [2 * (qr[3] * qd[0] - qd[3] * qr[0] + qr[1] * qd[2] - qr[2] * qd[1]), 2 * (qr[3] * qd[1] - qd[3] * qr[1] + qr[2] * qd[0] - qr[0] * qd[2]), 2 * (qr[3] * qd[2] - qd[3] * qr[2] + qr[0] * qd[1] - qr[1] * qd[0])];
    for (let c = 0; c < 3; c++) { P[v * 3 + c] = rp[c] + t[c]; N[v * 3 + c] = rn[c]; }
  }
  return { P, N, idx: Uint32Array.from(m.idxW) };
}
if (process.env.DUMP_REST) { const W0 = fk({ root: [0, 0.53, 0] }), r = skin(W0); (await import('node:fs')).writeFileSync(process.env.DUMP_REST, JSON.stringify({ P: Array.from(r.P, (x) => +x.toFixed(5)), NB: m.NB })); process.exit(0); }
const keys = (keysArg || 'A,B').split(',');
const base = EX.motion.base || {};
const views = viewsArg ? JSON.parse(viewsArg) : [{ az: 90, el: 5, span: 1.5 }, { az: 30, el: 15, span: 1.5 }];
const sheet = [];
for (const k of keys) {
  const pose = mirror(merge(base, EX.motion.keys[k]));
  const W = fk(pose), msh = skin(W);
  const c = W.pelvis.p;
  for (const v of views) sheet.push({ msh, v: { ...v, center: v.center || [c[0], c[1] + 0.1, c[2]] } });
}
// one image per key row
const S = 380; let k = 0;
for (const kk of keys) { renderViews(sheet[k].msh, sheet.slice(k, k + views.length).map((x) => x.v), outp.replace(/\.png$/, `_${kk}.png`), { size: S }); k += views.length; }
console.log('ok', keys.join(','));
