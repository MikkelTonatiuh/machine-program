// Steps 4-7 of the figure pipeline (after build_figure.mjs): faceless head, normals, engine weights, ambient occlusion,
// the figure's own grip centre and landmarks, UV seams, GLB.
//   node tools/figure_out.mjs [--shaped shaped/x.json] [--name figure_mpfb] [--views]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PARAMS } from './paths.mjs';
import { state } from './build_figure.mjs';
import * as M from './vmath.mjs';
import { renderViews } from './raster.mjs';
import { restField } from './body_field.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const { base, P2, NB, EW, W, bind, ebones, H, RIG, BODYJ, tunnel, HERE } = state;
const NAME = arg('name', 'figure_mpfb');
const OUTD = join(HERE, 'out', NAME); mkdirSync(OUTD, { recursive: true });
const log = (...a) => console.log(...a);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// welded triangles (quads split along the shorter diagonal after mapping)
const P = Float64Array.from(P2);
const tri = [];
const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
const triCorner = []; // per triangle corner: [faceIndex, cornerIndex]
base.faces.forEach((f, fi) => {
  const c = d2(f[0], f[2]) <= d2(f[1], f[3]) ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
  for (const t of c) { for (const k of t) { tri.push(f[k]); triCorner.push([fi, k]); } }
});
const idxW = Uint32Array.from(tri);
const NT = idxW.length / 3;

// ------------------------------------------------------------------ 3b. posterior fill (see tools/figure_backfill.json)
const BACKFILL = arg('backfill', join(PARAMS, 'figure_backfill.json'));
if (BACKFILL !== 'none') {
  const BF = JSON.parse(readFileSync(resolve(HERE, BACKFILL), 'utf8')), tab = BF.table;
  const g = (dy) => { if (dy <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (dy <= tab[i][0]) { const t = (dy - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]); return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * t; } return tab[tab.length - 1][1]; };
  const Pp = bind.pelvis.P, ext = new Map();
  for (let i = 0; i < NB; i++) if (Math.abs(P[i * 3] - Pp[0]) < 0.05) { const k = Math.round((P[i * 3 + 1] - Pp[1]) * 100 / 2); const e = ext.get(k) || [9, -9]; e[0] = Math.min(e[0], P[i * 3 + 2]); e[1] = Math.max(e[1], P[i * 3 + 2]); ext.set(k, e); }
  const zmid = (y) => { const k = (y - Pp[1]) * 100 / 2; let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const e = ext.get(Math.round(k) + d); if (e) { const wt = 3 - Math.abs(d); s += (e[0] + e[1]) / 2 * wt; w += wt; } } return w ? s / w : null; };
  const D = new Float64Array(NB);
  for (let i = 0; i < NB; i++) {
    const y = P[i * 3 + 1], z = P[i * 3 + 2], dy = (y - Pp[1]) * 100, zm = zmid(y); if (zm === null) continue;
    D[i] = g(dy) / 100 * sstep(zm - BF.mid, zm - BF.full, z);
  }
  if (BF.legs) { // the same for each thigh: posterior fill relative to the thigh's own mid-plane (table in cm below the pelvis origin)
    const lt = BF.legs, gl = (dy) => { if (dy >= lt[0][0]) return lt[0][1]; for (let i = 1; i < lt.length; i++) if (dy >= lt[i][0]) { const t = (dy - lt[i - 1][0]) / (lt[i][0] - lt[i - 1][0]); return lt[i - 1][1] + (lt[i][1] - lt[i - 1][1]) * t; } return lt[lt.length - 1][1]; };
    for (const sd of ['_l', '_r']) {
      const xc = bind['thigh' + sd].P[0], e2 = new Map();
      for (let i = 0; i < NB; i++) if (Math.abs(P[i * 3] - xc) < 0.04 && P[i * 3 + 1] < Pp[1] - 0.02) { const k = Math.round((P[i * 3 + 1] - Pp[1]) * 100 / 2); const e = e2.get(k) || [9, -9]; e[0] = Math.min(e[0], P[i * 3 + 2]); e[1] = Math.max(e[1], P[i * 3 + 2]); e2.set(k, e); }
      const zm2 = (y) => { const k = (y - Pp[1]) * 100 / 2; let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const e = e2.get(Math.round(k) + d); if (e) { const wt = 3 - Math.abs(d); s += (e[0] + e[1]) / 2 * wt; w += wt; } } return w ? s / w : null; };
      for (let i = 0; i < NB; i++) {
        if (Math.abs(P[i * 3] - xc) > 0.075 || P[i * 3 + 1] > Pp[1] - 0.01) continue;
        const y = P[i * 3 + 1], dy = (y - Pp[1]) * 100, zm = zm2(y); if (zm === null) continue;
        D[i] = Math.max(D[i], gl(dy) / 100 * sstep(zm - (BF.legMid ?? 0.01), zm - (BF.legFull ?? 0.05), P[i * 3 + 2]));
      }
    }
  }
  { // the displacement field smoothed over the mesh graph (a soft shoulder instead of a ledge)
    const adj = Array.from({ length: NB }, () => new Set());
    for (const f of base.faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; if (a < NB && b < NB) { adj[a].add(b); adj[b].add(a); } }
    for (let it = 0; it < (BF.smooth ?? 8); it++) { const D2 = D.slice(); for (let i = 0; i < NB; i++) { let s = D[i] * 2, n = 2; for (const j of adj[i]) { s += D[j]; n++; } D2[i] = s / n; } D.set(D2); }
  }
  let moved = 0; for (let i = 0; i < NB; i++) if (D[i] > 1e-5) { P[i * 3 + 2] -= D[i]; moved++; }
  log('posterior fill moved', moved, 'vertices');
}

