// The app's own engine running in node (no browser): core / rig / motion / machine / shading / skinbuild / instance / figure
// on top of three_shim.mjs, with the same data (rig, body, muscles, exercises, the figure). An Instance is built exactly as
// engine/stage.js builds one (compileJob -> skin build or figure paint -> attachSkin), so solve(), IK, pins, contacts,
// the dual-quaternion skin uniforms and the verification probes (preview/probe.js) give the numbers the browser gives.
//   import { makeScene, skinPose, drawScene } from './engine_sim.mjs'
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import * as THREE from './three_shim.mjs';
import { HERE, REPO, PARAMS } from './paths.mjs';
import { renderView, writePNG } from './raster.mjs';

let MCE = null;
export function loadSim() {
  if (MCE) return MCE;
  globalThis.THREE = { ...THREE };
  globalThis.MCE = {};
  const html = readFileSync(join(REPO, 'index.html'), 'utf8'), i = html.indexOf('// Machine Coach figure engine - core helpers'), j = html.indexOf('</script>', i);
  vm.runInThisContext(html.slice(i, j), { filename: 'core.js' });
  for (const f of ['rig.js', 'motion.js', 'machine.js', 'shading.js', 'skinbuild.js', 'instance.js', 'figure.js']) vm.runInThisContext(readFileSync(join(REPO, 'engine', f), 'utf8'), { filename: f });
  const probe = [join(PARAMS, 'probe.js'), join(HERE, 'preview', 'probe.js')].find(existsSync);
  if (probe) vm.runInThisContext(readFileSync(probe, 'utf8'), { filename: 'probe.js' });
  return (MCE = globalThis.MCE);
}
const json = (p) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
const runGen = (it) => { for (;;) { const r = it.next(); if (r.done) return r.value; } };
let _D = null;

