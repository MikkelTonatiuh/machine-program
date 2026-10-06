// The pad fit table (data/figure_mpfb_fit.json) made offline, with the engine running in node (engine_sim.mjs): for each exercise,
// the pads the figure does not meet are moved toward it, by the gap along the pad's normal, then the exercise is checked again.
//   node tools/fit_offline.mjs [exercise,...|all] [--out ../body_repo/data/figure_mpfb_fit.json] [--rounds 3] [--dry]
//  - a contact (landmark -> pad) with a mean gap above 0.004 H moves that pad by the gap along the pad's normal at the landmark
//  - a skin check with maxGap that fails (the figure floats off the part) moves that part by (gap - maxGap / 2) along the normal
//  - parts held by a hinge or a slide (dof, or a parent that moves) are not moved: they are listed for a manual look
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, probes } from './engine_sim.mjs';
import { REPO } from './paths.mjs';
import { FOLLOW } from './fit_compute.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const all = readdirSync(join(REPO, 'exercises')).map((f) => f.replace('.json', ''));
const exs = !process.argv[2] || process.argv[2].startsWith('--') || process.argv[2] === 'all' ? all : process.argv[2].split(',');
const OUT = arg('out', join(REPO, 'data', 'figure_mpfb_fit.json')), rounds = +arg('rounds', 3), dry = process.argv.includes('--dry');
const table = process.argv.includes('--keep') && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const add = (a, b) => a.map((x, i) => +(x + b[i]).toFixed(4));

function measure(ex, fit) {
  const S = makeScene(ex, { body: 'mpfb', fit }), P = probes(S);
  const c = P.contact(48), f = P.fit(24), sk = P.skin(48), rom = P.rom(48).violations;
  const moving = (id) => { const part = S.inst.machine.parts[id]; if (!part) return true; const d = part.def; return !!(d.dof || d.counter || d.follow || (d.parent && S.inst.machine.parts[d.parent] && (S.inst.machine.parts[d.parent].def.dof || d.parent[0] === '@'))); };
  return { S, c, f, sk, rom, moving };
}
const summary = (m) => {
  const bad = [];
  if (m.c.max > 0.004) bad.push('reach ' + m.c.max);
  for (const [k, v] of Object.entries(m.c.contacts)) if (!v.ok) bad.push('contact ' + k + ' [' + v.min + ',' + v.max + '] tol ' + v.tol);
  for (const [k, v] of Object.entries(m.sk.penetration)) if (!v.ok) bad.push('pen ' + k + ' ' + v.maxPen);
  for (const c of m.sk.checks) if (!c.ok) bad.push('check ' + c.part + ' [' + c.min + ',' + c.max + '] maxGap ' + c.maxGap + ' minGap ' + c.minGap + ' maxPen ' + c.maxPen);
  for (const r of m.rom) bad.push('rom ' + r);
  return bad;
};
const report = {};
for (const ex of exs) {
  let fit = JSON.parse(JSON.stringify(table[ex] ? { [ex]: table[ex] } : {})), m;
  for (let round = 0; round <= rounds; round++) {
    m = measure(ex, fit);
    const bad = summary(m);
    if (round === rounds || !bad.length) break;
    const t = fit[ex] = fit[ex] || {}, moves = {};
    for (const [name, c] of Object.entries(m.f)) { const part = name.split('->')[1]; if (c.mean > 0.004 && !m.moving(part)) (moves[part] = moves[part] || []).push(c.shift); }
    for (const c of m.sk.checks) if (c.maxGap != null && c.max > c.maxGap && c.n && !m.moving(c.part)) (moves[c.part] = moves[c.part] || []).push(c.n.map((x) => x * (c.max - 0.5 * c.maxGap)));
    if (!Object.keys(moves).length) break;
    for (const [part, vs] of Object.entries(moves)) {
      const mean = [0, 1, 2].map((k) => vs.reduce((a, v) => a + v[k], 0) / vs.length), prev = Array.isArray(t[part]) ? t[part] : [0, 0, 0];
      t[part] = add(prev, mean);
      for (const [fp, how] of Object.entries((FOLLOW[ex] || {})[part] || {})) { if (how === 'all') t[fp] = t[part].slice(); else { const o = {}; for (const end of Object.keys(how)) o[end] = t[part].slice(); t[fp] = o; } }
    }
    fit = { [ex]: t };
  }
  const bad = summary(m);
  if (fit[ex] && Object.keys(fit[ex]).length) table[ex] = fit[ex]; else delete table[ex];
  report[ex] = bad;
  console.log((bad.length ? 'LEFT ' : 'ok   ') + ex.padEnd(16), table[ex] ? JSON.stringify(table[ex]) : '', bad.length ? '\n        ' + bad.join('\n        ') : '');
}
if (!dry) { writeFileSync(OUT, JSON.stringify(table, null, 1)); console.log('wrote', OUT); }
const left = Object.entries(report).filter(([, b]) => b.length).length;
console.log(exs.length - left, 'of', exs.length, 'exercises pass every check;', left, 'have something left');