// ------------------------------------------------------------------ 4. faceless head
// the current mannequin's head (data/body.json, bone "head"): smooth union of its ellipsoids, in the head's rest frame
const eulerXYZ = (r) => { const [a, b, c] = (r || [0, 0, 0]).map((x) => x * M.D2R); const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c); return [cb * cc, -cb * sc, sb, ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb, sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb]; };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const headPrims = BODYJ.prims.filter((p) => p.bone === 'head' && p.t === 'ell' && !(p.k < 0)).map((p) => ({ c: p.c.map((x) => x * H), r: p.r.map((x) => x * H), R: eulerXYZ(p.rot), k: (p.k ?? BODYJ.k.head) * H }));
const HB = bind.head, atHead = RIG.bones.find((b) => b.id === 'head').at.map((x) => x * H);
function headSdf(pw) {
  const p = M.add(M.mv(M.tr(HB.R), M.sub(pw, HB.P)), atHead); // bind -> head rest frame
  let d = Infinity;
  for (const q of headPrims) {
    const l = M.mv(M.tr(q.R), M.sub(p, q.c));
    const k0 = Math.hypot(l[0] / q.r[0], l[1] / q.r[1], l[2] / q.r[2]), k1 = Math.hypot(l[0] / q.r[0] ** 2, l[1] / q.r[1] ** 2, l[2] / q.r[2] ** 2);
    const e = k1 < 1e-12 ? -Math.min(...q.r) : k0 * (k0 - 1) / k1;
    d = d === Infinity ? e : smin(d, e, q.k);
  }
  return neck ? smin(d, neckSdf(pw), +arg('neckK', 0.03)) : d;
}
// MPFB's own neck as an elliptical cone (fitted to the vertices the neck bones own), merged with the head by a smooth
// union, so the head blends into the real neck with a fillet instead of a step
let neck = null;
function neckSdf(pw) {
  const l = M.mv(M.tr(neck.R), M.sub(pw, neck.a)), t = Math.max(0, Math.min(1, l[1] / neck.h));
  const rx = neck.rx[0] + (neck.rx[1] - neck.rx[0]) * t, rz = neck.rz[0] + (neck.rz[1] - neck.rz[0]) * t;
  const radial = Math.hypot(l[0] / rx, l[2] / rz) - 1, rr = Math.min(rx, rz);
  const dy = l[1] < 0 ? -l[1] : l[1] > neck.h ? l[1] - neck.h : 0;
  return Math.hypot(Math.max(radial * rr, 0), dy) + Math.min(Math.max(radial * rr, -dy), 0);
}
{
  const a = bind.neck.P, top = M.add(bind.head.P, M.mv(bind.head.R, [0, 0.02, 0])), ax = M.norm(M.sub(top, a)), h = M.len(M.sub(top, a));
  const F2 = M.frame2(ax, M.mv(bind.neck.R, [1, 0, 0])); const Rn = M.cols(F2[1], F2[0], M.cross(F2[1], F2[0]));
  const xs = [[], []], zs = [[], []];
  for (let i = 0; i < NB; i++) {
    let w = 0; for (const [b, ww] of W[i]) if (/^neck0/.test(b)) w += ww; if (w < 0.7) continue;
    const l = M.mv(M.tr(Rn), M.sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], a)), t = l[1] / h; if (t < 0 || t > 1) continue;
    xs[t < 0.5 ? 0 : 1].push(Math.abs(l[0])); zs[t < 0.5 ? 0 : 1].push(Math.abs(l[2]));
  }
  const q = (A) => { A.sort((x, y) => x - y); return A[Math.floor(A.length * 0.92)] || 0.05; };
  neck = { a, R: Rn, h, rx: [q(xs[0]), q(xs[1])], rz: [q(zs[0]), q(zs[1])] };
  log('neck cone rx', neck.rx.map((x) => x.toFixed(3)), 'rz', neck.rz.map((x) => x.toFixed(3)), 'h', h.toFixed(3));
}
const sgrad = (p) => { const h = 0.0005; const g = [0, 1, 2].map((a) => { const q = p.slice(), r = p.slice(); q[a] += h; r[a] -= h; return (headSdf(q) - headSdf(r)) / (2 * h); }); return M.norm(g); };
const FACE = /^(head|jaw|eye|levator|oris|orbicularis|risorius|temporalis|oculi|special|tongue)/;
const headW = new Float64Array(NB);
for (let i = 0; i < NB; i++) for (const [b, w] of W[i]) if (FACE.test(b)) headW[i] += w;
const T0 = +arg('headT0', 0.45), T1 = +arg('headT1', 0.97);
const projT = new Float64Array(NB), sdfN = new Float64Array(NB * 3);
for (let i = 0; i < NB; i++) {
  const t = sstep(T0, T1, headW[i]); if (t <= 0) continue;
  let p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let it = 0; it < 8; it++) { const f = headSdf(p), g = sgrad(p); p = M.sub(p, M.mul(g, f)); }
  const g = sgrad(p);
  projT[i] = t;
  for (let k = 0; k < 3; k++) { P[i * 3 + k] += (p[k] - P[i * 3 + k]) * t; sdfN[i * 3 + k] = g[k]; }
}

