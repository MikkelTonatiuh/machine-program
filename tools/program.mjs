// Writes the list in PROGRAM.md: the exact program, day by day, in order, with each exercise's sets, reps and rest, taken from
// the program inside index.html (so the list cannot drift from what the app does), and checks that the program hangs together:
//
//   node tools/program.mjs           rewrite the list in PROGRAM.md (the part between the markers)
//   node tools/program.mjs --check   exit 1 if PROGRAM.md is stale or the program does not hang together (nothing is written)
//
// The check: every step names an exercise that has an entry; every entry is used by a step (or is a day's cover); every ready
// exercise has its animation file in exercises/; every day's cover is an exercise; every set step has its sets, a rep range and
// a rest. Run it after ANY change to the program, before committing: a change to the exercises or their order then shows up as a
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
const reps = (st, e) => st.n + ' × ' + st.lo + (st.hi !== st.lo ? '–' + st.hi : '') + (e.unilateral ? ' each arm' : '');

// ---- the checks
const problems = [];
const used = new Set();
P.days.forEach((d, k) => {
  const day = 'Day ' + (k + 1) + ' (' + d.name + ')';
  if (!d.steps.length) problems.push(day + ': no steps');
  d.steps.forEach((st, i) => {
    const where = day + ', step ' + (i + 1);
    if (st.ex) { used.add(st.ex); if (!P.ex[st.ex]) problems.push(where + ': "' + st.ex + '" has no entry in the exercises'); }
    if (st.t === 'sets') {
      if (!(st.n >= 1)) problems.push(where + ': no sets');
      if (!(st.lo >= 1 && st.hi >= st.lo)) problems.push(where + ': the rep range is wrong');
      if (!(st.rest > 0)) problems.push(where + ': no rest');
    } else if (st.t !== 'timer') problems.push(where + ': unknown step type "' + st.t + '"');
  });
  if (!P.ex[d.cover]) problems.push(day + ': the cover "' + d.cover + '" is not an exercise');
  else used.add(d.cover);
});
for (const [id, e] of Object.entries(P.ex)) {
  if (!used.has(id)) problems.push('"' + id + '" has an entry but no step uses it');
  if (e.ready && !existsSync(join(ROOT, 'exercises', id + '.json'))) problems.push('"' + id + '" is ready but exercises/' + id + '.json is missing');
}

// ---- the list
const out = [];
P.days.forEach((d, k) => {
  out.push('### Day ' + (k + 1) + ' · ' + d.name, '');
  d.steps.forEach((st, i) => {
    if (st.t === 'sets') { const e = P.ex[st.ex]; out.push((i + 1) + '. ' + e.name + ': ' + reps(st, e) + ', rest ' + rest(st.rest)); }
    else out.push((i + 1) + '. ' + st.name + ': ' + st.line + (st.pulse ? ', pulse ' + st.pulse + ' bpm' : ''));
  });
  out.push('');
});
const sets = P.days.map((d) => d.steps.filter((s) => s.t === 'sets').reduce((a, s) => a + s.n, 0));
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

`;
const TAIL = `
## Left out on purpose

- Bulgarian split squat, cable lat pullover and machine dip: the research found each one repeats what the program already trains.
- 45° back extension and cable shrug: the research recommends both (the program has no direct lower-back or upper-trap sets),
  but they have no animation yet, so they are not in the program.
- Supersets: the app logs one exercise at a time and cannot pair two.
`;
const block = START + '\n' + LIST + '\n' + END;

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
