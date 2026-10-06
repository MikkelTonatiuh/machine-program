// MPFB body -> the engine's figure asset (data/figure_mpfb.glb + its definition map).
//   node tools/build_figure.mjs [--shaped shaped/m_w035.json] [--out out/fig] [--views]
// Steps (all in node, from the MPFB shaped positions and MPFB's CC0 rig / weight / UV data):
//  1. the shaped base mesh, grounded; MPFB joints by the default rig's strategies; MPFB weights
//  2. pre-pose in MPFB space with MPFB's own weights (linear blend): the hands closed into a power grip
//  3. the bind pose: every engine bone (21 + 2 forearm twist helpers) oriented along the MPFB segment it stands for, at
//     the engine's own joint positions (rig.json, FK); each MPFB segment is moved onto its engine segment and scaled
//     along its axis (blended by the summed weights), so joint centres, grip and sole match the engine exactly
//  4. faceless head: the head region is projected onto the current mannequin head (data/body.json head primitives)
//  5. engine weights (top 4), normals, ambient occlusion, UV seams split, GLB written
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import * as io from './mpfb_io.mjs';
import * as M from './vmath.mjs';
import { renderViews } from './raster.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
import { HERE, REPO } from './paths.mjs';
const OUT = arg('out', join(HERE, 'out', 'fig'));
mkdirSync(dirname(OUT), { recursive: true });
const RIG = JSON.parse(readFileSync(join(REPO, 'data/rig.json'), 'utf8'));
const BODYJ = JSON.parse(readFileSync(join(REPO, 'data/body.json'), 'utf8'));
const H = RIG.height;
const log = (...a) => console.log(...a);

// ------------------------------------------------------------------ 1. load
const base = io.readBaseObj();
let V = base.V, shapedMeta = null;
if (arg('shaped')) { const s = io.readShaped(resolve(HERE, arg('shaped'))); V = s.V; shapedMeta = s.meta; }
if (arg('targets')) { const { applyTargets } = await import('./targets.mjs'); applyTargets(V, JSON.parse(readFileSync(resolve(HERE, arg('targets')), 'utf8'))); log('targets applied', arg('targets')); }
const NB = 13380; // body vertices
{ let ymin = Infinity; for (let i = 0; i < NB; i++) ymin = Math.min(ymin, V[i * 3 + 1]); for (let i = 0; i < V.length / 3; i++) V[i * 3 + 1] -= ymin; }
// the nipples (MakeHuman's carry a small cavity) smoothed away: umbrella smoothing weighted by the distance to the nipple vertex
{
  const adj = Array.from({ length: NB }, () => new Set());
  for (const f of base.faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; if (a < NB && b < NB) { adj[a].add(b); adj[b].add(a); } }
  const R = +arg('nippleR', 0.03), IT = +arg('nippleIters', 40);
  for (const c of [8451, 1779]) {
    const cx = [V[c * 3], V[c * 3 + 1], V[c * 3 + 2]], w = new Float64Array(NB);
    for (let i = 0; i < NB; i++) { const d = Math.hypot(V[i * 3] - cx[0], V[i * 3 + 1] - cx[1], V[i * 3 + 2] - cx[2]); if (d < R) { const t = 1 - d / R; w[i] = t * t * (3 - 2 * t); } }
    for (let it = 0; it < IT; it++) {
      const Q = Float64Array.from(V);
      for (let i = 0; i < NB; i++) if (w[i] > 0) { let sx = 0, sy = 0, sz = 0, n = 0; for (const j of adj[i]) { sx += V[j * 3]; sy += V[j * 3 + 1]; sz += V[j * 3 + 2]; n++; } const a = 0.6 * w[i]; Q[i * 3] += (sx / n - V[i * 3]) * a; Q[i * 3 + 1] += (sy / n - V[i * 3 + 1]) * a; Q[i * 3 + 2] += (sz / n - V[i * 3 + 2]) * a; }
      V.set(Q);
    }
  }
}
const rigM = io.readRig();
const Jm = io.mpfbJoints(V, rigM);
const W = io.readWeights(V.length / 3);
const order = Object.keys(rigM).sort((a, b) => depth(a) - depth(b));
function depth(n) { let d = 0; while (rigM[n].parent) { n = rigM[n].parent; d++; } return d; }
const P0 = (i) => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
let stature = 0; for (let i = 0; i < NB; i++) stature = Math.max(stature, V[i * 3 + 1]);
log('stature', stature.toFixed(4), shapedMeta ? JSON.stringify(shapedMeta.macro) : '(base mesh)');

