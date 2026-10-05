// The sculpted body's signed-distance field in the REST pose, in node (no browser): the same field the engine meshes
// (engine/skinbuild.js makeField), built from a body.json object the way engine/instance.js compileJob does it, with
// every bone at its rest frame. Used by tools/body_src.mjs to lay grooves onto the sculpted surface, and for probing.
//   import { restField } from './body_field.mjs';
//   const F = restField(body);      // F.at([x, y, z]) -> signed distance (H), F.snap(p, dir) -> surface point (H)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './paths.mjs';
import { loadEngine } from './engine_node.mjs';

loadEngine();
const MCE = globalThis.MCE;
const D2R = Math.PI / 180;

// rotation matrix (row-major 3x3) of a three.js Euler XYZ (degrees): R = Rx * Ry * Rz
function eulerXYZ(r) {
  const [a, b, c] = (r || [0, 0, 0]).map((x) => x * D2R);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [cb * cc, -cb * sc, sb, ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb, sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb];
}
// world -> local as the 12 numbers the mesher reads (rows of [R^T | -R^T t]); R given row-major, columns = local axes
function invRigid(R, t) {
  const m = [];
  for (let i = 0; i < 3; i++) { const cx = R[i], cy = R[3 + i], cz = R[6 + i]; m.push(cx, cy, cz, -(cx * t[0] + cy * t[1] + cz * t[2])); }
  return m;
}

export function restJob(body, rig) {
  rig = rig || JSON.parse(readFileSync(join(REPO, 'data', 'rig.json'), 'utf8'));
  const B = MCE.prepBody(body), H = rig.height, { sideOf, mirId, mirV } = MCE.util;
  const bones = []; for (const b of rig.bones) { bones.push({ id: b.id, at: b.at }); if (sideOf(b.id) === 1) bones.push({ id: mirId(b.id), at: mirV(b.at) }); }
  const idx = Object.fromEntries(bones.map((b, i) => [b.id, i]));
  const bi = (id) => { if (!(id in idx)) throw new Error('no bone ' + id); return idx[id]; };
  const P3 = (p) => [p[0] * H, p[1] * H, p[2] * H];
  const endPt = (e) => (Array.isArray(e) && typeof e[0] === 'string' ? e[1] : e);
  const kOf = (bone) => (B.k[bone] ?? B.k[bone.replace(/_r(?=_|$)/, '_l')] ?? 0.02) * H;
  const list = [];
  for (const d of B.prims) {
    let M, P, S, T;
    if (d.t === 'box' || d.t === 'ell') {
      const c = P3(d.c), R = eulerXYZ(d.rot);
      M = invRigid(R, c);
      if (d.t === 'box') { T = 2; P = [d.h[0] * H, d.h[1] * H, d.h[2] * H, (d.rr || 0.005) * H]; S = [...c, Math.hypot(P[0], P[1], P[2])]; }
      else { T = 0; P = [d.r[0] * H, d.r[1] * H, d.r[2] * H]; S = [...c, Math.max(...P)]; }
    } else {
      const ea = P3(endPt(d.a)), eb = P3(endPt(d.b));
      const ax = [eb[0] - ea[0], eb[1] - ea[1], eb[2] - ea[2]], h = Math.hypot(...ax); ax.forEach((_, i) => { ax[i] /= h; });
      let ex = [1, 0, 0]; let dt = ex[0] * ax[0]; ex = [ex[0] - dt * ax[0], -dt * ax[1], -dt * ax[2]];
      if (Math.hypot(...ex) < 1e-3) { ex = [0, 0, 1]; dt = ax[2]; ex = [-dt * ax[0], -dt * ax[1], 1 - dt * ax[2]]; }
      const el = Math.hypot(...ex); ex = ex.map((x) => x / el);
      const ez = [ex[1] * ax[2] - ex[2] * ax[1], ex[2] * ax[0] - ex[0] * ax[2], ex[0] * ax[1] - ex[1] * ax[0]];
      const R = [ex[0], ax[0], ez[0], ex[1], ax[1], ez[1], ex[2], ax[2], ez[2]];
      M = invRigid(R, ea);
      const ra = d.ra * H, rb = d.rb * H, cb = (ra - rb) / h, ca = Math.sqrt(Math.max(0, 1 - cb * cb));
      T = 1; P = [ra, rb, h, d.sx || 1, d.sz || 1, cb, ca];
      S = [(ea[0] + eb[0]) / 2, (ea[1] + eb[1]) / 2, (ea[2] + eb[2]) / 2, h / 2 + Math.max(ra, rb) * Math.max(d.sx || 1, d.sz || 1)];
    }
    list.push({ T, B: bi(d.bone), M, P, S, K: d.k !== undefined ? d.k * H : kOf(d.bone), n: d.n });
  }
  const NP = list.length;
  const J = { H, nb: bones.length, cell: B.cell * H, kc: B.kc, ao: B.ao, nBody: NP, stripe: 0.0062, groups: [] };
  J.PT = new Int8Array(NP); J.PB = new Int16Array(NP); J.PM = new Float64Array(NP * 12); J.PP = new Float64Array(NP * 8); J.PS = new Float64Array(NP * 4); J.PKS = new Float64Array(NP);
  list.forEach((p, i) => { J.PT[i] = p.T; J.PB[i] = p.B; J.PKS[i] = p.K; J.PM.set(p.M, i * 12); J.PP.set(p.P, i * 8); J.PS.set(p.S, i * 4); });
  const pairs = B.pairs, NPR = pairs.length;
  J.PA = new Int16Array(NPR); J.PC = new Int16Array(NPR); J.PRK = new Float64Array(NPR); J.PRR = new Float64Array(NPR); J.PTAU = new Float64Array(NPR); J.PX = new Float64Array(NPR * 3);
  pairs.forEach((p, i) => {
    J.PA[i] = bi(p.a); J.PC[i] = bi(p.b); J.PRK[i] = (p.k || 0) * H; J.PRR[i] = p.R * H; J.PTAU[i] = (p.tau || 0) * H;
    const c = p.at ? P3(p.at[1]) : P3(bones[bi(p.b)].at); J.PX[i * 3] = c[0]; J.PX[i * 3 + 1] = c[1]; J.PX[i * 3 + 2] = c[2];
  });
  const pairIdx = (a, b) => { const q = pairs.findIndex((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)); if (q < 0) throw new Error('no pair ' + a + '-' + b); return q; };
  J.steps = new Int16Array(B.steps.length * 3);
  B.steps.forEach((s, i) => { J.steps[i * 3] = bi(s[0]); J.steps[i * 3 + 1] = bi(s[1]); J.steps[i * 3 + 2] = pairIdx(s[2] || s[0], s[1]); });
  J.rootSlot = bi(B.root);
  return { J, list, bones, H };
}

