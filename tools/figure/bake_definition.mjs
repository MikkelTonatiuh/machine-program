// The definition map (plan 4.8 b): a tangent-space normal map baked from the engine's own muscle heads, so every visible
// separation lines up with the glow edges. Every head of data/muscles.json (both sides) is painted with the engine's
// painter (engine/skinbuild.js paintFigureGen, run here in node) on the figure subdivided once; each head's belly weight
// makes a mound, heads meeting make a groove; the height field is rasterised into the figure's UV atlas, smoothed inside
// each UV island, and its surface gradient written as normals (three's cotangent-frame convention: x along +u, y along +v).
//   node tools/bake_definition.mjs --name w035 [--size 1024] [--depth 0.004]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { HERE, REPO, PARAMS } from './paths.mjs';
import { loadEngine } from './engine_node.mjs';
import { writePNG, renderViews } from './raster.mjs';
import { makeRelief } from './relief_height.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const STR = +arg('strength', 1), NAME = arg('name', 'w035'), D = join(HERE, 'out', NAME), SIZE = +arg('size', 1024), DEPTH = +arg('depth', 0.004);
const mesh = JSON.parse(readFileSync(join(D, 'mesh.json'), 'utf8'));
const glb = readFileSync(join(D, NAME + '.glb')), X = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()).extras;
const RIG = JSON.parse(readFileSync(join(REPO, 'data/rig.json'), 'utf8')), MUS = JSON.parse(readFileSync(join(REPO, 'data/muscles.json'), 'utf8'));
const H = RIG.height;
const SK = loadEngine().SKIN_MODULE();
const t0 = Date.now();

// ------------------------------------------------------------------ subdivide once (welded mesh + render/UV topology)
const NB = mesh.NB, P = mesh.P, N = mesh.N, BONES = mesh.bones;
const pos = Array.from(P), nor = Array.from(N), sI = Array.from(mesh.skI), sW = Array.from(mesh.skW);
const emap = new Map();
const midW = (a, b) => {
  const k = a < b ? a * 100000 + b : b * 100000 + a; let m = emap.get(k); if (m !== undefined) return m;
  m = pos.length / 3; emap.set(k, m);
  for (let c = 0; c < 3; c++) pos.push((P[a * 3 + c] + P[b * 3 + c]) / 2);
  const n = [0, 1, 2].map((c) => N[a * 3 + c] + N[b * 3 + c]), l = Math.hypot(...n) || 1; nor.push(n[0] / l, n[1] / l, n[2] / l);
  const acc = {}; for (const v of [a, b]) for (let k2 = 0; k2 < 4; k2++) { const w = mesh.skW[v * 4 + k2]; if (w > 0) acc[mesh.skI[v * 4 + k2]] = (acc[mesh.skI[v * 4 + k2]] || 0) + w / 2; }
  const top = Object.entries(acc).sort((x, y) => y[1] - x[1]).slice(0, 4), s = top.reduce((q, x) => q + x[1], 0);
  for (let k2 = 0; k2 < 4; k2++) { sI.push(top[k2] ? +top[k2][0] : 0); sW.push(top[k2] ? top[k2][1] / s : 0); }
  return m;
};
const ridx = mesh.ridx, weld = mesh.weld, uv = mesh.uv;
const fineIdx = [], rTri = []; // welded fine triangles; render fine triangles as [welded, u, v] per corner
const rv = (w, u, v) => ({ w, u, v });
for (let t = 0; t < ridx.length; t += 3) {
  const r = [ridx[t], ridx[t + 1], ridx[t + 2]], wv = r.map((x) => weld[x]);
  const m = [midW(wv[0], wv[1]), midW(wv[1], wv[2]), midW(wv[2], wv[0])];
  const U = r.map((x) => [uv[x * 2], uv[x * 2 + 1]]);
  const mu = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => [(U[i][0] + U[j][0]) / 2, (U[i][1] + U[j][1]) / 2]);
  const C = [rv(wv[0], ...U[0]), rv(wv[1], ...U[1]), rv(wv[2], ...U[2])], M3 = [rv(m[0], ...mu[0]), rv(m[1], ...mu[1]), rv(m[2], ...mu[2])];
  for (const tri of [[C[0], M3[0], M3[2]], [M3[0], C[1], M3[1]], [M3[2], M3[1], C[2]], [M3[0], M3[1], M3[2]]]) { fineIdx.push(tri[0].w, tri[1].w, tri[2].w); rTri.push(tri); }
}
const NF = pos.length / 3;
console.log('fine mesh', NF, 'vertices', fineIdx.length / 3, 'triangles');

