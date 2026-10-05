// One exercise, ready to render: skeleton + machine + motion + skinned figure. The frame is a pure function of the
// loop phase. Solve order per frame: FK pose -> machine dofs -> pins (root translation) -> limb IK (feet, then hands,
// with fist/sole alignment) -> scapulohumeral rhythm (+ hand IK re-solve) -> cables -> dual-quaternion skin uniforms.
// Everything is solved in FIGURE space (the figure group un-yawed); the group is yawed only for rendering, so the
// camera and light rig never move between exercises.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const { D2R, clamp, sideOf, mirId, mirV } = MCE.util;
  const BIG = 1e9;

  // ---------------------------------------------------------------- static data prep (once per data set)
  function prepBody(BODY) {
    const prims = [];
    const onSide = (b) => sideOf(b);
    const endBone = (e, owner) => (Array.isArray(e) && typeof e[0] === 'string' ? e[0] : owner);
    const endPt = (e) => (Array.isArray(e) && typeof e[0] === 'string' ? e[1] : e);
    const mirEnd = (e) => (Array.isArray(e) && typeof e[0] === 'string' ? [mirId(e[0]), mirV(e[1])] : mirV(e));
    for (const p of BODY.prims) {
      prims.push(p);
      let mir = onSide(p.bone) === 1;
      if (!mir && onSide(p.bone) === 0) {
        if (p.t === 'ell' || p.t === 'box') mir = Math.abs(p.c[0]) > 1e-4;
        else mir = Math.abs(endPt(p.a)[0]) > 1e-4 || Math.abs(endPt(p.b)[0]) > 1e-4 || onSide(endBone(p.a, p.bone)) === 1 || onSide(endBone(p.b, p.bone)) === 1;
      }
      if (!mir) continue;
      const m = { ...p, bone: mirId(p.bone), n: p.n + '_r' };
      if (p.c) m.c = mirV(p.c);
      if (p.a) m.a = mirEnd(p.a);
      if (p.b) m.b = mirEnd(p.b);
      if (p.rot) m.rot = [p.rot[0], -p.rot[1], -p.rot[2]];
      if (p.raise) m.raise = { ...p.raise, arm: mirId(p.raise.arm), ...(p.raise.c ? { c: mirV(p.raise.c) } : {}), ...(p.raise.rot ? { rot: [p.raise.rot[0], -p.raise.rot[1], -p.raise.rot[2]] } : {}) };
      prims.push(m);
    }
    const pairs = [];
    for (const p of BODY.pairs) {
      pairs.push(p);
      if (sideOf(p.a) === 1 || sideOf(p.b) === 1) pairs.push({ ...p, a: mirId(p.a), b: mirId(p.b), at: p.at && [mirId(p.at[0]), mirV(p.at[1])] });
    }
    const steps = [];
    for (const s of BODY.union.steps) {
      steps.push(s);
      if (s.some((x) => sideOf(x) === 1)) steps.push(s.map(mirId));
    }
    return { prims, pairs, steps, root: BODY.union.root, k: BODY.k, cell: BODY.cell, ao: BODY.ao, kc: BODY.kc ?? 0.004 };
  }

  function prepMuscles(MUS) {
    const heads = {}, groups = {};
    for (const gr of MUS.groups) {
      groups[gr.id] = gr;
      for (const h of gr.heads) heads[h.id] = { group: gr, def: h };
    }
    return { heads, groups, aliases: MUS.aliases || {}, labels: MUS.labels || {}, labelOrder: MUS.labelOrder || [], stripe: MUS.stripe || 0.0062 };
  }

  // ---------------------------------------------------------------- instance
  class Instance {
    constructor(stage, id, EX, D) {
      const THREE = g.THREE;
      const so = stage.opts || {};
      if (so.muscleOverride) EX = { ...EX, muscles: { ...(EX.muscles || {}), ...so.muscleOverride } };
      this.stage = stage; this.id = id; this.ex = EX; this.D = D;
      this.skel = new MCE.Skeleton(D.rig);
      this.H = this.skel.H;
      this.group = new THREE.Group(); this.group.name = 'figure:' + id;
      this.group.add(this.skel.root);
      this.machine = new MCE.Machine((EX.machine && EX.machine.parts) || [], this.skel, stage.mats, EX.machine && EX.machine.fade);
      this.group.add(this.machine.root);
      this.motion = new MCE.Motion(EX);
      // the static figure (Stage option body: 'mpfb', engine/figure.js): its bone indices for this skeleton, and the pads
      // that press into it (a vertex-shader push, engine/shading.js; the meshed body carves them instead)
      this.figure = D.figure || null;
      if (this.figure) {
        this.figIdx = MCE.Figure.bindToSkeleton(this.figure, this.skel);
        this.pads = Object.values(this.machine.parts).filter((r) => r.mesh && (r.def.carve ?? (r.def.mat === 'pad' || r.def.mat === 'plate'))).slice(0, MCE.shading.PAD_MAX);
      }
      this.cam = Object.assign({ az: 90, el: 6, dAz: 0, dEl: 0, fill: 0.58 }, EX.camera || {}, so.cameraOverride || {});
      this.yaw = (this.cam.az + (this.cam.dAz || 0)) * D2R;
      this.el = (this.cam.el + (this.cam.dEl || 0)) * D2R;
      this._initIK(EX);
      this._initPins(EX);
      this._initHeads(EX);
      this.U = MCE.shading.skinUniforms();
      this.skin = null; this.skinMesh = null; this.ready = false;
      this.bindQ = []; this.bindP = [];
    }
    // ---------------- IK / pins / contacts specs (with _l -> _r mirroring)
    _initIK(EX) {
      const THREE = g.THREE, list = [];
      const add = (eff, spec) => {
        const side = eff.endsWith('_l') ? 'l' : 'r', kind = eff.startsWith('hand') ? 'hand' : 'foot';
        list.push({ eff, side, kind, spec });
      };
      const ik = EX.ik || {};
      for (const [eff, spec] of Object.entries(ik)) {
        add(eff, spec);
        if (sideOf(eff) === 1 && !ik[mirId(eff)] && spec.mirror !== false) {
          const m = { ...spec, to: mirId(spec.to) };
          if (Array.isArray(spec.pole)) m.pole = mirV(spec.pole);
          if (spec.align) m.align = mirId(spec.align);
          if (spec.plate) m.plate = mirId(spec.plate);
          if (spec.fwd) m.fwd = mirV(spec.fwd);
          add(mirId(eff), m);
        }
      }
      // feet first (they can move the pelvis-free chain), then hands
      this.ik = list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'foot' ? -1 : 1));
      this.hasArmIK = this.ik.some((e) => e.kind === 'hand');
      const rh = EX.rhythm;
      this.rhythm = rh === false ? null : { gain: (rh && rh.gain) ?? 0.2, cap: (rh && rh.cap) ?? 28 };
      this._tmp = { v: new THREE.Vector3(), w: new THREE.Vector3(), a: new THREE.Vector3(), n: new THREE.Vector3(), f: new THREE.Vector3() };
    }
    _landmark(spec) {
      // spec: "name" (rig.landmarks) or {bone, at}
      if (typeof spec === 'string') { const L = this.D.rig.landmarks[spec]; if (!L) throw new Error('unknown landmark ' + spec); return { bone: L[0], at: L[1] }; }
      return spec;
    }
    _initPins(EX) {
      this.pins = [];
      for (const p of EX.pins || []) {
        const jointAt = (id) => { const b = this.D.rig.bones.find((x) => x.id === id || mirId(x.id) === id); return b && (b.id === id ? b.at : mirV(b.at)); };
        const lm = p.landmark ? this._landmark(p.landmark) : { bone: p.bone, at: p.at || jointAt(p.bone) };
        const at = lm.at;
        this.pins.push({ bone: lm.bone, at, to: p.to, w: p.w ?? 1 });
        if (p.mirror !== false && sideOf(lm.bone) === 1 && sideOf(p.to) === 1) this.pins.push({ bone: mirId(lm.bone), at: mirV(at), to: mirId(p.to), w: p.w ?? 1 });
      }
      this.contacts = [];
      for (const c of EX.contacts || []) {
        const lm = this._landmark(c.landmark || { bone: c.bone, at: c.at });
        this.contacts.push({ name: c.landmark || c.bone, bone: lm.bone, at: lm.at, to: c.to, tol: c.tol ?? 0.012 });
        if (c.mirror !== false && sideOf(lm.bone) === 1) this.contacts.push({ name: mirId(c.landmark || c.bone), bone: mirId(lm.bone), at: mirV(lm.at), to: sideOf(c.to) === 1 ? mirId(c.to) : c.to, tol: c.tol ?? 0.012 });
      }
    }
    // ---------------- working muscles
    _initHeads(EX) {
      const M = this.D.muscles, mus = EX.muscles || {};
      const expand = (ids) => [...new Set((ids || []).flatMap((id) => M.aliases[id] || [id]))];
      const prim = expand(mus.primary), sec = expand(mus.secondary).filter((x) => !prim.includes(x));
      const sides = mus.side === 'l' ? [1] : mus.side === 'r' ? [-1] : [1, -1];
      this.heads = [];
      this.labels = { primary: [], secondary: [] };
      const addLabel = (tier, id) => { const L = (mus.labels && mus.labels[id]) || M.labels[id]; const arr = this.labels[tier]; if (L && !arr.includes(L) && !(tier === 'secondary' && this.labels.primary.includes(L))) arr.push(L); };
      for (const [ids, tier] of [[prim, 1], [sec, 2]]) for (const id of ids) {
        const h = M.heads[id]; if (!h) { console.warn('MCE: unknown muscle', id); continue; }
        addLabel(tier === 1 ? 'primary' : 'secondary', id);
        for (const side of sides) this.heads.push({ hi: this.heads.length, id, side, tier, group: h.group, def: h.def });
      }
      if (this.heads.length > MCE.shading.NM_MAX) throw new Error('too many active muscle heads: ' + this.heads.length);
      const ord = M.labelOrder; for (const t of ['primary', 'secondary']) this.labels[t].sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
      this.cycleAct = (EX.motion && EX.motion.activation) || {};
    }
    // guide curves of a group for one side, as [bone, restPoint] lists
    _groupGuides(gr, side) {
      let guides;
      if (gr.path) { // fusiform muscle given as a centre path + width: three offset guides across it
        const THREE = g.THREE, pts = gr.path.pts, n = new THREE.Vector3(...gr.path.n).normalize(), w = gr.path.w;
        const P = pts.map(([, p]) => new THREE.Vector3(...p));
        guides = [-1, 0, 1].map((k) => pts.map(([bone, p], i) => {
          const t = P[Math.min(P.length - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize();
          const b = new THREE.Vector3().crossVectors(t, n).normalize().multiplyScalar(k * w);
          return [bone, [p[0] + b.x, p[1] + b.y, p[2] + b.z]];
        }));
      } else guides = gr.guides;
      if (side > 0) return guides;
      return guides.map((gd) => gd.map(([bone, p]) => [mirId(bone), mirV(p)]));
    }
    // ---------------- per-frame solve (figure space)
    solve(phase) {
      const THREE = g.THREE, sk = this.skel, st = this.motion.sample(phase), pose = st.pose;
      const r = pose.root || this.motion.root;
      this.group.rotation.y = 0; this.group.position.set(0, 0, 0); this.group.updateMatrixWorld(true);
      sk.setPose(pose, sk.V(r));
      this.machine.setDofs(pose.m || {});
      this.group.updateMatrixWorld(true);
      const { v, w } = this._tmp;
      if (this.pins.length) {
        const d = new THREE.Vector3(); let ws = 0;
        for (const p of this.pins) { sk.world(p.bone, p.at, v); this.machine.socketWorld(p.to, w); d.addScaledVector(w.sub(v), p.w); ws += p.w; }
        sk.root.position.addScaledVector(d, 1 / ws); this.group.updateMatrixWorld(true);
      }
      this._runIK('foot'); this._runIK('hand');
      if (this.rhythm && this.hasArmIK) {
        const sides = [...new Set(this.ik.filter((e) => e.kind === 'hand').map((e) => e.side))];
        if (sk.rhythm(this.rhythm.gain, this.rhythm.cap, sides)) { this.group.updateMatrixWorld(true); this._runIK('hand'); }
      }
      this.machine.applyFollow();
      this.group.updateMatrixWorld(true);
      this.machine.updateCables();
      return st;
    }
    _runIK(kind) {
      const THREE = g.THREE, sk = this.skel, { v, a, n, f } = this._tmp;
      this.ikErr = this.ikErr || {};
      for (const e of this.ik) {
        if (e.kind !== kind) continue;
        const s = e.spec;
        this.machine.socketWorld(s.to, v);
        let pole;
        if (s.pole === 'fk') {
          // keep the authored (FK) bend plane: the pole is the FK elbow/knee offset from the shoulder/hip -> target line,
          // so the IK only corrects the reach and can never swing the elbow out (flare) or the knee in
          const up = sk.bones[(kind === 'hand' ? 'arm_' : 'thigh_') + e.side], mid = sk.bones[(kind === 'hand' ? 'fore_' : 'shank_') + e.side];
          const S = up.obj.getWorldPosition(new THREE.Vector3()), E = mid.obj.getWorldPosition(new THREE.Vector3()).sub(S), d = v.clone().sub(S).normalize();
          pole = E.addScaledVector(d, -E.dot(d));
          if (pole.lengthSq() < 1e-10) pole.set(e.side === 'l' ? 1 : -1, -0.5, -0.5);
          pole.normalize();
        } else pole = new THREE.Vector3(...(s.pole || (kind === 'hand' ? [e.side === 'l' ? 1 : -1, -0.5, -0.5] : [0, 0, 1]))).normalize();
        if (kind === 'hand') {
          let axis = null;
          if (s.align) axis = this.machine.axisWorld(s.align, s.alignAxis, a).clone();
          this.ikErr[e.eff] = sk.reachHand(e.side, v.clone(), { pole, axis });
        } else {
          const c = typeof s.contact === 'string' ? sk.sole[s.contact] : s.contact || null;
          let normal = null, fwd = null;
          if (s.plate) { normal = this.machine.axisWorld(s.plate, s.normal || [0, 1, 0], n).clone(); fwd = this.machine.axisWorld(s.plate, s.fwd || [0, 0, 1], f).clone(); }
          this.ikErr[e.eff] = sk.reachFoot(e.side, v.clone(), { pole, contact: c, normal, fwd });
        }
      }
      this.group.updateMatrixWorld(true);
    }
    // ---------------- bind pose + skin job
    // the skin is sculpted and bound at this loop phase: motion.bind (a loop phase, or { phase, at } like motion.still,
    // which keeps the same pose when the tempo changes), else the middle of the concentric
    bindPhase() {
      const b = this.ex.motion && this.ex.motion.bind;
      if (b != null) return typeof b === 'number' ? b : this.motion.phaseOf(b);
      if (this.motion.mode === 'cycle') return 0.125 / (this.motion.revs || 1);
      const con = this.motion.segs.filter((s) => s.phase === 'con');
      if (!con.length) return 0;
      return ((con[0].t0 + con[con.length - 1].t1) / 2) / this.motion.duration;
    }
    compileJob() {
      if (this.figure) return this._figureJob();
      const THREE = g.THREE, sk = this.skel, H = this.H, B = this.D.body;
      this.solve(this.bindPhase());
      for (const h of this.heads) { h.path = this._headPath(h); h.Lb = this._pathLen(h.path); }
      this.clearance = this._armClearance();
      this.group.updateMatrixWorld(true);
      const NB = sk.list.length;
      for (const b of sk.list) { this.bindQ[b.idx] = b.obj.getWorldQuaternion(new THREE.Quaternion()); this.bindP[b.idx] = b.obj.getWorldPosition(new THREE.Vector3()); }
      const bi = (id) => { const b = sk.bones[id]; if (!b) throw new Error('body: no bone ' + id); return b.idx; };
      const restToWorld = (boneId) => { const b = sk.bones[boneId]; return b.obj.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(-b.at.x, -b.at.y, -b.at.z)); };
      const worldOf = (boneId, p) => sk.V(p).applyMatrix4(restToWorld(boneId));
      const kOf = (bone) => (B.k[bone] ?? B.k[bone.replace(/_r(?=_|$)/, '_l')] ?? 0.02) * H;
      // Raised-arm shapes: an ellipsoid with `raise` { arm, from, to, c?, r?, rot?, k? } takes those values in proportion
      // to smoothstep(from, to, that arm's elevation at the bind pose, degrees in the thorax frame). The pecs use it: with
      // the arms overhead (shoulder press) the pectoralis is stretched flat and its lower border rises to the armpit,
      // where the resting mound read as a bust. Binds below `from` (every chest exercise) keep the base shape exactly.
      const ang = B.prims.some((d) => d.raise) ? sk.angles() : null;
      const raised = (d) => {
        const R = d.raise, s = MCE.util.sstep(R.from, R.to, ang['shoulder_elevation_' + R.arm.slice(-1)] || 0);
        if (s <= 0) return d;
        const mix = (a, b) => (b == null ? a : Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * s) : a + (b - a) * s);
        return { ...d, c: mix(d.c, R.c), r: mix(d.r, R.r), rot: mix(d.rot || [0, 0, 0], R.rot), k: R.k == null ? d.k : mix(d.k ?? (B.k[d.bone] ?? 0.02), R.k) };
      };
      const list = [];
      for (let d of B.prims) {
        if (d.raise && d.t === 'ell') d = raised(d);
        let mP, sc, sr, T, P;
        if (d.t === 'box') { // rounded box (fist block)
          const c = worldOf(d.bone, d.c);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(d.rot || [0, 0, 0]).map((x) => x * D2R)));
          const bq = sk.bones[d.bone].obj.getWorldQuaternion(new THREE.Quaternion());
          mP = new THREE.Matrix4().compose(c, bq.multiply(q), new THREE.Vector3(1, 1, 1));
          T = 2; P = [d.h[0] * H, d.h[1] * H, d.h[2] * H, (d.rr || 0.005) * H]; sr = Math.hypot(...P.slice(0, 3)); sc = c;
        } else if (d.t === 'ell') {
          const c = worldOf(d.bone, d.c);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(d.rot || [0, 0, 0]).map((x) => x * D2R)));
          const bq = sk.bones[d.bone].obj.getWorldQuaternion(new THREE.Quaternion());
          mP = new THREE.Matrix4().compose(c, bq.multiply(q), new THREE.Vector3(1, 1, 1));
          T = 0; P = [d.r[0] * H, d.r[1] * H, d.r[2] * H]; sr = Math.max(...P); sc = c;
        } else {
          const ea = Array.isArray(d.a) && typeof d.a[0] === 'string' ? worldOf(d.a[0], d.a[1]) : worldOf(d.bone, d.a);
          const eb = Array.isArray(d.b) && typeof d.b[0] === 'string' ? worldOf(d.b[0], d.b[1]) : worldOf(d.bone, d.b);
          const ax = eb.clone().sub(ea), h = ax.length(); ax.normalize();
          // section axes follow the owner bone's frame so sx/sz stay anatomical
          const bq = sk.bones[d.bone].obj.getWorldQuaternion(new THREE.Quaternion());
          let ex = new THREE.Vector3(1, 0, 0).applyQuaternion(bq); ex.addScaledVector(ax, -ex.dot(ax)); if (ex.lengthSq() < 1e-6) { ex = new THREE.Vector3(0, 0, 1).applyQuaternion(bq); ex.addScaledVector(ax, -ex.dot(ax)); } ex.normalize();
          const ez = new THREE.Vector3().crossVectors(ex, ax);
          mP = new THREE.Matrix4().makeBasis(ex, ax, ez).setPosition(ea);
          const ra = d.ra * H, rb = d.rb * H, cb = (ra - rb) / h, ca = Math.sqrt(Math.max(0, 1 - cb * cb));
          T = 1; P = [ra, rb, h, d.sx || 1, d.sz || 1, cb, ca]; sr = h / 2 + Math.max(ra, rb) * Math.max(d.sx || 1, d.sz || 1);
          sc = ea.clone().add(eb).multiplyScalar(0.5);
        }
        list.push({ T, B: bi(d.bone), M: mP.clone().invert(), P, S: [sc.x, sc.y, sc.z, sr], K: d.k !== undefined ? d.k * H : kOf(d.bone) });
      }
      const nBody = list.length;
      for (const c of this.machine.carveList()) {
        const wc = new THREE.Vector3().setFromMatrixPosition(c.M), M = c.M.clone().invert();
        if (c.kind === 'box') list.push({ T: 2, B: -1, M, P: [c.ud.hs[0], c.ud.hs[1], c.ud.hs[2], c.ud.rr], S: [wc.x, wc.y, wc.z, Math.hypot(...c.ud.hs)], K: 0 });
        else list.push({ T: 3, B: -1, M, P: [c.ud.r, c.ud.hh], S: [wc.x, wc.y, wc.z, Math.hypot(c.ud.r, c.ud.hh)], K: 0 });
      }
      const NP = list.length;
      const J = { H, nb: NB, cell: B.cell * H, kc: B.kc, ao: B.ao, nBody, stripe: this.D.muscles.stripe };
      J.PT = new Int8Array(NP); J.PB = new Int16Array(NP); J.PM = new Float64Array(NP * 12); J.PP = new Float64Array(NP * 8); J.PS = new Float64Array(NP * 4); J.PKS = new Float64Array(NP);
      list.forEach((p, i) => {
        J.PT[i] = p.T; J.PB[i] = p.B; J.PKS[i] = p.K; const e = p.M.elements;
        J.PM.set([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]], i * 12);
        J.PP.set(p.P, i * 8); J.PS.set(p.S, i * 4);
      });
      const pairs = B.pairs, NPR = pairs.length;
      J.PA = new Int16Array(NPR); J.PC = new Int16Array(NPR); J.PRK = new Float64Array(NPR); J.PRR = new Float64Array(NPR); J.PTAU = new Float64Array(NPR); J.PX = new Float64Array(NPR * 3);
      pairs.forEach((p, i) => {
        J.PA[i] = bi(p.a); J.PC[i] = bi(p.b); J.PRK[i] = (p.k || 0) * H; J.PRR[i] = p.R * H; J.PTAU[i] = (p.tau || 0) * H;
        const c = p.at ? worldOf(p.at[0], p.at[1]) : sk.bones[p.b].obj.getWorldPosition(new THREE.Vector3());
        J.PX[i * 3] = c.x; J.PX[i * 3 + 1] = c.y; J.PX[i * 3 + 2] = c.z;
      });
      const pairIdx = (a, b) => { const q = pairs.findIndex((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)); if (q < 0) throw new Error('body: no pair ' + a + '-' + b); return q; };
      J.steps = new Int16Array(B.steps.length * 3);
      B.steps.forEach((s, i) => { J.steps[i * 3] = bi(s[0]); J.steps[i * 3 + 1] = bi(s[1]); J.steps[i * 3 + 2] = pairIdx(s[2] || s[0], s[1]); });
      J.rootSlot = bi(B.root);
      J.groups = this._jobGroups(bi, worldOf);
      // restore the frame pose (clearance changed the arms)
      return J;
    }
    // muscle groups: guide points in bind (figure) space, per side
    _jobGroups(bi, worldOf) {
      const groups = new Map();
      for (const h of this.heads) {
        const key = h.group.id + '|' + h.side;
        if (!groups.has(key)) groups.set(key, { gr: h.group, side: h.side, heads: [] });
        groups.get(key).heads.push(h);
      }
      const out = [];
      for (const { gr, side, heads } of groups.values()) {
        const guides = this._groupGuides(gr, side);
        const M = guides.map((gd) => gd.length), off = []; let n = 0; for (const m of M) { off.push(n); n += m; }
        const pts = new Float64Array(n * 3); let o = 0;
        for (const gd of guides) for (const [bone, p] of gd) { const w = worldOf(bone, p); pts[o++] = w.x; pts[o++] = w.y; pts[o++] = w.z; }
        const gb = [...new Set(guides.flat().map(([bone]) => bi(bone)).concat((gr.bones || []).map((b) => bi(side > 0 ? b : mirId(b)))))];
        out.push({ id: gr.id + (side > 0 ? '_l' : '_r'), K: guides.length, M, off, pts, tol: gr.tol || 0.009, sub: gr.sub || 3, merge: gr.merge || 'smooth', bones: gb,
          heads: heads.map((h) => { const d = h.def; return { hi: h.hi, tier: h.tier, vc: d.v[0], hw: d.v[1], u0: d.u[0], u1: d.u[1], pk: d.peak ?? 0.5, t0: d.taper[0], t1: d.taper[1], r0: d.round[0], r1: d.round[1], sp: d.spindle ?? 0.7, sheet: d.profile === 'sheet', fade: d.fade ?? 0.62, sk: d.skew ?? 0 }; }) });
      }
      return out;
    }
    // The static figure's job: the skeleton in the figure's bind pose (its world rotations and the root position from the
    // file; FK with the rig's own segments puts every joint where the figure was built), then only the muscle paint.
    _figureJob() {
      const THREE = g.THREE, sk = this.skel, F = this.figure, H = this.H;
      this.group.rotation.y = 0; this.group.position.set(0, 0, 0);
      const wq = {};
      for (const b of sk.list) wq[b.id] = new THREE.Quaternion(...F.bind[b.id].q);
      for (const b of sk.list) b.obj.quaternion.copy(b.parent ? wq[b.parent].clone().invert().multiply(wq[b.id]) : wq[b.id]);
      sk.root.position.set(...F.bind.pelvis.p);
      this.group.updateMatrixWorld(true);
      for (const h of this.heads) { h.path = this._headPath(h); h.Lb = this._pathLen(h.path); }
      for (const b of sk.list) { this.bindQ[b.idx] = b.obj.getWorldQuaternion(new THREE.Quaternion()); this.bindP[b.idx] = b.obj.getWorldPosition(new THREE.Vector3()); }
      const n = sk.list.length; // forearm twist helpers: bound with their forearm
      for (const [k, s] of [[n, 'l'], [n + 1, 'r']]) { this.bindQ[k] = this.bindQ[sk.bones['fore_' + s].idx].clone(); this.bindP[k] = this.bindP[sk.bones['fore_' + s].idx].clone(); }
      const bi = (id) => { const b = sk.bones[id]; if (!b) throw new Error('figure: no bone ' + id); return b.idx; };
      const worldOf = (boneId, p) => { const b = sk.bones[boneId]; return sk.V(p).sub(b.at).applyMatrix4(b.obj.matrixWorld); };
      const W = F.welded;
      return { H, nb: this.figIdx.nb, stripe: this.D.muscles.stripe, groups: this._jobGroups(bi, worldOf), renderVerts: F.NV,
        figure: { pos: W.pos, nor: W.nor, idx: W.idx, skI: this.figIdx.wskI, skW: W.skW } };
    }
    // head length path (for the volume-preserving swell): the guide closest to the head's centre line
    _headPath(h) {
      const guides = this._groupGuides(h.group, h.side);
      const k = Math.round(clamp((h.def.v[0] + 1) / 2, 0, 1) * (guides.length - 1));
      return guides[k].map(([bone, p]) => ({ bone, p }));
    }
    _pathLen(path) {
      const THREE = g.THREE, a = new THREE.Vector3(), b = new THREE.Vector3(); let L = 0;
      for (let i = 0; i < path.length; i++) { this.skel.world(path[i].bone, path[i].p, b); if (i) L += a.distanceTo(b); a.copy(b); }
      return L;
    }
    // Non-adjacent contact in the bind pose (forearm against the hips in a pushdown) would fuse two body parts into one
    // surface that tears when they separate. For each arm that moves during the rep, find the smallest extra shoulder
    // abduction that clears forearm + hand from trunk and thighs; skinning carries it back.
    _armClearance() {
      const THREE = g.THREE, sk = this.skel, H = this.H, B = this.D.body;
      const armBones = new Set(); for (const s of ['l', 'r']) for (const n of ['arm_', 'fore_', 'hand_']) armBones.add(n + s);
      const isRef = (e) => typeof e[0] === 'string';
      const others = B.prims.filter((d) => !armBones.has(d.bone) && !/^clav/.test(d.bone) && (d.t === 'ell' || d.t === 'box' || (!isRef(d.a) && !isRef(d.b))));
      const lp = new THREE.Vector3();
      const prep = () => others.map((d) => { const b = sk.bones[d.bone]; return { d, inv: b.obj.matrixWorld.clone().invert(), at: b.at, rot: d.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...d.rot.map((x) => x * D2R))).invert() : null }; });
      const dist = (Pp, p) => {
        let m = BIG;
        for (const o of Pp) {
          lp.copy(p).applyMatrix4(o.inv).add(o.at); const d = o.d;
          if (d.t === 'ell' || d.t === 'box') {
            lp.sub(sk.V(d.c)); if (o.rot) lp.applyQuaternion(o.rot);
            const r = (d.r || d.h).map((x) => x * H), k0 = Math.hypot(lp.x / r[0], lp.y / r[1], lp.z / r[2]), k1 = Math.hypot(lp.x / r[0] / r[0], lp.y / r[1] / r[1], lp.z / r[2] / r[2]);
            m = Math.min(m, k1 > 0 ? k0 * (k0 - 1) / k1 : -r[0]);
          } else {
            const a = sk.V(d.a), bb = sk.V(d.b), ab = bb.clone().sub(a), t = clamp(lp.clone().sub(a).dot(ab) / ab.lengthSq());
            m = Math.min(m, lp.distanceTo(a.addScaledVector(ab, t)) - (d.ra + (d.rb - d.ra) * t) * H);
          }
        }
        return m;
      };
      const samples = [[0.1, 0.69, 0], [0.1, 0.62, 0], [0.1, 0.58, 0], [0.1, 0.54, 0], [0.1, 0.51, 0], [0.1, 0.46, 0.008]];
      const sampleBone = ['arm', 'fore', 'fore', 'fore', 'fore', 'hand'], rad = [0.026, 0.022, 0.021, 0.018, 0.015, 0.021];
      const bindPh = this.bindPhase();
      const handAt = (ph, side) => { this.solve(ph); return sk.bones['hand_' + side].obj.getWorldPosition(new THREE.Vector3()).sub(sk.bones.thorax.obj.getWorldPosition(new THREE.Vector3())); };
      const moving = {};
      for (const side of ['l', 'r']) moving[side] = handAt(0, side).distanceTo(handAt(this.motion.peak, side)) > 0.03 * H;
      this.solve(bindPh);
      const out = {};
      for (const side of ['l', 'r']) {
        out[side] = 0; if (!moving[side]) continue;
        const arm = sk.bones['arm_' + side], sg = side === 'l' ? 1 : -1, base = arm.obj.quaternion.clone();
        const q = new THREE.Vector3();
        for (const deg of [0, 6, 12, 18, 24, 30, 36]) {
          arm.obj.quaternion.copy(base); this.group.updateMatrixWorld(true);
          const pw = arm.obj.getWorldQuaternion(new THREE.Quaternion()), par = arm.obj.parent.getWorldQuaternion(new THREE.Quaternion());
          const extra = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, sg), deg * D2R);
          arm.obj.quaternion.copy(par.clone().invert().multiply(extra).multiply(pw)); this.group.updateMatrixWorld(true);
          const Pp = prep(); let c = BIG;
          samples.forEach((sp, i) => { const bn = sk.bones[sampleBone[i] + '_' + side]; q.copy(sk.V(side === 'l' ? sp : mirV(sp))).sub(bn.at).applyMatrix4(bn.obj.matrixWorld); c = Math.min(c, dist(Pp, q) - rad[i] * H); });
          out[side] = deg; if (c > 0.012 * H) break;
        }
      }
      this.group.updateMatrixWorld(true);
      return out;
    }
    // ---------------- skin mesh from a build result
    attachSkin(R) {
      const THREE = g.THREE, F = this.figure;
      if (F && R.NW) { // the static figure: its shared arrays, with the painted welded fields expanded to the render vertices
        const NV = F.NV, wd = F.weld;
        const ex = (src, n) => { const o = new Float32Array(NV * n); for (let v = 0; v < NV; v++) { const w = wd[v] * n; for (let k = 0; k < n; k++) o[v * n + k] = src[w + k]; } return o; };
        R = { NV, pos: F.pos, nor: F.nor, idx: F.idx, skI: this.figIdx.skI, skW: F.skW, ao: F.ao, uv: F.uv,
          musA: ex(R.musA, 4), hd: ex(R.hd, 2), bm: ex(R.bm, 4), g0: ex(R.g0, 3), g1: ex(R.g1, 3), stats: R.stats };
      }
      this.skin = R;
      const gm = new THREE.BufferGeometry();
      gm.setAttribute('position', new THREE.BufferAttribute(R.pos, 3));
      gm.setAttribute('normal', new THREE.BufferAttribute(R.nor, 3));
      gm.setAttribute('aSkI', new THREE.BufferAttribute(R.skI, 4));
      gm.setAttribute('aSkW', new THREE.BufferAttribute(R.skW, 4));
      gm.setAttribute('aAO', new THREE.BufferAttribute(R.ao, 1));
      gm.setAttribute('aMus', new THREE.BufferAttribute(R.musA, 4));
      gm.setAttribute('aHd', new THREE.BufferAttribute(R.hd, 2));
      gm.setAttribute('aBm', new THREE.BufferAttribute(R.bm, 4));
      gm.setAttribute('aG0', new THREE.BufferAttribute(R.g0, 3));
      gm.setAttribute('aG1', new THREE.BufferAttribute(R.g1, 3));
      if (R.uv) gm.setAttribute('uv', new THREE.BufferAttribute(R.uv, 2));
      gm.setIndex(new THREE.BufferAttribute(R.idx, 1));
      this.mat = MCE.shading.skinMaterial(this.U, this.stage.opts.debugMode || 'skin', F ? { pads: true, normalMap: F.normalTex || null, normalScale: F.normalScale } : null);
      this.skinMesh = new THREE.Mesh(gm, this.mat); this.skinMesh.frustumCulled = false; this.skinMesh.name = 'skin';
      this.group.add(this.skinMesh);
      // CPU sample of the skin (every n-th vertex) for framing and fill measurement
      const step = Math.max(1, Math.floor(R.NV / 3500)), ids = [];
      for (let v = 0; v < R.NV; v += step) ids.push(v);
      this.sampleIds = Int32Array.from(ids);
      this.ready = true;
    }
    // ---------------- per frame
    updateSkin(st) {
      const THREE = g.THREE, U = this.U, sk = this.skel;
      const qn = new THREE.Quaternion(), pn = new THREE.Vector3(), qi = new THREE.Quaternion(), t3 = new THREE.Vector3();
      for (const b of sk.list) {
        b.obj.getWorldQuaternion(qn); b.obj.getWorldPosition(pn);
        qi.copy(this.bindQ[b.idx]).invert(); const r = qn.multiply(qi);
        t3.copy(this.bindP[b.idx]).applyQuaternion(r); const t = pn.sub(t3);
        U.uQr.value[b.idx].set(r.x, r.y, r.z, r.w);
        U.uQd.value[b.idx].set(0.5 * (t.x * r.w + t.y * r.z - t.z * r.y), 0.5 * (-t.x * r.z + t.y * r.w + t.z * r.x), 0.5 * (t.x * r.y - t.y * r.x + t.z * r.w), -0.5 * (t.x * r.x + t.y * r.y + t.z * r.z));
      }
      if (this.figure) this._figureUniforms();
      const act = st.act, gain = this.ex.swellGain ?? 2.6;
      for (const h of this.heads) {
        let a = act;
        if (this.motion.mode === 'cycle') { const pk = this.cycleAct[h.id] ?? this.cycleAct[h.group.id]; a = pk != null ? this.motion.cycleActivation(st.crank, pk, h.side) : act; }
        const aT = h.tier === 1 ? a : 0.5 * a;
        U.uHB.value[h.hi].y = aT;
        if (h.path) {
          const L = this._pathLen(h.path), R = h.Lb / Math.max(1e-6, L);
          const vol = clamp(Math.pow(R, 1.25) - 1, -0.25, 0.4);          // volume-preserving: thickness x (Lbind/L)^1.25
          U.uHB.value[h.hi].x = (h.def.thick || 0.01) * this.H * (gain * vol + 0.9 * (a - 0.775)) * (h.tier === 1 ? 1 : 0.6);
        }
      }
    }
    // The static figure's extra skin uniforms: the forearm twist helpers (a share of the hand's turn about the forearm
    // since the bind pose, so the forearm skin twists along its length instead of all at the wrist), and the pads in figure
    // space (this runs inside frame(), after the solve and before the render yaw).
    _figureUniforms() {
      const THREE = g.THREE, sk = this.skel, U = this.U, n = sk.list.length;
      const T = this._ft || (this._ft = { qf: new THREE.Quaternion(), qh: new THREE.Quaternion(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), p: new THREE.Vector3(), t: new THREE.Vector3(), y: new THREE.Vector3(0, 1, 0) });
      const share = (this.figure.twist && this.figure.twist.share) ?? 0.55;
      for (const [k, s] of [[n, 'l'], [n + 1, 'r']]) {
        const fore = sk.bones['fore_' + s], hand = sk.bones['hand_' + s];
        fore.obj.getWorldQuaternion(T.qf); hand.obj.getWorldQuaternion(T.qh);
        T.qa.copy(T.qf).invert().multiply(T.qh);                                                   // hand in the forearm frame now
        T.qb.copy(this.bindQ[fore.idx]).invert().multiply(this.bindQ[hand.idx]).invert();       // ... and at the bind pose (inverse)
        T.qa.multiply(T.qb);
        let th = 2 * Math.atan2(T.qa.y, T.qa.w); if (th > Math.PI) th -= 2 * Math.PI; if (th < -Math.PI) th += 2 * Math.PI;
        const r = T.qa.setFromAxisAngle(T.y, th * share).premultiply(T.qf).multiply(T.qb.copy(this.bindQ[k]).invert());
        fore.obj.getWorldPosition(T.p); T.t.copy(this.bindP[k]).applyQuaternion(r); const t = T.p.sub(T.t);
        U.uQr.value[k].set(r.x, r.y, r.z, r.w);
        U.uQd.value[k].set(0.5 * (t.x * r.w + t.y * r.z - t.z * r.y), 0.5 * (-t.x * r.z + t.y * r.w + t.z * r.x), 0.5 * (t.x * r.y - t.y * r.x + t.z * r.w), -0.5 * (t.x * r.x + t.y * r.y + t.z * r.z));
      }
      let np = 0;
      for (const pr of this.pads || []) {
        const ud = pr.mesh.userData; pr.mesh.updateMatrixWorld(true);
        U.uPadM.value[np].copy(pr.mesh.matrixWorld).invert();
        if (ud.kind === 'box') U.uPadP.value[np].set(ud.hs[0], ud.hs[1], ud.hs[2], ud.rr); else U.uPadP.value[np].set(ud.r, ud.hh, 0, -1);
        np++;
      }
      U.uPadN.value = np; U.uPadK.value = (this.D.body.kc ?? 0.004) * this.H;
    }
    // Render transform: the authored yaw about the world origin, plus the viewer's turn (uYaw, radians; engine/stage.js
    // orbit view) about the vertical axis through `pivot` ([x, z] in world space at the authored yaw, the lathe axis):
    // world = pivot + Ry(uYaw) (Ry(yaw) p - pivot).
    frame(phase) {
      const st = this.solve(phase);
      if (this.ready) this.updateSkin(st);
      const u = this.uYaw || 0;
      this.group.rotation.y = this.yaw + u;
      if (u && this.pivot) { const [px, pz] = this.pivot, c = Math.cos(u), s = Math.sin(u); this.group.position.set(px - (px * c + pz * s), 0, pz - (-px * s + pz * c)); }
      this.group.updateMatrixWorld(true);
      this.lastState = st;
      return st;
    }
    // CPU dual-quaternion skinning of the sampled vertices (figure space, current pose) in WORLD space, written flat
    // (x, y, z) into buf from index o; returns the index after the last value. Allocation-free: the auto-fit runs it for
    // 24 frames of about 3500 points (engine/stage.js _fitFor).
    samplePositions(buf, o = 0) {
      const R = this.skin, U = this.U; if (!R || !this.sampleIds) return o;
      const m = this.group.matrixWorld.elements, Qr = U.uQr.value, Qd = U.uQd.value, skI = R.skI, skW = R.skW, pos = R.pos;
      const np = this.figure ? U.uPadN.value : 0; // the static figure: the shader's pad press, here too (framing, probes)
      for (const id of this.sampleIds) {
        const r0 = Qr[skI[id * 4]];
        let q0 = 0, q1 = 0, q2 = 0, q3 = 0, d0 = 0, d1 = 0, d2 = 0, d3 = 0;
        for (let k = 0; k < 4; k++) {
          const wk = skW[id * 4 + k]; if (!wk) continue; const bi = skI[id * 4 + k], rq = Qr[bi], dq = Qd[bi];
          const s = (r0.x * rq.x + r0.y * rq.y + r0.z * rq.z + r0.w * rq.w) < 0 ? -wk : wk;
          q0 += rq.x * s; q1 += rq.y * s; q2 += rq.z * s; q3 += rq.w * s; d0 += dq.x * s; d1 += dq.y * s; d2 += dq.z * s; d3 += dq.w * s;
        }
        const l = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) || 1;
        const x = q0 / l, y = q1 / l, z = q2 / l, w = q3 / l, dx = d0 / l, dy = d1 / l, dz = d2 / l, dw = d3 / l;
        const px = pos[id * 3], py = pos[id * 3 + 1], pz = pos[id * 3 + 2];
        // p' = p + 2 q.xyz x (q.xyz x p + w p) + 2 (w d.xyz - dw q.xyz + q.xyz x d.xyz)
        const cx = y * pz - z * py + w * px, cy = z * px - x * pz + w * py, cz = x * py - y * px + w * pz;
        let ox = px + 2 * (y * cz - z * cy) + 2 * (w * dx - dw * x + (y * dz - z * dy));
        let oy = py + 2 * (z * cx - x * cz) + 2 * (w * dy - dw * y + (z * dx - x * dz));
        let oz = pz + 2 * (x * cy - y * cx) + 2 * (w * dz - dw * z + (x * dy - y * dx));
        if (np) { const q = this._padPress(ox, oy, oz, np); ox = q[0]; oy = q[1]; oz = q[2]; }
        // the group's world matrix is affine (no perspective row)
        buf[o++] = m[0] * ox + m[4] * oy + m[8] * oz + m[12];
        buf[o++] = m[1] * ox + m[5] * oy + m[9] * oz + m[13];
        buf[o++] = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
      }
      return o;
    }
    // engine/shading.js PADS on one figure-space point (allocation-free but for the returned triple)
    _padPress(x, y, z, np) {
      const U = this.U, K = U.uPadK.value, e = 0.001;
      const sdf = (P, M, lx0, ly0, lz0) => {
        const lx = M[0] * lx0 + M[4] * ly0 + M[8] * lz0 + M[12], ly = M[1] * lx0 + M[5] * ly0 + M[9] * lz0 + M[13], lz = M[2] * lx0 + M[6] * ly0 + M[10] * lz0 + M[14];
        if (P.w >= 0) { const qx = Math.abs(lx) - P.x + P.w, qy = Math.abs(ly) - P.y + P.w, qz = Math.abs(lz) - P.z + P.w; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - P.w; }
        const dx = Math.hypot(lx, lz) - P.x, dy = Math.abs(ly) - P.y; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      };
      for (let i = 0; i < np; i++) {
        const M = U.uPadM.value[i].elements, P = U.uPadP.value[i], d = sdf(P, M, x, y, z);
        if (d >= K) continue;
        let gx = sdf(P, M, x + e, y, z) - sdf(P, M, x - e, y, z), gy = sdf(P, M, x, y + e, z) - sdf(P, M, x, y - e, z), gz = sdf(P, M, x, y, z + e) - sdf(P, M, x, y, z - e);
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        const h = Math.max(K - Math.abs(d), 0) / K, push = Math.max(d, 0) + h * h * K * 0.25 - d;
        x += gx * push; y += gy * push; z += gz * push;
      }
      return [x, y, z];
    }
    // the same points as Vector3s pushed to out[] (probes: fill)
    sampledPoints(out) {
      if (!this.skin || !this.sampleIds) return out;
      const THREE = g.THREE, n = this.sampleIds.length;
      const b = this._spBuf && this._spBuf.length === n * 3 ? this._spBuf : (this._spBuf = new Float64Array(n * 3));
      this.samplePositions(b, 0);
      for (let i = 0; i < n; i++) out.push(new THREE.Vector3(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]));
      return out;
    }
    dispose() {
      this.disposed = true;
      if (this.skinMesh) { this.skinMesh.geometry.dispose(); this.mat.dispose(); }
      this.machine.dispose();
      if (this.group.parent) this.group.parent.remove(this.group);
    }
  }
  MCE.Instance = Instance;
  MCE.prepBody = prepBody;
  MCE.prepMuscles = prepMuscles;
})(typeof window !== 'undefined' ? window : globalThis);
