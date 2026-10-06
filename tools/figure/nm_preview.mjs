// Software check of the definition map without a browser: the figure's base mesh shaded WITH the baked normal map, using
// three.js's perturbNormal2Arb decode (T = det (dP/dv x N), B = -det (dP/du x N), scale 1 / max(|T|, |B|)), next to the
// same mesh geometrically displaced by the baked heights (bake_definition.mjs --preview). The two should shade alike.
//   node tools/nm_preview.mjs <figure> <out.png> '<views json>' [--scale 1] [--flipy]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { writePNG } from './raster.mjs';

const [name, outp, vj] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
import { HERE } from './paths.mjs';
const D = join(HERE, 'out', name);
const m = JSON.parse(readFileSync(join(D, 'mesh.json'), 'utf8'));
// our own PNG (8-bit RGB, filter 0 rows)
function readPNG(path) {
  const b = readFileSync(path); let o = 8, w = 0, h = 0; const idat = [];
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8); if (type === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); } if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return { w, h, px };
}
const tex = readPNG(join(D, 'nrm.png'));
const sample = (u, v) => { // bilinear, glTF convention: row = v * h
  const x = u * tex.w - 0.5, y = v * tex.h - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, out = [0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const xx = Math.min(tex.w - 1, Math.max(0, x0 + dx)), yy = Math.min(tex.h - 1, Math.max(0, y0 + dy));
    for (let c = 0; c < 3; c++) out[c] += tex.px[(yy * tex.w + xx) * 3 + c] * w;
  }
  return out.map((q) => q / 127.5 - 1);
};
const scale = +arg('scale', 1), flipY = process.argv.includes('--flipy');
const views = JSON.parse(vj), size = 380, W = size * views.length, Hh = size, img = Buffer.alloc(W * Hh * 3);
for (let i = 0; i < W * Hh; i++) { img[i * 3] = 24; img[i * 3 + 1] = 28; img[i * 3 + 2] = 33; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const NR = m.weld.length, ridx = m.ridx;
const Pw = (r) => { const v = m.weld[r]; return [m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]]; }, Nw = (r) => { const v = m.weld[r]; return [m.N[v * 3], m.N[v * 3 + 1], m.N[v * 3 + 2]]; };
views.forEach((view, vi) => {
  const az = view.az * Math.PI / 180, el = (view.el || 0) * Math.PI / 180;
  const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)], r = [Math.cos(az), 0, -Math.sin(az)], u = cross(d, r), c = view.center, sc = size / view.span;
  const proj = (p) => { const q = sub(p, c); return [size / 2 + dot(q, r) * sc, size / 2 - dot(q, u) * sc, dot(q, d)]; };
  const zb = new Float32Array(size * size).fill(-1e9);
  for (let t = 0; t < ridx.length; t += 3) {
    const ids = [ridx[t], ridx[t + 1], ridx[t + 2]], P3 = ids.map(Pw), N3 = ids.map(Nw), UV = ids.map((i) => [m.uv[i * 2], m.uv[i * 2 + 1]]), S = P3.map(proj);
    const area = (S[1][0] - S[0][0]) * (S[2][1] - S[0][1]) - (S[2][0] - S[0][0]) * (S[1][1] - S[0][1]); if (Math.abs(area) < 1e-12) continue;
    // dP/du, dP/dv of the triangle
    const e1 = sub(P3[1], P3[0]), e2 = sub(P3[2], P3[0]), du1 = UV[1][0] - UV[0][0], dv1 = UV[1][1] - UV[0][1], du2 = UV[2][0] - UV[0][0], dv2 = UV[2][1] - UV[0][1], det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-14) continue;
    const a = [0, 1, 2].map((k) => (e1[k] * dv2 - e2[k] * dv1) / det), b = [0, 1, 2].map((k) => (e2[k] * du1 - e1[k] * du2) / det);
    const minx = Math.max(0, Math.floor(Math.min(S[0][0], S[1][0], S[2][0]))), maxx = Math.min(size - 1, Math.ceil(Math.max(S[0][0], S[1][0], S[2][0])));
    const miny = Math.max(0, Math.floor(Math.min(S[0][1], S[1][1], S[2][1]))), maxy = Math.min(size - 1, Math.ceil(Math.max(S[0][1], S[1][1], S[2][1])));
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      const w0 = ((S[1][0] - qx) * (S[2][1] - qy) - (S[2][0] - qx) * (S[1][1] - qy)) / area, w1 = ((S[2][0] - qx) * (S[0][1] - qy) - (S[0][0] - qx) * (S[2][1] - qy)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * S[0][2] + w1 * S[1][2] + w2 * S[2][2], zi = py * size + px; if (z <= zb[zi]) continue; zb[zi] = z;
      let N = nrm([0, 1, 2].map((k) => w0 * N3[0][k] + w1 * N3[1][k] + w2 * N3[2][k]));
      const uu = w0 * UV[0][0] + w1 * UV[1][0] + w2 * UV[2][0], vv = w0 * UV[0][1] + w1 * UV[1][1] + w2 * UV[2][1];
      const mp = sample(uu, vv); if (flipY) mp[1] = -mp[1];
      // three's frame: T = det_st (b x N), B = -det_st (a x N); only the common factor |det_st| cancels in `scale`
      const sg = Math.sign(dot(cross(a, b), N)) || 1, T = cross(b, N).map((x) => x * sg), B = cross(a, N).map((x) => -x * sg), sT = Math.hypot(...T), sB = Math.hypot(...B), M = Math.max(sT, sB) || 1;
      const Np = nrm([0, 1, 2].map((k) => T[k] * (mp[0] * scale) / M + B[k] * (mp[1] * scale) / M + N[k] * mp[2]));
      const vn = [dot(Np, r), dot(Np, u), dot(Np, d)];
      const lam = Math.max(0, -0.45 * vn[0] + 0.6 * vn[1] + 0.66 * vn[2]), rim = Math.pow(1 - Math.max(0, vn[2]), 3) * 0.25, k = 0.22 + 0.78 * lam;
      const o = (py * W + vi * size + px) * 3, base = [0.78, 0.76, 0.73];
      for (let q = 0; q < 3; q++) img[o + q] = Math.round(255 * Math.min(1, base[q] * k + rim));
    }
  }
});
writePNG(outp, W, Hh, img);
console.log('wrote', outp);
