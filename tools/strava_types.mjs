// Reads the exercise_type names Strava's uploads documentation lists as supported ("Supported Exercises" on
// developers.strava.com/docs/uploads/) and writes them to tools/strava_exercise_types.json, which tools/program.mjs checks every exercise's
// "strava" name against. Run it when Strava adds names, or when program.mjs says a name is not in the list:  node tools/strava_types.mjs
// (nothing but that public page is read; --print shows the result without writing it).
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url))), 'strava_exercise_types.json');
const URL_ = 'https://developers.strava.com/docs/uploads/';
const res = await fetch(URL_);
if (!res.ok) { console.error('strava_types: ' + URL_ + ' answered ' + res.status); process.exit(1); }
const html = await res.text(), at = html.indexOf('id="supported-exercises"');
if (at < 0) { console.error('strava_types: the page has no "Supported Exercises" part (it changed: look at it)'); process.exit(1); }
const categories = {};
for (const m of html.slice(at).matchAll(/<p><strong>([^<]+?):<\/strong>\s*([^<]+)<\/p>/g)) categories[m[1].trim()] = m[2].split(',').map((x) => x.trim()).filter(Boolean);
const n = Object.values(categories).flat().length;
if (n < 300) { console.error('strava_types: only ' + n + ' names found (the page changed: look at it)'); process.exit(1); }
const out = { source: 'developers.strava.com/docs/uploads (Supported Exercises)', fetched: new Date().toISOString().slice(0, 10), categories };
if (process.argv.includes('--print')) console.log(JSON.stringify(out, null, 1));
else { writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n'); console.log('strava_types: ' + n + ' names in ' + Object.keys(categories).length + ' categories written to tools/strava_exercise_types.json'); }