// opts: { body: 'mpfb' | 'sdf', fit: table | null (default: data/figure_mpfb_fit.json), glb: path (default data/figure_mpfb.glb) }
export function makeScene(exId, opts = {}) {
  const M = loadSim(), body = opts.body || 'mpfb';
  const rig = json('data/rig.json');
  const D = { rig, body: M.prepBody(json('data/body.json')), muscles: M.prepMuscles(json('data/muscles.json')) };
  if (body === 'mpfb') {
    const glb = readFileSync(opts.glb || join(REPO, 'data/figure_mpfb.glb')), fig = M.Figure.decode(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
    fig.fit = opts.fit !== undefined ? opts.fit : (existsSync(join(REPO, 'data/figure_mpfb_fit.json')) ? json('data/figure_mpfb_fit.json') : {});
    D.rig = { ...rig, grip: { ...rig.grip, ...fig.grip }, landmarks: { ...rig.landmarks, ...fig.landmarks } };
    D.figure = fig;
  }
  const EX = json('exercises/' + exId + '.json');
  const stage = { opts: {}, mats: M.shading.machineMaterials(), cur: null, phase: 0 };
  const inst = new M.Instance(stage, exId, EX, D);
  M.shading.setFinish(inst.U, 'clay');
  const t0 = Date.now(), job = inst.compileJob();
  const R = body === 'mpfb' ? runGen(M.SKIN_MODULE().paintFigureGen(job)) : M.SKIN_MODULE().buildSkin(job);
  inst.attachSkin(R);
  inst.buildStats = { ...R.stats, ms: Date.now() - t0 };
  stage.cur = inst;
  return { M, inst, D, R, stage, EX, body };
}
export const probes = (S) => S.M.Probe(S.stage);

// dual-quaternion skin of every render vertex in figure space (the vertex shader of engine/shading.js, on the CPU), with the
// volume-preserving swell and, for the static figure, the pad press
export function skinPose(S, phase) {
  const { inst } = S, R = inst.skin, U = inst.U, NV = R.NV, Qr = U.uQr.value, Qd = U.uQd.value, HB = U.uHB.value;
  inst.frame(phase);
  const P = new Float32Array(NV * 3), N = new Float32Array(NV * 3), np = inst.figure ? U.uPadN.value : 0;
  for (let v = 0; v < NV; v++) {
    const hi0 = Math.round(R.bm[v * 4]), hi1 = Math.round(R.bm[v * 4 + 2]), a0 = HB[hi0] ? HB[hi0].x : 0, a1 = HB[hi1] ? HB[hi1].x : 0;
    let nx = R.nor[v * 3] - a0 * R.g0[v * 3] - a1 * R.g1[v * 3], ny = R.nor[v * 3 + 1] - a0 * R.g0[v * 3 + 1] - a1 * R.g1[v * 3 + 1], nz = R.nor[v * 3 + 2] - a0 * R.g0[v * 3 + 2] - a1 * R.g1[v * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const sw = a0 * R.bm[v * 4 + 1] + a1 * R.bm[v * 4 + 3];
    const px = R.pos[v * 3] + R.nor[v * 3] * sw, py = R.pos[v * 3 + 1] + R.nor[v * 3 + 1] * sw, pz = R.pos[v * 3 + 2] + R.nor[v * 3 + 2] * sw;
    const r0 = Qr[R.skI[v * 4]];
    let q0 = 0, q1 = 0, q2 = 0, q3 = 0, d0 = 0, d1 = 0, d2 = 0, d3 = 0;
    for (let k = 0; k < 4; k++) {
      const w = R.skW[v * 4 + k]; if (!w) continue; const bi = R.skI[v * 4 + k], rq = Qr[bi], dq = Qd[bi], s = (r0.x * rq.x + r0.y * rq.y + r0.z * rq.z + r0.w * rq.w) < 0 ? -w : w;
      q0 += rq.x * s; q1 += rq.y * s; q2 += rq.z * s; q3 += rq.w * s; d0 += dq.x * s; d1 += dq.y * s; d2 += dq.z * s; d3 += dq.w * s;
    }
    const l = Math.hypot(q0, q1, q2, q3) || 1, x = q0 / l, y = q1 / l, z = q2 / l, w = q3 / l, dx = d0 / l, dy = d1 / l, dz = d2 / l, dw = d3 / l;
    const cx = y * pz - z * py + w * px, cy = z * px - x * pz + w * py, cz = x * py - y * px + w * pz;
    let ox = px + 2 * (y * cz - z * cy) + 2 * (w * dx - dw * x + (y * dz - z * dy)), oy = py + 2 * (z * cx - x * cz) + 2 * (w * dy - dw * y + (z * dx - x * dz)), oz = pz + 2 * (x * cy - y * cx) + 2 * (w * dz - dw * z + (x * dy - y * dx));
    const ex = nx, ey = ny, ez = nz, c2x = y * ez - z * ey + w * ex, c2y = z * ex - x * ez + w * ey, c2z = x * ey - y * ex + w * ez;
    N[v * 3] = ex + 2 * (y * c2z - z * c2y); N[v * 3 + 1] = ey + 2 * (z * c2x - x * c2z); N[v * 3 + 2] = ez + 2 * (x * c2y - y * c2x);
    if (np) { const q = inst._padPress(ox, oy, oz, np); ox = q[0]; oy = q[1]; oz = q[2]; }
    P[v * 3] = ox; P[v * 3 + 1] = oy; P[v * 3 + 2] = oz;
  }
  return { P, N };
}

// ------------------------------------------------------------------ drawing: figure with glow + the machine, software-rendered
const MAT = { frame: [0.10, 0.11, 0.13], pad: [0.04, 0.045, 0.05], plate: [0.06, 0.065, 0.07], accent: [0.22, 0.24, 0.27] };
function boxTris(M4, hs, rr, out, col) { // rounded box ~ plain box
  const e = M4.elements, c = [], P = [];
  const h = [hs[0], hs[1], hs[2]];
  for (let i = 0; i < 8; i++) { const x = i & 1 ? h[0] : -h[0], y = i & 2 ? h[1] : -h[1], z = i & 4 ? h[2] : -h[2]; P.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]); }
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const f of faces) { const a = P[f[0]], b = P[f[1]], d = P[f[3]], n = nrm(cross(sub(b, a), sub(d, a))); for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) out.push({ p: P[f[k]], n, col }); }
}
function cylTris(M4, r, hh, out, col, seg = 20) {
  const e = M4.elements, T = (x, y, z) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]], Nn = (x, y, z) => nrm([e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z]);
  for (let k = 0; k < seg; k++) {
    const a0 = 2 * Math.PI * k / seg, a1 = 2 * Math.PI * (k + 1) / seg, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const P = [T(r * c0, -hh, r * s0), T(r * c1, -hh, r * s1), T(r * c1, hh, r * s1), T(r * c0, hh, r * s0)], N = [Nn(c0, 0, s0), Nn(c1, 0, s1), Nn(c1, 0, s1), Nn(c0, 0, s0)];
    for (const t of [[0, 1, 2], [0, 2, 3]]) for (const q of t) out.push({ p: P[q], n: N[q], col });
    const top = T(0, hh, 0), bot = T(0, -hh, 0), nt = Nn(0, 1, 0), nb = Nn(0, -1, 0);
    out.push({ p: top, n: nt, col }, { p: T(r * c0, hh, r * s0), n: nt, col }, { p: T(r * c1, hh, r * s1), n: nt, col });
    out.push({ p: bot, n: nb, col }, { p: T(r * c1, -hh, r * s1), n: nb, col }, { p: T(r * c0, -hh, r * s0), n: nb, col });
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// the machine's visible parts at the current pose as triangle soup
export function machineTris(S) {
  const out = [], { inst } = S, M = inst.machine;
  for (const r of Object.values(M.parts)) {
    if (!r.mesh || !r.mesh.visible) continue; r.mesh.updateMatrixWorld(true);
    const ud = r.mesh.userData, col = MAT[r.def.mat || 'frame'] || MAT.frame;
    if (ud.kind === 'box') boxTris(r.mesh.matrixWorld, ud.hs, ud.rr, out, col); else if (ud.kind === 'cyl') cylTris(r.mesh.matrixWorld, ud.r, ud.hh, out, col);
  }
  for (const c of M.cables) {
    if (!c.mesh.visible) continue; c.mesh.updateMatrixWorld(true);
    const e = c.mesh.matrixWorld.elements, ax = [e[4], e[5], e[6]], L = Math.hypot(...ax), u = nrm(ax), A = [e[12], e[13], e[14]];
    const tmp = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    // a thin cylinder along the cable: build a frame
    const a = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], x = nrm(cross(u, a)), z = cross(x, u);
    tmp.elements = [x[0], x[1], x[2], 0, u[0], u[1], u[2], 0, z[0], z[1], z[2], 0, A[0], A[1], A[2], 1];
    cylTris(tmp, Math.max(c.r, 0.004), L / 2, out, c.mesh.userData.cable ? [0.35, 0.37, 0.4] : MAT.frame, 6);
  }
  return out;
}

