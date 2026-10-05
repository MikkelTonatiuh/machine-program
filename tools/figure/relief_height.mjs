// The mannequin's relief lines (data/body.json primitives with a negative k: linea alba, tendinous intersections, navel,
// inguinal V-lines, lower pec edge, natal cleft, spinal furrow) as a height field on the figure: the same primitives, carried
// to the figure's bind pose on their bones, snapped onto the figure's skin along the front / back direction (the figure's
// torso is not where the mannequin's was), evaluated with the engine's own primitive distance functions and the engine's
// groove profile (engine/skinbuild.js makeField).
//   import { makeRelief } from './relief_height.mjs'; const rel = makeRelief(F, meshTris); rel.at(x, y, z) -> metres (+ raised)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as M from './vmath.mjs';
import { REPO, skinModule, rig } from './figlib.mjs';
import { loadEngine } from './engine_node.mjs';

const quatMat = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
const eulerXYZ = (r) => { const [a, b, c] = (r || [0, 0, 0]).map((x) => x * M.D2R); const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c); return [cb * cc, -cb * sc, sb, ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb, sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb]; };
const invRigid = (R, t) => { const m = []; for (let i = 0; i < 3; i++) { const cx = R[i], cy = R[3 + i], cz = R[6 + i]; m.push(cx, cy, cz, -(cx * t[0] + cy * t[1] + cz * t[2])); } return m; };

let _prep = null;
function prepBody() {
  if (_prep) return _prep;
  loadEngine();
  return (_prep = globalThis.MCE.prepBody(JSON.parse(readFileSync(join(REPO, 'data/body.json'), 'utf8'))));
}

