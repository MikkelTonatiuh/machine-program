// The app's skin shading emulated in software, to judge the look (definition map, clay finish, glow) without a browser.
// It follows engine/shading.js and the three.js r147 MeshStandardMaterial path the app uses: the fixed light rig (key, fill, two
// rims, lights fixed in the world while the figure is yawed), Lambert diffuse of the clay colour, a small sky ambient, the
// fresnel rim graded by the height of the world normal, ambient occlusion, the highlight roll-off (knee / keep), ACES filmic
// tone mapping, the muscle glow added after tone mapping with the engine's own field maths, sRGB output. Orthographic
// camera, no specular (the clay clamps it). Perspective, the exact environment map and the horizon backdrop are approximated.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { writePNG } from './raster.mjs';

const lin = (hex) => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255].map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// three.js ACESFilmicToneMapping (exposure 1)
function aces(c) {
  const v = c.map((x) => x / 0.6);
  const m1 = [0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2], 0.07600 * v[0] + 0.90834 * v[1] + 0.01566 * v[2], 0.02840 * v[0] + 0.13383 * v[1] + 0.83777 * v[2]];
  const f = (x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081), r = m1.map(f);
  return [1.60475 * r[0] - 0.53108 * r[1] - 0.07367 * r[2], -0.10208 * r[0] + 1.10813 * r[1] - 0.00605 * r[2], -0.00327 * r[0] - 0.07276 * r[1] + 1.07602 * r[2]].map((x) => Math.max(0, Math.min(1, x)));
}
const FINISH = { color: lin(0xaaa7a2), env: 0.5, rimLo: [0.06, 0.065, 0.07], rimHi: [0.10, 0.20, 0.25], rim: 0.45, rimPow: 3.0, rimAO: 0.5, occ: 0.42, knee: 0.135, keep: 0.25, glow: 1.55, under: [0.96, 0.8] };
const LIGHTS = [[0xffeee2, 0.62, [1.8, 3.0, 2.2]], [0x6a8699, 0.20, [-2.2, 0.8, 1.6]], [0x7fb4c8, 1.55, [1.2, 2.6, -5.0]], [0x8e8687, 0.55, [-0.8, -0.6, -6.0]]].map(([c, i, p]) => ({ col: lin(c).map((x) => x * i), dir: nrm([p[0], p[1] - 0.9, p[2]]) }));
const CORE = lin(0xff5a1f), FALL = lin(0xc14d21), AMBER = lin(0xe0a060);
const SCORE = AMBER.map((x) => x * 0.56), SFALL = AMBER.map((x, i) => (x + (FALL[i] - x) * 0.3) * 0.32);

export function readPNG(path) {
  const b = readFileSync(path); let o = 8, w = 0, h = 0; const idat = [];
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8); if (type === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); } if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return { w, h, px };
}
function sampleMap(tex, u, v) { // bilinear, rows = v * h (the file's uv convention), -> [-1, 1]
  const x = u * tex.w - 0.5, y = v * tex.h - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, out = [0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const xx = Math.min(tex.w - 1, Math.max(0, x0 + dx)), yy = Math.min(tex.h - 1, Math.max(0, y0 + dy));
    for (let c = 0; c < 3; c++) out[c] += tex.px[(yy * tex.w + xx) * 3 + c] * w;
  }
  return out.map((q) => q / 127.5 - 1);
}