// glow colours per vertex from the painted fields and the head activations at the current pose
export function glowColors(S) {
  const { inst } = S, R = inst.skin, U = inst.U, NV = R.NV, col = new Float32Array(NV * 3), HB = U.uHB.value;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let v = 0; v < NV; v++) {
    let c = [0.74, 0.72, 0.69];
    const fp = R.musA[v * 4], fs = R.musA[v * 4 + 1], hdp = HB[Math.round(R.hd[v * 2])], hds = HB[Math.round(R.hd[v * 2 + 1])];
    const ap = Math.pow(Math.max(hdp ? hdp.y : 0, 0), 1.45), as = Math.pow(Math.min(1, 2 * (hds ? hds.y : 0)), 1.45);
    const wP = sstep(-0.03, 0.03, fp), wS = sstep(-0.2, 0.42, fs) * (1 - wP);
    if (wS > 0) { const k = (0.35 + 0.65 * as) * wS * 0.85; c = c.map((x, i) => x * (1 - k) + [0.93, 0.66, 0.38][i] * k); }
    if (wP > 0) { const b = sstep(0, 1.05, fp), k = wP * (0.45 + 0.55 * ap), g = [0.76 + 0.24 * b, 0.30 + 0.05 * b, 0.13]; c = c.map((x, i) => x * (1 - 0.92 * k) + g[i] * k * (0.5 + 0.7 * ap)); }
    col[v * 3] = Math.min(1, c[0]); col[v * 3 + 1] = Math.min(1, c[1]); col[v * 3 + 2] = Math.min(1, c[2]);
  }
  return col;
}

