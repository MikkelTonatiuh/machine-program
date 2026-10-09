// Minimal Chrome DevTools Protocol driver (Node 22+: global WebSocket + fetch). One headless Chrome per session,
// SwiftShader GL so renders are deterministic on any machine (verify); launch({ gpu: true }) uses the real GPU instead
// (behaviour tests, where SwiftShader's slow frames would delay every dispatched input event).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ gpu = false } = {}) {
  const port = 9200 + ((process.pid * 7 + Math.floor(Math.random() * 600)) % 700);
  const prof = mkdtempSync(join(tmpdir(), 'mce-cdp-'));
  const gl = gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', ...gl, '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* */ }
    if (!wsUrl) await sleep(100);
  }
  if (!wsUrl) { chrome.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  // (sessionId: a target attached with flatten, e.g. the service worker)
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const page = {
    logs, send,
    async size(w, h, dpr = 1) { await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: +dpr, mobile: +w < 600 }); },
    async goto(url, timeoutMs = 60000) {
      await send('Page.navigate', { url });
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const r = await send('Runtime.evaluate', { expression: '!!window.__ready', returnByValue: true });
        if (r.result?.result?.value === true) return true;
        await sleep(100);
      }
      return false;
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result?.result?.value;
    },
    async shot(out) { await sleep(60); const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(out, Buffer.from(s.result.data, 'base64')); },
    // wait for Chrome to exit before removing its profile (Windows keeps the files locked until then; removing after a
    // fixed 200 ms left a stale profile folder in %TEMP% on most runs)
    async close() { try { ws.close(); } catch { /* */ } const gone = chrome.exitCode !== null ? Promise.resolve() : new Promise((r) => chrome.once('exit', r)); chrome.kill(); await Promise.race([gone, sleep(5000)]); try { rmSync(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ } },
  };
  return page;
}

// CLI: node tools/cdp.mjs <url> <out.png> [w=540] [h=540] [dpr=1] [js]
if (process.argv[1] && process.argv[1].endsWith('cdp.mjs') && process.argv.length > 3) {
  const [url, out, w = '540', h = '540', dpr = '1', js = ''] = process.argv.slice(2);
  const p = await launch();
  await p.size(w, h, dpr);
  const ok = await p.goto(url);
  if (js) console.log('eval =>', JSON.stringify(await p.eval(js)));
  const err = await p.eval('window.__error || null');
  if (err) console.log('PAGE ERROR', err);
  await p.shot(out);
  console.log(`ready=${ok} ${out}`); if (p.logs.length) console.log(p.logs.slice(0, 30).join('\n'));
  await p.close();
}
