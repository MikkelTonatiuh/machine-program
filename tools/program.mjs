// Writes the list in PROGRAM.md: the exact program, day by day, in order, with each exercise's sets, reps and rest, taken from
// the program inside index.html (so the list cannot drift from what the app does), and checks that the program hangs together:
//
//   node tools/program.mjs           rewrite the list in PROGRAM.md (the part between the markers)
//   node tools/program.mjs --check   exit 1 if PROGRAM.md is stale or the program does not hang together (nothing is written)
//
// The check: every step names an exercise that has an entry; every entry is used by a step, a swap or a harder variant (or is a
// day's cover); every ready exercise has its animation file in exercises/; every swap and harder variant names a ready exercise;
// every day's cover is an exercise; every set step has its sets, a rep range and a rest (a top set: its own range, and sets after it;
// restTop, the rest after it, when given); a timer's phases add up to its time; a day's order (when it has one: steps added later
// are appended, so saved progress keeps its step) lists every step once, the automatic warm-up first. A step taken out of the
// program ("off") keeps its place in the steps (saved progress keeps its step numbers) and is not listed. The list follows each
// day's order. Run it after ANY change to the program, before committing: a change to the exercises or their order then shows up as a
// change in PROGRAM.md, in the diff, where it can be read.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script type="application\/json" id="program">([\s\S]*?)<\/script>/);
if (!m) throw new Error('index.html: no inline program');
const P = JSON.parse(m[1]);

const rest = (s) => (s % 60 === 0 ? s / 60 + ' min' : s + ' s');
const restOf = (st, e) => (st.restTop ? 'rest ' + rest(st.restTop) + ' after the top set, then ' + rest(st.rest) : 'rest ' + rest(st.rest) + (e && e.unilateral ? ' after both arms' : ''));
// a timed step in phases: its line (a warm-up), or the intervals in short: "8 min easy (...), 4 × 4 min hard (...) with 3 min easy (...) between, 5 min easy (...)"
const phasesText = (st) => {
  const L = st.phases, base = (p) => p.name.replace(/ \d+ of \d+$/, '').toLowerCase(), pt = (p) => (p.pulse ? ' (' + p.pulse + ')' : ''), one = (p) => mins(p.sec) + ' ' + base(p) + pt(p);
  const hard = L.filter((p) => p.hard);
  if (!hard.length) return st.line + (st.pulse ? ', pulse ' + st.pulse + ' bpm' : '');
  const a = L.indexOf(hard[0]), b = L.lastIndexOf(hard[hard.length - 1]), between = L.slice(a, b + 1).filter((p) => !p.hard);
  return [...L.slice(0, a).map(one), hard.length + ' × ' + mins(hard[0].sec) + ' hard' + pt(hard[0]) + (between.length ? ' with ' + one(between[0]) + ' between' : ''), ...L.slice(b + 1).map(one)].join(', ');
};
const mins = (s) => (s % 60 === 0 ? s / 60 + ' min' : (s / 60).toFixed(1).replace(/\.0$/, '') + ' min');
const range = (lo, hi) => lo + (hi !== lo ? '–' + hi : '');
// "4 × 8–10", or with a heavy top set first "top set 6–8, then 3 × 8–12"; "each arm", "every set to failure", "+ drop set"
const reps = (st, e) => (Array.isArray(st.top) ? 'top set ' + range(st.top[0], st.top[1]) + ', then ' + (st.n - 1) : st.n) + ' × ' + range(st.lo, st.hi)
  + (e.unilateral ? ' each arm' : '') + (e.failAll ? ', every set to failure' : '') + (e.drop ? ' + drop set' : '');
const swaps = (e) => (e.swap && e.swap.length ? '; swap: ' + e.swap.map((id) => (P.ex[id] ? P.ex[id].name : id)).join(', ') : '')
  + (e.next && P.ex[e.next] ? '; next: ' + P.ex[e.next].name : '');