// Field in H units: at(p) signed distance (negative inside), grad(p), snap(p, dir) = the surface point along the ray
// p + t * dir nearest to p (bisection on the sign change), or null when the ray misses within `reach`.
export function restField(body, rig) {
  const { J, H } = restJob(body, rig);
  const F = MCE.SKIN_MODULE().makeField(J);
  const at = (p) => F.at(p[0] * H, p[1] * H, p[2] * H) / H;
  const grad = (p, h = 0.0005) => {
    const g = [0, 1, 2].map((a) => { const q = p.slice(), r = p.slice(); q[a] += h; r[a] -= h; return (at(q) - at(r)) / (2 * h); });
    const l = Math.hypot(...g) || 1; return g.map((x) => x / l);
  };
  function snap(p, dir, reach = 0.05) {
    const l = Math.hypot(...dir), d = dir.map((x) => x / l);
    const f = (t) => at([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]);
    // march both ways from p for the nearest sign change
    const step = 0.001; let best = null;
    for (const sg of [1, -1]) {
      let t0 = 0, f0 = f(0);
      for (let t = step; t <= reach; t += step) {
        const f1 = f(sg * t);
        if ((f0 < 0) !== (f1 < 0)) { let a = sg * (t - step), b = sg * t, fa = f(a); for (let k = 0; k < 30; k++) { const m = (a + b) / 2, fm = f(m); if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m; } const tt = (a + b) / 2; if (!best || Math.abs(tt) < Math.abs(best)) best = tt; break; }
        f0 = f1; t0 = t;
      }
    }
    return best == null ? null : [p[0] + d[0] * best, p[1] + d[1] * best, p[2] + d[2] * best];
  }
  return { at, grad, snap, J, H };
}
