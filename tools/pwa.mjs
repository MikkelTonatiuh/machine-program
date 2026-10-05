// Writes the service worker's build record (the first line of sw.js): the app's files with their SHA-256, and a version that
// changes whenever any of them does. sw.js installs a version's files into their own cache and refuses a file whose hash is not
// the one written here, so run this after changing ANY file the app ships (index.html, the engine, data, exercises, icons,
// covers, the manifest), before committing:
//
//   node tools/pwa.mjs           rewrite the build record in sw.js
//   node tools/pwa.mjs --check   exit 1 if the record is stale (nothing is written)
//
// sw.js itself is not in the list: the browser checks it byte for byte on its own.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');
const lines = readFileSync(SW, 'utf8').split('\n');
const first = lines[0].replace(/\r$/, ''); // (a checkout that turned the line endings into CRLF must not break the parse)
if (!first.startsWith('const BUILD = ')) throw new Error('sw.js: the first line is not the build record');
const old = JSON.parse(first.slice('const BUILD = '.length).replace(/;$/, ''));

// what the app ships: the page, the manifest, the icons, the engine, the data, the exercises, the day pictures
const list = (dir, ext) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => dir + '/' + f) : []);
const wanted = ['index.html', 'manifest.webmanifest', ...list('icons', '.png'), ...list('engine', '.js'), ...list('data', '.json'), ...list('data', '.glb'), ...list('data', '.webp'), ...list('exercises', '.json'), ...list('covers', '.webp')];
// files the record already knew keep their place; new ones follow
const known = old.files.map((f) => f[0]).filter((p) => wanted.includes(p));
const paths = [...known, ...wanted.filter((p) => !known.includes(p))];
const files = paths.map((p) => [p, createHash('sha256').update(readFileSync(join(ROOT, p))).digest('base64')]);
const version = createHash('sha256').update(files.map((f) => f[0] + ' ' + f[1]).join('\n')).digest('hex').slice(0, 12);
const record = 'const BUILD = ' + JSON.stringify({ version, files, cdn: old.cdn }) + ';';

if (process.argv.includes('--check')) {
  if (first !== record) { console.error('sw.js: the build record is stale (run: node tools/pwa.mjs)'); process.exit(1); }
  console.log('sw.js: the build record is current (' + version + ', ' + files.length + ' files)');
} else {
  lines[0] = record;
  writeFileSync(SW, lines.join('\n'));
  console.log('sw.js: version ' + version + ', ' + files.length + ' files' + (old.version === version ? ' (unchanged)' : ' (was ' + old.version + ')'));
}
