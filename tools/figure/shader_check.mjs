// Builds the skin material's shader text exactly as the browser does (skinMaterial + onBeforeCompile) and checks it for
// JS-side mistakes: unresolved interpolations, NaN / undefined, unbalanced braces and #if blocks, every figure option.
import { loadSim } from './engine_sim.mjs';
const M = loadSim(), SH = M.shading, THREE = globalThis.THREE;
const U = SH.skinUniforms(23, 22); SH.setFinish(U, 'clay');
const vs0 = '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n', fs0 = '#include <common>\n#include <output_fragment>\n#include <tonemapping_fragment>\n';
const cases = [['plain sculpted', 'skin', null], ['figure pads+normal', 'skin', { pads: true, normalMap: {}, normalScale: 1.6, knee: 0.17, keep: 0.45, roughness: 0.78 }], ['figure no pads', 'skin', { normalMap: {}, normalScale: 1 }], ['mask', 'mask', { pads: true }], ['heads', 'heads', null], ['field', 'field', null]];
let bad = 0;
const bal = (s, a, b) => (s.split(a).length - 1) - (s.split(b).length - 1);
for (const [name, mode, fig] of cases) {
  const mat = SH.skinMaterial(U, mode, fig), sh = { uniforms: {}, vertexShader: vs0, fragmentShader: fs0 };
  mat.onBeforeCompile(sh);
  const problems = [];
  for (const [k, s] of [['vertex', sh.vertexShader], ['fragment', sh.fragmentShader]]) {
    if (/undefined|NaN|\$\{|\[object/.test(s)) problems.push(k + ': unresolved text ' + (s.match(/.{20}(undefined|NaN|\$\{|\[object).{20}/s) || [''])[0].replace(/\n/g, ' '));
    if (bal(s, '{', '}')) problems.push(k + ': braces ' + bal(s, '{', '}'));
    if (bal(s, '(', ')')) problems.push(k + ': parens ' + bal(s, '(', ')'));
    const ifs = (s.match(/^\s*#if(def|ndef)?\b/gm) || []).length, ends = (s.match(/^\s*#endif\b/gm) || []).length;
    if (ifs !== ends) problems.push(k + ': #if ' + ifs + ' vs #endif ' + ends);
  }
  if (!mat.customProgramCacheKey) problems.push('no cache key');
  console.log(name.padEnd(20), 'defines', JSON.stringify(mat.defines || {}), 'key', mat.customProgramCacheKey(), problems.length ? 'PROBLEMS ' + problems.join(' | ') : 'ok', 'lens', sh.vertexShader.length, sh.fragmentShader.length);
  bad += problems.length;
}
console.log(bad ? 'FAILED' : 'all ok');
process.exit(bad ? 1 : 0);