// the seam where the mannequin head meets MPFB's neck: Laplacian smoothing over the blend band and two rings around it
{
  const adj = Array.from({ length: NB }, () => new Set());
  for (let t = 0; t < NT; t++) for (let k = 0; k < 3; k++) { const a = idxW[t * 3 + k], b = idxW[t * 3 + (k + 1) % 3]; adj[a].add(b); adj[b].add(a); }
  let band = new Set(); for (let i = 0; i < NB; i++) if (projT[i] > 0.01 && projT[i] < 0.99) band.add(i);
  for (let r = 0; r < +arg('seamRings', 3); r++) { const nb = new Set(band); for (const i of band) for (const j of adj[i]) if (projT[j] < 0.99) nb.add(j); band = nb; }
  const Q = new Float64Array(P);
  for (let it = 0; it < +arg('seamIters', 10); it++) {
    for (const i of band) { let s = [0, 0, 0], n = 0; for (const j of adj[i]) { s[0] += P[j * 3]; s[1] += P[j * 3 + 1]; s[2] += P[j * 3 + 2]; n++; } for (let k = 0; k < 3; k++) Q[i * 3 + k] = 0.5 * P[i * 3 + k] + 0.5 * s[k] / n; }
    for (const i of band) for (let k = 0; k < 3; k++) P[i * 3 + k] = Q[i * 3 + k];
  }
  log('head seam smoothed over', band.size, 'vertices');
}