// ------------------------------------------------------------------ 2. pre-pose (MPFB space): power grip
const SIDE = { L: 1, R: -1 };
const handFrame = (S, J) => {
  const wrist = J['wrist.' + S].head;
  const across = M.norm(M.sub(J['finger2-1.' + S].head, J['finger5-1.' + S].head));        // pinky -> index (thumb side)
  const fdir0 = M.norm(M.sub(J['finger3-1.' + S].head, wrist));
  const fdir = M.norm(M.sub(fdir0, M.mul(across, M.dot(fdir0, across))));
  const palm = M.mul(M.cross(fdir, across), SIDE[S]);
  return { wrist, across, fdir, palm };
};
// The power grip: every finger wraps a cylinder along the palm's width (the handle), solved joint by joint (each
// joint turned until the next one lies on the circle of radius R about the axis); the thumb closes over the index and
// middle fingers (CCD on its three bones toward a point outside the index finger's middle phalanx).
const GR = JSON.parse(arg('grip', 'null')) || { back: 0.008, out: 0.031, R: 0.0245, thumb: 0.013 };
function fk(J, rot) { // FK in MPFB rest coordinates: F_b(x) = F_parent(head_b + R_b (x - head_b)) as { A, t }
  const F = {};
  for (const n of order) {
    const p = rigM[n].parent, Fp = p ? F[p] : { A: M.I3(), t: [0, 0, 0] };
    const R = rot[n];
    if (!R) { F[n] = Fp; continue; }
    const h = J[n].head;
    F[n] = { A: M.mm(Fp.A, R), t: M.add(M.mv(Fp.A, M.sub(h, M.mv(R, h))), Fp.t) };
  }
  return F;
}
const apply = (F, p) => M.add(M.mv(F.A, p), F.t);
const gripInfo = {};
function poseRotations(J) {
  const R = {};
  for (const S of ['L', 'R']) {
    const hf = handFrame(S, J);
    const mcp = M.mid(J[`finger2-1.${S}`].head, J[`finger4-1.${S}`].head);
    const c = M.add(M.add(mcp, M.mul(hf.fdir, -GR.back)), M.mul(hf.palm, GR.out));
    const distAx = (p) => { const d = M.sub(p, c); return M.len(M.sub(d, M.mul(hf.across, M.dot(d, hf.across)))); };
    for (const k of [2, 3, 4, 5]) {
      const d = M.norm(M.sub(J[`finger${k}-1.${S}`].tail, J[`finger${k}-1.${S}`].head));
      const ax = M.norm(M.cross(d, hf.palm));
      const Rk = (k === 5 ? 0.92 : 1) * GR.R; // the little finger closes a little tighter (the handle tapers in a real fist)
      for (let j = 1; j <= 3; j++) {
        const b = `finger${k}-${j}.${S}`, nxt = j < 3 ? `finger${k}-${j + 1}.${S}` : null;
        const tipOf = (F) => (nxt ? apply(F[nxt] || F[b], J[nxt].head) : apply(F[b], J[b].tail));
        let lo = 0, hi = 150, best = 0;
        const f = (deg) => { R[b] = M.axisAngle(ax, deg * M.D2R); const F = fk(J, R); return distAx(tipOf(F)) - Rk; };
        // the next joint starts outside the circle and moves in as the joint flexes: first crossing
        let prev = f(0);
        if (prev <= 0) { best = 0; } else {
          for (let a = 5; a <= 150; a += 5) { const v = f(a); if (v <= 0) { lo = a - 5; hi = a; break; } prev = v; best = a; }
          for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; } best = (lo + hi) / 2;
        }
        R[b] = M.axisAngle(ax, best * M.D2R);
        (gripInfo[S] = gripInfo[S] || {})[b] = +best.toFixed(1);
      }
    }
    // thumb: CCD toward a point just outside the index finger's middle phalanx (over the handle)
    const tgtOf = (F) => {
      const pip = apply(F[`finger2-2.${S}`], J[`finger2-2.${S}`].head), dip = apply(F[`finger2-3.${S}`], J[`finger2-3.${S}`].head);
      const m = M.mid(M.lerp(pip, dip, 0.35), M.lerp(apply(F[`finger3-2.${S}`], J[`finger3-2.${S}`].head), apply(F[`finger3-3.${S}`], J[`finger3-3.${S}`].head), 0.35));
      const d = M.sub(m, c), out = M.norm(M.sub(d, M.mul(hf.across, M.dot(d, hf.across))));
      return M.add(M.lerp(pip, m, 0.4), M.mul(out, GR.thumb));
    };
    const chain = [`finger1-3.${S}`, `finger1-2.${S}`, `finger1-1.${S}`];
    for (const b of chain) R[b] = M.I3();
    for (let it = 0; it < 24; it++) for (const b of chain) {
      const F = fk(J, R), tip = apply(F[`finger1-3.${S}`], J[`finger1-3.${S}`].tail), tgt = tgtOf(F);
      const par = rigM[b].parent, Ap = F[par].A, h = apply(F[par], J[b].head);
      let Q = M.fromTo(M.sub(tip, h), M.sub(tgt, h));
      R[b] = M.mm(M.mm(M.mm(M.tr(Ap), Q), Ap), R[b]);
    }
    { const F = fk(J, R); gripInfo[S].thumbMiss = +(M.len(M.sub(apply(F[`finger1-3.${S}`], J[`finger1-3.${S}`].tail), tgtOf(F))) * 1000).toFixed(1); }
    gripInfo[S].c = c; gripInfo[S].R = GR.R;
  }
  return R;
}
const rotP = poseRotations(Jm);
const Fp = fk(Jm, rotP);
const nAll = V.length / 3;
const V1 = new Float64Array(V.length);
for (let i = 0; i < nAll; i++) {
  const p = P0(i); let q = [0, 0, 0], ws = 0;
  for (const [b, w] of W[i]) { const f = Fp[b]; if (f === undefined) continue; q = M.add(q, M.mul(apply(f, p), w)); ws += w; }
  if (ws < 1e-9) q = p; else q = M.mul(q, 1 / ws);
  V1[i * 3] = q[0]; V1[i * 3 + 1] = q[1]; V1[i * 3 + 2] = q[2];
}
// joints carried by their own bone (heads) / the bone itself (tails)
const J1 = {};
for (const n of order) J1[n] = { head: apply(Fp[n], Jm[n].head), tail: apply(Fp[n], Jm[n].tail), parent: Jm[n].parent };
// the fist's tunnel: the solved cylinder, carried with the hand (the wrist and metacarpals did not move in the pre-pose)
const tunnel = {};
for (const S of ['L', 'R']) {
  const hf = handFrame(S, J1), gi = gripInfo[S];
  tunnel[S] = { c: gi.c, r: gi.R - 0.0095, axis: M.mul(hf.across, SIDE[S]), wrist: hf.wrist };
  const { c, R, ...ang } = gi;
  log('fist', S, JSON.stringify(ang), 'wrist->tunnel', (M.len(M.sub(c, hf.wrist)) * 1000).toFixed(1), 'mm');
}

