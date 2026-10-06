// MPFB / MakeHuman data access for the figure pipeline (no Blender needed): the CC0 base mesh (data/3dobjs/base.obj),
// the joint definitions of the "default" rig (rig.default.json: CUBE = mean of a joint-cube vertex group, VERTEX, MEAN),
// and its painted weights (weights.default.json). A shaped body exported from Blender (mpfb_build.py) replaces the base
// positions vertex for vertex: MPFB keeps the base mesh's vertex order through targets.
// Frame used everywhere here: metres, Y up, the figure faces +Z, figure-left = +X (the engine's frame; = OBJ's frame).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HERE } from './paths.mjs';

export const MPFB = join(HERE, 'mpfb_src');

export function readBaseObj() {
  const L = readFileSync(join(MPFB, 'data/3dobjs/base.obj'), 'utf8').split('\n');
  const V = [], VT = [], faces = [], fuv = [];
  let g = '';
  for (const l of L) {
    if (l.startsWith('v ')) { const p = l.trim().split(/\s+/); V.push(+p[1] * 0.1, +p[2] * 0.1, +p[3] * 0.1); }
    else if (l.startsWith('vt ')) { const p = l.trim().split(/\s+/); VT.push(+p[1], +p[2]); }
    else if (l.startsWith('g ')) g = l.slice(2).trim();
    else if (l.startsWith('f ') && g === 'body') {
      const p = l.trim().split(/\s+/).slice(1);
      faces.push(p.map((s) => +s.split('/')[0] - 1)); fuv.push(p.map((s) => +s.split('/')[1] - 1));
    }
  }
  return { V: Float64Array.from(V), VT: Float64Array.from(VT), faces, fuv, nAll: V.length / 3 };
}

// shaped positions from Blender (Z up, -Y front, metres) -> engine frame
export function readShaped(path) {
  const S = JSON.parse(readFileSync(path, 'utf8'));
  const n = S.co.length / 3, V = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { V[i * 3] = S.co[i * 3]; V[i * 3 + 1] = S.co[i * 3 + 2]; V[i * 3 + 2] = -S.co[i * 3 + 1]; }
  return { V, meta: S.meta || {}, bones: S.bones || null };
}

let _groups = null;
export function vertexGroups() {
  if (_groups) return _groups;
  const g = JSON.parse(readFileSync(join(MPFB, 'data/mesh_metadata/basemesh_vertex_groups.json'), 'utf8'));
  _groups = {};
  for (const [k, ranges] of Object.entries(g)) { const out = []; for (const r of ranges) { if (Array.isArray(r)) for (let i = r[0]; i <= r[1]; i++) out.push(i); else out.push(r); } _groups[k] = out; }
  return _groups;
}

export function readRig() { return JSON.parse(readFileSync(join(MPFB, 'data/rigs/standard/rig.default.json'), 'utf8')); }

// joint positions of every MPFB bone (head, tail) from the vertex positions V
export function mpfbJoints(V, rig = readRig()) {
  const G = vertexGroups();
  const mean = (ids) => { const p = [0, 0, 0]; for (const i of ids) { p[0] += V[i * 3]; p[1] += V[i * 3 + 1]; p[2] += V[i * 3 + 2]; } return p.map((x) => x / ids.length); };
  const at = (e) => {
    if (e.strategy === 'CUBE') return mean(G[e.cube_name]);
    if (e.strategy === 'VERTEX') return mean([e.vertex_index]);
    if (e.strategy === 'MEAN') return mean(e.vertex_indices);
    throw new Error('strategy ' + e.strategy);
  };
  const J = {};
  for (const [name, b] of Object.entries(rig)) J[name] = { head: at(b.head), tail: at(b.tail), parent: b.parent || null, roll: b.roll || 0 };
  return J;
}

// weights: per vertex [[boneName, w], ...] normalised
export function readWeights(nAll) {
  const W = JSON.parse(readFileSync(join(MPFB, 'data/rigs/standard/weights.default.json'), 'utf8')).weights;
  const per = Array.from({ length: nAll }, () => []);
  for (const [b, list] of Object.entries(W)) for (const [vi, w] of list) if (w > 0) per[vi].push([b, w]);
  for (const l of per) { const s = l.reduce((a, x) => a + x[1], 0); if (s > 0) for (const x of l) x[1] /= s; }
  return per;
}

export const exists = existsSync;
