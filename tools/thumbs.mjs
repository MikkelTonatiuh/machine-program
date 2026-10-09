// Renders the thumbnails the Options sheet shows (thumbs/<id>.webp): the app's own figure engine drawing each ready exercise at its peak
// contraction, working muscles glowing, on the horizon, 160 x 200 and at most 5 KB (the quality is lowered until it fits).
//
// usage:  node tools/thumbs.mjs [--only chest_press,leg_press] [--out thumbs] [--max 5000]
// needs:  Chrome (CHROME=/path/to/chrome.exe if it is not in the usual place); software rendering, one browser, closed at the end.
//         Run it again for the ids of any exercise that was added or whose animation changed, then node tools/pwa.mjs.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(ROOT, arg('out', 'thumbs')), ONLY = arg('only', ''), MAX = +arg('max', 5000);
const W = 160, H = 200, STAGE_W = 400, STAGE_H = 500;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };

const program = JSON.parse(readFileSync(join(ROOT, 'index.html'), 'utf8').match(/<script type="application\/json" id="program">([\s\S]*?)<\/script>/)[1]);
const ids = (ONLY ? ONLY.split(',').map((x) => x.trim()).filter(Boolean) : Object.keys(program.ex).filter((id) => program.ex[id].ready)).sort();
for (const id of ids) if (!program.ex[id] || !program.ex[id].ready) { console.error('not a ready exercise: ' + id); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

// the figure is framed for a tall thumbnail: the arc low in the picture, the figure large, no text zone
const INIT = `(() => { let m; const frame = (w, h) => { const top = Math.round(h * 0.03), arcY = Math.round(h * 0.82), f = 0.83, bh = 1.22 * (arcY - top) / f, y0 = arcY - f * bh;
  return { mode: 'below', top, arc: { y: arcY, R: 1.3 * w }, box: { x0: 0, y0, x1: w, y1: y0 + bh }, text: { x0: 0, y0: h, x1: w, y1: h } }; };
  Object.defineProperty(window, 'MCE', { configurable: true, get() { return m; }, set(v) { m = new Proxy(v, { set(t, key, val) { t[key] = key === 'playerLayout' ? frame : val; return true; } }); } }); })();`;
const CAPTURE = `(async () => {
  const W = ${W}, H = ${H}, MAX = ${MAX}, st = window.__stage;
  st.pause(); st.setPhase(st.cur.motion.peak); st._draw(0);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { alpha: false }); cx.imageSmoothingQuality = 'high';
  cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
  const put = (c, op) => { cx.globalCompositeOperation = op; cx.drawImage(c, 0, 0, c.width, c.height, 0, 0, W, H); };
  put(st.skyCanvas, 'source-over'); put(st.timerCanvas, 'screen'); put(st.glCanvas, 'source-over'); put(st.bloomCanvas, 'screen');
  const enc = (q) => new Promise((res) => cv.toBlob(res, 'image/webp', q));
  const b64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
  let q = 0.72, blob = await enc(q);
  while (blob.size > MAX && q > 0.05) { q = Math.round((q - 0.06) * 100) / 100; blob = await enc(q); }
  return { data: await b64(blob), size: blob.size, q };
})()`;

const page = await launch();
let bad = 0;
try {
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*/sw.js'] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  await page.size(STAGE_W, STAGE_H, 2);
  for (const id of ids) {
    if (!await page.goto(base + '?ex=' + id + '&t=peak', 120000)) { console.log(id + ': the page did not get ready'); bad++; continue; }
    const r = await page.eval(CAPTURE);
    writeFileSync(join(OUT, id + '.webp'), Buffer.from(r.data, 'base64'));
    console.log(id.padEnd(22) + (r.size / 1024).toFixed(1) + ' KB (quality ' + r.q + ')' + (r.size > MAX ? '  OVER ' + MAX : ''));
    if (r.size > MAX) bad++;
  }
  const errs = page.logs.filter((l) => /EXC|^error/i.test(l));
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));
} finally { await page.close(); server.close(); }
process.exitCode = bad ? 1 : 0;
