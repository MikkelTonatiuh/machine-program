// Renders the overview's day pictures from the app's own figure engine:
//   covers/day<N>.webp        a looping animation of the day's cover exercise (day.cover in the program in index.html)
//   covers/day<N>-still.webp  one frame of it, for people who asked their device for reduced motion
// Each animation frame stores only the region that changed since the last one (the horizon and the machine stand still),
// which keeps a day at 40 to 90 KB; the frames are encoded by the browser itself and joined here into an animated WebP.
//
// usage:  node tools/covers.mjs [--out covers] [--size 320] [--quality 0.4] [--only 1,3]
// needs:  playwright with a Chromium (npm i -D playwright && npx playwright install chromium)
//         THREE_JS=/path/to/three.min.js   uses a local copy of three.js (r147) instead of the CDN
//         CHROME_PATH=/path/to/chrome      uses that browser instead of Playwright's own
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(ROOT, arg('out', 'covers')), SIZE = +arg('size', 320), QUALITY = +arg('quality', 0.4), ONLY = arg('only', '');
const STAGE = 440; // CSS px of the square the figure is drawn in (drawn at 2x, then scaled down to SIZE)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ---- the animated WebP container: RIFF 'WEBP' { VP8X, ANIM, ANMF x frames }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u24 = (n) => { const b = Buffer.alloc(3); b.writeUIntLE(n, 0, 3); return b; };
const chunk = (tag, data) => Buffer.concat([Buffer.from(tag, 'ascii'), u32(data.length), data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
// the image chunks (ALPH, VP8, VP8L) of a still WebP file
function imageChunks(file) {
  const parts = [];
  for (let o = 12; o + 8 <= file.length;) {
    const tag = file.toString('ascii', o, o + 4), size = file.readUInt32LE(o + 4), total = 8 + size + (size & 1);
    if (tag === 'VP8 ' || tag === 'VP8L' || tag === 'ALPH') parts.push(file.subarray(o, o + total));
    o += total;
  }
  if (!parts.length) throw new Error('not a WebP still');
  return Buffer.concat(parts);
}
// frames: [{ x, y, w, h, ms, file }] (x, y even; the first frame covers the whole canvas)
function animatedWebp(frames, W, H) {
  const vp8x = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(W - 1), u24(H - 1)]); // the animation flag
  const anim = Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0])]); // background, loop forever
  const body = [chunk('VP8X', vp8x), chunk('ANIM', anim)];
  for (const f of frames) body.push(chunk('ANMF', Buffer.concat([u24(f.x / 2), u24(f.y / 2), u24(f.w - 1), u24(f.h - 1), u24(f.ms), Buffer.from([0x02]) /* do not blend, keep */, imageChunks(f.file)])));
  const inner = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...body]);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), u32(inner.length), inner]);
}