// ------------------------------------------------------------------ all heads, both sides, guides in the bind pose
const bindOf = Object.fromEntries(Object.entries(X.bind).map(([b, B]) => { const [x, y, z, w] = B.q; return [b, { R: [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], p: B.p }]; }));
const atOf = {}; for (const b of RIG.bones) { atOf[b.id] = b.at; if (/_l$/.test(b.id)) atOf[b.id.replace(/_l$/, '_r')] = [-b.at[0], b.at[1], b.at[2]]; }
const mirId = (id) => id.replace(/_l$/, '_r'), mirV = (v) => [-v[0], v[1], v[2]];
const worldOf = (bone, p) => { const B = bindOf[bone], a = atOf[bone], d = [(p[0] - a[0]) * H, (p[1] - a[1]) * H, (p[2] - a[2]) * H]; return [0, 1, 2].map((i) => B.p[i] + B.R[i * 3] * d[0] + B.R[i * 3 + 1] * d[1] + B.R[i * 3 + 2] * d[2]); };
function guidesOf(gr, side) { // engine/instance.js _groupGuides
  let guides;
  if (gr.path) {
    const pts = gr.path.pts, nn = gr.path.n, nl = Math.hypot(...nn), n = nn.map((x) => x / nl), w = gr.path.w, Pp = pts.map(([, p]) => p);
    guides = [-1, 0, 1].map((k) => pts.map(([bone, p], i) => {
      const a = Pp[Math.min(Pp.length - 1, i + 1)], b = Pp[Math.max(0, i - 1)], t0 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], tl = Math.hypot(...t0), t = t0.map((x) => x / tl);
      const c = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]], cl = Math.hypot(...c);
      return [bone, [p[0] + c[0] / cl * k * w, p[1] + c[1] / cl * k * w, p[2] + c[2] / cl * k * w]];
    }));
  } else guides = gr.guides;
  return side > 0 ? guides : guides.map((gd) => gd.map(([bone, p]) => [mirId(bone), mirV(p)]));
}
const bi = (id) => { const i = BONES.indexOf(id); if (i < 0) throw new Error('no bone ' + id); return i; };
const groups = []; let hi = 0; const headOf = [];
for (const gr of MUS.groups) for (const side of [1, -1]) {
  const guides = guidesOf(gr, side), Mn = guides.map((g) => g.length), off = []; let n = 0; for (const m of Mn) { off.push(n); n += m; }
  const pts = new Float64Array(n * 3); let o = 0; for (const gd of guides) for (const [bone, p] of gd) { const w = worldOf(bone, p); pts[o++] = w[0]; pts[o++] = w[1]; pts[o++] = w[2]; }
  const gb = [...new Set(guides.flat().map(([bone]) => bi(bone)).concat((gr.bones || []).map((b) => bi(side > 0 ? b : mirId(b)))))];
  groups.push({ id: gr.id + (side > 0 ? '_l' : '_r'), K: guides.length, M: Mn, off, pts, tol: gr.tol || 0.009, sub: gr.sub || 3, merge: gr.merge || 'smooth', bones: gb,
    heads: gr.heads.map((d) => { headOf[hi] = d.id; return { hi: hi++, tier: 1, vc: d.v[0], hw: d.v[1], u0: d.u[0], u1: d.u[1], pk: d.peak ?? 0.5, t0: d.taper[0], t1: d.taper[1], r0: d.round[0], r1: d.round[1], sp: d.spindle ?? 0.7, sheet: d.profile === 'sheet', fade: d.fade ?? 0.62, sk: d.skew ?? 0 }; }) });
}
const job = { H, nb: BONES.length, stripe: MUS.stripe, groups, figure: { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint32Array.from(fineIdx), skI: Float32Array.from(sI), skW: Float32Array.from(sW) } };
const R = SK.buildSkin(job);
console.log('painted', groups.length, 'groups,', hi, 'heads in', ((Date.now() - t0) / 1000).toFixed(1), 's');

