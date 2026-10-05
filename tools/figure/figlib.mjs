// Shared node-side helpers for the figure tools: load a built figure (out/<name>), build the engine's muscle-painter job for
// any set of heads exactly as engine/instance.js does (guides moved into the figure's bind pose), run the engine's own
// painter (engine/skinbuild.js paintFigureGen) on the figure's mesh.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, REPO, PARAMS } from './paths.mjs';
import { loadEngine } from './engine_node.mjs';

export { HERE, REPO, PARAMS };
export const rig = () => JSON.parse(readFileSync(join(REPO, 'data/rig.json'), 'utf8'));
export const muscles = () => JSON.parse(readFileSync(join(REPO, 'data/muscles.json'), 'utf8'));

let _SK = null;
export function skinModule() {
  if (_SK) return _SK;
  return (_SK = loadEngine().SKIN_MODULE());
}

export function loadFigure(name) {
  const dir = join(HERE, 'out', name);
  const mesh = JSON.parse(readFileSync(join(dir, 'mesh.json'), 'utf8'));
  const glb = readFileSync(join(dir, name + '.glb'));
  const X = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()).extras;
  return { dir, mesh, X };
}

const quatMat = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
const mirId = (id) => id.replace(/_l$/, '_r'), mirV = (v) => [-v[0], v[1], v[2]];

// groups for the heads of `ids` (muscle head ids): tiers[id] = 1 | 2 (default 1); both sides unless side = 'l' | 'r'
export function buildGroups(F, ids, { tiers = {}, side = 'both', guideOffset = null } = {}) {
  const RIG = rig(), MUS = muscles(), H = RIG.height;
  const bindOf = Object.fromEntries(Object.entries(F.X.bind).map(([b, B]) => [b, { R: quatMat(B.q), p: B.p }]));
  const atOf = {}; for (const b of RIG.bones) { atOf[b.id] = b.at; if (/_l$/.test(b.id)) atOf[mirId(b.id)] = mirV(b.at); }
  const worldOf = (bone, p) => { const B = bindOf[bone], a = atOf[bone], d = [(p[0] - a[0]) * H, (p[1] - a[1]) * H, (p[2] - a[2]) * H]; return [0, 1, 2].map((i) => B.p[i] + B.R[i * 3] * d[0] + B.R[i * 3 + 1] * d[1] + B.R[i * 3 + 2] * d[2]); };
  const guidesOf = (gr, sd) => {
    let guides;
    if (gr.path) {
      const pts = gr.path.pts, nn = gr.path.n, nl = Math.hypot(...nn), n = nn.map((x) => x / nl), w = gr.path.w, Pp = pts.map(([, p]) => p);
      guides = [-1, 0, 1].map((k) => pts.map(([bone, p], i) => {
        const a = Pp[Math.min(Pp.length - 1, i + 1)], b = Pp[Math.max(0, i - 1)], t0 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], tl = Math.hypot(...t0), t = t0.map((x) => x / tl);
        const c = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]], cl = Math.hypot(...c);
        return [bone, [p[0] + c[0] / cl * k * w, p[1] + c[1] / cl * k * w, p[2] + c[2] / cl * k * w]];
      }));
    } else guides = gr.guides;
    return sd > 0 ? guides : guides.map((gd) => gd.map(([bone, p]) => [mirId(bone), mirV(p)]));
  };
  const BONES = F.mesh.bones, bi = (id) => { const i = BONES.indexOf(id); if (i < 0) throw new Error('no bone ' + id); return i; };
  const want = new Set(ids), groups = []; let hi = 0; const headOf = [];
  const sides = side === 'l' ? [1] : side === 'r' ? [-1] : [1, -1];
  for (const gr of MUS.groups) {
    const heads = gr.heads.filter((h) => want.has(h.id)); if (!heads.length) continue;
    for (const sd of sides) {
      const guides = guidesOf(gr, sd), Mn = guides.map((g) => g.length), off = []; let n = 0; for (const m of Mn) { off.push(n); n += m; }
      const pts = new Float64Array(n * 3); let o = 0;
      for (const gd of guides) for (const [bone, p0] of gd) {
        const p = guideOffset ? guideOffset(gr.id, bone, p0, sd) : p0;
        const w = worldOf(bone, p); pts[o++] = w[0]; pts[o++] = w[1]; pts[o++] = w[2];
      }
      const gb = [...new Set(guides.flat().map(([bone]) => bi(bone)).concat((gr.bones || []).map((b) => bi(sd > 0 ? b : mirId(b)))))];
      groups.push({ id: gr.id + (sd > 0 ? '_l' : '_r'), K: guides.length, M: Mn, off, pts, tol: gr.tol || 0.009, sub: gr.sub || 3, merge: gr.merge || 'smooth', bones: gb,
        heads: heads.map((d) => { headOf[hi] = d.id + (sd > 0 ? '_l' : '_r'); return { hi: hi++, tier: tiers[d.id] || 1, vc: d.v[0], hw: d.v[1], u0: d.u[0], u1: d.u[1], pk: d.peak ?? 0.5, t0: d.taper[0], t1: d.taper[1], r0: d.round[0], r1: d.round[1], sp: d.spindle ?? 0.7, sheet: d.profile === 'sheet', fade: d.fade ?? 0.62, sk: d.skew ?? 0 }; }) });
    }
  }
  return { groups, headOf, H, nb: BONES.length, stripe: MUS.stripe };
}

// the exercise's heads with tiers (aliases expanded as engine/instance.js _initHeads)
export function exerciseHeads(exId) {
  const MUS = muscles(), EX = JSON.parse(readFileSync(join(REPO, 'exercises', exId + '.json'), 'utf8')), m = EX.muscles || {};
  const expand = (ids) => [...new Set((ids || []).flatMap((id) => (MUS.aliases || {})[id] || [id]))];
  const prim = expand(m.primary), sec = expand(m.secondary).filter((x) => !prim.includes(x));
  const tiers = {}; for (const id of prim) tiers[id] = 1; for (const id of sec) tiers[id] = 2;
  return { ids: [...prim, ...sec], tiers, side: m.side === 'l' ? 'l' : m.side === 'r' ? 'r' : 'both', EX };
}

// paint the figure's welded mesh for a job; returns the painter's arrays
export function paintFigure(F, jobBase) {
  const SK = skinModule(), m = F.mesh;
  const J = { ...jobBase, figure: { pos: Float32Array.from(m.P), nor: Float32Array.from(m.N), idx: Uint32Array.from(m.idxW), skI: Float32Array.from(m.skI), skW: Float32Array.from(m.skW) } };
  const it = SK.paintFigureGen(J); for (;;) { const r = it.next(); if (r.done) return r.value; }
}
