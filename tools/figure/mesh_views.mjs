// software renders of a figure's bind mesh (out/<name>/mesh.json) and, optionally, the current SDF body at rest
//   node tools/mesh_views.mjs <name> <out.png> '<views json>' [--sdf]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { renderViews } from './raster.mjs';
const [name, outp, vj] = process.argv.slice(2);
import { HERE, REPO } from './paths.mjs';
const D = join(HERE, 'out', name);
const m = JSON.parse(readFileSync(join(D, 'mesh.json'), 'utf8'));
const views = JSON.parse(vj);
renderViews({ P: Float32Array.from(m.P), N: Float32Array.from(m.N), idx: Uint32Array.from(m.idxW) }, views, outp, { size: 380 });
if (process.argv.includes('--sdf')) {
  const { restJob } = await import('./body_field.mjs');
  const body = JSON.parse(readFileSync(join(REPO, 'data/body.json'), 'utf8'));
  const { J } = restJob(body);
  const R = (await import('./engine_node.mjs')).loadEngine().SKIN_MODULE().buildSkin(J);
  renderViews({ P: R.pos, N: R.nor, idx: R.idx }, views, outp.replace(/\.png$/, '_sdf.png'), { size: 380 });
}
console.log('ok');