// ------------------------------------------------------------------ 3. bind pose + mapping
const { sideOf, mirId, mirV } = { sideOf: (id) => (/_l$/.test(id) ? 1 : /_r$/.test(id) ? -1 : 0), mirId: (id) => id.replace(/_l$/, '_r'), mirV: (v) => [-v[0], v[1], v[2]] };
const ebones = [];
for (const b of RIG.bones) { ebones.push({ id: b.id, parent: b.parent, at: b.at.map((x) => x * H) }); if (sideOf(b.id) === 1) ebones.push({ id: mirId(b.id), parent: b.parent && mirId(b.parent), at: mirV(b.at).map((x) => x * H) }); }
const EB = Object.fromEntries(ebones.map((b) => [b.id, b]));
const at = (id) => EB[id].at;
// MPFB landmark for each engine joint (pre-posed space)
const s2 = (id) => (sideOf(id) > 0 ? 'L' : 'R');
const hipMid = M.mid(J1['upperleg01.L'].head, J1['upperleg01.R'].head);
const toeMid = (S) => [1, 2, 3, 4, 5].reduce((a, k) => M.add(a, M.mul(J1[`toe${k}-1.${S}`].head, 0.2)), [0, 0, 0]);
// engine lumbar / thorax joints: at the engine's own fractions of the pelvis -> neck path, along MPFB's spine polyline
const spinePts = [hipMid, J1.spine04.head, J1.spine03.head, J1.spine02.head, J1.spine01.head, J1.neck01.head];
function spineAt(id) {
  const ePts = ['pelvis', 'lumbar', 'thorax', 'neck'].map(at); let eL = 0, eT = 0;
  for (let i = 1; i < ePts.length; i++) { const l = M.len(M.sub(ePts[i], ePts[i - 1])); eT += l; if (i <= (id === 'lumbar' ? 1 : 2)) eL += l; }
  const fr = eL / eT; let tot = 0; const seg = [];
  for (let i = 1; i < spinePts.length; i++) { const l = M.len(M.sub(spinePts[i], spinePts[i - 1])); seg.push(l); tot += l; }
  let d = fr * tot;
  for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) return M.lerp(spinePts[i], spinePts[i + 1], d / seg[i]); d -= seg[i]; }
  return spinePts[spinePts.length - 1];
}
const LM = (id) => {
  const S = s2(id), b = id.replace(/_[lr]$/, '');
  switch (b) {
    case 'pelvis': return hipMid; case 'lumbar': return spineAt('lumbar'); case 'thorax': return spineAt('thorax');
    case 'neck': return J1.neck01.head; case 'head': return J1.head.head;
    case 'clav': return J1['clavicle.' + S].head; case 'arm': return J1['upperarm01.' + S].head;
    case 'fore': return J1['lowerarm01.' + S].head; case 'hand': return J1['wrist.' + S].head;
    case 'thigh': return J1['upperleg01.' + S].head; case 'shank': return J1['lowerleg01.' + S].head;
    case 'foot': return J1['foot.' + S].head; case 'toe': return toeMid(S);
  }
  throw new Error(id);
};
const X = [1, 0, 0], Yv = [0, 1, 0], Zv = [0, 0, 1];
// foot geometry in MPFB space (sole plane, heel, toe tip) from the vertices the foot and toes own
const footGeo = {};
for (const S of ['L', 'R']) {
  let ymin = Infinity, zmin = Infinity, zmax = -Infinity, heel = null, tip = null;
  for (let i = 0; i < NB; i++) {
    let w = 0; for (const [b, ww] of W[i]) if (b === 'foot.' + S || b.startsWith('toe') && b.endsWith('.' + S)) w += ww;
    if (w < 0.5) continue;
    const p = [V1[i * 3], V1[i * 3 + 1], V1[i * 3 + 2]];
    ymin = Math.min(ymin, p[1]);
    if (p[2] < zmin) { zmin = p[2]; heel = p; } if (p[2] > zmax) { zmax = p[2]; tip = p; }
  }
  footGeo[S] = { sole: ymin, heel, tip };
}
const bind = {}; // id -> { R, P, J (mpfb joint), A (3x3 map), s }
const R_ = {};
function setBind(id, R) { R_[id] = R; }
// trunk
setBind('pelvis', M.align2(M.norm(M.sub(at('lumbar'), at('pelvis'))), X, M.norm(M.sub(LM('lumbar'), LM('pelvis'))), M.norm(M.sub(J1['upperleg01.L'].head, J1['upperleg01.R'].head))));
setBind('lumbar', M.align2(M.norm(M.sub(at('thorax'), at('lumbar'))), X, M.norm(M.sub(LM('thorax'), LM('lumbar'))), X));
setBind('thorax', M.align2(M.norm(M.sub(at('neck'), at('thorax'))), X, M.norm(M.sub(LM('neck'), LM('thorax'))), X));
setBind('neck', M.align2(M.norm(M.sub(at('head'), at('neck'))), X, M.norm(M.sub(LM('head'), LM('neck'))), X));
setBind('head', M.align2(Yv, X, M.norm(M.sub(J1.head.tail, J1.head.head)), X));
for (const S of ['L', 'R']) {
  const sd = S === 'L' ? '_l' : '_r';
  setBind('clav' + sd, M.fromTo(M.sub(at('arm' + sd), at('clav' + sd)), M.sub(LM('arm' + sd), LM('clav' + sd))));
  // arm: local -Y along the upper arm, local +Z toward the forearm's bend (the elbow hinge plane)
  const du = M.norm(M.sub(LM('fore' + sd), LM('arm' + sd))), df = M.norm(M.sub(LM('hand' + sd), LM('fore' + sd)));
  let fp = M.sub(df, M.mul(du, M.dot(df, du))); if (M.len(fp) < 1e-3) fp = [0, 0, 1];
  { const cy = M.mul(du, -1), cz = M.norm(fp), cx = M.cross(cy, cz); setBind('arm' + sd, M.cols(cx, cy, cz)); }
  setBind('fore' + sd, M.mm(M.fromTo(M.mv(R_['arm' + sd], [0, -1, 0]), df), R_['arm' + sd]));
  // hand: grip axis -> local +X, wrist -> tunnel centre -> the rig's grip offset direction
  { const t = tunnel[S], g = RIG.grip.offset, gl = Math.hypot(g[1], g[2]), gy = g[1] / gl, gz = g[2] / gl;
    const e1 = M.norm(t.axis), w = M.sub(t.c, t.wrist), wp = M.norm(M.sub(w, M.mul(e1, M.dot(w, e1)))), x2 = M.cross(e1, wp);
    const cy = M.add(M.mul(wp, gy), M.mul(x2, -gz)), cz = M.add(M.mul(wp, gz), M.mul(x2, gy));
    setBind('hand' + sd, M.cols(e1, cy, cz)); }
  // thigh: local -Y along the thigh, local -Z toward the knee's bend (straight knee: the front stays +Z)
  const dt = M.norm(M.sub(LM('shank' + sd), LM('thigh' + sd))), ds = M.norm(M.sub(LM('foot' + sd), LM('shank' + sd)));
  let sp = M.sub(ds, M.mul(dt, M.dot(ds, dt)));
  const cz0 = M.len(sp) > 0.02 ? M.mul(M.norm(sp), -1) : Zv;
  { const cy = M.mul(dt, -1), cz = M.norm(M.sub(cz0, M.mul(cy, M.dot(cz0, cy)))), cx = M.cross(cy, cz); setBind('thigh' + sd, M.cols(cx, cy, cz)); }
  setBind('shank' + sd, M.mm(M.fromTo(M.mv(R_['thigh' + sd], [0, -1, 0]), ds), R_['thigh' + sd]));
  // foot: local +Y the sole normal (up), local +Z heel -> toe on the sole
  { const fg = footGeo[S]; let f = M.sub(fg.tip, fg.heel); f[1] = 0; f = M.norm(f); setBind('foot' + sd, M.cols(M.cross(Yv, f), Yv, f)); setBind('toe' + sd, R_['foot' + sd]); }
}
// FK positions with the engine's segment lengths; the pelvis stays at the MPFB hip centre
const P_ = {};
for (const b of ebones) P_[b.id] = b.parent ? M.add(P_[b.parent], M.mv(R_[b.parent], M.sub(b.at, EB[b.parent].at))) : LM('pelvis');
// per-bone map: P + A (p - J), A = axial scale along the segment (in MPFB space = bind directions)
const child = { pelvis: 'lumbar', lumbar: 'thorax', thorax: 'neck', neck: 'head', clav: 'arm', arm: 'fore', fore: 'hand', thigh: 'shank', shank: 'foot', foot: 'toe' };
const report = [];
for (const b of ebones) {
  const id = b.id, sd = id.match(/_[lr]$/)?.[0] || '', bb = id.replace(/_[lr]$/, '');
  const J = LM(id); let A = M.I3(), s = 1;
  if (child[bb]) {
    const c = child[bb] + sd, Lm = M.len(M.sub(LM(c), J)), Le = M.len(M.sub(at(c), at(id)));
    s = Le / Lm; const d = M.norm(M.sub(LM(c), J));
    A = M.I3(); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i * 3 + j] += (s - 1) * d[i] * d[j];
    report.push([id, (Lm * 100).toFixed(1) + ' cm', (Le * 100).toFixed(1) + ' cm', s.toFixed(3)]);
  }
  if (bb === 'hand') { // uniform scale: the tunnel centre lands on the rig's grip centre
    const S = sd === '_l' ? 'L' : 'R', g = RIG.grip.offset;
    s = +arg('handScale', 1); // the fist keeps its size; the engine takes this figure's own grip centre (extras.grip)
    A = [s, 0, 0, 0, s, 0, 0, 0, s]; report.push([id, 'hand scale', s.toFixed(3), 'rig grip at', (Math.hypot(g[1], g[2]) * H * 100).toFixed(1) + ' cm', 'fist tunnel at', (M.len(M.sub(tunnel[S].c, tunnel[S].wrist)) * s * 100).toFixed(1) + ' cm']);
  }
  if (bb === 'foot') { // sole onto the rig's sole plane, ankle -> ball onto the toe joint (in the foot's own frame)
    const S = sd === '_l' ? 'L' : 'R', R = R_[id], fg = footGeo[S];
    const sy = (RIG.sole.heel[1] * -H) / (J[1] - fg.sole);
    const tl = M.mv(M.tr(R), M.sub(LM('toe' + sd), J)), te = M.sub(at('toe' + sd), at(id));
    const sz = te[2] / tl[2];
    A = M.mm(R, M.mm([1, 0, 0, 0, sy, 0, 0, 0, sz], M.tr(R)));
    report.push([id, 'sole scale', sy.toFixed(3), 'length scale', sz.toFixed(3)]);
  }
  bind[id] = { R: R_[id], P: P_[id], J, A };
}
// forearm twist helpers: same frame as the forearm
for (const sd of ['_l', '_r']) bind['ftw' + sd] = { ...bind['fore' + sd] };
log('segments (mpfb -> engine, axial scale):'); for (const r of report) log('  ' + r.join('  '));
for (const id of ['arm_l', 'fore_l', 'hand_l', 'thigh_l', 'shank_l', 'foot_l', 'clav_l', 'pelvis', 'thorax']) {
  log('  bind', id.padEnd(8), 'P', bind[id].P.map((x) => (x / H).toFixed(3)).join(','), 'J', bind[id].J.map((x) => (x / H).toFixed(3)).join(','), 'moved', (M.len(M.sub(bind[id].P, bind[id].J)) * 100).toFixed(1) + ' cm');
}