// opts: { tex, normalScale, knee, keep, yawDeg, glowOn }. fig: { P, N, uv, ao, musA, hd, idx, HB (uHB values) }; mach: triangle soup.
export function renderEngineLike(fig, mach, view, size, opts = {}) {
  const F = { ...FINISH, knee: opts.knee ?? FINISH.knee, keep: opts.keep ?? FINISH.keep }, ns = opts.normalScale ?? 1, tex = opts.tex || null;
  const yaw = (opts.yawDeg || 0) * Math.PI / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
  // world = Ry(yaw) figure; lights live in the world: figure-space light directions L_f = Ry(-yaw) L_w, and the world normal's height is y
  const toFig = (d) => [cy * d[0] - sy * d[2], d[1], sy * d[0] + cy * d[2]];
  const lights = LIGHTS.map((l) => ({ col: l.col, dir: toFig(l.dir) }));
  const az = view.az * Math.PI / 180, el = view.el * Math.PI / 180, d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)], r = [Math.cos(az), 0, -Math.sin(az)], u = cross(d, r);
  const sc = size / view.span, c = view.center;
  const proj = (p) => { const q = sub(p, c); return [size / 2 + dot(q, r) * sc, size / 2 - dot(q, u) * sc, dot(q, d)]; };
  // background: the horizon sky and the planet arc (approximation of engine/backdrop.js)
  const img = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ty = y / size, sky = [mix(0.02, 0.10, sstep(0, 0.8, ty)), mix(0.045, 0.24, sstep(0, 0.82, ty)), mix(0.07, 0.32, sstep(0, 0.82, ty))];
    const R = 0.83 * size, cxp = size / 2, cyp = 0.84 * size + R, dd = Math.hypot(x - cxp, y - cyp), inside = dd < R;
    let col = sky;
    if (inside) col = [0.05, 0.028, 0.022]; else { const g = Math.exp(-Math.pow((dd - R) / (0.012 * size), 2)) * 0.9; col = col.map((k, i) => k + [0.85, 0.35, 0.1][i] * g * 0.7); }
    if (inside) { const g = Math.exp(-Math.pow((R - dd) / (0.01 * size), 2)); col = col.map((k, i) => k + [0.7, 0.28, 0.08][i] * g * 0.6); }
    const o = (y * size + x) * 3; img[o] = Math.round(255 * Math.min(1, srgb(col[0]))); img[o + 1] = Math.round(255 * Math.min(1, srgb(col[1]))); img[o + 2] = Math.round(255 * Math.min(1, srgb(col[2])));
  }
  const zb = new Float32Array(size * size).fill(-1e9);
  const put = (px, py, rgb) => { const o = (py * size + px) * 3; img[o] = Math.round(255 * rgb[0]); img[o + 1] = Math.round(255 * rgb[1]); img[o + 2] = Math.round(255 * rgb[2]); };
  // ------------------------------------------------------------ the machine (quiet, dark, cool rim)
  for (let t = 0; t < mach.length; t += 3) {
    const A = [mach[t], mach[t + 1], mach[t + 2]], S = A.map((q) => proj(q.p)), area = (S[1][0] - S[0][0]) * (S[2][1] - S[0][1]) - (S[2][0] - S[0][0]) * (S[1][1] - S[0][1]); if (Math.abs(area) < 1e-12) continue;
    const n = A[0].n, col = A[0].col, ndv = Math.max(0, dot(n, d)), key = Math.max(0, dot(n, lights[0].dir));
    let L = col.map((k) => k * (0.3 + 0.7 * key) * 0.55) ; const fr = Math.pow(1 - ndv, 3); L = L.map((k, i) => k + [0.16, 0.30, 0.36][i] * fr * 0.12);
    const mL = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]; if (mL > 0.08) L = L.map((k) => k * (0.08 + (mL - 0.08) * 0.15) / mL);
    const out = aces(L).map(srgb);
    const minx = Math.max(0, Math.floor(Math.min(S[0][0], S[1][0], S[2][0]))), maxx = Math.min(size - 1, Math.ceil(Math.max(S[0][0], S[1][0], S[2][0]))), miny = Math.max(0, Math.floor(Math.min(S[0][1], S[1][1], S[2][1]))), maxy = Math.min(size - 1, Math.ceil(Math.max(S[0][1], S[1][1], S[2][1])));
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const qx = px + 0.5, qy = py + 0.5, w0 = ((S[1][0] - qx) * (S[2][1] - qy) - (S[2][0] - qx) * (S[1][1] - qy)) / area, w1 = ((S[2][0] - qx) * (S[0][1] - qy) - (S[0][0] - qx) * (S[2][1] - qy)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * S[0][2] + w1 * S[1][2] + w2 * S[2][2], zi = py * size + px; if (z <= zb[zi]) continue; zb[zi] = z; put(px, py, out);
    }
  }
  // ------------------------------------------------------------ the skin
  const { P, N, uv, ao, musA, hd, idx, HB } = fig, NV = P.length / 3;
  const Sx = new Float32Array(NV), Sy = new Float32Array(NV), Sz = new Float32Array(NV);
  for (let v = 0; v < NV; v++) { const s = proj([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); Sx[v] = s[0]; Sy[v] = s[1]; Sz[v] = s[2]; }
  const act = (hi) => { const h = HB[Math.round(hi)]; return h ? h.y : 0; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], e = idx[t + 2], S = [[Sx[a], Sy[a], Sz[a]], [Sx[b], Sy[b], Sz[b]], [Sx[e], Sy[e], Sz[e]]], area = (S[1][0] - S[0][0]) * (S[2][1] - S[0][1]) - (S[2][0] - S[0][0]) * (S[1][1] - S[0][1]); if (Math.abs(area) < 1e-12) continue;
    // back faces (the engine culls them)
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pc = [P[e * 3], P[e * 3 + 1], P[e * 3 + 2]], gn = cross(sub(pb, pa), sub(pc, pa));
    if (dot(gn, d) <= 0) continue;
    let T = null, B = null;
    if (tex && uv) {
      const e1 = sub(pb, pa), e2 = sub(pc, pa), du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], du2 = uv[e * 2] - uv[a * 2], dv2 = uv[e * 2 + 1] - uv[a * 2 + 1], det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) > 1e-14) { const aa = [0, 1, 2].map((k) => (e1[k] * dv2 - e2[k] * dv1) / det), bb = [0, 1, 2].map((k) => (e2[k] * du1 - e1[k] * du2) / det); T = { a: aa, b: bb, sg: Math.sign(dot(cross(aa, bb), gn)) || 1 }; }
    }
    const minx = Math.max(0, Math.floor(Math.min(S[0][0], S[1][0], S[2][0]))), maxx = Math.min(size - 1, Math.ceil(Math.max(S[0][0], S[1][0], S[2][0]))), miny = Math.max(0, Math.floor(Math.min(S[0][1], S[1][1], S[2][1]))), maxy = Math.min(size - 1, Math.ceil(Math.max(S[0][1], S[1][1], S[2][1])));
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const qx = px + 0.5, qy = py + 0.5, w0 = ((S[1][0] - qx) * (S[2][1] - qy) - (S[2][0] - qx) * (S[1][1] - qy)) / area, w1 = ((S[2][0] - qx) * (S[0][1] - qy) - (S[0][0] - qx) * (S[2][1] - qy)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * S[0][2] + w1 * S[1][2] + w2 * S[2][2], zi = py * size + px; if (z <= zb[zi]) continue; zb[zi] = z;
      let n = nrm([0, 1, 2].map((k) => w0 * N[a * 3 + k] + w1 * N[b * 3 + k] + w2 * N[e * 3 + k]));
      if (T && ns > 0) {
        const m = sampleMap(tex, w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[e * 2], w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[e * 2 + 1]);
        const Tt = cross(T.b, n).map((x) => x * T.sg), Bt = cross(T.a, n).map((x) => -x * T.sg), M = Math.max(Math.hypot(...Tt), Math.hypot(...Bt)) || 1;
        n = nrm([0, 1, 2].map((k) => Tt[k] * (m[0] * ns) / M + Bt[k] * (m[1] * ns) / M + n[k] * m[2]));
      }
      const aoV = w0 * ao[a] + w1 * ao[b] + w2 * ao[e], ndv = Math.max(0, Math.min(1, dot(n, d)));
      // lit clay
      let L = [0, 0, 0];
      for (const l of lights) { const nl = Math.max(0, dot(n, l.dir)); L[0] += F.color[0] * l.col[0] * nl; L[1] += F.color[1] * l.col[1] * nl; L[2] += F.color[2] * l.col[2] * nl; }
      const wn = [cy * n[0] + sy * n[2], n[1], -sy * n[0] + cy * n[2]], amb = mix(0.012, 0.05, wn[1] * 0.5 + 0.5) * F.env;
      L = L.map((x, i) => x + F.color[i] * amb * [0.85, 1, 1.15][i]);
      const occ = mix(F.occ, 1, aoV), fres = Math.pow(1 - ndv, F.rimPow), rt = sstep(-0.45, 0.55, wn[1]);
      L = L.map((x, i) => x * occ + mix(F.rimLo[i], F.rimHi[i], rt) * fres * F.rim * mix(F.rimAO, 1, aoV));
      const lk = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]; if (lk > F.knee) L = L.map((x) => x * (F.knee + (lk - F.knee) * F.keep) / lk);
      let col = aces(L);
      // the glow, added after tone mapping (engine/shading.js)
      const fp = w0 * musA[a * 4] + w1 * musA[b * 4] + w2 * musA[e * 4], fs = w0 * musA[a * 4 + 1] + w1 * musA[b * 4 + 1] + w2 * musA[e * 4 + 1];
      if ((fp > -0.05 || fs > -0.25) && opts.glowOn !== false) {
        const fz = w0 * musA[a * 4 + 2] + w1 * musA[b * 4 + 2] + w2 * musA[e * 4 + 2], sa = w0 * musA[a * 4 + 3] + w1 * musA[b * 4 + 3] + w2 * musA[e * 4 + 3];
        const ap = Math.pow(Math.max(act(hd[a * 2]), 0), 1.45), as = Math.pow(Math.max(0, Math.min(1, 2 * act(hd[a * 2 + 1]))), 1.45);
        const aP = sstep(-0.04, 0.04, fp), aS = sstep(-0.2, 0.42, fs) * (1 - aP) * sstep(0.1, 0.38, ndv);
        if (aP + aS > 0.0005) {
          const keyv = Math.max(0, Math.min(1, dot(n, nrm([0.4 * r[0] + 0.6 * u[0] + 0.7 * d[0], 0.4 * r[1] + 0.6 * u[1] + 0.7 * d[1], 0.4 * r[2] + 0.6 * u[2] + 0.7 * d[2]])))), form = Math.min(1, 0.50 + 0.36 * keyv + 0.24 * ndv), fr = Math.pow(1 - ndv, 2.2);
          const st = 0.5 + 0.5 * Math.cos(2 * Math.PI * fz), stri = 1 - 0.15 * sa * (1 - st) * (1 - st);
          let bP = sstep(0, 1.05, fp); bP = bP * bP * (3 - 2 * bP) * mix(0.45, 1, sa);
          const gP = [0, 1, 2].map((k) => mix(FALL[k] * 0.5, CORE[k], bP) * ap * form * stri + CORE[k] * fr * 0.30 * ap * (0.3 + 0.7 * bP));
          let bS = sstep(0.05, 0.9, fs); bS = bS * bS * (3 - 2 * bS) * mix(0.7, 1, sa);
          const gS = [0, 1, 2].map((k) => mix(SFALL[k], SCORE[k], bS) * as * (0.55 + 0.45 * form) + SCORE[k] * fr * 0.2 * as);
          col = col.map((x, k) => x * (1 - F.under[0] * aP - F.under[1] * aS) + (gP[k] * aP + gS[k] * aS) * F.glow);
        }
      }
      put(px, py, col.map((x) => srgb(Math.max(0, Math.min(1, x)))));
    }
  }
  return img;
}
export function savePNG(path, size, img) { writePNG(path, size, size, img); }