// ------------------------------------------------------------------ 5. normals, weights, AO
const N = new Float64Array(NB * 3);
for (let t = 0; t < NT; t++) {
  const a = idxW[t * 3], b = idxW[t * 3 + 1], c = idxW[t * 3 + 2];
  const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), v = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
  const n = M.cross(u, v);
  for (const i of [a, b, c]) for (let k = 0; k < 3; k++) N[i * 3 + k] += n[k];
}
for (let i = 0; i < NB; i++) {
  let n = M.norm([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
  if (projT[i] > 0) n = M.norm(M.lerp(n, [sdfN[i * 3], sdfN[i * 3 + 1], sdfN[i * 3 + 2]], Math.min(1, projT[i] * 1.5)));
  N[i * 3] = n[0]; N[i * 3 + 1] = n[1]; N[i * 3 + 2] = n[2];
}
// engine bones: the skeleton's order (rig bones, each _l followed by its _r), then the two forearm twist helpers
const BONES = ebones.map((b) => b.id).concat(['ftw_l', 'ftw_r']);
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
const skI = new Uint8Array(NB * 4), skW = new Float64Array(NB * 4);
for (let i = 0; i < NB; i++) {
  const top = EW[i].slice(0, 4), s = top.reduce((a, x) => a + x[1], 0);
  top.forEach(([e, w], k) => { skI[i * 4 + k] = BI[e]; skW[i * 4 + k] = w / s; });
}
// ambient occlusion: cosine-weighted rays against the bind mesh (uniform grid), occlusion falling off over 9 cm
const AO = new Float64Array(NB).fill(1);
{
  const cell = 0.03; let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < NB; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i * 3 + k]); mx[k] = Math.max(mx[k], P[i * 3 + k]); }
  const dim = [0, 1, 2].map((k) => Math.ceil((mx[k] - mn[k]) / cell) + 1);
  const grid = new Map();
  for (let t = 0; t < NT; t++) {
    const lo = [0, 1, 2].map((k) => Math.floor((Math.min(P[idxW[t * 3] * 3 + k], P[idxW[t * 3 + 1] * 3 + k], P[idxW[t * 3 + 2] * 3 + k]) - mn[k]) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor((Math.max(P[idxW[t * 3] * 3 + k], P[idxW[t * 3 + 1] * 3 + k], P[idxW[t * 3 + 2] * 3 + k]) - mn[k]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const key = x + dim[0] * (y + dim[1] * z); let L = grid.get(key); if (!L) grid.set(key, L = []); L.push(t); }
  }
  const hit = (o, d, tmax, self) => { // Moller-Trumbore over the grid cells along the ray (fixed steps of half a cell)
    const seen = new Set(); let best = tmax;
    for (let s = 0; s <= tmax + cell; s += cell * 0.5) {
      const q = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
      const c = [0, 1, 2].map((k) => Math.floor((q[k] - mn[k]) / cell));
      if (c.some((x, k) => x < 0 || x >= dim[k])) break;
      const L = grid.get(c[0] + dim[0] * (c[1] + dim[1] * c[2])); if (!L) continue;
      for (const t of L) {
        if (seen.has(t)) continue; seen.add(t);
        const a = idxW[t * 3], b = idxW[t * 3 + 1], cc = idxW[t * 3 + 2]; if (a === self || b === self || cc === self) continue;
        const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], e1 = [P[b * 3] - A[0], P[b * 3 + 1] - A[1], P[b * 3 + 2] - A[2]], e2 = [P[cc * 3] - A[0], P[cc * 3 + 1] - A[1], P[cc * 3 + 2] - A[2]];
        const pv = M.cross(d, e2), det = M.dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
        const tv = M.sub(o, A), u = M.dot(tv, pv) / det; if (u < 0 || u > 1) continue;
        const qv = M.cross(tv, e1), v = M.dot(d, qv) / det; if (v < 0 || u + v > 1) continue;
        const tt = M.dot(e2, qv) / det; if (tt > 0.004 && tt < best) best = tt;
      }
      if (best < s) break;
    }
    return best;
  };
  const NR = 24, DMAX = 0.09, dirs = [];
  for (let k = 0; k < NR; k++) { const u1 = (k + 0.5) / NR, u2 = (k * 0.618034) % 1; const r = Math.sqrt(u1), ph = 2 * Math.PI * u2; dirs.push([r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - u1)]); }
  for (let i = 0; i < NB; i++) {
    if (projT[i] > 0.9) continue; // the projected head is smooth and open
    const n = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
    const a1 = M.norm(M.cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), a2 = M.cross(n, a1);
    const o = M.add([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], M.mul(n, 0.002));
    let occ = 0;
    for (const d of dirs) { const w = [0, 1, 2].map((k) => a1[k] * d[0] + a2[k] * d[1] + n[k] * d[2]); const t = hit(o, w, DMAX, i); if (t < DMAX) occ += 1 - t / DMAX; }
    AO[i] = Math.max(0, 1 - 1.6 * occ / NR);
  }
  // smoothing over the mesh graph
  const adj = Array.from({ length: NB }, () => new Set());
  for (let t = 0; t < NT; t++) for (let k = 0; k < 3; k++) { const a = idxW[t * 3 + k], b = idxW[t * 3 + (k + 1) % 3]; adj[a].add(b); adj[b].add(a); }
  for (let it = 0; it < 3; it++) { const A2 = AO.slice(); for (let i = 0; i < NB; i++) { let s = AO[i] * 2, w = 2; for (const j of adj[i]) { s += AO[j]; w++; } A2[i] = s / w; } AO.set(A2); }
}