// ------------------------------------------------------------------ height per fine vertex (metres, + = raised)
// mound per head from its belly weight; two heads meeting dip to a groove; a muscle's free border slopes to the base; plus the
// mannequin's relief lines (linea alba, intersections, V-lines, ...) laid onto this skin
const hgt = new Float32Array(NF);
const sm = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const BELLY = +arg('belly', 0.9);
for (let v = 0; v < NF; v++) {
  const w0 = R.bm[v * 4 + 1], w1 = R.bm[v * 4 + 3], f = R.musA[v * 4];
  const m0 = sm(w0 / BELLY), m1 = sm(w1 / BELLY);
  hgt[v] = DEPTH * Math.max(0, 1 - (1 - m0) * (1 - 0.65 * m1) - 0.55 * m0 * m1) * sm((f + 0.25) / 0.5);
}
const REL = +arg('relief', 1);
const nWeld = mesh.NB, relMesh = { P: Float64Array.from(P), idx: Uint32Array.from(mesh.idxW) };
const EXTRA = arg('extra', join(PARAMS, 'figure_relief_extra.json'));
const extra = EXTRA === 'none' ? null : JSON.parse(readFileSync(resolve(HERE, EXTRA), 'utf8')).prims;
const rel = makeRelief({ X }, relMesh, { extra });
console.log('relief primitives', rel.n);
const hRel = new Float32Array(NF);
for (let v = 0; v < NF; v++) hRel[v] = REL * rel.at(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
let rmin = 0, rmax = 0; for (let v = 0; v < NF; v++) { rmin = Math.min(rmin, hRel[v]); rmax = Math.max(rmax, hRel[v]); }
console.log('relief range (mm)', (rmin * 1000).toFixed(2), (rmax * 1000).toFixed(2));
for (let v = 0; v < NF; v++) hgt[v] += hRel[v];

// ------------------------------------------------------------------ rasterise into the UV atlas
const S = SIZE, HT = new Float32Array(S * S), COV = new Uint8Array(S * S), GU = new Float32Array(S * S * 3), GV = new Float32Array(S * S * 3), NRM = new Float32Array(S * S * 3), MX = new Float32Array(S * S), MV = new Float32Array(S * S);
const tri3 = (w) => [pos[w * 3], pos[w * 3 + 1], pos[w * 3 + 2]];
for (const tr of rTri) {
  const p = tr.map((c) => tri3(c.w)), e1 = [0, 1, 2].map((k) => p[1][k] - p[0][k]), e2 = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
  const du1 = tr[1].u - tr[0].u, dv1 = tr[1].v - tr[0].v, du2 = tr[2].u - tr[0].u, dv2 = tr[2].v - tr[0].v;
  const a11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], a12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], a22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2], det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-16) continue;
  const grad = (d1, d2) => { const a = (a22 * d1 - a12 * d2) / det, b = (a11 * d2 - a12 * d1) / det; return [0, 1, 2].map((k) => a * e1[k] + b * e2[k]); };
  const gu = grad(du1, du2), gv = grad(dv1, dv2), lu = Math.hypot(...gu), lv = Math.hypot(...gv);
  const X0 = tr.map((c) => c.u * S - 0.5), Y0 = tr.map((c) => c.v * S - 0.5);
  const area = (X0[1] - X0[0]) * (Y0[2] - Y0[0]) - (X0[2] - X0[0]) * (Y0[1] - Y0[0]); if (Math.abs(area) < 1e-12) continue;
  const minx = Math.max(0, Math.floor(Math.min(...X0)) - 1), maxx = Math.min(S - 1, Math.ceil(Math.max(...X0)) + 1), miny = Math.max(0, Math.floor(Math.min(...Y0)) - 1), maxy = Math.min(S - 1, Math.ceil(Math.max(...Y0)) + 1);
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const b0 = ((X0[1] - x) * (Y0[2] - y) - (X0[2] - x) * (Y0[1] - y)) / area, b1 = ((X0[2] - x) * (Y0[0] - y) - (X0[0] - x) * (Y0[2] - y)) / area, b2 = 1 - b0 - b1;
    if (b0 < -0.02 || b1 < -0.02 || b2 < -0.02) continue;
    const i = y * S + x; COV[i] = 1;
    HT[i] = b0 * hgt[tr[0].w] + b1 * hgt[tr[1].w] + b2 * hgt[tr[2].w];
    for (let k = 0; k < 3; k++) { GU[i * 3 + k] = gu[k]; GV[i * 3 + k] = gv[k]; NRM[i * 3 + k] = b0 * nor[tr[0].w * 3 + k] + b1 * nor[tr[1].w * 3 + k] + b2 * nor[tr[2].w * 3 + k]; }
    MX[i] = lu; MV[i] = lv;
  }
}
// smooth the height inside the islands (masked Gaussian, two passes of a 5-tap binomial each way), then the gradient
const blur = (A) => { const T = new Float32Array(A.length), Wt = [1, 4, 6, 4, 1];
  for (const dir of [[1, 0], [0, 1]]) { const src = dir[0] ? A : T, dst = dir[0] ? T : A;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x; if (!COV[i]) { dst[i] = src[i]; continue; } let s = 0, w = 0;
      for (let k = -2; k <= 2; k++) { const xx = x + k * dir[0], yy = y + k * dir[1]; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; const j = yy * S + xx; if (!COV[j]) continue; s += src[j] * Wt[k + 2]; w += Wt[k + 2]; }
      dst[i] = s / w; } } };
