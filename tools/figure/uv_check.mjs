// UV layout sanity of the figure: overlaps (two surface regions on one texel), texel density spread, tiny islands.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from './paths.mjs';
const name = process.argv[2] || 'm5', m = JSON.parse(readFileSync(join(HERE, 'out', name, 'mesh.json'), 'utf8')), S = 1024;
const P = m.P, uv = m.uv, ridx = m.ridx, weld = m.weld;
const own = new Int32Array(S * S).fill(-1), posx = new Float32Array(S * S * 3);
let over = 0, covered = 0; const bad = [];
const tris = ridx.length / 3;
const dens = [];
for (let t = 0; t < tris; t++) {
  const r = [ridx[t * 3], ridx[t * 3 + 1], ridx[t * 3 + 2]], w = r.map((x) => weld[x]);
  const X = r.map((x) => uv[x * 2] * S - 0.5), Y = r.map((x) => uv[x * 2 + 1] * S - 0.5);
  const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]); if (Math.abs(area) < 1e-9) continue;
  // 3D area vs uv area
  const e1 = [0, 1, 2].map((k) => P[w[1] * 3 + k] - P[w[0] * 3 + k]), e2 = [0, 1, 2].map((k) => P[w[2] * 3 + k] - P[w[0] * 3 + k]);
  const a3 = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
  dens.push(Math.sqrt(Math.abs(area) / 2) / Math.sqrt(a3) / 1000); // texels per mm
  const minx = Math.max(0, Math.floor(Math.min(...X))), maxx = Math.min(S - 1, Math.ceil(Math.max(...X))), miny = Math.max(0, Math.floor(Math.min(...Y))), maxy = Math.min(S - 1, Math.ceil(Math.max(...Y)));
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const b0 = ((X[1] - x) * (Y[2] - y) - (X[2] - x) * (Y[1] - y)) / area, b1 = ((X[2] - x) * (Y[0] - y) - (X[0] - x) * (Y[2] - y)) / area, b2 = 1 - b0 - b1; if (b0 < 0 || b1 < 0 || b2 < 0) continue;
    const i = y * S + x, p = [0, 1, 2].map((k) => b0 * P[w[0] * 3 + k] + b1 * P[w[1] * 3 + k] + b2 * P[w[2] * 3 + k]);
    if (own[i] >= 0) { const d = Math.hypot(p[0] - posx[i * 3], p[1] - posx[i * 3 + 1], p[2] - posx[i * 3 + 2]); if (d > 0.01) { over++; if (bad.length < 5) bad.push([x, y, d.toFixed(3), p.map((q) => q.toFixed(2)).join(',')]); } }
    else covered++;
    own[i] = t; posx[i * 3] = p[0]; posx[i * 3 + 1] = p[1]; posx[i * 3 + 2] = p[2];
  }
}
dens.sort((a, b) => a - b);
console.log('texels covered', covered, 'overlapping (two surface places > 1 cm apart)', over, bad.map((b) => b.join('/')).join(' | '));
console.log('texel density, texels per mm (1024 map): p1', dens[Math.floor(dens.length * 0.01)].toFixed(2), 'p10', dens[Math.floor(dens.length * 0.1)].toFixed(2), 'median', dens[Math.floor(dens.length * 0.5)].toFixed(2), 'p90', dens[Math.floor(dens.length * 0.9)].toFixed(2), 'p99', dens[Math.floor(dens.length * 0.99)].toFixed(2));
