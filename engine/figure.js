// The static figure (Stage option body: 'mpfb'): one skinned mesh built offline from a MakeHuman / MPFB body (CC0), bound
// to the engine's own skeleton in its bind pose, shared by every exercise (data/figure_mpfb.glb, tools in the authoring
// workspace). Each exercise only paints its working muscles onto it (engine/skinbuild.js paintFigure, in the worker);
// nothing is meshed per exercise. The file is glTF 2.0 binary (KHR_mesh_quantization) read by this small parser, so no
// GLTFLoader is needed:
//   POSITION, NORMAL (int8), TEXCOORD_0 (uint16), JOINTS_0 / WEIGHTS_0 (uint8, bone order in extras.bones),
//   _AO (x: ambient occlusion), _WELD (welded vertex of each render vertex: UV seams split the render vertices, the
//   muscle painter works on the welded mesh), indices; extras: bind pose per bone { q, p } (metres, figure space), the
//   fist's grip centre, re-measured landmarks, the forearm twist helpers.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

  function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('figure: not a GLB file');
    let o = 12, json = null, bin = null;
    while (o < buf.byteLength) {
      const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)));
      else if (type === 0x004e4942) bin = new Uint8Array(buf, o + 8, len);
      o += 8 + len;
    }
    return { json, bin };
  }
  // an accessor as a tightly packed typed array; normalised integers become floats in [-1, 1] / [0, 1]
  function accessor(G, i, asFloat) {
    const a = G.json.accessors[i], v = G.json.bufferViews[a.bufferView], T = CT[a.componentType], nc = NC[a.type];
    const es = T.BYTES_PER_ELEMENT, stride = v.byteStride || nc * es, out = new (asFloat ? Float32Array : T)(a.count * nc);
    const src = new DataView(G.bin.buffer, G.bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0));
    const rd = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const k = asFloat && a.normalized ? 1 / NORM[a.componentType] : 1;
    for (let e = 0; e < a.count; e++) for (let c = 0; c < nc; c++) out[e * nc + c] = src[rd](e * stride + c * es, true) * k;
    return out;
  }
  // fetch, with an XMLHttpRequest fallback (file:// pages with file access)
  function fetchBuffer(url) {
    const xhr = () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'arraybuffer'; x.onload = () => (x.status === 200 || x.status === 0) && x.response ? res(x.response) : rej(new Error('figure: ' + url + ' ' + x.status)); x.onerror = () => rej(new Error('figure: ' + url)); x.send(); });
    if (typeof fetch !== 'function' || /^file:/.test(location.href)) return xhr();
    return fetch(url).then((r) => { if (!r.ok) throw new Error('figure: ' + url + ' ' + r.status); return r.arrayBuffer(); }, xhr);
  }

  function decode(buf) {
    const G = parseGLB(buf), pr = G.json.meshes[0].primitives[0], at = pr.attributes, X = G.json.extras || {};
    const pos = accessor(G, at.POSITION, true), nor = accessor(G, at.NORMAL, true), uv = accessor(G, at.TEXCOORD_0, true);
    const joints = accessor(G, at.JOINTS_0, true), skW = accessor(G, at.WEIGHTS_0, true), ao2 = accessor(G, at._AO, true);
    const weld = accessor(G, at._WELD, false), idx = Uint32Array.from(accessor(G, pr.indices, false));
    const NV = pos.length / 3, ao = new Float32Array(NV);
    for (let v = 0; v < NV; v++) { ao[v] = ao2[v * 2]; const s = skW[v * 4] + skW[v * 4 + 1] + skW[v * 4 + 2] + skW[v * 4 + 3] || 1; for (let k = 0; k < 4; k++) skW[v * 4 + k] /= s; }
    // the welded mesh for the painter: one vertex per weld id, triangles re-indexed
    let NW = 0; for (let v = 0; v < NV; v++) if (weld[v] + 1 > NW) NW = weld[v] + 1;
    const first = new Int32Array(NW).fill(-1); for (let v = 0; v < NV; v++) if (first[weld[v]] < 0) first[weld[v]] = v;
    const wpos = new Float32Array(NW * 3), wnor = new Float32Array(NW * 3), wskI = new Float32Array(NW * 4), wskW = new Float32Array(NW * 4);
    for (let w = 0; w < NW; w++) { const v = first[w]; for (let k = 0; k < 3; k++) { wpos[w * 3 + k] = pos[v * 3 + k]; wnor[w * 3 + k] = nor[v * 3 + k]; } for (let k = 0; k < 4; k++) { wskI[w * 4 + k] = joints[v * 4 + k]; wskW[w * 4 + k] = skW[v * 4 + k]; } }
    for (let w = 0; w < NW; w++) { const l = Math.hypot(wnor[w * 3], wnor[w * 3 + 1], wnor[w * 3 + 2]) || 1; for (let k = 0; k < 3; k++) wnor[w * 3 + k] /= l; }
    for (let v = 0; v < NV; v++) { const l = Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) || 1; for (let k = 0; k < 3; k++) nor[v * 3 + k] /= l; }
    const widx = new Uint32Array(idx.length); for (let i = 0; i < idx.length; i++) widx[i] = weld[idx[i]];
    return { NV, NW, pos, nor, uv, joints, skW, ao, weld, idx, welded: { pos: wpos, nor: wnor, idx: widx, joints: wskI, skW: wskW },
      bones: X.bones, bind: X.bind, grip: X.grip, landmarks: X.landmarks, twist: X.twist || {}, bytes: buf.byteLength };
  }

  // fig.skI for a skeleton: engine bone indices (the skeleton's own order; the twist helpers follow its last bone)
  function bindToSkeleton(fig, sk) {
    const n = sk.list.length, map = fig.bones.map((b) => (sk.bones[b] ? sk.bones[b].idx : b === 'ftw_l' ? n : b === 'ftw_r' ? n + 1 : -1));
    if (map.some((x) => x < 0)) throw new Error('figure: a bone the skeleton does not have');
    const remap = (J) => { const o = new Float32Array(J.length); for (let i = 0; i < J.length; i++) o[i] = map[J[i]]; return o; };
    return { skI: remap(fig.joints), wskI: remap(fig.welded.joints), nb: n + 2 };
  }

  MCE.Figure = { parseGLB, decode, bindToSkeleton, load: (url) => fetchBuffer(url).then(decode) };
})(typeof window !== 'undefined' ? window : globalThis);
