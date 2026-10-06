// Runs a command and kills it if it grows past a memory cap or the PC runs short of free RAM (Mikkel's training shares this PC).
//   node tools/guarded.mjs <maxMB> <minFreeMB> <cmd> [args...]     prints the peak working set at the end
import { spawn, spawnSync } from 'node:child_process';
import { freemem } from 'node:os';
const [maxMB, minFree, cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: 'inherit' });
let peak = 0, killed = '';
const tick = setInterval(() => {
  const r = spawnSync('tasklist', ['/FI', 'PID eq ' + child.pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  const m = /"([\d,. ]+) K"\s*$/m.exec((r.stdout || '').trim()), kb = m ? +m[1].replace(/[^\d]/g, '') : 0;
  peak = Math.max(peak, kb / 1024);
  if (kb / 1024 > +maxMB) killed = 'over ' + maxMB + ' MB'; else if (freemem() / 1048576 < +minFree) killed = 'free RAM under ' + minFree + ' MB';
  if (killed) { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); clearInterval(tick); }
}, 400);
child.on('exit', (code) => { clearInterval(tick); console.log('guarded: exit', code, killed ? '(killed: ' + killed + ')' : '', 'peak working set', peak.toFixed(0), 'MB, free now', (freemem() / 1048576).toFixed(0), 'MB'); process.exit(killed ? 3 : code ?? 1); });