// the posed scene at one phase as one triangle mesh (figure with glow colours + machine), figure space
export function sceneMesh(S, phase, { machine = true } = {}) {
  const sk = skinPose(S, phase), g = glowColors(S), mt = machine ? machineTris(S) : [], P = Array.from(sk.P), N = Array.from(sk.N), idx = Array.from(S.inst.skin.idx), col = Array.from(g);
  for (let i = 0; i < mt.length; i += 3) { const b = P.length / 3; for (let k = 0; k < 3; k++) { P.push(...mt[i + k].p); N.push(...mt[i + k].n); col.push(...mt[i + k].col.map((x) => x * 2.4)); } idx.push(b, b + 1, b + 2); }
  return { P: Float32Array.from(P), N: Float32Array.from(N), idx: Uint32Array.from(idx), colors: Float32Array.from(col), nFig: sk.P.length / 3 };
}
// one tile: a mesh seen from the exercise's camera (az / el of the stage) at the given centre and span (figure-space metres)
export function drawTile(mesh, view, size, out, bg) {
  const img = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) { const t = y / size, c = [0, 1, 2].map((k) => Math.round(bg[0][k] + (bg[1][k] - bg[0][k]) * t)); for (let x = 0; x < size; x++) { const o = (y * size + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; } }
  renderView({ P: mesh.P, N: mesh.N, idx: mesh.idx }, view, size, mesh.colors, img, 0, 0, size);
  writePNG(out, size, size, img);
}
export function cameraFor(S) { const c = S.inst.cam; return { az: -(c.az + (c.dAz || 0)), el: c.el + (c.dEl || 0) }; }
export function boundsInView(mesh, az, el) {
  const ar = az * Math.PI / 180, er = el * Math.PI / 180, d = [Math.sin(ar) * Math.cos(er), Math.sin(er), Math.cos(ar) * Math.cos(er)], r = [Math.cos(ar), 0, -Math.sin(ar)], u = cross(d, r);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let v = 0; v < mesh.P.length; v += 3) { const x = mesh.P[v] * r[0] + mesh.P[v + 1] * r[1] + mesh.P[v + 2] * r[2], y = mesh.P[v] * u[0] + mesh.P[v + 1] * u[1] + mesh.P[v + 2] * u[2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1, r, u };
}

// engine-like shading of a posed scene (tools/engine_shade.mjs): figure + machine, one tile
import { renderEngineLike, readPNG } from './engine_shade.mjs';
let _tex = null;
export function engineTile(S, phase, view, size, opts = {}) {
  const { inst } = S, sk = skinPose(S, phase), R = inst.skin, mt = opts.machine === false ? [] : machineTris(S);
  if (S.body === 'mpfb' && !_tex) { const f = opts.nrm || join(REPO, 'data', 'figure_mpfb_nrm.webp'); _tex = opts.texPng ? readPNG(opts.texPng) : null; }
  const fig = { P: sk.P, N: sk.N, uv: S.body === 'mpfb' ? R.uv : null, ao: R.ao, musA: R.musA, hd: R.hd, idx: R.idx, HB: inst.U.uHB.value };
  return renderEngineLike(fig, mt, view, size, { ...opts, tex: S.body === 'mpfb' ? (opts.texPng ? (_tex || (_tex = readPNG(opts.texPng))) : null) : null, yawDeg: opts.yawDeg ?? (inst.cam.az + (inst.cam.dAz || 0)) });
}
