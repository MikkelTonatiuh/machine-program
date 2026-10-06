// Finds a fit entry for the machine parts that keep an exercise from passing its offline checks: coordinate descent on the
// shift of a group of parts (3 numbers, metres, H rest-pose frame), the cost being how far every check is outside its limit.
//   node tools/fit_search.mjs <exercise> <spec[,spec...]> [--steps 4,2,1] [--rounds 6] [--axes xyz] [--start 0,0,0] [--write]
// spec: "a"      one part (a single shift vector)
//       "a+b"    parts that move together by the same vector
//       "a:b"    a mirror pair: b gets the vector with x negated
//       "a:b+c:d" any mix; every spec is searched in turn, the earlier ones kept
//       "a@from" / "a@to" / "a@at": only that anchor of the part moves
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, probes } from './engine_sim.mjs';
import { REPO } from './paths.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ex = process.argv[2], specs = process.argv[3].split(',');
const steps = arg('steps', '4,2,1').split(',').map((x) => +x / 1000), rounds = +arg('rounds', 6), axes = arg('axes', 'xyz');
const FIT = join(REPO, 'data', 'figure_mpfb_fit.json');
const table = JSON.parse(readFileSync(FIT, 'utf8'));
const mirror = (v) => [-v[0], v[1], v[2]];

// one entry of the exercise's fit from a spec's parts and its vector; "part[w0,w1]": the from end moves by w0 x vector, the to end by
// w1 x vector (a chain of segments that keeps its joints: 0, 0.5, 1, 1, 0.5, 0)
function apply(entry, spec, v) {
  const groups = spec.split('+');
  for (const g of groups) {
    const m = /^(.*?)(?:\[([\d./-]+)\])?$/.exec(g), w = m[2] ? m[2].split('/').map(Number) : null, pair = m[1].split(':');
    pair.forEach((pp, i) => {
      const [id, anchor] = pp.split('@'), vec = (i === 0 ? v : mirror(v)).map((x) => +x.toFixed(4));
      if (w) entry[id] = { from: vec.map((x) => +(x * w[0]).toFixed(4)), to: vec.map((x) => +(x * w[1]).toFixed(4)) };
      else entry[id] = anchor ? { ...(typeof entry[id] === 'object' && !Array.isArray(entry[id]) ? entry[id] : {}), [anchor]: vec } : vec;
    });
  }
}
function evaluate(entry) {
  const S = makeScene(ex, { body: 'mpfb', fit: { ...table, [ex]: entry } }), P = probes(S);
  const c = P.contact(48), sk = P.skin(48), rom = P.rom(48).violations;
  let cost = 0; const why = [];
  const add = (x, what) => { if (x > 1e-9) { cost += x; why.push(what + ' ' + (x * 1000).toFixed(1) + ' mm'); } };
  add(Math.max(0, Math.max(c.maxHand || 0, c.maxFoot || 0, c.maxPin || 0) - 0.004), 'reach');
  for (const [k, v] of Object.entries(c.contacts)) { add(Math.max(0, -v.tol - v.min) + Math.max(0, v.max - v.tol), 'contact ' + k); if (!v.ok && cost === 0) cost += 1e-4; }
  for (const [k, v] of Object.entries(sk.penetration)) add(Math.max(0, v.maxPen - v.tol), 'pen ' + k);
  for (const k of sk.checks) {
    if (k.maxGap != null) add(Math.max(0, k.max - k.maxGap), 'gap ' + k.part);
    if (k.minGap != null) add(Math.max(0, k.minGap - k.min), 'clear ' + k.part);
    if (k.maxPen != null && k.min < 0) add(Math.max(0, -k.min - k.maxPen), 'checkpen ' + k.part);
    if (!k.ok && !why.some((w) => w.endsWith(k.part) || w.includes(' ' + k.part + ' '))) { cost += 1e-4; why.push('check ' + k.part + ' (not ok)'); }
  }
  for (const r of rom) { const m = /([\d.]+) [<>] ([\d.]+)/.exec(r); add(m ? Math.abs(+m[1] - +m[2]) * 0.001 : 0.001, 'rom ' + r); }
  return { cost, why };
}

const entry = JSON.parse(JSON.stringify(table[ex] || {}));
let best = evaluate(entry);
console.log(ex, 'start cost', (best.cost * 1000).toFixed(2), 'mm', best.why.join('; '));
for (const spec of specs) {
  const first = spec.split('+')[0].split(':')[0].split('@')[0], had = entry[first];
  let v = process.argv.includes('--start') ? arg('start', '0,0,0').split(',').map(Number) : (Array.isArray(had) ? had.slice() : [0, 0, 0]), cur = best; // (the search continues from the part's current entry)
  const trial = (vv) => { const e = JSON.parse(JSON.stringify(entry)); apply(e, spec, vv); return e; };
  for (const st of steps) {
    for (let r = 0; r < rounds; r++) {
      let moved = false;
      for (let a = 0; a < 3; a++) {
        if (!axes.includes('xyz'[a])) continue;
        for (const dir of [1, -1]) {
          const vv = v.slice(); vv[a] += dir * st;
          const ev = evaluate(trial(vv)), reg = 1e-6 * (Math.abs(vv[0]) + Math.abs(vv[1]) + Math.abs(vv[2]));
          if (ev.cost + reg < cur.cost + 1e-6 * (Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2])) - 1e-9) { v = vv; cur = ev; moved = true; }
        }
      }
      if (!moved) break;
    }
  }
  apply(entry, spec, v); best = cur;
  console.log('spec', spec, 'vector', JSON.stringify(v.map((x) => +x.toFixed(4))), 'cost', (best.cost * 1000).toFixed(2), 'mm', best.why.join('; ') || 'all checks pass');
}
console.log(JSON.stringify({ [ex]: entry }));
if (process.argv.includes('--write')) { table[ex] = entry; writeFileSync(FIT, JSON.stringify(table, null, 1)); console.log('wrote', FIT); }
