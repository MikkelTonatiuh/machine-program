// Merges a hand-over patch for new animated alternatives into the program (index.html) and the figure fit table.
//
// usage:  node tools/apply_patch.mjs patch.json [--dry] [--run]
//   patch.json = {
//     "ex":    { "<id>": { ...the exercise entry, as in the program's "ex"... } },           new entries (or fields to add to an existing one)
//     "links": [ { "base": "<id>", "alt": "<id>", "m": "same|close|weak", "w": "<reason, at most 60 characters>" } ],
//     "fit":   { "<id>": { ...the exercise's entry in data/figure_mpfb_fit.json... } }
//   }
// For every link the tool adds `alt` to base.swap (and `base` to alt.swap, so the way back exists), removes `alt` from base.alts (a text
// alternative that now has its animation is promoted), and sets base.eq[alt] and alt.eq[base] (a link may carry rm / rw for the way back;
// otherwise the same match and reason). Each eq list is kept best first (same, close, weak; earlier entries stay ahead within a grade).
// It is idempotent (a second run changes nothing), refuses unknown ids and changes nothing when anything is wrong.
// Then: node tools/program.mjs && node tools/thumbs.mjs --only <the new ids> && node tools/pwa.mjs   (--run does all three)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node tools/apply_patch.mjs patch.json [--dry] [--run]'); process.exit(2); }
const DRY = process.argv.includes('--dry'), RUN = process.argv.includes('--run');
const patch = JSON.parse(readFileSync(resolve(file), 'utf8'));
const HTML = join(ROOT, 'index.html'), FIT = join(ROOT, 'data', 'figure_mpfb_fit.json');
const html = readFileSync(HTML, 'utf8');
const re = /(<script type="application\/json" id="program">)([\s\S]*?)(<\/script>)/, m = html.match(re);
const P = JSON.parse(m[2]), fit = JSON.parse(readFileSync(FIT, 'utf8'));
const before = JSON.stringify(P) + JSON.stringify(fit);
const problems = [];
const ID = /^[a-z0-9_]{1,40}$/, GRADE = ['same', 'close', 'weak'];
const fail = (s) => problems.push(s);

// 1. the entries: new ones are added; an existing one takes the patch's fields (its swap, alts and eq are merged, not replaced)
const newIds = [];
for (const [id, e] of Object.entries(patch.ex || {})) {
  if (!ID.test(id) || !e || typeof e !== 'object') { fail('bad exercise entry "' + id + '"'); continue; }
  const old = P.ex[id];
  if (!old) newIds.push(id);
  const merged = Object.assign({}, old || {}, e);
  if (old) {
    merged.swap = [...new Set([...(old.swap || []), ...(e.swap || [])])];
    const byId = new Map([...(old.alts || []), ...(e.alts || [])].map((a) => [a.id, a]));
    merged.alts = [...byId.values()];
    merged.eq = Object.assign({}, old.eq || {}, e.eq || {});
  }
  P.ex[id] = merged;
}
// 2. the links
const rank = (e) => { const o = {}; for (const k of Object.keys(e.eq || {}).sort((a, b) => GRADE.indexOf(e.eq[a].m) - GRADE.indexOf(e.eq[b].m) || Object.keys(e.eq).indexOf(a) - Object.keys(e.eq).indexOf(b))) o[k] = e.eq[k]; e.eq = o; };
for (const l of patch.links || []) {
  const b = P.ex[l.base], a = P.ex[l.alt];
  if (!b) { fail('link: unknown base "' + l.base + '"'); continue; }
  if (!a) { fail('link: unknown alt "' + l.alt + '"'); continue; }
  if (!a.ready) fail('link: "' + l.alt + '" is not ready (it has no animation entry marked ready)');
  if (l.base === l.alt) { fail('link: "' + l.base + '" to itself'); continue; }
  for (const [who, mm, ww] of [['link ' + l.base + ' > ' + l.alt, l.m, l.w], ['link ' + l.alt + ' > ' + l.base, l.rm || l.m, l.rw || l.w]]) {
    if (!GRADE.includes(mm)) fail(who + ': m must be same, close or weak');
    if (typeof ww !== 'string' || !ww || ww.length > 60) fail(who + ': w must be a reason of 1 to 60 characters');
  }
  b.swap = [...new Set([...(b.swap || []), l.alt])];
  a.swap = [...new Set([...(a.swap || []), l.base])];
  if (b.alts) b.alts = b.alts.filter((x) => x.id !== l.alt);
  if (a.alts) a.alts = a.alts.filter((x) => x.id !== l.base);
  b.eq = Object.assign({}, b.eq || {}, { [l.alt]: { m: l.m, w: l.w } });
  a.eq = Object.assign({}, a.eq || {}, { [l.base]: { m: l.rm || l.m, w: l.rw || l.w } });
  rank(b); rank(a);
}
// 3. the fit table
for (const [id, v] of Object.entries(patch.fit || {})) {
  if (!P.ex[id]) { fail('fit: unknown exercise "' + id + '"'); continue; }
  fit[id] = Object.assign({}, fit[id] || {}, v);
}
if (problems.length) { console.error('Nothing changed:\n  ' + problems.join('\n  ')); process.exit(1); }
const after = JSON.stringify(P) + JSON.stringify(fit);
if (after === before) { console.log('Nothing to do: the patch is already in.'); process.exit(0); }
if (DRY) { console.log('Would change the program and/or the fit table (dry run).'); process.exit(0); }
writeFileSync(HTML, html.replace(re, (_, x, _y, z) => x + JSON.stringify(P) + z));
writeFileSync(FIT, JSON.stringify(fit, null, 1) + '\n');
const touched = [...new Set([...newIds, ...(patch.links || []).map((l) => l.alt)])];
console.log('Merged: ' + newIds.length + ' new exercise(s), ' + (patch.links || []).length + ' link(s), ' + Object.keys(patch.fit || {}).length + ' fit entr' + (Object.keys(patch.fit || {}).length === 1 ? 'y' : 'ies') + '.');
const steps = [['tools/program.mjs'], ['tools/thumbs.mjs', '--only', touched.join(',')], ['tools/pwa.mjs']];
if (RUN) { for (const s of steps) { console.log('> node ' + s.join(' ')); const r = spawnSync(process.execPath, s, { cwd: ROOT, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); } }
else console.log('Next:\n  ' + steps.map((s) => 'node ' + s.join(' ')).join('\n  '));
