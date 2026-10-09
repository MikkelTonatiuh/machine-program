// Merges a hand-over patch for new animated alternatives into the program (index.html) and the figure fit table.
//
// usage:  node tools/apply_patch.mjs patch.json [--dry] [--run]
//   patch.json = {
//     "ex":      { "<id>": { ...the exercise entry, as in the program's "ex"... } },           new entries (or fields to add to an existing one)
//     "links":   [ { "base": "<id>", "alt": "<id>", "m": "same|close|weak", "w": "<reason, at most 60 characters>", "rm": "...", "rw": "..." } ],
//     "fit":     { "<id>": { ...the exercise's entry in data/figure_mpfb_fit.json... } },
//     "aliases": { "<newId>": "<oldAltId>" }                                                   optional, adds to or overrides ALIASES
//   }
// For every link the tool adds `alt` to base.swap (and `base` to alt.swap, so the way back exists), removes `alt` from base.alts (a text
// alternative that now has its animation is promoted), and sets base.eq[alt] and alt.eq[base] (a link may carry rm / rw for the way back;
// otherwise the same match and reason). Each eq list is kept best first (same, close, weak; earlier entries stay ahead within a grade).
// A one-sided entry ("unilateral": true) with no "side" gets "arm" or "leg" from its primary muscles (tools/side.mjs).
// Aliases: an animated exercise can come under a different id than the text-only alternative it replaces (ALIASES below). When the patch
// brings in such an id, the old alternative leaves every base.alts, its eq entry moves to the new id (in the same place, unless a link
// of the patch already set one: the link wins) and the new id joins that base's swap list.
// It is idempotent (a second run changes nothing), refuses unknown ids (an exercise, a link's base or alt, a fit entry, an alias, a
// swap list) and unknown keys, and changes nothing when anything is wrong.
// Then: node tools/program.mjs && node tools/thumbs.mjs --only <the new ids> && node tools/pwa.mjs   (--run does all three)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sideFor } from './side.mjs';

// the new animated id : the text-only alternative id it replaces
const ALIASES = {
  face_pull: 'rope_face_pull',
  assisted_pullup: 'assisted_pull_up',
  smith_squat: 'smith_squat_forward',
  smith_shoulder_press: 'smith_seated_press',
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('usage: node tools/apply_patch.mjs patch.json [--dry] [--run]'); process.exit(2); }
const DRY = process.argv.includes('--dry'), RUN = process.argv.includes('--run');
const patch = JSON.parse(readFileSync(resolve(file), 'utf8'));
const HTML = join(ROOT, 'index.html'), FIT = join(ROOT, 'data', 'figure_mpfb_fit.json');
const html = readFileSync(HTML, 'utf8');
const re = /(<script type="application\/json" id="program">)([\s\S]*?)(<\/script>)/, m = html.match(re);
const rawFit = readFileSync(FIT, 'utf8'), P = JSON.parse(m[2]), fit = JSON.parse(rawFit);
const before = JSON.stringify(P) + JSON.stringify(fit);
const problems = [], notes = [];
const ID = /^[a-z0-9_]{1,40}$/, GRADE = ['same', 'close', 'weak'];
const fail = (s) => problems.push(s);
for (const k of Object.keys(patch)) if (!['ex', 'links', 'fit', 'aliases'].includes(k)) fail('unknown key "' + k + '" in the patch (ex, links, fit, aliases)');
const aliases = Object.assign({}, ALIASES, patch.aliases || {});

