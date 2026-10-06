// Verification probes for headless checks (used by dist/stage.html and tools/verify.mjs). Not needed by the app.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const { clamp } = MCE.util;

  function boxSDF(p, M, hs, rr) { // p world, M world->local
    const THREE = g.THREE, l = p.clone().applyMatrix4(M);
    const q = new THREE.Vector3(Math.abs(l.x) - hs[0] + rr, Math.abs(l.y) - hs[1] + rr, Math.abs(l.z) - hs[2] + rr);
    const o = new THREE.Vector3(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0));
    return o.length() + Math.min(Math.max(q.x, q.y, q.z), 0) - rr;
  }
  function cylSDF(p, M, r, hh) { const l = p.clone().applyMatrix4(M); const dx = Math.hypot(l.x, l.z) - r, dy = Math.abs(l.y) - hh; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)); }

  function Probe(stage) {
    const THREE = g.THREE;
    const inst = () => { if (!stage.cur) throw new Error('nothing loaded'); return stage.cur; };
    const P = {};
    // hand/foot contact error (H), pin residuals, pad contact distances over n phases
    P.contact = (n = 48) => {
      const I = inst(), H = I.H, sk = I.skel, v = new THREE.Vector3(), w = new THREE.Vector3();
      const out = { maxHand: 0, maxFoot: 0, maxPin: 0, effectors: {}, contacts: {} };
      for (let i = 0; i < n; i++) {
        I.solve(i / n);
        for (const e of I.ik) {
          I.machine.socketWorld(e.spec.to, w);
          if (e.kind === 'hand') { const go = sk.grip.offset, sg = e.side === 'l' ? 1 : -1; v.set(go[0] * sg * H, go[1] * H, go[2] * H).applyMatrix4(sk.bones['hand_' + e.side].obj.matrixWorld); }
          else { const c = typeof e.spec.contact === 'string' ? sk.sole[e.spec.contact] : e.spec.contact || [0, 0, 0], sg = e.side === 'l' ? 1 : -1; v.set(c[0] * sg * H, c[1] * H, c[2] * H).applyMatrix4(sk.bones['foot_' + e.side].obj.matrixWorld); }
          const err = v.distanceTo(w) / H;
          out.effectors[e.eff] = Math.max(out.effectors[e.eff] || 0, err);
          if (e.kind === 'hand') out.maxHand = Math.max(out.maxHand, err); else out.maxFoot = Math.max(out.maxFoot, err);
        }
        for (const p of I.pins) { sk.world(p.bone, p.at, v); I.machine.socketWorld(p.to, w); out.maxPin = Math.max(out.maxPin, v.distanceTo(w) / H); }
        for (const c of I.contacts) {
          sk.world(c.bone, c.at, v); const part = I.machine.parts[c.to]; if (!part || !part.mesh) continue;
          part.mesh.updateMatrixWorld(true); const M = part.mesh.matrixWorld.clone().invert(), ud = part.mesh.userData;
          const d = (ud.kind === 'box' ? boxSDF(v, M, ud.hs, ud.rr) : cylSDF(v, M, ud.r, ud.hh)) / H;
          const r = out.contacts[c.name + '->' + c.to] = out.contacts[c.name + '->' + c.to] || { min: 9, max: -9, tol: c.tol };
          r.min = Math.min(r.min, d); r.max = Math.max(r.max, d);
        }
      }
      for (const k of Object.keys(out.effectors)) out.effectors[k] = +out.effectors[k].toFixed(5);
      for (const r of Object.values(out.contacts)) { r.min = +r.min.toFixed(4); r.max = +r.max.toFixed(4); r.ok = r.max <= r.tol && r.min >= -r.tol * 1.5; }
      out.maxHand = +out.maxHand.toFixed(5); out.maxFoot = +out.maxFoot.toFixed(5); out.maxPin = +out.maxPin.toFixed(5);
      out.max = Math.max(out.maxHand, out.maxFoot);
      I.frame(stage.phase);
      return out;
    };
    // Fit suggestions for the static figure: for every pad contact (landmark -> pad part) the signed distance at each of n phases and the
    // shift (H, figure space) that would bring the pad to the landmark at the phase of the smallest gap.. use the mean over the loop
    P.fit = (n = 24) => {
      const I = inst(), H = I.H, sk = I.skel, v = new THREE.Vector3(), out = {};
      for (let i = 0; i < n; i++) {
        I.solve(i / n);
        for (const c of I.contacts) {
          sk.world(c.bone, c.at, v); const part = I.machine.parts[c.to]; if (!part || !part.mesh) continue;
          part.mesh.updateMatrixWorld(true); const M = part.mesh.matrixWorld.clone().invert(), ud = part.mesh.userData;
          const f = (p) => (ud.kind === 'box' ? boxSDF(p, M, ud.hs, ud.rr) : cylSDF(p, M, ud.r, ud.hh)) / H;
          const d = f(v), e = 0.002, gx = f(v.clone().add(new THREE.Vector3(e, 0, 0))) - f(v.clone().add(new THREE.Vector3(-e, 0, 0))), gy = f(v.clone().add(new THREE.Vector3(0, e, 0))) - f(v.clone().add(new THREE.Vector3(0, -e, 0))), gz = f(v.clone().add(new THREE.Vector3(0, 0, e))) - f(v.clone().add(new THREE.Vector3(0, 0, -e)));
          const gl = Math.hypot(gx, gy, gz) || 1, k = c.name + '->' + c.to, r = out[k] = out[k] || { d: [], n: [0, 0, 0], tol: c.tol };
          r.d.push(+d.toFixed(4)); r.n[0] += gx / gl / n; r.n[1] += gy / gl / n; r.n[2] += gz / gl / n;
        }
      }
      for (const r of Object.values(out)) { r.mean = +(r.d.reduce((a, b) => a + b, 0) / r.d.length).toFixed(4); r.min = Math.min(...r.d); r.max = Math.max(...r.d); const l = Math.hypot(...r.n) || 1; r.n = r.n.map((x) => +(x / l).toFixed(3)); r.shift = r.n.map((x) => +(x * r.mean).toFixed(4)); delete r.d; }
      I.frame(stage.phase);
      return out;
    };
    // anatomical angle ranges over the loop, checked against rig.rom
    P.rom = (n = 48) => {
      const I = inst(), lim = I.D.rig.rom, rng = {}, chk = {};
      for (let i = 0; i < n; i++) {
        I.solve(i / n); const a = I.skel.angles();
        for (const [k, v] of Object.entries(a)) {
          if (/^shoulder_plane/.test(k) && a[k.replace('plane', 'elevation')] > 150) continue; // the plane is undefined near overhead
          const r = rng[k] = rng[k] || [1e9, -1e9]; r[0] = Math.min(r[0], v); r[1] = Math.max(r[1], v);
          // the sagittal projection of a near-horizontal humerus is ill-conditioned (a T 10 deg behind the frontal plane
          // reads -78 deg of "extension"): limit extension below 60 deg of elevation, horizontal abduction (plane) above it
          const el = /^shoulder_(flexion|plane)/.test(k) ? a[k.replace(/flexion|plane/, 'elevation')] : null;
          if (el != null && (/^shoulder_flexion/.test(k) ? el > 60 : el < 60)) continue;
          const c = chk[k] = chk[k] || [1e9, -1e9]; c[0] = Math.min(c[0], v); c[1] = Math.max(c[1], v);
        }
      }
      const violations = [];
      for (const [k, r] of Object.entries(chk)) {
        const base = k.replace(/_[lr]$/, ''), L = lim[base]; if (!L) continue;
        if (r[0] < L[0] - 1e-6) violations.push(`${k} ${r[0]} < ${L[0]}`);
        if (r[1] > L[1] + 1e-6) violations.push(`${k} ${r[1]} > ${L[1]}`);
      }
      const at = (ph) => { I.solve(ph); return I.skel.angles(); };
      const start = at(0), peak = at(I.motion.peak);
      I.frame(stage.phase);
      return { ranges: rng, violations, start, peak };
    };
    // NaN / Inf check over the geometry and every bone matrix and uniform through the loop
    P.nan = (n = 24) => {
      const I = inst(), R = I.skin, bad = [];
      const chk = (name, arr) => { for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { bad.push(name + '[' + i + ']'); return; } };
      for (const k of ['pos', 'nor', 'skI', 'skW', 'ao', 'musA', 'hd', 'bm', 'g0', 'g1']) chk(k, R[k]);
      for (let i = 0; i < n; i++) {
        I.frame(i / n);
        for (const b of I.skel.list) chk('bone ' + b.id + ' @' + i, b.obj.matrixWorld.elements);
        for (const v of I.U.uHB.value) chk('uHB @' + i, [v.x, v.y]);
        for (const q of I.U.uQr.value) chk('uQr @' + i, [q.x, q.y, q.z, q.w]);
        for (const q of I.U.uQd.value) chk('uQd @' + i, [q.x, q.y, q.z, q.w]);
      }
      I.frame(stage.phase);
      return { ok: bad.length === 0, bad: bad.slice(0, 20) };
    };
    // figure height on screen as a fraction of the stage height (max over the loop)
    P.fill = (n = 24) => {
      const I = inst(), cam = stage.camera, h = stage.size.h, v = new THREE.Vector3();
      let mx = 0, mn = 9, top = 9, bottom = -9, left = 9, right = -9;
      for (let i = 0; i < n; i++) {
        I.frame(i / n); const pts = I.sampledPoints([]);
        let y0 = 9, y1 = -9;
        for (const p of pts) { v.copy(p).project(cam); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); left = Math.min(left, v.x); right = Math.max(right, v.x); }
        const f = (y1 - y0) / 2; mx = Math.max(mx, f); mn = Math.min(mn, f); top = Math.min(top, (1 - y1) / 2); bottom = Math.max(bottom, (1 - y0) / 2);
      }
      I.frame(stage.phase);
      return { max: +mx.toFixed(3), min: +mn.toFixed(3), topMargin: +top.toFixed(3), bottom: +bottom.toFixed(3), left: +((1 + left) / 2).toFixed(3), right: +((1 + right) / 2).toFixed(3), arc: +(stage.arc.y / h).toFixed(3) };
    };
    // Screen extents (CSS px) of the figure (sampled skin) and of the machine (part bounds) over n loop phases at the
    // current view (the viewer's turn included), with the stage's composition: the player checks in tools/verify.mjs
    // (the figure inside its box and above the text; figure and machine in frame at every yaw of the orbit view).
    P.extent = (n = 24) => {
      const I = inst(), cam = stage.camera, { w, h } = stage.size, v = new THREE.Vector3();
      stage._applyView();
      const box = () => ({ x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }), F = box(), M = box();
      const add = (B, p) => { v.copy(p).project(cam); const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h; if (x < B.x0) B.x0 = x; if (x > B.x1) B.x1 = x; if (y < B.y0) B.y0 = y; if (y > B.y1) B.y1 = y; };
      let fillMax = 0;
      for (let i = 0; i < n; i++) {
        I.frame(i / n);
        let y0 = 1e9, y1 = -1e9;
        for (const p of I.sampledPoints([])) { add(F, p); v.copy(p).project(cam); const y = (1 - v.y) / 2 * h; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        fillMax = Math.max(fillMax, y1 - y0);
        for (const p of I.machine.boundsPoints([])) add(M, p);
      }
      I.frame(stage.phase);
      const r = (B) => ({ x0: +B.x0.toFixed(1), x1: +B.x1.toFixed(1), y0: +B.y0.toFixed(1), y1: +B.y1.toFixed(1) });
      const c = stage.comp, bh = c.box.y1 - c.box.y0, bcx = (c.box.x0 + c.box.x1) / 2;
      return { w, h, fig: r(F), mach: r(M), figHeight: +fillMax.toFixed(1), fill: +(fillMax / bh).toFixed(3), comp: c, arcAtBox: +stage._arcY(bcx).toFixed(1), view: stage.view() };
    };
    // warm-pixel audit: warm pixels in the rendered figure/machine that are NOT inside the working-muscle mask
    P.audit = (phase) => {
      const I = inst(), r = stage.renderer, gl = r.getContext();
      if (phase != null) stage.setPhase(phase);
      const W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
      const read = () => { const a = new Uint8Array(W * Hh * 4); gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      stage._draw(); const col = read();
      // mask pass: skin with the mask shader, machines black
      const maskMat = MCE.shading.skinMaterial(I.U, 'mask');
      const saved = I.skinMesh.material; I.skinMesh.material = maskMat;
      // machines occlude as black; faded (see-through) parts and cables do not occlude
      const mm = [], hid = [];
      I.group.traverse((o) => { if (o.isMesh && o !== I.skinMesh) { if (o.material.transparent) { hid.push([o, o.visible]); o.visible = false; } else { mm.push([o, o.material]); o.material = stage.mats.black; } } });
      const tm = r.toneMapping; r.toneMapping = g.THREE.NoToneMapping;
      r.render(stage.scene, stage.camera); const mask = read();
      // faded (see-through) parts drawn solid white over the mask pass: pixels where a faded part covers working muscle
      let fadeOver = 0;
      if (hid.length) {
        const white = new g.THREE.MeshBasicMaterial({ color: 0xffffff }), fm = [];
        for (const [o] of hid) if (!o.userData.cable) { fm.push([o, o.material]); o.material = white; o.visible = true; }
        r.render(stage.scene, stage.camera); const fcol = read();
        for (let i = 0; i < W * Hh; i++) if ((mask[i * 4] > 127 || mask[i * 4 + 1] > 127) && fcol[i * 4] > 250 && fcol[i * 4 + 1] > 250 && fcol[i * 4 + 2] > 250) fadeOver++;
        for (const [o, m] of fm) { o.material = m; o.visible = false; } white.dispose();
      }
      r.toneMapping = tm; I.skinMesh.material = saved; for (const [o, m] of mm) o.material = m; for (const [o, v] of hid) o.visible = v; maskMat.dispose();
      stage._draw();
      // dilate mask by 2 px
      const M = new Uint8Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) M[i] = (mask[i * 4] > 127 || mask[i * 4 + 1] > 127) ? 1 : 0;
      const D = new Uint8Array(M);
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < Hh) D[Y * W + X] = 1; }
      let fig = 0, warmOut = 0, warmIn = 0, glow = 0;
      const hot = [];
      for (let i = 0; i < W * Hh; i++) {
        const a = col[i * 4 + 3]; if (a < 200) continue; fig++;
        const R = col[i * 4], G = col[i * 4 + 1], B = col[i * 4 + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), S = mx ? (mx - mn) / mx : 0;
        let hue = 0; if (mx !== mn) { if (mx === R) hue = 60 * (((G - B) / (mx - mn)) % 6); else if (mx === G) hue = 60 * ((B - R) / (mx - mn) + 2); else hue = 60 * ((R - G) / (mx - mn) + 4); }
        if (hue < 0) hue += 360;
        const warm = mx >= 56 && S >= 0.32 && (hue <= 52 || hue >= 340);
        if (D[i]) { if (M[i]) glow++; if (warm) warmIn++; }
        else if (warm) { warmOut++; if (hot.length < 12) hot.push([i % W, Hh - 1 - Math.floor(i / W), R, G, B]); }
      }
      return { phase: stage.phase, figurePx: fig, maskPx: glow, warmInside: warmIn, warmOutside: warmOut, warmOutsideFrac: fig ? +(warmOut / fig).toFixed(5) : 0, fadeOverMaskPx: fadeOver, samples: hot };
    };
    // Skin (CPU dual-quaternion skinned, every vertex) against machine parts over n phases:
    //  - penetration of every solid, visible part except handles (accent), cables and bone-attached parts, and of rigid
    //    links (capsules); limit 0.004 H
    //    unless the exercise sets skinTol { part: H }
    //  - exercise skinChecks: [{ part, bones: [...], maxGap (contact kept at every phase) | minGap (clearance), phases }]
    // closed-mesh check on the built skin: every edge must be shared by exactly two triangles (open = on one only, a hole)
    P.edges = () => {
      const R = inst().skin, idx = R.idx, NV = R.NV, H = inst().H, m = new Map();
      for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
        const a = idx[i + k], b = idx[i + (k + 1) % 3], key = a < b ? a * NV + b : b * NV + a; m.set(key, (m.get(key) || 0) + 1);
      }
      let open = 0, nonManifold = 0; const at = [];
      for (const [k, c] of m) {
        if (c === 1) { open++; const a = Math.floor(k / NV); if (at.length < 8) at.push([R.pos[a * 3] / H, R.pos[a * 3 + 1] / H, R.pos[a * 3 + 2] / H].map((v) => +v.toFixed(3))); }
        else if (c > 2) nonManifold++;
      }
      return { open, nonManifold, at };
    };
    P.skin = (n = 24) => {
      const I = inst(), R = I.skin, U = I.U, H = I.H, NV = R.NV, EX = I.ex, M = I.machine;
      const tolOf = (id) => ((EX.skinTol || {})[id] ?? 0.004);
      const parts = Object.values(M.parts).filter((p) => p.mesh && p.mesh.visible && !p.def.fade && p.def.mat !== 'accent' && !p.boneLocal && !(p.def.parent && M.parts[p.def.parent] && M.parts[p.def.parent].boneLocal));
      const own = new Int16Array(NV); for (let v = 0; v < NV; v++) own[v] = R.skI[v * 4];
      const boneIdx = (id) => I.skel.bones[id] ? I.skel.bones[id].idx : -1;
      const checks = (EX.skinChecks || []).map((c) => ({ ...c, bi: new Set((c.bones || []).map(boneIdx)), res: [] }));
      const P = new Float32Array(NV * 3), q = new THREE.Vector3();
      const skinAll = () => {
        for (let id = 0; id < NV; id++) {
          let qr0 = 0, qr1 = 0, qr2 = 0, qr3 = 0, qd0 = 0, qd1 = 0, qd2 = 0, qd3 = 0; const r0 = U.uQr.value[R.skI[id * 4]];
          for (let k = 0; k < 4; k++) {
            const w = R.skW[id * 4 + k]; if (!w) continue; const bi = R.skI[id * 4 + k], rq = U.uQr.value[bi], dq = U.uQd.value[bi];
            const s = (r0.x * rq.x + r0.y * rq.y + r0.z * rq.z + r0.w * rq.w) < 0 ? -w : w;
            qr0 += rq.x * s; qr1 += rq.y * s; qr2 += rq.z * s; qr3 += rq.w * s; qd0 += dq.x * s; qd1 += dq.y * s; qd2 += dq.z * s; qd3 += dq.w * s;
          }
          const l = Math.hypot(qr0, qr1, qr2, qr3) || 1; const x = qr0 / l, y = qr1 / l, z = qr2 / l, w = qr3 / l, dx = qd0 / l, dy = qd1 / l, dz = qd2 / l, dw = qd3 / l;
          const px = R.pos[id * 3], py = R.pos[id * 3 + 1], pz = R.pos[id * 3 + 2];
          const cx = y * pz - z * py + w * px, cy = z * px - x * pz + w * py, cz = x * py - y * px + w * pz;
          P[id * 3] = px + 2 * (y * cz - z * cy) + 2 * (w * dx - dw * x + (y * dz - z * dy));
          P[id * 3 + 1] = py + 2 * (z * cx - x * cz) + 2 * (w * dy - dw * y + (z * dx - x * dz));
          P[id * 3 + 2] = pz + 2 * (x * cy - y * cx) + 2 * (w * dz - dw * z + (x * dy - y * dx));
        }
        if (I.figure && U.uPadN.value) for (let id = 0; id < NV; id++) { const q2 = I._padPress(P[id * 3], P[id * 3 + 1], P[id * 3 + 2], U.uPadN.value); P[id * 3] = q2[0]; P[id * 3 + 1] = q2[1]; P[id * 3 + 2] = q2[2]; }
      };
      const sdfOf = (p) => { p.mesh.updateMatrixWorld(true); const Mi = p.mesh.matrixWorld.clone().invert(), ud = p.mesh.userData; return (x, y, z) => { q.set(x, y, z).applyMatrix4(Mi); return (ud.kind === 'box' ? boxSDF(q, new THREE.Matrix4(), ud.hs, ud.rr) : cylSDF(q, new THREE.Matrix4(), ud.r, ud.hh)) / H; }; };
      const pen = {};
      for (let i = 0; i < n; i++) {
        const t = i / n; I.frame(t); I.group.rotation.y = 0; I.group.position.set(0, 0, 0); I.group.updateMatrixWorld(true); skinAll();
        for (const p of parts) {
          const f = sdfOf(p), r = pen[p.def.id] = pen[p.def.id] || { maxPen: 0, verts: 0, at: 0, tol: tolOf(p.def.id) };
          const bb = new THREE.Box3().setFromObject(p.mesh).expandByScalar(0.002 * H);
          let cnt = 0;
          for (let v = 0; v < NV; v++) {
            const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
            if (x < bb.min.x || y < bb.min.y || z < bb.min.z || x > bb.max.x || y > bb.max.y || z > bb.max.z) continue;
            const d = f(x, y, z); if (d < 0) { cnt++; if (-d > r.maxPen) { r.maxPen = -d; r.at = t; r.bone = I.skel.list[own[v]].id; r.p = [x / H, y / H, z / H].map((a) => +a.toFixed(3)); } }
          }
          r.verts = Math.max(r.verts, cnt);
        }
        // rigid links (lever linkages, machine.js keeps them in cables): capsules of radius r between their sockets;
        // like handle parts, links in the handle material (a rope held in the fists) are gripped and not checked
        for (const c of M.cables) {
          if (c.mesh.userData.cable || !c.mesh.visible) continue;
          if (M.defs.some((d) => d.link && d.link[0] === c.a && d.link[1] === c.b && d.mat === 'accent')) continue;
          c.mesh.updateMatrixWorld(true); const e = c.mesh.matrixWorld.elements;
          const ax = new THREE.Vector3(e[4], e[5], e[6]), L = ax.length(); ax.normalize();
          const A = new THREE.Vector3(e[12], e[13], e[14]).addScaledVector(ax, -L / 2);
          const id = 'link:' + c.a + '-' + c.b, r = pen[id] = pen[id] || { maxPen: 0, verts: 0, at: 0, tol: tolOf(id) };
          let cnt = 0;
          for (let v = 0; v < NV; v++) {
            const px = P[v * 3] - A.x, py = P[v * 3 + 1] - A.y, pz = P[v * 3 + 2] - A.z;
            const s = Math.max(0, Math.min(L, px * ax.x + py * ax.y + pz * ax.z));
            const d = (Math.hypot(px - ax.x * s, py - ax.y * s, pz - ax.z * s) - c.r) / H;
            if (d < 0) { cnt++; if (-d > r.maxPen) { r.maxPen = -d; r.at = t; r.bone = I.skel.list[own[v]].id; r.p = [P[v * 3] / H, P[v * 3 + 1] / H, P[v * 3 + 2] / H].map((a) => +a.toFixed(3)); } }
          }
          r.verts = Math.max(r.verts, cnt);
        }
        for (const c of checks) {
          if (Array.isArray(c.phases) && !c.phases.some((ph) => Math.abs((ph === 'peak' ? I.motion.peak : ph) - t) < 0.5 / n)) continue;
          const part = M.parts[c.part]; if (!part || !part.mesh) continue;
          const f = sdfOf(part); let dmin = 9, vm = -1;
          for (let v = 0; v < NV; v++) if (c.bi.has(own[v])) { const d0 = f(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (d0 < dmin) { dmin = d0; vm = v; } }
          let nn = null; if (vm >= 0) { const e = 0.002 * H, X = P[vm * 3], Y = P[vm * 3 + 1], Z = P[vm * 3 + 2], gx = f(X + e, Y, Z) - f(X - e, Y, Z), gy = f(X, Y + e, Z) - f(X, Y - e, Z), gz = f(X, Y, Z + e) - f(X, Y, Z - e), gl = Math.hypot(gx, gy, gz) || 1; nn = [+(gx / gl).toFixed(3), +(gy / gl).toFixed(3), +(gz / gl).toFixed(3)]; }
          c.res.push([+t.toFixed(3), +dmin.toFixed(4), nn]);
        }
      }
      I.frame(stage.phase);
      const parts_ = {}; let ok = true;
      for (const [id, r] of Object.entries(pen)) { r.maxPen = +r.maxPen.toFixed(4); r.ok = r.maxPen <= r.tol; if (!r.ok) ok = false; if (r.verts) parts_[id] = r; }
      const cks = checks.map((c) => {
        const ds = c.res.map((x) => x[1]), mx = Math.max(...ds), mn = Math.min(...ds);
        const okc = (c.maxGap == null || mx <= c.maxGap) && (c.minGap == null || mn >= c.minGap) && (c.maxPen == null || mn >= -c.maxPen);
        if (!okc) ok = false;
        const wr = c.res.slice().sort((a, b) => (c.minGap != null ? a[1] - b[1] : b[1] - a[1]))[0];
        return { part: c.part, bones: c.bones, maxGap: c.maxGap, minGap: c.minGap, maxPen: c.maxPen, min: +mn.toFixed(4), max: +mx.toFixed(4), ok: okc, worst: wr, n: wr && wr[2] };
      });
      return { ok, penetration: parts_, checks: cks };
    };
    // Luminance of the brightest bare skin (not glowing muscle, not machine) against the primary glow, at a phase:
    // the glow must stay the brightest thing on the figure. Linear luminance, 99.5th percentile (single-pixel sparkle ignored).
    P.luma = (phase) => {
      const I = inst(), r = stage.renderer, gl = r.getContext(), THREE = g.THREE;
      if (phase != null) stage.setPhase(phase);
      const W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
      const read = () => { const a = new Uint8Array(W * Hh * 4); gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      stage._draw(); const col = read();
      const saved = I.skinMesh.material, maskMat = MCE.shading.skinMaterial(I.U, 'mask'), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mm = []; I.group.traverse((o) => { if (o.isMesh && o !== I.skinMesh) { mm.push([o, o.material, o.visible]); if (o.material.transparent) o.visible = false; else o.material = stage.mats.black; } });
      const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
      I.skinMesh.material = maskMat; r.render(stage.scene, stage.camera); const mask = read();
      I.skinMesh.material = white; r.render(stage.scene, stage.camera); const skin = read();
      r.toneMapping = tm; I.skinMesh.material = saved; for (const [o, m, v] of mm) { o.material = m; o.visible = v; } maskMat.dispose(); white.dispose();
      stage._draw();
      const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const Lk = (i) => 0.2126 * lin(col[i]) + 0.7152 * lin(col[i + 1]) + 0.0722 * lin(col[i + 2]);
      const sk = [], gp = [];
      for (let i = 0; i < W * Hh; i++) {
        if (col[i * 4 + 3] < 250) continue;
        const inMask = mask[i * 4] > 127 || mask[i * 4 + 1] > 127, isSkin = skin[i * 4] > 250 && skin[i * 4 + 1] > 250;
        if (mask[i * 4] > 127) gp.push(Lk(i * 4)); else if (isSkin && !inMask) sk.push(Lk(i * 4));
      }
      const pct = (a, p) => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
      const skin995 = pct(sk, 0.995), glow90 = pct(gp, 0.9);
      const over = sk.filter((x) => x > 0.6 * glow90).length;
      return { skinP995: +skin995.toFixed(4), skinP95: +pct(sk, 0.95).toFixed(4), glowP90: +glow90.toFixed(4), ratio: glow90 ? +(skin995 / glow90).toFixed(3) : null, overFrac: +(over / Math.max(1, sk.length)).toFixed(4), skinPx: sk.length, glowPx: gp.length };
    };
    P.bench = (n = 240) => {
      const I = inst(), gl = stage.renderer.getContext(), px = new Uint8Array(4);
      const t0 = MCE.now(); for (let i = 0; i < n; i++) I.frame(i / n); const t1 = MCE.now();
      for (let i = 0; i < 20; i++) { stage.setPhase(i / 20); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } const t2 = MCE.now();
      const info = stage.renderer.info.render;
      return { cpuFrameMs: +((t1 - t0) / n).toFixed(3), syncedFrameMs_swiftshader: +((t2 - t1) / 20).toFixed(1), tris: info.triangles, calls: info.calls, skin: I.buildStats };
    };
    P.state = () => { const I = stage.cur; return I ? { id: I.id, name: I.ex.name, heads: I.heads.map((h) => h.id + (h.side > 0 ? '_l' : '_r') + ':' + h.tier), labels: I.labels, build: I.buildStats, clearance: I.clearance, three: g.THREE.REVISION, webgl2: stage.renderer.capabilities.isWebGL2, worker: !stage.workers.fallback, camera: { az: I.cam.az + (I.cam.dAz || 0), el: I.cam.el + (I.cam.dEl || 0) }, phases: I.motion.namedPhases(), duration: I.motion.duration, peak: I.motion.peak, still: I.motion.still } : null; };
    return P;
  }
  MCE.Probe = Probe;
})(typeof window !== 'undefined' ? window : globalThis);