// ------------------------------------------------------------------ 6. the figure's own grip centre and landmarks
const grip = {};
{
  const t = tunnel.L, hb = bind.hand_l, s = hb.A[0];
  const c = M.add(hb.P, M.mul(M.sub(t.c, t.wrist), s));
  const off = M.mv(M.tr(hb.R), M.sub(c, hb.P)).map((x) => x / H);
  grip.offset = [+off[0].toFixed(4), +off[1].toFixed(4), +off[2].toFixed(4)]; grip.axis = [1, 0, 0];
  grip.radius = +(t.r / H).toFixed(4);
  log('grip offset (H, hand-local)', grip.offset, 'tunnel radius', t.r.toFixed(4), 'm');
}
// landmarks: each old landmark moved along the old surface normal onto the new surface (same offset from the surface)
const OLD = restField(BODYJ, RIG);
const KEEP = arg('keep', 'ischia_c,sacrum,thorax_back').split(',');
const landmarks = { note: 'rig.json landmarks re-measured on this figure: each moved along the old body surface normal onto this surface, keeping its offset from the surface' };
for (const [name, v] of Object.entries(RIG.landmarks)) {
  if (name === 'note') continue;
  for (const [nm, bone, p] of [[name, v[0], v[1]], ...(/_l$/.test(name) ? [[name.replace(/_l$/, '_r'), v[0].replace(/_l$/, '_r'), [-v[1][0], v[1][1], v[1][2]]]] : [])]) {
    if (KEEP.includes(nm.replace(/_[lr]$/, ''))) { if (!/_r$/.test(nm)) landmarks[nm] = [bone, p]; log('  landmark', nm.padEnd(16), 'kept (a pin: the sculpted body value places the pelvis as every exercise was authored)'); continue; }
    const f = OLD.at(p), g = OLD.grad(p), B = bind[bone], atB = ebones.find((b) => b.id === bone).at;
    const o = M.add(B.P, M.mv(B.R, M.sub(M.mul(p, H), atB))), d = M.mv(B.R, g);
    let best = null;
    for (let t = 0; t < NT; t++) {
      const a = idxW[t * 3], b = idxW[t * 3 + 1], c = idxW[t * 3 + 2];
      const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], e1 = [P[b * 3] - A[0], P[b * 3 + 1] - A[1], P[b * 3 + 2] - A[2]], e2 = [P[c * 3] - A[0], P[c * 3 + 1] - A[1], P[c * 3 + 2] - A[2]];
      const pv = M.cross(d, e2), det = M.dot(e1, pv); if (Math.abs(det) < 1e-14) continue;
      const tv = M.sub(o, A), u = M.dot(tv, pv) / det; if (u < 0 || u > 1) continue;
      const qv = M.cross(tv, e1), w = M.dot(d, qv) / det; if (w < 0 || u + w > 1) continue;
      const tt = M.dot(e2, qv) / det; if (Math.abs(tt) < 0.08 && (best === null || Math.abs(tt) < Math.abs(best))) best = tt;
    }
    if (best === null) { landmarks[nm] = [bone, p]; log('  landmark', nm, 'no surface hit, kept'); continue; }
    const hitW = M.add(o, M.mul(d, best + f * H));
    const np = M.mul(M.add(M.mv(M.tr(B.R), M.sub(hitW, B.P)), atB), 1 / H).map((x) => +x.toFixed(4));
    if (/_r$/.test(nm)) continue; // the engine mirrors _l landmarks
    landmarks[nm] = [bone, np];
    log('  landmark', nm.padEnd(16), 'moved', ((best) * 100).toFixed(1), 'cm along the old normal', g.map((x) => x.toFixed(2)).join(','));
  }
}