for (let it = 0; it < +arg('blur', 10); it++) blur(HT);
const img = Buffer.alloc(S * S * 3);
let maxSlope = 0;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = y * S + x;
  if (!COV[i]) { img[i * 3] = 128; img[i * 3 + 1] = 128; img[i * 3 + 2] = 255; continue; }
  const hx = (xx) => (xx >= 0 && xx < S && COV[y * S + xx] ? HT[y * S + xx] : HT[i]), hy = (yy) => (yy >= 0 && yy < S && COV[yy * S + x] ? HT[yy * S + x] : HT[i]);
  const hu = (hx(x + 1) - hx(x - 1)) / 2 * S, hv = (hy(y + 1) - hy(y - 1)) / 2 * S; // per uv unit
  // three decodes (perturbNormal2Arb) with T = det (dP/dv x N) and B = -det (dP/du x N): along the unit u direction
  // x * |dP/dv| / M and along the unit v direction y * |dP/du| / M, M = max(|dP/du|, |dP/dv|); |grad u| = lu = 1 / |dP/du|.
  // A height field of amplitude STR leans the normal by -STR * (dh/du) * lu along u and -STR * (dh/dv) * lv along v, so
  // x = -STR * hu * max(lu, lv) and y = -STR * hv * max(lu, lv)
  const lu = MX[i], lv = MV[i], L = Math.max(lu, lv);
  const tx = -STR * hu * L, ty = -STR * hv * L, l = Math.hypot(tx, ty, 1);
  maxSlope = Math.max(maxSlope, Math.hypot(tx, ty));
  img[i * 3] = Math.round((tx / l * 0.5 + 0.5) * 255); img[i * 3 + 1] = Math.round((ty / l * 0.5 + 0.5) * 255); img[i * 3 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
}
// dilate the islands by 8 texels (mipmaps must not pull the flat background into the borders)
for (let it = 0; it < 8; it++) {
  const grow = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x; if (COV[i]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; const j = yy * S + xx; if (COV[j]) { grow.push([i, j]); break; } } }
  for (const [i, j] of grow) { COV[i] = 1; img[i * 3] = img[j * 3]; img[i * 3 + 1] = img[j * 3 + 1]; img[i * 3 + 2] = img[j * 3 + 2]; }
}
writePNG(join(D, 'nrm.png'), S, S, img);
// a height preview too
const hi8 = Buffer.alloc(S * S * 3); for (let i = 0; i < S * S; i++) { const v = Math.round(HT[i] * 255); hi8[i * 3] = hi8[i * 3 + 1] = hi8[i * 3 + 2] = v; }
writePNG(join(D, 'height.png'), S, S, hi8);
writeFileSync(join(D, 'fine_height.json'), JSON.stringify({ NF, h: Array.from(hgt, (x) => +x.toFixed(3)) }));
console.log('wrote', join(D, 'nrm.png'), 'max slope', maxSlope.toFixed(3), 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');

// ------------------------------------------------------------------ preview: the fine mesh with the heights as real displacement
if (process.argv.includes('--preview')) {
  const k = +arg('disp', 1), Pd = new Float32Array(NF * 3), Nd = new Float32Array(NF * 3), idxF = Uint32Array.from(fineIdx);
  for (let v = 0; v < NF; v++) for (let c = 0; c < 3; c++) Pd[v * 3 + c] = pos[v * 3 + c] + nor[v * 3 + c] * hgt[v] * k;
  for (let t = 0; t < idxF.length; t += 3) {
    const a = idxF[t], b = idxF[t + 1], c2 = idxF[t + 2];
    const u = [0, 1, 2].map((q) => Pd[b * 3 + q] - Pd[a * 3 + q]), w = [0, 1, 2].map((q) => Pd[c2 * 3 + q] - Pd[a * 3 + q]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const i of [a, b, c2]) for (let q = 0; q < 3; q++) Nd[i * 3 + q] += n[q];
  }
  for (let v = 0; v < NF; v++) { const l = Math.hypot(Nd[v * 3], Nd[v * 3 + 1], Nd[v * 3 + 2]) || 1; for (let q = 0; q < 3; q++) Nd[v * 3 + q] /= l; }
  const c = [0, 1.2, 0.05];
  renderViews({ P: Pd, N: Nd, idx: idxF }, JSON.parse(arg('pviews', '[{"az":0,"center":[0,1.2,0.05],"span":0.85},{"az":-35,"el":5,"center":[0,1.2,0.05],"span":0.85},{"az":90,"center":[0,1.2,0.05],"span":0.85},{"az":180,"center":[0,1.2,0.05],"span":0.85},{"az":0,"center":[0,0.6,0.05],"span":0.9}]')), join(D, arg('ptag', 'relief_preview') + '.png'), { size: 380 });
  console.log('preview', join(D, 'relief_preview.png'));
}