const orderOf = (d) => (Array.isArray(d.order) ? d.order : d.steps.map((_, i) => i)).filter((i) => !d.steps[i].off);

// ---- the checks
const problems = [], notes = [];
const used = new Set();
P.days.forEach((d, k) => {
  const day = 'Day ' + (k + 1) + ' (' + d.name + ')';
  if (!d.steps.length) problems.push(day + ': no steps');
  d.steps.forEach((st, i) => {
    const where = day + ', step ' + (i + 1);
    if (st.ex && !st.off) used.add(st.ex);
    if (st.ex && !P.ex[st.ex]) problems.push(where + ': "' + st.ex + '" has no entry in the exercises');
    if (st.t === 'sets') {
      if (!(st.n >= 1)) problems.push(where + ': no sets');
      if (!(st.lo >= 1 && st.hi >= st.lo)) problems.push(where + ': the rep range is wrong');
      if (!(st.rest > 0)) problems.push(where + ': no rest');
      if (st.top !== undefined && !(Array.isArray(st.top) && st.top.length === 2 && st.top[0] >= 1 && st.top[1] >= st.top[0] && st.n >= 2)) problems.push(where + ': the top set is wrong (top: [lo, hi], and sets after it)');
      if (st.restTop !== undefined && !(st.restTop > 0 && Array.isArray(st.top))) problems.push(where + ': restTop is the rest after a top set');
    } else if (st.t === 'timer') {
      if (st.phases !== undefined && !(Array.isArray(st.phases) && st.phases.length && st.phases.every((p) => p.sec > 0 && typeof p.name === 'string') && st.phases.reduce((a, p) => a + p.sec, 0) === st.sec)) problems.push(where + ': the phases must have a time and a name each, and add up to the step\'s time');
    } else problems.push(where + ': unknown step type "' + st.t + '"');
  });
  if (d.order !== undefined) {
    const n = d.steps.length, o = d.order;
    if (!(Array.isArray(o) && o.length === n && new Set(o).size === n && o.every((i) => Number.isInteger(i) && i >= 0 && i < n))) problems.push(day + ': the order must list every step once');
    else if (d.steps.some((s, i) => s.auto && o[0] !== i)) problems.push(day + ': the automatic warm-up must come first in the order');
  }
  if (!P.ex[d.cover]) problems.push(day + ': the cover "' + d.cover + '" is not an exercise');
  else used.add(d.cover);
});
// a swap or a harder variant of an exercise a step uses is used too (it can take that step's place)
for (let grew = true; grew;) {
  grew = false;
  for (const id of [...used]) {
    const e = P.ex[id]; if (!e) continue;
    for (const x of [...(Array.isArray(e.swap) ? e.swap : []), ...(e.next ? [e.next] : [])]) {
      if (!P.ex[x]) { problems.push('"' + id + '" names "' + x + '" (a swap or its harder variant), which has no entry'); continue; }
      if (!P.ex[x].ready) problems.push('"' + id + '" names "' + x + '", which is not ready (no animation yet): leave it out until it is');
      if (!used.has(x)) { used.add(x); grew = true; }
    }
  }
}
for (const [id, e] of Object.entries(P.ex)) {
  if (!used.has(id)) problems.push('"' + id + '" has an entry but no step, swap or harder variant uses it');
  if (e.swap !== undefined && !(Array.isArray(e.swap) && e.swap.every((x) => typeof x === 'string' && x !== id))) problems.push('"' + id + '": swap must be a list of other exercises');
  if (e.alts !== undefined) {
    // other machines for the same movement (text only, best first): [{ id, n, cue? }]
    const ok = Array.isArray(e.alts) && e.alts.length <= 8 && e.alts.every((a) => a && /^[a-z0-9_]{1,40}$/.test(a.id) && typeof a.n === 'string' && a.n.length > 0 && a.n.length <= 60 && (a.cue === undefined || (typeof a.cue === 'string' && a.cue.length <= 80)));
    if (!ok || new Set(e.alts.map((a) => a.id)).size !== e.alts.length) problems.push('"' + id + '": alts must be up to 8 of { id (a-z, 0-9, _), n (the name), cue? }, with different ids');
  }
  if (e.eq !== undefined) {
    // how close each alternative is: { <id in swap or alts>: { m: same | close | weak, w: reason up to 60 characters } }
    const keys = new Set([...(Array.isArray(e.swap) ? e.swap : []), ...(Array.isArray(e.alts) ? e.alts.map((a) => a.id) : [])]);
    const ok = e.eq && typeof e.eq === 'object' && !Array.isArray(e.eq) && Object.entries(e.eq).every(([k, v]) => keys.has(k) && v && ['same', 'close', 'weak'].includes(v.m) && typeof v.w === 'string' && v.w.length > 0 && v.w.length <= 60);
    if (!ok) problems.push('"' + id + '": eq must map ids of its swap or alts to { m: same|close|weak, w: reason of at most 60 characters }');
  }
  if (Array.isArray(e.swap) || Array.isArray(e.alts)) for (const k of [...(e.swap || []), ...(e.alts || []).map((a) => a.id)]) if (!(e.eq && e.eq[k])) notes.push('"' + id + '" has no eq entry for "' + k + '" (Options then shows no match line for it)');
  if (e.reps !== undefined && !(Array.isArray(e.reps) && e.reps.length === 2 && e.reps[0] >= 1 && e.reps[1] >= e.reps[0])) problems.push('"' + id + '": reps must be [lo, hi]');
  // a no-weight exercise (kg0 0) is straight sets in its own range wherever it is done (a swap into a top-set step, a harder version)
  if (e.kg0 === 0) {
    if (!Array.isArray(e.reps)) problems.push('"' + id + '" has no weight (kg0 0): it needs its own rep range (reps: [lo, hi])');
    if (e.drop || e.compound) problems.push('"' + id + '" has no weight (kg0 0): no drop set and no warm-up ramp (drop, compound)');
  }
  if (e.ready && !existsSync(join(ROOT, 'exercises', id + '.json'))) problems.push('"' + id + '" is ready but exercises/' + id + '.json is missing');
}