// 1. the entries: new ones are added; an existing one takes the patch's fields (its swap, alts and eq are merged, not replaced)
const newIds = [];
for (const [id, e] of Object.entries(patch.ex || {})) {
  if (!ID.test(id) || !e || typeof e !== 'object') { fail('bad exercise entry "' + id + '"'); continue; }
  const old = P.ex[id];
  if (!old) newIds.push(id);
  const merged = Object.assign({}, old || {}, e);
  if (old) {
    if (old.swap || e.swap) merged.swap = [...new Set([...(old.swap || []), ...(e.swap || [])])];
    if (old.alts || e.alts) merged.alts = [...new Map([...(old.alts || []), ...(e.alts || [])].map((a) => [a.id, a])).values()];
    if (old.eq || e.eq) merged.eq = Object.assign({}, old.eq || {}, e.eq || {});
  }
  if (merged.side !== undefined && !['arm', 'leg'].includes(merged.side)) fail('"' + id + '": side must be "arm" or "leg"');
  if (merged.unilateral && merged.side === undefined) merged.side = sideFor(merged); // (a one-sided exercise: "each arm" or "each leg", from its primary muscles)
  P.ex[id] = merged;
}
// 2. the links
const rank = (e) => { const o = {}; for (const k of Object.keys(e.eq || {}).sort((a, b) => GRADE.indexOf(e.eq[a].m) - GRADE.indexOf(e.eq[b].m) || Object.keys(e.eq).indexOf(a) - Object.keys(e.eq).indexOf(b))) o[k] = e.eq[k]; e.eq = o; };
const linked = new Set();
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
  for (const [x, id] of [[b, l.alt], [a, l.base]]) if (x.alts) { x.alts = x.alts.filter((y) => y.id !== id); if (!x.alts.length) delete x.alts; }
  b.eq = Object.assign({}, b.eq || {}, { [l.alt]: { m: l.m, w: l.w } });
  a.eq = Object.assign({}, a.eq || {}, { [l.base]: { m: l.rm || l.m, w: l.rw || l.w } });
  linked.add(l.base + '>' + l.alt); linked.add(l.alt + '>' + l.base);
  rank(b); rank(a);
}
// 3. the aliases: the animated id takes the place of the text-only alternative it replaces
const promoted = new Set([...Object.keys(patch.ex || {}), ...(patch.links || []).map((l) => l.alt)]);
for (const [nid, oid] of Object.entries(aliases)) {
  if (!ID.test(nid) || !ID.test(oid)) { fail('alias "' + nid + '": "' + oid + '" is not an id'); continue; }
  if (!promoted.has(nid)) continue; // (this patch does not bring that exercise in)
  const n = P.ex[nid];
  if (!n) { fail('alias: unknown exercise "' + nid + '"'); continue; }
  if (nid === oid) { fail('alias: "' + nid + '" to itself'); continue; }
  for (const [bid, b] of Object.entries(P.ex)) {
    if (bid === nid) continue;
    const hadAlt = (b.alts || []).some((x) => x.id === oid), hadEq = !!(b.eq && b.eq[oid]);
    if (!hadAlt && !hadEq) continue;
    if (b.alts) { b.alts = b.alts.filter((x) => x.id !== oid); if (!b.alts.length) delete b.alts; }
    b.swap = [...new Set([...(b.swap || []), nid])];
    if (hadEq) {
      const eq = {};
      for (const k of Object.keys(b.eq)) {
        if (k === oid) { if (!b.eq[nid]) eq[nid] = b.eq[oid]; } // (a link's own line for the new id wins)
        else eq[k] = b.eq[k];
      }
      b.eq = eq; rank(b);
    }
    if (!(b.eq && b.eq[nid])) notes.push('"' + bid + '" now swaps to "' + nid + '" but has no eq line for it (the old "' + oid + '" had none)');
    if (!(n.swap || []).includes(bid)) notes.push('"' + nid + '" does not list "' + bid + '" in its swap (add a link, so the way back exists)');
  }
}
// 4. the fit table
for (const [id, v] of Object.entries(patch.fit || {})) {
  if (!P.ex[id]) { fail('fit: unknown exercise "' + id + '"'); continue; }
  fit[id] = Object.assign({}, fit[id] || {}, v);
}
// 5. what the patch's own entries name must exist, and be animated; a swap should go both ways
for (const id of Object.keys(patch.ex || {})) {
  const e = P.ex[id]; if (!e) continue;
  for (const s of e.swap || []) {
    const o = P.ex[s];
    if (!o) { fail('"' + id + '".swap names an unknown exercise "' + s + '"'); continue; }
    if (!o.ready) fail('"' + id + '".swap names "' + s + '", which is not ready');
    if (!(o.swap || []).includes(id) && !linked.has(s + '>' + id)) notes.push('"' + id + '" swaps to "' + s + '" but "' + s + '" does not swap back (add a link)');
    else if (!(e.eq && e.eq[s])) notes.push('"' + id + '" has no eq line for "' + s + '"');
  }
  if (e.ready && !existsSync(join(ROOT, 'exercises', id + '.json'))) notes.push('exercises/' + id + '.json is missing (its animation)');
}
if (problems.length) { console.error('Nothing changed:\n  ' + problems.join('\n  ')); process.exit(1); }
const after = JSON.stringify(P) + JSON.stringify(fit);
const said = [...new Set(notes)];
if (after === before) { console.log('Nothing to do: the patch is already in.' + (said.length ? '\nNotes:\n  ' + said.join('\n  ') : '')); process.exit(0); }
if (DRY) { console.log('Would change the program and/or the fit table (dry run).' + (said.length ? '\nNotes:\n  ' + said.join('\n  ') : '')); process.exit(0); }
writeFileSync(HTML, html.replace(re, (_, x, _y, z) => x + JSON.stringify(P) + z));
writeFileSync(FIT, JSON.stringify(fit, null, 1) + (rawFit.endsWith('\n') ? '\n' : '')); // (the file's own layout: one space of indent)
const touched = [...new Set([...newIds, ...(patch.links || []).map((l) => l.alt)])];
console.log('Merged: ' + newIds.length + ' new exercise(s), ' + (patch.links || []).length + ' link(s), ' + Object.keys(patch.fit || {}).length + ' fit entr' + (Object.keys(patch.fit || {}).length === 1 ? 'y' : 'ies') + '.');
if (said.length) console.log('Notes:\n  ' + said.join('\n  '));
const steps = [['tools/program.mjs'], ['tools/thumbs.mjs', '--only', touched.join(',')], ['tools/pwa.mjs']];
if (RUN) { for (const s of steps) { console.log('> node ' + s.join(' ')); const r = spawnSync(process.execPath, s, { cwd: ROOT, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); } }
else console.log('Next:\n  ' + steps.map((s) => 'node ' + s.join(' ')).join('\n  '));
