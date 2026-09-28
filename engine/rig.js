// Skeleton, joint-angle conventions, analytic IK (with grip and sole alignment), pins, scapulohumeral rhythm,
// and anatomical angle read-back for ROM checks. All rest frames are world aligned: Y up, figure faces +Z,
// figure-left = +X. Units in data files are fractions of stature H.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const { D2R, clamp, sideOf, mirId, mirV, baseOf } = MCE.util;
  const T = () => g.THREE;

  let AX = null;
  const axes = () => AX || (AX = { x: new (T().Vector3)(1, 0, 0), y: new (T().Vector3)(0, 1, 0), z: new (T().Vector3)(0, 0, 1) });
  const qa = (ax, deg) => new (T().Quaternion)().setFromAxisAngle(axes()[ax], deg * D2R);

  // Engine joint parameters per bone type (degrees). s = +1 figure-left, -1 figure-right.
  //  pelvis/lumbar/thorax/neck/head: flex (+ forward), lat (+ bend to figure-left), rot (+ turn to figure-left)
  //  clav: elev (+ shrug), pro (+ protraction)
  //  arm:  plane (0 = abduction plane, 90 = straight forward, <0 behind), elev (0 hanging .. 180 overhead), rot (+ external)
  //  fore: flex (+ elbow flexion)            hand: pro (+ pronation), flex (+ palmar flexion), dev (+ radial deviation)
  //  thigh: flex (+ hip flexion), abd (+ abduction), rot (+ external)
  //  shank: flex (+ knee flexion)            foot: dorsi (+ dorsiflexion), inv (+ inversion)   toe: ext (+ extension)
  function jointQ(base, s, p) {
    const gv = (k) => p[k] || 0;
    switch (base) {
      case 'pelvis': case 'lumbar': case 'thorax': case 'neck': case 'head':
        return qa('y', gv('rot')).multiply(qa('x', gv('flex'))).multiply(qa('z', -gv('lat')));
      case 'clav': return qa('y', -s * gv('pro')).multiply(qa('z', s * gv('elev')));
      case 'arm': return qa('y', -s * gv('plane')).multiply(qa('z', s * gv('elev'))).multiply(qa('y', s * gv('rot')));
      case 'fore': return qa('x', -gv('flex'));
      case 'hand': return qa('y', -s * gv('pro')).multiply(qa('x', -gv('flex'))).multiply(qa('z', s * gv('dev')));
      case 'thigh': return qa('x', -gv('flex')).multiply(qa('z', s * gv('abd'))).multiply(qa('y', s * gv('rot')));
      case 'shank': return qa('x', gv('flex'));
      case 'foot': return qa('x', -gv('dorsi')).multiply(qa('z', -s * gv('inv')));
      case 'toe': return qa('x', -gv('ext'));
    }
    return new (T().Quaternion)();
  }

  class Skeleton {
    constructor(RIG) {
      const THREE = T();
      this.RIG = RIG; this.H = RIG.height;
      this.root = new THREE.Group(); this.root.name = 'skeleton';
      this.bones = {}; this.list = [];
      const add = (def) => {
        const b = { id: def.id, parent: def.parent, at: this.V(def.at), obj: new THREE.Object3D(), side: sideOf(def.id), base: baseOf(def.id) };
        b.obj.name = def.id; this.bones[def.id] = b;
      };
      for (const b of RIG.bones) { add(b); if (sideOf(b.id) === 1) add({ id: mirId(b.id), parent: b.parent && mirId(b.parent), at: mirV(b.at) }); }
      for (const b of Object.values(this.bones)) {
        if (b.parent) { this.bones[b.parent].obj.add(b.obj); b.obj.position.copy(b.at).sub(this.bones[b.parent].at); }
        else this.root.add(b.obj);
      }
      this.list = Object.values(this.bones); this.list.forEach((b, i) => { b.idx = i; });
      this.grip = RIG.grip; this.sole = RIG.sole;
      this._v = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3());
      this._q = [0, 1, 2, 3].map(() => new THREE.Quaternion());
      this._m = new THREE.Matrix4();
    }
    V(a) { return new (T().Vector3)(a[0] * this.H, a[1] * this.H, a[2] * this.H); }
    // a rest-pose world point (H units) expressed in the bone's local frame
    local(boneId, p) { return this.V(p).sub(this.bones[boneId].at); }
    // world position of a rest-pose point attached to a bone
    world(boneId, p, out) { const b = this.bones[boneId]; return out.copy(this.V(p)).sub(b.at).applyMatrix4(b.obj.matrixWorld); }
    setPose(pose, rootPos) {
      this.root.position.copy(rootPos);
      for (const b of this.list) b.obj.quaternion.copy(jointQ(b.base, b.side, pose[b.id] || {}));
    }
    update() { this.root.updateMatrixWorld(true); }

    // ---------------- two-bone analytic IK (hinge-consistent: the mid joint only flexes about its local X)
    // upper/mid/end are bone records; the end bone's ORIGIN (wrist / ankle) is placed on `target`.
    // `pole` is a world direction the elbow/knee should point toward. bendSign +1 = elbow (flexes toward +Z at rest),
    // -1 = knee (flexes toward -Z at rest).
    solveLimb(upper, mid, end, target, pole, bendSign) {
      const [S, E, Tg, d, pp, du, df] = this._v, THREE = T();
      const L1 = mid.at.distanceTo(upper.at), L2 = end.at.distanceTo(mid.at);
      upper.obj.getWorldPosition(S);
      d.copy(target).sub(S);
      const dist = Math.min(L1 + L2 - 1e-5, Math.max(Math.abs(L1 - L2) + 1e-5, d.length()));
      d.normalize();
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      pp.copy(pole).addScaledVector(d, -pole.dot(d)); if (pp.lengthSq() < 1e-10) pp.set(0, 0, 1).addScaledVector(d, -d.z); pp.normalize();
      E.copy(S).addScaledVector(d, a).addScaledVector(pp, h);
      Tg.copy(S).addScaledVector(d, dist);
      du.copy(E).sub(S).normalize(); df.copy(Tg).sub(E).normalize();
      const Z = this._v[7].copy(df).addScaledVector(du, -df.dot(du));
      if (Z.lengthSq() < 1e-10) Z.copy(pp).multiplyScalar(-1);
      Z.normalize().multiplyScalar(bendSign);
      const Y = new THREE.Vector3().copy(du).negate(), X = new THREE.Vector3().crossVectors(Y, Z);
      this._m.makeBasis(X, Y, Z);
      const pq = upper.obj.parent.getWorldQuaternion(this._q[0]);
      upper.obj.quaternion.setFromRotationMatrix(this._m).premultiply(pq.invert());
      const flex = Math.acos(clamp(du.dot(df), -1, 1)) / D2R;
      mid.obj.quaternion.copy(qa('x', bendSign > 0 ? -flex : flex));
      upper.obj.updateMatrixWorld(true);
      return flex;
    }

    // Orient the hand so the fist's grip tunnel (hand-local grip.axis) lies along `axisW` (world), fingers continuing
    // the forearm as closely as possible. The sign of the axis is chosen for the smallest turn from the FK hand.
    alignHand(hand, axisW) {
      const THREE = T(), [fd, xa, ya, za] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const fore = this.bones[hand.parent];
      // forearm long axis (world, pointing distally)
      const wq = fore.obj.getWorldQuaternion(new THREE.Quaternion());
      fd.set(0, -1, 0).applyQuaternion(wq);
      const fk = hand.obj.getWorldQuaternion(new THREE.Quaternion());
      const fkPalm = new THREE.Vector3(0, 0, 1).applyQuaternion(fk);
      xa.copy(axisW).normalize();
      // limit radial/ulnar deviation: the tunnel may tilt at most maxDev out of the plane normal to the forearm
      // (the handle then enters the fist at a slight angle instead of bending the wrist past its range)
      const c = xa.dot(fd), sMax = Math.sin((this.maxGripDev ?? 16) * D2R);
      if (Math.abs(c) > sMax) { const p = xa.clone().addScaledVector(fd, -c).normalize(); xa.copy(p.multiplyScalar(Math.sqrt(1 - sMax * sMax))).addScaledVector(fd, Math.sign(c) * sMax).normalize(); }
      ya.copy(fd).addScaledVector(xa, -fd.dot(xa)); if (ya.lengthSq() < 1e-8) ya.set(0, -1, 0); ya.normalize().negate(); // hand +Y = proximal
      za.crossVectors(xa, ya);
      if (za.dot(fkPalm) < 0) { xa.negate(); za.negate(); }
      const ga = this.grip.axis; // hand-local tunnel axis (default +X)
      const m = new THREE.Matrix4().makeBasis(xa, ya, za);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      if (!(ga[0] === 1 && ga[1] === 0 && ga[2] === 0)) q.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...ga).normalize()).invert());
      hand.obj.quaternion.copy(wq.invert().multiply(q));
      hand.obj.updateMatrixWorld(true);
    }
    // Orient the foot so its sole normal (foot-local +Y) is `nW` and its forward (foot-local +Z) follows `fwdW` projected on the sole.
    alignFoot(foot, nW, fwdW) {
      const THREE = T();
      const shank = this.bones[foot.parent];
      const wq = shank.obj.getWorldQuaternion(new THREE.Quaternion());
      const y = nW.clone().normalize();
      let z = (fwdW ? fwdW.clone() : new THREE.Vector3(0, 0, 1).applyQuaternion(foot.obj.getWorldQuaternion(new THREE.Quaternion())));
      z.addScaledVector(y, -z.dot(y)); if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z); z.normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      foot.obj.quaternion.copy(wq.invert().multiply(q));
      foot.obj.updateMatrixWorld(true);
    }

    // Place a hand's grip centre on a world point. spec: { pole: Vector3 (world), axis: Vector3|null (handle axis, world) }
    // Returns the residual distance.
    reachHand(side, socketW, spec) {
      const THREE = T(), b = this.bones, arm = b['arm_' + side], fore = b['fore_' + side], hand = b['hand_' + side];
      const sgn = side === 'l' ? 1 : -1, go = this.grip.offset, gl = new THREE.Vector3(go[0] * sgn, go[1], go[2]).multiplyScalar(this.H);
      const fq = new THREE.Quaternion(), tgt = new THREE.Vector3(), gw = new THREE.Vector3();
      // initial wrist guess: back off along the current forearm direction
      fore.obj.getWorldQuaternion(fq); tgt.copy(socketW).addScaledVector(new THREE.Vector3(0, -1, 0).applyQuaternion(fq), -gl.length());
      const handFK = hand.obj.quaternion.clone();
      let err = 0;
      for (let it = 0; it < 8; it++) {
        this.solveLimb(arm, fore, hand, tgt, spec.pole, +1);
        hand.obj.quaternion.copy(handFK); hand.obj.updateMatrixWorld(true);
        if (spec.axis) this.alignHand(hand, spec.axis);
        gw.copy(gl).applyMatrix4(hand.obj.matrixWorld);
        const e = socketW.clone().sub(gw); err = e.length();
        if (err < 1e-6 * this.H) break;
        tgt.add(e);
      }
      return err;
    }
    // Place a foot on a world point. spec: { pole, contact: foot-local point (H, rest offsets from the ankle), normal: Vector3|null, fwd }
    reachFoot(side, socketW, spec) {
      const THREE = T(), b = this.bones, thigh = b['thigh_' + side], shank = b['shank_' + side], foot = b['foot_' + side];
      const sgn = side === 'l' ? 1 : -1, c = spec.contact || [0, 0, 0];
      const cl = new THREE.Vector3(c[0] * sgn, c[1], c[2]).multiplyScalar(this.H);
      const tgt = socketW.clone(), cw = new THREE.Vector3();
      const footFK = foot.obj.quaternion.clone();
      // first guess: FK foot orientation
      cw.copy(cl).applyQuaternion(foot.obj.getWorldQuaternion(new THREE.Quaternion())); tgt.sub(cw);
      let err = 0;
      for (let it = 0; it < 10; it++) {
        this.solveLimb(thigh, shank, foot, tgt, spec.pole, -1);
        foot.obj.quaternion.copy(footFK); foot.obj.updateMatrixWorld(true);
        if (spec.normal) this.alignFoot(foot, spec.normal, spec.fwd);
        cw.copy(cl).applyMatrix4(foot.obj.matrixWorld);
        const e = socketW.clone().sub(cw); err = e.length();
        if (err < 1e-6 * this.H) break;
        tgt.add(e);
      }
      return err;
    }

    // humeral elevation relative to the thorax (deg)
    humeralElevation(side) {
      const THREE = T(), a = new THREE.Vector3(), f = new THREE.Vector3(), qi = new THREE.Quaternion();
      this.bones['arm_' + side].obj.getWorldPosition(a); this.bones['fore_' + side].obj.getWorldPosition(f);
      this.bones.thorax.obj.getWorldQuaternion(qi).invert();
      f.sub(a).normalize().applyQuaternion(qi);
      return Math.acos(clamp(-f.y, -1, 1)) / D2R;
    }
    // Scapulohumeral rhythm: beyond 30 deg of humeral elevation the shoulder girdle elevates/upwardly rotates
    // (about 1 deg of clavicle elevation per 5 deg of arm elevation here, capped). Returns true if anything moved.
    rhythm(gain = 0.2, cap = 28, sides = ['l', 'r']) {
      let moved = false;
      for (const s of sides) {
        const extra = Math.min(cap, Math.max(0, this.humeralElevation(s) - 30) * gain);
        if (extra > 0.01) { const c = this.bones['clav_' + s]; c.obj.quaternion.multiply(qa('z', c.side * extra)); moved = true; }
      }
      if (moved) this.update();
      return moved;
    }

    // ---------------- anatomical read-back (degrees), used for ROM checks and authoring reports
    angles() {
      const THREE = T(), b = this.bones, P = (id) => b[id].obj.getWorldPosition(new THREE.Vector3());
      const Q = (id) => b[id].obj.getWorldQuaternion(new THREE.Quaternion());
      const inFrame = (v, id) => v.clone().applyQuaternion(Q(id).invert());
      const ang = (u, v) => Math.acos(clamp(u.dot(v) / (u.length() * v.length() || 1), -1, 1)) / D2R;
      const out = {};
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(Q('thorax'));
      const trunkF = Math.atan2(up.z, up.y) / D2R; // world sagittal lean of the thorax (+ forward), before world yaw
      out.trunk_flexion = +trunkF.toFixed(1);
      // research trunk conventions (cable crunch, knee raise): spinal flexion = lumbar + thoracic curl (thorax tilt minus
      // pelvis tilt), trunk chord = the hip-centre -> C7 line from vertical (+ forward)
      const pu = new THREE.Vector3(0, 1, 0).applyQuaternion(Q('pelvis'));
      out.spinal_flexion = +(trunkF - Math.atan2(pu.z, pu.y) / D2R).toFixed(1);
      const ch = P('neck').sub(P('pelvis'));
      out.trunk_chord = +(Math.atan2(ch.z, ch.y) / D2R).toFixed(1);
      for (const s of ['l', 'r']) {
        const sg = s === 'l' ? 1 : -1;
        const sh = P('arm_' + s), el = P('fore_' + s), wr = P('hand_' + s), hp = P('thigh_' + s), kn = P('shank_' + s), an = P('foot_' + s);
        const hum = inFrame(el.clone().sub(sh), 'thorax').normalize();
        out['elbow_flexion_' + s] = +ang(el.clone().sub(sh), wr.clone().sub(el)).toFixed(1);
        out['shoulder_elevation_' + s] = +(Math.acos(clamp(-hum.y, -1, 1)) / D2R).toFixed(1);
        out['shoulder_plane_' + s] = +(Math.atan2(hum.z, sg * hum.x) / D2R).toFixed(1);
        out['shoulder_flexion_' + s] = +(Math.atan2(hum.z, -hum.y) / D2R).toFixed(1);
        out['shoulder_abduction_' + s] = +(Math.atan2(sg * hum.x, -hum.y) / D2R).toFixed(1);
        // elbow flare: the humerus out of the trunk's sagittal plane (well defined near 90 deg of flexion, where abduction is not)
        out['shoulder_flare_' + s] = +(Math.asin(clamp(sg * hum.x, -1, 1)) / D2R).toFixed(1);
        // the same humerus angles in the (un-yawed) figure frame, for research that measures against the world vertical
        const hw = el.clone().sub(sh).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
        out['shoulder_elevation_w_' + s] = +(Math.acos(clamp(-hw.y, -1, 1)) / D2R).toFixed(1);
        out['shoulder_plane_w_' + s] = +(Math.atan2(hw.z, sg * hw.x) / D2R).toFixed(1);
        const th = inFrame(kn.clone().sub(hp), 'pelvis').normalize();
        out['hip_flexion_' + s] = +(Math.atan2(th.z, -th.y) / D2R).toFixed(1);
        out['hip_abduction_' + s] = +(Math.atan2(sg * th.x, Math.hypot(th.y, th.z)) / D2R).toFixed(1);
        out['knee_flexion_' + s] = +ang(kn.clone().sub(hp), an.clone().sub(kn)).toFixed(1);
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(Q('foot_' + s)), shu = kn.clone().sub(an).normalize();
        out['ankle_dorsiflexion_' + s] = +(Math.asin(clamp(fwd.dot(shu), -1, 1)) / D2R).toFixed(1);
        const fd = inFrame(new THREE.Vector3(0, -1, 0).applyQuaternion(Q('hand_' + s)), 'fore_' + s);
        out['wrist_flexion_' + s] = +(Math.atan2(fd.z, -fd.y) / D2R).toFixed(1);
        out['wrist_deviation_' + s] = +(Math.atan2(sg * fd.x, -fd.y) / D2R).toFixed(1);
      }
      return out;
    }
  }

  MCE.Skeleton = Skeleton;
  MCE.jointQ = jointQ;
  MCE.qa = qa;
})(typeof window !== 'undefined' ? window : globalThis);
