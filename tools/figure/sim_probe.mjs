// The browser probes, in node, on the static figure (or the sculpted body): contact, pad gaps with fit suggestions, skin penetration, ROM.
//   node tools/sim_probe.mjs chest_press,leg_press,... [mpfb|sdf] [--fit none|file] [--skin]
import { makeScene, probes } from './engine_sim.mjs';
import { readFileSync } from 'node:fs';
const exs = (process.argv[2] || 'chest_press,leg_press,lateral_raise,hip_thrust').split(','), body = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'mpfb';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const fitArg = arg('fit', null), opts = { body };
if (fitArg === 'none') opts.fit = {}; else if (fitArg) opts.fit = JSON.parse(readFileSync(fitArg, 'utf8'));
const out = {};
for (const ex of exs) {
  const S = makeScene(ex, opts), P = probes(S), r = out[ex] = {};
  r.contact = P.contact(48);
  if (body === 'mpfb') r.fit = P.fit(24);
  if (process.argv.includes('--skin')) r.skin = P.skin(48);
  r.rom = P.rom(48).violations;
  console.log('==', ex, body, 'build ms', S.inst.buildStats.ms);
  console.log('  hand', r.contact.maxHand, 'foot', r.contact.maxFoot, 'pin', r.contact.maxPin, JSON.stringify(Object.fromEntries(Object.entries(r.contact.effectors))));
  for (const [k, v] of Object.entries(r.contact.contacts)) console.log('  contact', k.padEnd(26), 'min', v.min, 'max', v.max, 'tol', v.tol, v.ok ? 'ok' : 'OUT');
  if (r.fit) for (const [k, v] of Object.entries(r.fit)) console.log('  fit    ', k.padEnd(26), 'mean gap', v.mean, 'shift', JSON.stringify(v.shift));
  if (r.skin) { console.log('  skin ok', r.skin.ok, JSON.stringify(r.skin.penetration)); for (const c of r.skin.checks) console.log('   check', c.part, JSON.stringify(c.bones), 'min', c.min, 'max', c.max, 'maxGap', c.maxGap, 'minGap', c.minGap, 'n', JSON.stringify(c.n), c.ok ? 'ok' : 'OUT'); }
  console.log('  rom violations', JSON.stringify(r.rom));
}