// tris: { P: positions (Float64/32, metres, bind frame), idx } the figure's welded mesh, for snapping
export function makeRelief(F, tris, { snapReach = 0.07, extra = null } = {}) {
  const SK = skinModule(), RIG = rig(), H = RIG.height, B0 = prepBody();
  // extra lines (same schema as body.json primitives) are mirrored by the engine's own prepBody
  const B = extra ? { prims: [...B0.prims, ...globalThis.MCE.prepBody({ prims: extra, pairs: [], union: { steps: [], root: 'pelvis' }, k: {}, cell: 0.0054, ao: [] }).prims] } : B0;
  const atOf = {}; for (const b of RIG.bones) { atOf[b.id] = b.at; if (/_l$/.test(b.id)) atOf[b.id.replace(/_l$/, '_r')] = [-b.at[0], b.at[1], b.at[2]]; }
  const bind = Object.fromEntries(Object.entries(F.X.bind).map(([b, v]) => [b, { R: quatMat(v.q), p: v.p }]));
  const worldOf = (bone, p) => { const b = bind[bone], a = atOf[bone], d = [(p[0] - a[0]) * H, (p[1] - a[1]) * H, (p[2] - a[2]) * H]; return M.add(b.p, M.mv(b.R, d)); };
  const { P, idx } = tris;
  // ray -> nearest skin hit along +-dir within reach (Moller-Trumbore, brute force: a few dozen points)
  const snap = (p, dir) => {
    let best = null;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], e1 = [P[b * 3] - A[0], P[b * 3 + 1] - A[1], P[b * 3 + 2] - A[2]], e2 = [P[c * 3] - A[0], P[c * 3 + 1] - A[1], P[c * 3 + 2] - A[2]];
      const pv = M.cross(dir, e2), det = M.dot(e1, pv); if (Math.abs(det) < 1e-14) continue;
      const tv = M.sub(p, A), u = M.dot(tv, pv) / det; if (u < 0 || u > 1) continue;
      const qv = M.cross(tv, e1), v = M.dot(dir, qv) / det; if (v < 0 || u + v > 1) continue;
      const tt = M.dot(e2, qv) / det; if (Math.abs(tt) < snapReach && (best === null || Math.abs(tt) < Math.abs(best))) best = tt;
    }
    return best === null ? p : M.add(p, M.mul(dir, best));
  };
  const list = [], names = [];
  for (const d of B.prims) {
    if (!(d.k < 0)) continue;
    const bn = d.bone, b = bind[bn], front = !/^(cleft|spine)/.test(d.n);
    const sdir = M.mv(b.R, [0, 0, front ? 1 : -1]);
    const isRef = (e) => Array.isArray(e) && typeof e[0] === 'string';
    const wp = (e) => snap(isRef(e) ? worldOf(e[0], e[1]) : worldOf(bn, e), sdir);
    let T, Pp, Mm, S;
    if (d.t === 'ell') {
      const c = snap(worldOf(bn, d.c), sdir), R = M.mm(b.R, eulerXYZ(d.rot));
      T = 0; Pp = [d.r[0] * H, d.r[1] * H, d.r[2] * H]; Mm = invRigid(R, c); S = [...c, Math.max(...Pp)];
    } else if (d.t === 'cone') {
      const ea = wp(d.a), eb = wp(d.b), ax0 = M.sub(eb, ea), h = M.len(ax0), ax = M.mul(ax0, 1 / h);
      let ex = M.col(b.R, 0); ex = M.sub(ex, M.mul(ax, M.dot(ex, ax))); if (M.len(ex) < 1e-3) { ex = M.col(b.R, 2); ex = M.sub(ex, M.mul(ax, M.dot(ex, ax))); } ex = M.norm(ex);
      const ez = M.cross(ex, ax), R = M.cols(ex, ax, ez), ra = d.ra * H, rb = d.rb * H, cb = (ra - rb) / h, ca = Math.sqrt(Math.max(0, 1 - cb * cb));
      T = 1; Pp = [ra, rb, h, d.sx || 1, d.sz || 1, cb, ca]; Mm = invRigid(R, ea); S = [0, 0, 0, h / 2 + ra];
    } else continue;
    list.push({ T, Pp, Mm, K: d.k * H }); names.push(d.n);
  }
  const NP = list.length, J = { H, nb: 1, cell: 0.01, kc: 0.004, ao: null, nBody: NP };
  J.PT = new Int8Array(NP); J.PB = new Int16Array(NP); J.PM = new Float64Array(NP * 12); J.PP = new Float64Array(NP * 8); J.PS = new Float64Array(NP * 4); J.PKS = new Float64Array(NP);
  list.forEach((p, i) => { J.PT[i] = p.T; J.PB[i] = 0; J.PKS[i] = p.K; J.PM.set(p.Mm, i * 12); J.PP.set(p.Pp, i * 8); });
  J.PA = new Int16Array(0); J.PC = new Int16Array(0); J.PRK = new Float64Array(0); J.PRR = new Float64Array(0); J.PTAU = new Float64Array(0); J.PX = new Float64Array(0);
  J.steps = new Int16Array(0); J.rootSlot = 0;
  const FD = SK.makeField(J);
  const GD = new Float64Array(NP), GW = new Float64Array(NP);
  for (let i = 0; i < NP; i++) { const kk = -J.PKS[i] / H; GD[i] = (kk >= 1 ? -(kk - 1) : kk) * H; GW[i] = J.PT[i] === 1 ? J.PP[i * 8] : Math.min(J.PP[i * 8], J.PP[i * 8 + 1], J.PP[i * 8 + 2]); }
  return {
    n: NP, names,
    // metres, + = raised, - = pressed in (the engine's rule: grooves and ridges each combine by their maximum)
    at(x, y, z) {
      let gIn = 0, gOut = 0;
      for (let i = 0; i < NP; i++) {
        const e = FD.evalPrim(i, x, y, z); if (e >= 0) continue;
        const t = -e < GW[i] ? -e / GW[i] : 1, g = GD[i] * t * t * (3 - 2 * t);
        if (g > gIn) gIn = g; else if (-g > gOut) gOut = -g;
      }
      return gOut - gIn;
    },
  };
}