// ---- the list
const out = [];
P.days.forEach((d, k) => {
  out.push('### Day ' + (k + 1) + ' · ' + d.name, '');
  orderOf(d).forEach((i, k) => {
    const st = d.steps[i];
    if (st.t === 'sets') { const e = P.ex[st.ex]; out.push((k + 1) + '. ' + e.name + ': ' + reps(st, e) + ', ' + restOf(st, e) + swaps(e)); }
    else if (st.phases) out.push((k + 1) + '. ' + st.name + ': ' + phasesText(st));
    else out.push((k + 1) + '. ' + st.name + (st.optional ? ' (optional)' : '') + ': ' + st.line + (st.pulse ? ', pulse ' + st.pulse + ' bpm' : ''));
  });
  out.push('');
});
const sets = P.days.map((d) => d.steps.filter((s) => s.t === 'sets' && !s.off).reduce((a, s) => a + s.n, 0));
const altLines = Object.values(P.ex).filter((e) => e.alts && e.alts.length).map((e) => '- ' + e.name + ': ' + e.alts.map((a) => a.n).join(', '));
if (altLines.length) out.push('Other machines (Options; text only: the figure of the exercise stays, its weights are kept apart):', '', ...altLines, '');
out.push('Working sets a day: ' + sets.map((n, k) => 'day ' + (k + 1) + ': ' + n).join(', ') + '. In a week: ' + sets.reduce((a, b) => a + b, 0) + '.', '');
const LIST = out.join('\n');

