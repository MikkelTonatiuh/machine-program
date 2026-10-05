import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restField } from './body_field.mjs';
import { HERE, REPO } from './paths.mjs';
const name = process.argv[2] || 'm1', H = 1.78;
const R = JSON.parse(readFileSync(join(HERE, 'out', name, 'rest_pose.json'), 'utf8')), P = R.P;
const body = JSON.parse(readFileSync(join(REPO, 'data/body.json'), 'utf8'));
const OLD = restField(body);
console.log('REST pose (engine frame): back / front depth (cm, + forward of the pelvis origin) at heights above the pelvis origin');
console.log('dy(cm) | figure back front | mannequin back front | back gap (figure - mannequin)');
for (const dy of [-12, -8, -4, 0, 4, 8, 12, 16, 20, 25, 30, 40, 50, 60]) {
  const y = 0.53 * H + dy / 100; let zb = 9, zf = -9;
  for (let i = 0; i < R.NB; i++) if (Math.abs(P[i * 3]) < 0.015 && Math.abs(P[i * 3 + 1] - y) < 0.012) { zb = Math.min(zb, P[i * 3 + 2]); zf = Math.max(zf, P[i * 3 + 2]); }
  const yH = 0.53 + dy / 100 / H, b = OLD.snap([0, yH, -0.3], [0, 0, 1], 0.5), f = OLD.snap([0, yH, 0.3], [0, 0, -1], 0.5);
  const mb = b ? b[2] * H * 100 : NaN, mf = f ? f[2] * H * 100 : NaN;
  console.log(String(dy).padStart(5), '|', (zb * 100).toFixed(1).padStart(8), (zf * 100).toFixed(1).padStart(6), ' |', mb.toFixed(1).padStart(8), mf.toFixed(1).padStart(6), ' |', (zb * 100 - mb).toFixed(1).padStart(6));
}
