// Shading: procedural horizon environment, the fixed light rig, the skin material in its satin or clay finish (GPU dual-quaternion skinning,
// volume-preserving muscle swell, emitted muscle glow with anti-aliased mask edges and fibre striation), and the quiet
// machine materials. Only working muscles are warm: the skin rim grades neutral (down) -> teal (up), machines get a
// cool rim only, and nothing else emits.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const NB_MAX = 24, NM_MAX = 32, PAD_MAX = 8;

  // brief palette, linear RGB (sRGB -> linear)
  const lin = (hex) => { const c = new g.THREE.Color(hex); return c; }; // ColorManagement.legacyMode=false converts on set
  const vec3 = (c) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;

  function makeEnvironment(renderer) {
    const THREE = g.THREE, es = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; void main(){
        float y = vD.y;
        vec3 c = mix(vec3(0.005,0.008,0.011), vec3(0.012,0.02,0.03), smoothstep(-0.2, 0.9, y));
        c += vec3(0.08,0.19,0.26) * exp(-pow((y-0.10)/0.18, 2.0)) * 0.9;     // teal atmosphere band
        c += vec3(0.20,0.18,0.18) * exp(-pow((y-0.01)/0.035, 2.0)) * 0.45;   // muted warm-neutral limb (no ember)
        c += vec3(0.05,0.04,0.04) * smoothstep(0.0, -0.3, y) * 0.3;          // dark planet below
        float key = smoothstep(0.80, 0.98, dot(vD, normalize(vec3(0.45,0.72,0.55))));
        c += vec3(1.0,0.96,0.92) * key * 0.45;
        gl_FragColor = vec4(c, 1.0); }` });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(es, 0.03).texture; pm.dispose(); mat.dispose();
    return tex;
  }

  // world-fixed light rig (the camera never orbits; the figure group is yawed instead)
  function makeLights(scene) {
    const THREE = g.THREE, grp = new THREE.Group(); grp.name = 'lights';
    const L = (color, i, x, y, z) => { const l = new THREE.DirectionalLight(color, i); l.position.set(x, y, z); l.target.position.set(0, 0.9, 0); grp.add(l); grp.add(l.target); return l; };
    const lights = {
      key: L(0xffeee2, 0.62, 1.8, 3.0, 2.2),      // soft key, front-top
      fill: L(0x6a8699, 0.20, -2.2, 0.8, 1.6),    // cool fill
      rimT: L(0x7fb4c8, 1.55, 1.2, 2.6, -5.0),    // teal rim from the atmosphere (above-behind)
      rimN: L(0x8e8687, 0.55, -0.8, -0.6, -6.0),  // neutral rim from the limb (below-behind), no ember
    };
    scene.add(grp);
    return lights;
  }

  // Skin finishes (Stage option `finish`; the Stage default is 'satin', the app ships 'clay': engine/app.js FINISH):
  //  satin: the film look, a dark satin sculpture backlit by the horizon; its fresnel rim grades neutral (normals facing
  //         down) -> teal (up), never ember on non-working skin
  //  clay:  a light matte clay sculpture (the owner's reference mannequin) lit by the key light against the dark horizon;
  //         a faint cool rim separates it from the sky, and the working-muscle glow is emitted brighter so the ember
  //         still stands out clearly on the light surface
  // Every finish keeps the brief's rules: only working muscles are warm, and bare skin never outshines the glow (the
  // highlight roll-off `knee` / `keep`, checked by verify's glowBrightestOk).
  const FINISHES = {
    satin: { color: 0x15181c, roughness: 0.56, env: 0.62, specKnee: 0.045, specKeep: 0.18, rimLo: [0.16, 0.145, 0.145], rimHi: [0.20, 0.44, 0.53],
      rim: 0.72, rimPow: 2.5, rimAO: 0.45, occ: 0.32, knee: 0.095, keep: 0.3, glow: 1.0, under: [0.9, 0.7] },
    clay: { color: 0xaaa7a2, roughness: 0.78, env: 0.5, specKnee: 0.03, specKeep: 0.25, rimLo: [0.06, 0.065, 0.07], rimHi: [0.10, 0.20, 0.25],
      rim: 0.45, rimPow: 3.0, rimAO: 0.5, occ: 0.42, knee: 0.135, keep: 0.25, glow: 1.55, under: [0.96, 0.8] },
  };
  const num = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  const v3 = (a) => `vec3(${a.map(num).join(', ')})`;
  // specular clamp, ambient occlusion, fresnel rim, highlight roll-off (bare skin never outshines the working-muscle glow)
  const rimChunk = (F) => `
    { float ls_ = dot(totalSpecular, vec3(0.2126, 0.7152, 0.0722));
      if (ls_ > ${num(F.specKnee)}) outgoingLight -= totalSpecular * (1.0 - (${num(F.specKnee)} + (ls_ - ${num(F.specKnee)}) * ${num(F.specKeep)}) / ls_); }
    vec3 nV_ = normalize(normal); vec3 vD_ = normalize(vViewPosition);
    float fres_ = pow(1.0 - clamp(dot(nV_, vD_), 0.0, 1.0), ${num(F.rimPow)});
    vec3 wn_ = normalize(vWN);
    vec3 rimC_ = mix(${v3(F.rimLo)}, ${v3(F.rimHi)}, smoothstep(-0.45, 0.55, wn_.y));
    float occ_ = mix(${num(F.occ)}, 1.0, vAO);
    outgoingLight *= occ_;
    outgoingLight += rimC_ * fres_ * ${num(F.rim)} * mix(${num(F.rimAO)}, 1.0, vAO);
    { float lk_ = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); if (lk_ > ${num(F.knee)}) outgoingLight *= (${num(F.knee)} + (lk_ - ${num(F.knee)}) * ${num(F.keep)}) / lk_; }`;
  const finishOf = (U) => FINISHES[(U && U.finish) || 'satin'] || FINISHES.satin;
  // the Stage tags each figure's uniforms with its finish (not enumerable, so three.js never sees it as a uniform)
  function setFinish(U, finish) {
    if (finish != null && !FINISHES[finish]) console.warn('MCE: unknown skin finish ' + finish + ', using satin');
    Object.defineProperty(U, 'finish', { value: FINISHES[finish] ? finish : 'satin', enumerable: false, configurable: true, writable: true });
    return U;
  }

  // Per-instance uniforms for one skinned figure
  function skinUniforms(nb, nm) {
    const THREE = g.THREE;
    return {
      uQr: { value: Array.from({ length: NB_MAX }, () => new THREE.Vector4(0, 0, 0, 1)) },
      uQd: { value: Array.from({ length: NB_MAX }, () => new THREE.Vector4()) },
      uHB: { value: Array.from({ length: NM_MAX }, () => new THREE.Vector2()) }, // per head: x = swell (m), y = activation
      uGlow: { value: 1.0 },
      // pads pressing into the static figure (engine/figure.js): figure space -> pad local, and the pad's shape
      // (rounded box: half sizes + corner radius; cylinder along local Y: r, half height, 0, -1)
      uPadM: { value: Array.from({ length: PAD_MAX }, () => new THREE.Matrix4()) },
      uPadP: { value: Array.from({ length: PAD_MAX }, () => new THREE.Vector4()) },
      uPadN: { value: 0 }, uPadK: { value: 0.007 },
      uKeyV: { value: new THREE.Vector3(0.4, 0.6, 0.7) },
    };
  }

  const DQ_PARS = `uniform vec4 uQr[${NB_MAX}]; uniform vec4 uQd[${NB_MAX}]; uniform vec2 uHB[${NM_MAX}];
    attribute vec4 aSkI; attribute vec4 aSkW; attribute vec4 aMus; attribute vec4 aBm; attribute vec3 aG0; attribute vec3 aG1; attribute vec2 aHd; attribute float aAO;
    varying vec4 vMus; varying vec2 vAct; varying float vAO; varying vec3 vWN; varying float vHd;
    #ifdef PADS
    uniform mat4 uPadM[${PAD_MAX}]; uniform vec4 uPadP[${PAD_MAX}]; uniform int uPadN; uniform float uPadK;
    float padSdf(vec3 lp, vec4 pp) {
      if (pp.w >= 0.0) { vec3 q = abs(lp) - pp.xyz + pp.w; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - pp.w; }
      vec2 d = vec2(length(lp.xz) - pp.x, abs(lp.y) - pp.y); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
    }
    #endif`;
  const DQ_MAIN = `
    float bA0 = uHB[int(aBm.x + 0.5)].x, bA1 = uHB[int(aBm.z + 0.5)].x;
    vec3 bnrm = normalize(normal - bA0 * aG0 - bA1 * aG1);
    vec3 bpos = position + normal * (bA0 * aBm.y + bA1 * aBm.w);
    int i0 = int(aSkI.x + 0.5), i1 = int(aSkI.y + 0.5), i2 = int(aSkI.z + 0.5), i3 = int(aSkI.w + 0.5);
    vec4 r0 = uQr[i0];
    vec4 qr = r0 * aSkW.x, qd = uQd[i0] * aSkW.x;
    vec4 rq = uQr[i1]; float w1 = aSkW.y * (dot(r0, rq) < 0.0 ? -1.0 : 1.0); qr += rq * w1; qd += uQd[i1] * w1;
    rq = uQr[i2]; float w2 = aSkW.z * (dot(r0, rq) < 0.0 ? -1.0 : 1.0); qr += rq * w2; qd += uQd[i2] * w2;
    rq = uQr[i3]; float w3 = aSkW.w * (dot(r0, rq) < 0.0 ? -1.0 : 1.0); qr += rq * w3; qd += uQd[i3] * w3;
    float ql = length(qr); qr /= ql; qd /= ql;
    vec3 dqPos = bpos + 2.0 * cross(qr.xyz, cross(qr.xyz, bpos) + qr.w * bpos)
               + 2.0 * (qr.w * qd.xyz - qd.w * qr.xyz + cross(qr.xyz, qd.xyz));
    vec3 dqNrm = bnrm + 2.0 * cross(qr.xyz, cross(qr.xyz, bnrm) + qr.w * bnrm);
    #ifdef PADS
    // pad press: skin inside a pad goes out to its surface (a smooth max with 0, so the skin just around the contact
    // bulges a little, like soft tissue), and the pressed skin turns to face the pad
    for (int i = 0; i < ${PAD_MAX}; i++) {
      if (i >= uPadN) break;
      vec3 lp = (uPadM[i] * vec4(dqPos, 1.0)).xyz; vec4 pp = uPadP[i];
      float d = padSdf(lp, pp);
      if (d < uPadK) {
        const float e = 0.001;
        vec3 pg = vec3(padSdf(lp + vec3(e, 0, 0), pp) - padSdf(lp - vec3(e, 0, 0), pp), padSdf(lp + vec3(0, e, 0), pp) - padSdf(lp - vec3(0, e, 0), pp), padSdf(lp + vec3(0, 0, e), pp) - padSdf(lp - vec3(0, 0, e), pp));
        mat3 pr = mat3(uPadM[i]); vec3 gw = normalize(pg * pr); // the pad matrix is rigid: back to figure space by its transpose
        float h = max(uPadK - abs(d), 0.0) / uPadK, dn = max(d, 0.0) + h * h * uPadK * 0.25;
        dqPos += gw * (dn - d);
        dqNrm = normalize(mix(dqNrm, -gw, 0.75 * (1.0 - smoothstep(-uPadK, 0.0, d))));
      }
    }
    #endif
    vMus = aMus; vAO = aAO; vHd = aHd.x;
    vAct = vec2(uHB[int(aHd.x + 0.5)].y, uHB[int(aHd.y + 0.5)].y);
    // perceptual curve: 0.55 at stretch reads clearly dimmer than 1.0 at peak; secondaries peak at ~0.46x the primary glow
    vAct = vec2(pow(max(vAct.x, 0.0), 1.45), 0.46 * pow(clamp(2.0 * vAct.y, 0.0, 1.0), 1.45));
    vAct.y /= 0.46; // secondary light level follows the primary curve (0.42 at the stretch, 1.0 at peak); its colour carries the ~0.46x
    vWN = normalize(mat3(modelMatrix) * dqNrm);`;

  function glowColors() {
    const THREE = g.THREE;
    const core = new THREE.Color('#ff5a1f'), fall = new THREE.Color('#c14d21'), amber = new THREE.Color('#e0a060');
    // secondary: #e0a060 lifted toward warm white and scaled so it reads as dimmer light next to the ember core (value
    // ~0.7 at peak, saturation ~0.45), never as a brown tint
    const sCore = amber.clone().multiplyScalar(0.56), sFall = amber.clone().lerp(fall, 0.3).multiplyScalar(0.32);
    return { core, fall, sCore, sFall };
  }

  // mode: 'skin' (normal), 'mask' (audit: R = primary mask, G = secondary mask, dilated), 'heads' (authoring colours)
  // fig (the static figure, engine/figure.js): { pads: true (the pad press), normalMap: texture (definition), normalScale }
  function skinMaterial(U, mode = 'skin', fig = null) {
    const THREE = g.THREE, C = glowColors();
    // the static figure may adjust the finish's highlight roll-off and roughness (the definition map needs the shading to keep
    // its contrast: the clay roll-off compresses everything above its knee to a quarter)
    const F0 = finishOf(U), fname = (U && U.finish) || 'satin';
    const F = fig && (fig.knee != null || fig.keep != null) ? { ...F0, knee: fig.knee ?? F0.knee, keep: fig.keep ?? F0.keep } : F0;
    const mat = new THREE.MeshStandardMaterial({ color: F.color, roughness: fig && fig.roughness != null ? fig.roughness : F.roughness, metalness: 0.0, envMapIntensity: F.env });
    if (fig && fig.normalMap) { mat.normalMap = fig.normalMap; const ns = fig.normalScale ?? 1; mat.normalScale = new THREE.Vector2(ns, ns); }
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + DQ_PARS)
        .replace('#include <beginnormal_vertex>', DQ_MAIN + '\nvec3 objectNormal = dqNrm;')
        .replace('#include <begin_vertex>', 'vec3 transformed = dqPos;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uGlow; uniform vec3 uKeyV; varying vec4 vMus; varying vec2 vAct; varying float vAO; varying vec3 vWN; varying float vHd;`)
        .replace('#include <output_fragment>', rimChunk(F) + '\n#include <output_fragment>')
        .replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
        {
          float fp = vMus.x, fs = vMus.y;
          float wP = max(fwidth(fp), 1e-4), wS = max(fwidth(fs), 1e-4);
          float aP = smoothstep(-wP, wP, fp);                         // anti-aliased mask edge at f = 0
          float aS = smoothstep(-0.2 - wS, 0.42 + wS, fs) * (1.0 - aP); // secondary: feathered edge, it reads as light spilling from the form
          #if defined(MODE_MASK)
            gl_FragColor = vec4(step(-0.10, fp), step(-0.22, fs), 0.0, 1.0);
          #elif defined(MODE_FIELD)
            float fv = max(fp, fs);
            vec3 band = mix(vec3(0.05, 0.1, 0.4), vec3(1.0, 0.8, 0.2), clamp(fv * 0.5 + 0.5, 0.0, 1.0));
            band *= 0.55 + 0.45 * step(0.5, fract(fv * 6.0));
            gl_FragColor.rgb = fv > -0.95 ? band : gl_FragColor.rgb;
          #elif defined(MODE_HEADS)
            vec3 hc = 0.5 + 0.5 * cos(6.2831853 * (fract(vHd * 0.618034) + vec3(0.0, 0.33, 0.67)));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, hc * (0.4 + 0.6 * smoothstep(0.0, 0.5, fp)), aP);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.9), aS * 0.6);
          #else
          if (aP + aS > 0.0005) {
            vec3 nV = normalize(normal); vec3 vD = normalize(vViewPosition);
            float ndv = clamp(dot(nV, vD), 0.0, 1.0);
            float fr = pow(1.0 - ndv, 2.2);
            float key = clamp(dot(nV, normalize(uKeyV)), 0.0, 1.0);
            float form = min(1.0, 0.50 + 0.36 * key + 0.24 * ndv);     // keeps the belly reading as a 3D form (no clipping)
            float fz = vMus.z, fwz = fwidth(fz);
            float st = 0.5 + 0.5 * cos(6.2831853 * fz);
            float stAmt = (1.0 - smoothstep(0.16, 0.42, fwz)) * vMus.w;  // fades where it would alias and toward tendons
            float stri = 1.0 - 0.15 * stAmt * (1.0 - st) * (1.0 - st);
            float bP = smoothstep(0.0, 1.05, fp);                        // belly weight: #c14d21 edges -> #ff5a1f belly
            bP = bP * bP * (3.0 - 2.0 * bP) * mix(0.45, 1.0, vMus.w);     // ... and brightest mid-belly, dimmer toward tendons
            vec3 gP = mix(${vec3(C.fall)} * 0.50, ${vec3(C.core)}, bP) * vAct.x * form * stri
                    + ${vec3(C.core)} * fr * 0.30 * vAct.x * (0.3 + 0.7 * bP);
            float bS = smoothstep(0.05, 0.9, fs); bS = bS * bS * (3.0 - 2.0 * bS) * mix(0.7, 1.0, vMus.w);
            vec3 gS = mix(${vec3(C.sFall)}, ${vec3(C.sCore)}, bS) * vAct.y * (0.55 + 0.45 * form) + ${vec3(C.sCore)} * fr * 0.2 * vAct.y;
            aS *= smoothstep(0.1, 0.38, ndv); // secondaries fade on silhouette-grazing faces (no ember rim on the arm outline)
            vec3 base = gl_FragColor.rgb;
            // emitted light, not a tint: the skin's own shading is suppressed under the glow
            gl_FragColor.rgb = base * (1.0 - ${num(F.under[0])} * aP - ${num(F.under[1])} * aS) + (gP * aP + gS * aS) * (uGlow * ${num(F.glow)});
          }
          #endif
        }`);
    };
    if (mode === 'mask') mat.defines = { MODE_MASK: 1 };
    if (mode === 'heads') mat.defines = { MODE_HEADS: 1 };
    if (mode === 'field') mat.defines = { MODE_FIELD: 1 };
    if (fig && fig.pads) mat.defines = Object.assign(mat.defines || {}, { PADS: 1 });
    mat.customProgramCacheKey = () => 'mce-skin-' + mode + '-' + fname + (fig ? '-fig' + (fig.normalMap ? 'n' : '') + (fig.knee != null ? 'k' + fig.knee : '') + (fig.keep != null ? 'p' + fig.keep : '') : '');
    return mat;
  }

  // machine: dark, quiet, cool rim only
  function machineMaterials() {
    const THREE = g.THREE;
    // spec: scales direct + environment specular. Large horizontal plates would otherwise mirror the teal rim light
    // toward the low camera and become the brightest surface in the frame.
    const quiet = (mat, rim, spec = 1, cap = 0) => {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>', `
          // flat up-facing faces (cylinder end caps, bar tops) mirror the bright sky: keep their specular quiet
          float capW = smoothstep(0.82, 0.97, inverseTransformDirection(normalize(normal), viewMatrix).y) * ${cap.toFixed(3)};
          outgoingLight = totalDiffuse * (1.0 - 0.5 * capW) + totalSpecular * ${spec.toFixed(3)} * (1.0 - capW) + totalEmissiveRadiance;
          { vec3 nV = normalize(normal); float fr = pow(1.0 - clamp(dot(nV, normalize(vViewPosition)), 0.0, 1.0), 3.0);
            outgoingLight += vec3(0.16, 0.30, 0.36) * fr * ${rim.toFixed(3)};
            outgoingLight = mix(outgoingLight, vec3(0.012, 0.024, 0.032), 0.25);
            // soft knee: small end faces / edges catching the key light or the sky must stay below the muscle glow
            float mL = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            if (mL > 0.08) outgoingLight *= (0.08 + (mL - 0.08) * 0.15) / mL; }
          #include <output_fragment>`);
      };
      mat.customProgramCacheKey = () => 'mce-q' + rim + '-' + spec + '-' + cap; return mat;
    };
    const M = {
      frame: quiet(new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.5, metalness: 0.55, envMapIntensity: 0.32 }), 0.14, 1, 0.8),
      pad: quiet(new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.14 }), 0.07),
      plate: quiet(new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.8, metalness: 0.1, envMapIntensity: 0.12 }), 0.06, 0.4), // floor/foot plates: the quietest large surface
      accent: quiet(new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.4, metalness: 0.65, envMapIntensity: 0.45 }), 0.12, 1, 0.8),
      cable: new THREE.MeshBasicMaterial({ color: 0x8a949c, transparent: true, opacity: 0.55, depthWrite: false }),
    };
    const fadedCache = {};
    M.faded = (name, alpha) => {
      const key = name + alpha;
      if (!fadedCache[key]) {
        const m = M[name].clone(); m.onBeforeCompile = M[name].onBeforeCompile; m.customProgramCacheKey = M[name].customProgramCacheKey;
        m.transparent = true; m.opacity = alpha; m.depthWrite = false; fadedCache[key] = m;
      }
      return fadedCache[key];
    };
    M.black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    return M;
  }

  MCE.shading = { makeEnvironment, makeLights, skinUniforms, skinMaterial, machineMaterials, NB_MAX, NM_MAX, PAD_MAX, glowColors, FINISHES, setFinish };
})(typeof window !== 'undefined' ? window : globalThis);