// ------------------------------------------------------------------ 7. UV seams split, GLB
const keyOf = new Map(), weld = [], uv = [];
const ridx = new Uint32Array(NT * 3);
for (let c = 0; c < NT * 3; c++) {
  const [fi, k] = triCorner[c], v = base.faces[fi][k], t = base.fuv[fi][k], key = v * 65536 + t;
  let r = keyOf.get(key);
  if (r === undefined) { r = weld.length; keyOf.set(key, r); weld.push(v); uv.push(base.VT[t * 2], 1 - base.VT[t * 2 + 1]); }
  ridx[c] = r;
}
const NR_ = weld.length;
log('vertices', NB, 'render vertices', NR_, 'triangles', NT);
const fPos = new Float32Array(NR_ * 3), iNor = new Int8Array(NR_ * 4), uUV = new Uint16Array(NR_ * 2), uJ = new Uint8Array(NR_ * 4), uW = new Uint8Array(NR_ * 4), uAO = new Uint8Array(NR_ * 4), uWeld = new Uint16Array(NR_);
for (let r = 0; r < NR_; r++) {
  const v = weld[r];
  for (let k = 0; k < 3; k++) { fPos[r * 3 + k] = P[v * 3 + k]; iNor[r * 4 + k] = Math.round(N[v * 3 + k] * 127); }
  uUV[r * 2] = Math.round(Math.min(1, Math.max(0, uv[r * 2])) * 65535); uUV[r * 2 + 1] = Math.round(Math.min(1, Math.max(0, uv[r * 2 + 1])) * 65535);
  // weights quantised to bytes that sum to 255
  const w = [0, 1, 2, 3].map((k) => skW[v * 4 + k]), q = w.map((x) => Math.round(x * 255)); q[0] += 255 - q.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 4; k++) { uJ[r * 4 + k] = skI[v * 4 + k]; uW[r * 4 + k] = q[k]; }
  uAO[r * 4] = Math.round(AO[v] * 255); uAO[r * 4 + 1] = Math.round(projT[v] * 255);
  uWeld[r] = v;
}
const idx16 = Uint16Array.from(ridx);
// glTF 2.0 binary with KHR_mesh_quantization; a standard skin (bind pose) so any viewer shows it; engine data in extras
const chunks = [], views = [], accessors = [];
let off = 0;
const addView = (arr, target) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) }); off += b.length + pad; return views.length - 1; };
const addAcc = (arr, ctype, type, count, extra = {}) => { const bv = addView(arr, extra.target); delete extra.target; accessors.push({ bufferView: bv, componentType: ctype, count, type, ...extra }); return accessors.length - 1; };
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let r = 0; r < NR_; r++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], fPos[r * 3 + k]); mx[k] = Math.max(mx[k], fPos[r * 3 + k]); }
const aPos = addAcc(fPos, 5126, 'VEC3', NR_, { min: mn, max: mx, target: 34962 });
// int8 normals padded to 4 bytes per vertex (byteStride 4)
const aNor = (() => { const bv = addView(iNor, 34962); views[bv].byteStride = 4; accessors.push({ bufferView: bv, componentType: 5120, normalized: true, count: NR_, type: 'VEC3' }); return accessors.length - 1; })();
const aUV = addAcc(uUV, 5123, 'VEC2', NR_, { normalized: true, target: 34962 });
const aJ = addAcc(uJ, 5121, 'VEC4', NR_, { target: 34962 });
const aW = addAcc(uW, 5121, 'VEC4', NR_, { normalized: true, target: 34962 });
const aAO = (() => { const bv = addView(uAO, 34962); views[bv].byteStride = 4; accessors.push({ bufferView: bv, componentType: 5121, normalized: true, count: NR_, type: 'VEC2' }); return accessors.length - 1; })();
const aWeld = addAcc(uWeld, 5123, 'SCALAR', NR_, { target: 34962 });
const aIdx = addAcc(idx16, 5123, 'SCALAR', idx16.length, { target: 34963 });
// skin: joint nodes in the bind pose, inverse bind matrices
const nodes = [], jointNodes = [];
const m4 = (R, p) => [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, p[0], p[1], p[2], 1]; // column-major
const parentOf = Object.fromEntries(ebones.map((b) => [b.id, b.parent]));
parentOf.ftw_l = 'fore_l'; parentOf.ftw_r = 'fore_r';
for (const b of BONES) {
  const B = bind[b], pa = parentOf[b];
  let R = B.R, t = B.P;
  if (pa) { const Pp = bind[pa]; R = M.mm(M.tr(Pp.R), B.R); t = M.mv(M.tr(Pp.R), M.sub(B.P, Pp.P)); }
  nodes.push({ name: b, translation: t, rotation: M.quatFromMat(R) });
  jointNodes.push(nodes.length - 1);
}
BONES.forEach((b, i) => { const ch = BONES.map((c, j) => (parentOf[c] === b ? j : -1)).filter((j) => j >= 0); if (ch.length) nodes[i].children = ch; });
const ibm = new Float32Array(BONES.length * 16);
BONES.forEach((b, i) => { const B = bind[b], Ri = M.tr(B.R), ti = M.mul(M.mv(Ri, B.P), -1); ibm.set(m4(Ri, ti), i * 16); });
const aIBM = addAcc(ibm, 5126, 'MAT4', BONES.length);
nodes.push({ name: 'figure', mesh: 0, skin: 0 });
const meshNode = nodes.length - 1;
const extras = {
  units: 'metres, the engine frame (Y up, the figure faces +Z, figure-left +X), in the bind pose below',
  bones: BONES, twist: { ftw_l: 'fore_l', ftw_r: 'fore_r', share: 0.55 },
  bind: Object.fromEntries(BONES.map((b) => [b, { q: M.quatFromMat(bind[b].R).map((x) => +x.toFixed(6)), p: bind[b].P.map((x) => +x.toFixed(5)) }])),
  grip, landmarks,
  attributes: { _AO: 'x: ambient occlusion (1 open), y: faceless-head projection weight', _WELD: 'index of the welded vertex (UV seams split the render vertices; the muscle painter works on the welded mesh)' },
  source: { generator: 'MakeHuman / MPFB 2.0.17 in Blender 4.5 (base mesh, targets, UVs, rig and weights are CC0); node pipeline work/v10/body/tools', macro: state.shapedMeta && state.shapedMeta.macro, targets: state.shapedMeta && state.shapedMeta.targets, licence: 'CC0 1.0' },
};
const gltf = {
  asset: { version: '2.0', generator: 'machine-program figure pipeline (MPFB 2.0.17 body)', copyright: 'CC0 1.0 (MakeHuman assets are CC0)' },
  extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0, scenes: [{ nodes: [0, meshNode] }], nodes,
  skins: [{ joints: jointNodes, inverseBindMatrices: aIBM, skeleton: 0 }],
  meshes: [{ name: 'figure', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUV, JOINTS_0: aJ, WEIGHTS_0: aW, _AO: aAO, _WELD: aWeld }, indices: aIdx, mode: 4 }] }],
  accessors, bufferViews: views, buffers: [{ byteLength: off }], extras,
};
const json = Buffer.from(JSON.stringify(gltf)); const jpad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const bin = Buffer.concat(chunks);
const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + json.length + jpad.length + 8 + bin.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
const glb = Buffer.concat([hdr, ch(json.length + jpad.length, 0x4e4f534a), json, jpad, ch(bin.length, 0x004e4942), bin]);
writeFileSync(join(OUTD, NAME + '.glb'), glb);
log('wrote', join(OUTD, NAME + '.glb'), (glb.length / 1024).toFixed(1), 'KB');
// raw arrays for the definition-map baker
writeFileSync(join(OUTD, 'mesh.json'), JSON.stringify({ NB, P: Array.from(P, (x) => +x.toFixed(5)), N: Array.from(N, (x) => +x.toFixed(4)), idxW: Array.from(idxW), projT: Array.from(projT, (x) => +x.toFixed(3)), weld, uv: uv.map((x) => +x.toFixed(6)), ridx: Array.from(ridx), skI: Array.from(skI), skW: Array.from(skW, (x) => +x.toFixed(4)), bones: BONES }));

if (process.argv.includes('--views')) {
  const Pf = Float32Array.from(P), Nf = Float32Array.from(N), col = new Float32Array(NB * 3);
  for (let i = 0; i < NB; i++) { const a = 0.35 + 0.65 * AO[i]; col[i * 3] = 0.8 * a; col[i * 3 + 1] = 0.78 * a; col[i * 3 + 2] = 0.75 * a; }
  const hp = bind.head.P, hl = bind.hand_l.P;
  renderViews({ P: Pf, N: Nf, idx: idxW }, [{ az: 0, center: [0, 0.95, 0], span: 1.95 }, { az: 90, center: [0, 0.95, 0], span: 1.95 }, { az: 180, center: [0, 0.95, 0], span: 1.95 },
    { az: 30, el: 5, center: [hp[0], hp[1] + 0.08, hp[2] + 0.02], span: 0.36 }, { az: 100, el: 0, center: [hp[0], hp[1] + 0.06, hp[2]], span: 0.36 }, { az: 45, el: 20, center: [hl[0] + 0.02, hl[1] - 0.06, hl[2] + 0.03], span: 0.2 }],
  join(OUTD, 'views.png'), { size: 360, colors: col });
  log('views', join(OUTD, 'views.png'));
}
