// glue equally sized PNGs (our own writer, RGB 8-bit) side by side
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { writePNG } from './raster.mjs';
function read(path) { const b = readFileSync(path); let o = 8, w = 0, h = 0; const idat = []; while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8); if (type === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); } if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; } const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) raw.copy(px, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1)); return { w, h, px }; }
export async function PNG_join(files, out) { const im = files.map(read), W = im.reduce((a, i) => a + i.w, 0), H = Math.max(...im.map((i) => i.h)), buf = Buffer.alloc(W * H * 3); let x0 = 0; for (const i of im) { for (let y = 0; y < i.h; y++) i.px.copy(buf, (y * W + x0) * 3, y * i.w * 3, (y + 1) * i.w * 3); x0 += i.w; } writePNG(out, W, H, buf); }
