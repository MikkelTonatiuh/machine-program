// Tiny software rasteriser for looking at meshes without a browser or Blender (cheap on RAM and CPU): orthographic
// views, z-buffer, a soft clay shading from per-vertex normals, optional per-vertex colour, written as PNG.
//   renderViews(mesh, views, out, { size, colors })  mesh: { P: Float32Array(3n), N: Float32Array(3n), idx: Uint32Array }
//   views: [{ az, el, center: [x,y,z], span }]  (az 0 = front (+Z), 90 = from the figure's left (+X))
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

export function renderView(mesh, view, size, colors, img, ox, oy, W) {
  const { P, N, idx } = mesh, n = P.length / 3;
  const az = view.az * Math.PI / 180, el = (view.el || 0) * Math.PI / 180;
  // camera basis: looking from direction d toward the centre
  const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const r = [Math.cos(az), 0, -Math.sin(az)];
  const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
  const c = view.center, sc = size / view.span;
  const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n), sh = new Float32Array(n * 3);
  const L = [0.45, 0.7, 0.55]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - c[0], y = P[i * 3 + 1] - c[1], z = P[i * 3 + 2] - c[2];
    sx[i] = size / 2 + (x * r[0] + y * r[1] + z * r[2]) * sc;
    sy[i] = size / 2 - (x * u[0] + y * u[1] + z * u[2]) * sc;
    sz[i] = x * d[0] + y * d[1] + z * d[2];
    // light fixed to the camera (key from upper left-front of the view)
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const vn = [nx * r[0] + ny * r[1] + nz * r[2], nx * u[0] + ny * u[1] + nz * u[2], nx * d[0] + ny * d[1] + nz * d[2]];
    const lam = Math.max(0, -0.45 * vn[0] + 0.6 * vn[1] + 0.66 * vn[2]);
    const rim = Math.pow(1 - Math.max(0, vn[2]), 3) * 0.25;
    const base = colors ? [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]] : [0.78, 0.76, 0.73];
    const k = 0.22 + 0.78 * lam;
    for (let q = 0; q < 3; q++) sh[i * 3 + q] = Math.min(1, base[q] * k + rim);
  }
  const zb = new Float32Array(size * size).fill(-1e9);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], e = idx[t + 2];
    const x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b], x2 = sx[e], y2 = sy[e];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxx = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxy = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      const w0 = ((x1 - qx) * (y2 - qy) - (x2 - qx) * (y1 - qy)) / area, w1 = ((x2 - qx) * (y0 - qy) - (x0 - qx) * (y2 - qy)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[e], zi = py * size + px;
      if (z <= zb[zi]) continue; zb[zi] = z;
      const o = ((oy + py) * W + ox + px) * 3;
      for (let q = 0; q < 3; q++) img[o + q] = Math.round(255 * (w0 * sh[a * 3 + q] + w1 * sh[b * 3 + q] + w2 * sh[e * 3 + q]));
    }
  }
}

export function renderViews(mesh, views, out, { size = 420, colors = null, bg = [24, 28, 33] } = {}) {
  const W = size * views.length, H = size, img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = bg[0]; img[i * 3 + 1] = bg[1]; img[i * 3 + 2] = bg[2]; }
  views.forEach((v, k) => renderView(mesh, v, size, colors, img, k * size, 0, W));
  writePNG(out, W, H, img);
}