// ---- a static server for the app
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const program = JSON.parse(readFileSync(join(ROOT, 'index.html'), 'utf8').match(/<script type="application\/json" id="program">([\s\S]*?)<\/script>/)[1]);
const only = ONLY ? new Set(ONLY.split(',').map(Number)) : null;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
try {
  for (let k = 0; k < program.days.length; k++) {
    if (only && !only.has(k + 1)) continue;
    const id = program.days[k].cover;
    const ctx = await browser.newContext({ viewport: { width: STAGE, height: STAGE }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    if (process.env.THREE_JS) await ctx.route(/three\.min\.js/, (r) => r.fulfill({ path: process.env.THREE_JS, contentType: 'text/javascript' }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    // the app's own composition has a text zone under the horizon; a picture keeps a band of dark planet at the bottom for the tile's label
    await page.addInitScript(() => {
      let m;
      const cover = (w, h) => {
        const top = Math.round(h * 0.02), arcY = Math.round(h * 0.79), frac = 0.83, bh = 1.2 * (arcY - top) / frac, y0 = arcY - frac * bh;
        return { mode: 'below', top, arc: { y: arcY, R: 1.3 * w }, box: { x0: 0, y0, x1: w, y1: y0 + bh }, text: { x0: 0, y0: h, x1: w, y1: h } };
      };
      Object.defineProperty(window, 'MCE', { configurable: true, get() { return m; }, set(v) { m = new Proxy(v, { set(t, key, val) { t[key] = key === 'playerLayout' ? cover : val; return true; } }); } });
    });
    await page.goto(base + '?ex=' + id + '&t=peak', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const r = await page.evaluate(async ({ SIZE, QUALITY }) => {
      const st = window.__stage, mo = st.cur.motion, dur = mo.duration;
      st.pause();
      const N = Math.max(12, Math.min(48, Math.round(dur * 8))), ms = Math.round(dur * 1000 / N);
      const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
      const cx = cv.getContext('2d', { alpha: false, willReadFrequently: true });
      let held = null; // the source pixels as of the last time each was stored (what the viewer's decoder shows, before compression)
      const b64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      const enc = (c, q) => new Promise((res) => c.toBlob(res, 'image/webp', q));
      const shot = (phase) => {
        st.setPhase(phase); st._draw(0); // (drawn now, read in the same task: the GL buffer is only there until the next frame)
        cx.globalCompositeOperation = 'source-over'; cx.fillStyle = '#000'; cx.fillRect(0, 0, SIZE, SIZE);
        const put = (c, op) => { cx.globalCompositeOperation = op; cx.drawImage(c, 0, 0, c.width, c.height, 0, 0, SIZE, SIZE); };
        put(st.skyCanvas, 'source-over'); put(st.timerCanvas, 'screen'); put(st.glCanvas, 'source-over'); put(st.bloomCanvas, 'screen');
        cx.globalCompositeOperation = 'source-over';
      };
      const frames = [];
      for (let i = 0; i < N; i++) {
        shot(i / N);
        const cur = cx.getImageData(0, 0, SIZE, SIZE).data;
        let x0 = 0, y0 = 0, x1 = SIZE, y1 = SIZE;
        if (i > 0) { // the box around what differs from what has been stored so far (a slow change adds up until it shows)
          x0 = SIZE; y0 = SIZE; x1 = -1; y1 = -1;
          for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
            const p = (y * SIZE + x) * 4;
            if (Math.abs(cur[p] - held[p]) > 5 || Math.abs(cur[p + 1] - held[p + 1]) > 5 || Math.abs(cur[p + 2] - held[p + 2]) > 5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 < 0) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; } // nothing moved: the smallest frame
          x0 = Math.max(0, (x0 - 3) & ~1); y0 = Math.max(0, (y0 - 3) & ~1); x1 = Math.min(SIZE, x1 + 4); y1 = Math.min(SIZE, y1 + 4);
        } else held = new Uint8ClampedArray(cur);
        const w = x1 - x0, h = y1 - y0, part = document.createElement('canvas'); part.width = w; part.height = h;
        part.getContext('2d', { alpha: false }).drawImage(cv, x0, y0, w, h, 0, 0, w, h);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * SIZE + x) * 4; held[p] = cur[p]; held[p + 1] = cur[p + 1]; held[p + 2] = cur[p + 2]; }
        const blob = await enc(part, QUALITY);
        frames.push({ x: x0, y: y0, w, h, ms, file: await b64(blob) });
      }
      shot(mo.peak); const still = await b64(await enc(cv, 0.6));
      return { frames, still, N, dur };
    }, { SIZE, QUALITY });
    const anim = animatedWebp(r.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, ms: f.ms, file: Buffer.from(f.file, 'base64') })), SIZE, SIZE);
    writeFileSync(join(OUT, 'day' + (k + 1) + '.webp'), anim);
    writeFileSync(join(OUT, 'day' + (k + 1) + '-still.webp'), Buffer.from(r.still, 'base64'));
    console.log('day ' + (k + 1) + ' (' + id + '): ' + r.N + ' frames of ' + r.frames[0].ms + ' ms, ' + (anim.length / 1024).toFixed(0) + ' KB animated, ' + (Buffer.from(r.still, 'base64').length / 1024).toFixed(0) + ' KB still');
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
