// Machine parts: quiet primitives (rounded boxes, cylinders), named sockets for IK/pins, hinges and slides driven by
// pose dofs, cables between sockets, attachment to bones ("@bone"), auto-mirroring of _l parts, a `fade` flag for
// parts that would hide working muscles, and the list of pad volumes that carve the skin at bind time.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const { D2R, clamp, sideOf, mirId, mirV } = MCE.util;

  function roundedBox(THREE, sx, sy, sz, r) {
    const gm = new THREE.BoxGeometry(sx, sy, sz, 6, 6, 6), p = gm.attributes.position, n = gm.attributes.normal;
    const hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r, v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
      const d = v.sub(c); if (d.lengthSq() < 1e-12) continue; d.normalize();
      p.setXYZ(i, c.x + d.x * r, c.y + d.y * r, c.z + d.z * r); n.setXYZ(i, d.x, d.y, d.z);
    }
    return gm;
  }

  // mirror every part whose id (or parent) is _l, unless a _r twin exists or mirror:false
  function expandParts(parts) {
    const ids = new Set(parts.map((p) => p.id)), out = parts.slice();
    for (const p of parts) {
      if (p.mirror === false) continue;
      const parentL = p.parent && sideOf(p.parent[0] === '@' ? p.parent.slice(1) : p.parent) === 1;
      if (sideOf(p.id) !== 1 && !parentL) continue;
      const id = sideOf(p.id) === 1 ? mirId(p.id) : p.id + '_r';
      if (ids.has(id)) continue;
      const q = JSON.parse(JSON.stringify(p)); q.id = id; q._mirrorOf = p.id;
      if (p.parent) q.parent = p.parent[0] === '@' ? '@' + mirId(p.parent.slice(1)) : mirId(p.parent);
      for (const k of ['at', 'from', 'to', 'pivot']) if (p[k]) q[k] = mirV(p[k]);
      if (p.axis) q.axis = [p.axis[0], -p.axis[1], -p.axis[2]];  // hinge axes mirror as pseudo-vectors
      if (p.slide) q.slide = mirV(p.slide);
      if (p.rot) q.rot = [p.rot[0], -p.rot[1], -p.rot[2]];
      if (p.cable) q.cable = p.cable.map(mirId);
      if (p.link) q.link = p.link.map(mirId);
      if (p.normal) q.normal = mirV(p.normal);
      if (p.fwd) q.fwd = mirV(p.fwd);
      ids.add(id); out.push(q);
    }
    return out;
  }

  class Machine {
    constructor(defs, skel, mats, fadeIds) {
      const THREE = g.THREE;
      this.skel = skel; this.H = skel.H; this.mats = mats;
      this.root = new THREE.Group(); this.root.name = 'machine';
      this.parts = {}; this.cables = []; this.dofParts = []; this.defs = expandParts(defs || []);
      if (fadeIds) for (const p of this.defs) if (fadeIds.includes(p.id)) p.fade = p.fade || 0.22;
      const V = (a) => skel.V(a);
      for (const p of this.defs) {
        if (p.cable || p.link) { // cable: thin line between sockets; link: rigid bar between sockets (lever linkages)
          const [a, b] = p.cable || p.link;
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, p.link ? 20 : 8, 1, !!p.cable), p.cable ? mats.cable : this._mat(p));
          mesh.frustumCulled = false; if (p.cable) { mesh.renderOrder = 3; mesh.userData.cable = true; }
          this.root.add(mesh); this.cables.push({ a, b, mesh, r: (p.r || 0.0016) * this.H }); continue;
        }
        let parentObj = this.root, parentOrigin = new THREE.Vector3(), boneLocal = false;
        if (p.parent && p.parent[0] === '@') {
          const bb = skel.bones[p.parent.slice(1)]; if (!bb) throw new Error('machine: no bone ' + p.parent);
          parentObj = bb.obj; parentOrigin = bb.at.clone(); boneLocal = true;
        } else if (p.parent) {
          const pr = this.parts[p.parent]; if (!pr) throw new Error('machine: parent must come first: ' + p.parent);
          parentObj = pr.obj; parentOrigin = pr.origin;
        }
        const origin = p.pivot ? V(p.pivot) : parentOrigin.clone();
        const obj = new THREE.Object3D(); obj.name = p.id; obj.position.copy(origin).sub(parentOrigin); parentObj.add(obj);
        const rec = { def: p, obj, origin, base: obj.position.clone(), boneLocal };
        this.parts[p.id] = rec;
        if (p.dof || p.counter) this.dofParts.push(rec);
        const loc = (a) => V(a).sub(origin);
        let mesh = null;
        if (p.shape === 'box') {
          const r = Math.min((p.round ?? 0.006) * this.H, p.size[0] * this.H * 0.45, p.size[1] * this.H * 0.45, p.size[2] * this.H * 0.45);
          mesh = new THREE.Mesh(roundedBox(THREE, p.size[0] * this.H, p.size[1] * this.H, p.size[2] * this.H, r), this._mat(p));
          mesh.position.copy(loc(p.at)); if (p.rot) mesh.rotation.set(p.rot[0] * D2R, p.rot[1] * D2R, p.rot[2] * D2R);
          mesh.userData = { kind: 'box', hs: [p.size[0] * this.H / 2, p.size[1] * this.H / 2, p.size[2] * this.H / 2], rr: r };
        } else if (p.shape === 'cyl') {
          const a = loc(p.from), c = loc(p.to), len = a.distanceTo(c);
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.r * this.H, p.r * this.H, len, p.seg || 28), this._mat(p));
          mesh.position.copy(a).add(c).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
          mesh.userData = { kind: 'cyl', r: p.r * this.H, hh: len / 2 };
        }
        if (p.at && !mesh) { rec.socket = new THREE.Object3D(); rec.socket.position.copy(loc(p.at)); obj.add(rec.socket); }
        if (mesh) {
          if (p.hidden) mesh.visible = false;
          if (p.fade) { mesh.renderOrder = 4; }
          obj.add(mesh); rec.mesh = mesh;
          if (p.shape === 'box' && p.at) { rec.socket = new THREE.Object3D(); rec.socket.position.copy(loc(p.at)); obj.add(rec.socket); }
        }
      }
    }
    _mat(p) {
      const m = this.mats[p.mat || 'frame'] || this.mats.frame;
      if (!p.fade) return m;
      const f = this.mats.faded(p.mat || 'frame', typeof p.fade === 'number' ? p.fade : 0.2);
      return f;
    }
    // apply dof values: { dofName: value }
    setDofs(mv) {
      const THREE = g.THREE;
      for (const r of this.dofParts) {
        const p = r.def;
        let val = p.dof ? ((mv[p.dof] || 0) + (p.offset || 0)) * (p.gain ?? 1) : 0;
        if (p.counter) val -= (mv[p.counter] || 0) * (p.gain ?? 1);
        if (p.axis) r.obj.quaternion.setFromAxisAngle(new THREE.Vector3(...p.axis).normalize(), val * D2R);
        if (p.slide) r.obj.position.copy(r.base).add(this.skel.V(p.slide).multiplyScalar(val));
      }
    }
    // parts with `follow: "<bone>"` copy that bone's world orientation after IK (pedals spin freely under the foot)
    applyFollow() {
      const THREE = g.THREE, q = new THREE.Quaternion(), pq = new THREE.Quaternion();
      for (const r of Object.values(this.parts)) {
        const f = r.def.follow; if (!f) continue;
        const b = this.skel.bones[f]; if (!b) continue;
        b.obj.getWorldQuaternion(q); r.obj.parent.getWorldQuaternion(pq);
        r.obj.quaternion.copy(pq.invert().multiply(q)); r.obj.updateMatrixWorld(true);
      }
    }
    socketWorld(id, out) {
      const r = this.parts[id]; if (!r) throw new Error('machine: no socket ' + id);
      return (r.socket || r.obj).getWorldPosition(out);
    }
    // world direction of a cylinder part's axis (from -> to), or of a box part's local axis
    axisWorld(id, local, out) {
      const r = this.parts[id]; if (!r) throw new Error('machine: no part ' + id);
      const THREE = g.THREE, q = (r.mesh || r.obj).getWorldQuaternion(new THREE.Quaternion());
      if (local) return out.set(...local).applyQuaternion(r.obj.getWorldQuaternion(new THREE.Quaternion())).normalize();
      if (r.mesh && r.mesh.userData.kind === 'cyl') return out.set(0, 1, 0).applyQuaternion(q).normalize();
      return out.set(1, 0, 0).applyQuaternion(q).normalize();
    }
    updateCables() {
      const THREE = g.THREE, A = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (const c of this.cables) {
        this.socketWorld(c.a, A); this.socketWorld(c.b, B);
        this.root.worldToLocal(A); this.root.worldToLocal(B);
        c.mesh.position.copy(A).add(B).multiplyScalar(0.5); c.mesh.scale.set(c.r, Math.max(1e-6, A.distanceTo(B)), c.r);
        c.mesh.quaternion.setFromUnitVectors(up, B.clone().sub(A).normalize());
      }
    }
    // carve volumes for the skin build: boxes and cylinders flagged carve (default: pads and floor plates)
    carveList() {
      const out = [];
      for (const r of Object.values(this.parts)) {
        const p = r.def; if (!r.mesh) continue;
        const carve = p.carve ?? (p.mat === 'pad' || p.mat === 'plate');
        if (!carve) continue;
        r.mesh.updateMatrixWorld(true);
        out.push({ kind: r.mesh.userData.kind, ud: r.mesh.userData, M: r.mesh.matrixWorld.clone(), id: p.id });
      }
      return out;
    }
    // world-space bounding points of all visible parts (for framing): the 8 corners of each part's world-axis bounding
    // box. With tight (an array), also the 8 corners of each part's own bounding box carried by its world matrix, as
    // x, y, z numbers: an oriented box, which stays close to a diagonal rail or a turned plate (the side layout keeps
    // the machine out of the text column with these, engine/stage.js _fitFor).
    boundsPoints(outArr, tight) {
      const THREE = g.THREE, box = new THREE.Box3(), v = new THREE.Vector3();
      for (const r of Object.values(this.parts)) {
        if (!r.mesh || !r.mesh.visible || r.def.noFit) continue;
        r.mesh.geometry.computeBoundingBox(); const b = r.mesh.geometry.boundingBox;
        box.copy(b).applyMatrix4(r.mesh.matrixWorld);
        for (let i = 0; i < 8; i++) outArr.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
        if (tight) for (let i = 0; i < 8; i++) { v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(r.mesh.matrixWorld); tight.push(v.x, v.y, v.z); }
      }
      return outArr;
    }
    // Parts parented to a bone ("@bone") live under the skeleton, not under this.root, so they are walked on their own;
    // materials are the stage's shared (and cached faded) materials and stay alive.
    dispose() {
      const seen = new Set(), free = (o) => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } };
      this.root.traverse(free);
      for (const r of Object.values(this.parts)) if (r.boneLocal) { r.obj.traverse(free); if (r.obj.parent) r.obj.parent.remove(r.obj); }
    }
  }
  MCE.Machine = Machine;
  MCE.expandParts = expandParts;
})(typeof window !== 'undefined' ? window : globalThis);