// MPFB bone -> engine bone
const FACE = /^(head|jaw|eye|levator|oris|orbicularis|risorius|temporalis|oculi|special|tongue)/;
function engineBone(b) {
  const m = b.match(/\.(L|R)$/), sd = m ? (m[1] === 'L' ? '_l' : '_r') : '';
  const n = b.replace(/\.(L|R)$/, '');
  if (/^(root|spine05|pelvis)$/.test(n)) return 'pelvis';
  if (/^(spine04|spine03)$/.test(n)) return 'lumbar';
  if (/^(spine02|spine01|breast)$/.test(n)) return 'thorax';
  if (/^neck0/.test(n)) return 'neck';
  if (FACE.test(n)) return 'head';
  if (/^(clavicle|shoulder01)$/.test(n)) return 'clav' + sd;
  if (/^upperarm0/.test(n)) return 'arm' + sd;
  if (n === 'lowerarm01') return 'fore' + sd;
  if (n === 'lowerarm02') return 'ftw' + sd;
  if (/^(wrist|metacarpal|finger)/.test(n)) return 'hand' + sd;
  if (/^upperleg0/.test(n)) return 'thigh' + sd;
  if (/^lowerleg0/.test(n)) return 'shank' + sd;
  if (n === 'foot') return 'foot' + sd;
  if (/^toe/.test(n)) return 'toe' + sd;
  throw new Error('unmapped MPFB bone ' + b);
}
const EW = []; // per body vertex: [[engineId, w]...] summed
for (let i = 0; i < NB; i++) {
  const acc = {}; for (const [b, w] of W[i]) { const e = engineBone(b); acc[e] = (acc[e] || 0) + w; }
  EW.push(Object.entries(acc).sort((a, b) => b[1] - a[1]));
}
// map every body vertex: linear blend of the per-bone maps with the summed weights
const P2 = new Float64Array(NB * 3);
const mapPt = (i, p) => { let q = [0, 0, 0], ws = 0; for (const [e, w] of EW[i]) { const B = bind[e]; q = M.add(q, M.mul(M.add(B.P, M.mv(B.A, M.sub(p, B.J))), w)); ws += w; } return M.mul(q, 1 / ws); };
for (let i = 0; i < NB; i++) { const q = mapPt(i, [V1[i * 3], V1[i * 3 + 1], V1[i * 3 + 2]]); P2[i * 3] = q[0]; P2[i * 3 + 1] = q[1]; P2[i * 3 + 2] = q[2]; }

export const state = { base, V1, P2, NB, EW, W, bind, ebones, Jm, J1, tunnel, footGeo, rigM, RIG, BODYJ, H, shapedMeta, report, OUT, HERE, REPO, stature };
