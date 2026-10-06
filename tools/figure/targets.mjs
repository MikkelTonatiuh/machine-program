// MakeHuman / MPFB "targets": sparse per-vertex offsets (CC0 data files, "vertex dx dy dz" per line, MakeHuman units of
// 10 cm), additive on the base mesh; the local ones (shoulders, pecs, arm and leg muscle, V-shape ...) can be mixed in here
// in node on top of a body shaped in Blender, the result is the same as the shape keys of MPFB.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MPFB } from './mpfb_io.mjs';

const ROOT = join(MPFB, 'data', 'targets');
let _index = null;
function find(name) {
  if (!_index) { _index = {}; for (const d of readdirSync(ROOT, { withFileTypes: true })) if (d.isDirectory()) for (const f of readdirSync(join(ROOT, d.name))) if (/\.target(\.gz)?$/.test(f)) _index[f.replace(/\.target(\.gz)?$/, '')] = join(ROOT, d.name, f); }
  const p = _index[name]; if (!p) throw new Error('no target ' + name + ' (extracted from the add-on zip?)');
  return p;
}
export function readTarget(name) {
  const p = find(name), raw = readFileSync(p), txt = (p.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  const out = [];
  for (const l of txt.split('\n')) { if (!l || l[0] === '#') continue; const q = l.trim().split(/\s+/); out.push([+q[0], +q[1], +q[2], +q[3]]); }
  return out;
}
// V: Float64Array (metres, x right, y up, z forward = the OBJ frame), modified in place
export function applyTargets(V, weights) {
  for (const [name, w] of Object.entries(weights || {})) { if (!w) continue; for (const [i, dx, dy, dz] of readTarget(name)) { V[i * 3] += dx * 0.1 * w; V[i * 3 + 1] += dy * 0.1 * w; V[i * 3 + 2] += dz * 0.1 * w; } }
  return V;
}