const START = '<!-- program:start -->', END = '<!-- program:end -->';
const FILE = join(ROOT, 'PROGRAM.md');
const HEAD = `# The program

The exact program the app runs: each day, each exercise in the order it comes, with its sets, reps and rest. The list below is
written by \`node tools/program.mjs\` from the program inside \`index.html\`, so it cannot drift from what the app does; when it is
out of date, \`node tools/program.mjs --check\` fails.

The routine is custom, not one of Jeff Nippard's programs. The exercise choices, effort, tempo and rest come from his free videos
and the research they cite; how they were checked is in the README.

Around the list, the app adds what is not a working set (the counts below leave it out):

- **Top set** on a step marked "top set" (the first compound of a lifting day): one heavy set first, 1–2 reps short of
  failure; the sets after it are about 85–90% of its weight.
- **Warm-up sets** before the first set of each compound: about 50% × 8 and 75% × 4 of the first set's weight (and 85% × 2
  before a top set; 75% × 4 alone when an earlier exercise has worked its muscles); one light set (about 50% × 10) before an
  isolation for a muscle the day has not worked yet. Whole kg (or lb).
- **Drop set** right after the last set of an exercise marked "+ drop set": no rest, about 30% lighter, to failure.
- **Each arm**: the weaker arm first, then the other arm does the same reps; the set counts the weaker arm's reps.
- **Swap** for a busy machine (Options): the exercise named after "swap" takes the step's place for the day (same sets, reps
  and rest; the first one listed is the best).
- **Other machines** (Options): text-only alternatives, listed after the program. The exercise's figure stays and so do its sets and
  rest; the machine's weights are kept apart (the first time it starts from the exercise's last weight: "start lighter").
- **Deload week**, when you choose it (the app suggests it after 6 weeks or when several lifts stall): half the sets, same
  weights, every set 3–4 reps short of failure.
- **No weight** (knee raise, leg raise, 45° back extension): reps first; once every set reaches the top, the knee raise moves on
  to the leg raise ("next"), and the others get harder (slower, then with a weight).

`;
const TAIL = `
## Left out on purpose

- Bulgarian split squat, cable lat pullover and machine dip: the research found each one repeats what the program already trains.
- Cable shrug: the research recommends it (the program has no direct upper-trap sets), but it has no animation yet, so it is not
  in the program.
- Supersets: the app logs one exercise at a time and cannot pair two.
`;
const block = START + '\n' + LIST + '\n' + END;

for (const id of Object.keys(P.ex)) if (P.ex[id].ready && !existsSync(join(ROOT, 'thumbs', id + '.webp'))) notes.push('no thumbnail for "' + id + '" (node tools/thumbs.mjs --only ' + id + ')');
if (notes.length) console.log(notes.map((n) => 'program note: ' + n).join(String.fromCharCode(10)));
if (process.argv.includes('--check')) {
  const cur = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
  const a = cur.indexOf(START), b = cur.indexOf(END);
  if (a < 0 || b < 0 || cur.slice(a, b + END.length) !== block) problems.push('PROGRAM.md is stale (run: node tools/program.mjs)');
  if (problems.length) { console.error(problems.map((p) => 'program: ' + p).join('\n')); process.exit(1); }
  console.log('program: PROGRAM.md is current and the program hangs together (' + P.days.length + ' days, ' + Object.keys(P.ex).length + ' exercises, ' + sets.reduce((x, y) => x + y, 0) + ' working sets a week)');
} else {
  if (problems.length) { console.error(problems.map((p) => 'program: ' + p).join('\n')); process.exit(1); }
  let cur = existsSync(FILE) ? readFileSync(FILE, 'utf8') : null;
  const a = cur ? cur.indexOf(START) : -1, b = cur ? cur.indexOf(END) : -1;
  cur = a >= 0 && b >= 0 ? cur.slice(0, a) + block + cur.slice(b + END.length) : HEAD + block + '\n' + TAIL;
  writeFileSync(FILE, cur);
  console.log('program: PROGRAM.md written (' + P.days.length + ' days, ' + sets.reduce((x, y) => x + y, 0) + ' working sets a week)');
}
