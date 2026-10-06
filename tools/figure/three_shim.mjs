// A small stand-in for the parts of three.js (r147) the engine's solve path touches, so the engine's own Skeleton / IK /
// Machine / Instance code runs in node with no browser: Vector2/3/4, Quaternion, Euler, Matrix4, Object3D / Group / Mesh with
// the matrix-world logic, Box3, stub geometries (extent only) and inert materials. The math follows three.js.
const EPS = Number.EPSILON;

export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } copy(v) { this.x = v.x; this.y = v.y; return this; } clone() { return new Vector2(this.x, this.y); } }
export class Vector4 { constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; } set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; } clone() { return new Vector4(this.x, this.y, this.z, this.w); } }

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  crossVectors(a, b) { const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z; this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx; return this; }
  cross(v) { return this.crossVectors(this, v); }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  applyMatrix4(m) { const x = this.x, y = this.y, z = this.z, e = m.elements; const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]); this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w; this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w; this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w; return this; }
  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy; this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz; this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx; return this;
  }
  applyAxisAngle(axis, angle) { return this.applyQuaternion(new Quaternion().setFromAxisAngle(axis, angle)); }
  setFromMatrixPosition(m) { const e = m.elements; this.x = e[12]; this.y = e[13]; this.z = e[14]; return this; }
  fromBufferAttribute(a, i) { this.x = a.getX(i); this.y = a.getY(i); this.z = a.getZ(i); return this; }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  normalize() { let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w); if (l === 0) { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } else { l = 1 / l; this.x *= l; this.y *= l; this.z *= l; this.w *= l; } return this; }
  multiplyQuaternions(a, b) {
    const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w, qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby; this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx; this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz; return this;
  }
  multiply(q) { return this.multiplyQuaternions(this, q); }
  premultiply(q) { return this.multiplyQuaternions(q, this); }
  setFromAxisAngle(axis, angle) { const h = angle / 2, s = Math.sin(h); this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(h); return this; }
  setFromEuler(e) {
    const x = e.x, y = e.y, z = e.z, c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    if (e.order !== 'XYZ') throw new Error('shim: Euler order ' + e.order);
    this.x = s1 * c2 * c3 + c1 * s2 * s3; this.y = c1 * s2 * c3 - s1 * c2 * s3; this.z = c1 * c2 * s3 + s1 * s2 * c3; this.w = c1 * c2 * c3 - s1 * s2 * s3; return this;
  }
  setFromRotationMatrix(m) {
    const te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10], trace = m11 + m22 + m33;
    if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1.0); this.w = 0.25 / s; this.x = (m32 - m23) * s; this.y = (m13 - m31) * s; this.z = (m21 - m12) * s; }
    else if (m11 > m22 && m11 > m33) { const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33); this.w = (m32 - m23) / s; this.x = 0.25 * s; this.y = (m12 + m21) / s; this.z = (m13 + m31) / s; }
    else if (m22 > m33) { const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33); this.w = (m13 - m31) / s; this.x = (m12 + m21) / s; this.y = 0.25 * s; this.z = (m23 + m32) / s; }
    else { const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22); this.w = (m21 - m12) / s; this.x = (m13 + m31) / s; this.y = (m23 + m32) / s; this.z = 0.25 * s; }
    return this;
  }
  setFromUnitVectors(a, b) {
    let r = a.dot(b) + 1;
    if (r < EPS) { r = 0; if (Math.abs(a.x) > Math.abs(a.z)) { this.x = -a.y; this.y = a.x; this.z = 0; this.w = r; } else { this.x = 0; this.y = -a.z; this.z = a.y; this.w = r; } }
    else { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; this.w = r; }
    return this.normalize();
  }
}

export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this._x = x; this._y = y; this._z = z; this.order = order; this._cb = null; }
  get x() { return this._x; } set x(v) { this._x = v; this._cb && this._cb(); }
  get y() { return this._y; } set y(v) { this._y = v; this._cb && this._cb(); }
  get z() { return this._z; } set z(v) { this._z = v; this._cb && this._cb(); }
  set(x, y, z, order = this.order) { this._x = x; this._y = y; this._z = z; this.order = order; this._cb && this._cb(); return this; }
}

export class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  identity() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; return this; }
  copy(m) { this.elements = m.elements.slice(); return this; }
  clone() { return new Matrix4().copy(this); }
  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) { const te = this.elements; te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14; te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24; te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34; te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44; return this; }
  makeBasis(x, y, z) { return this.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1); }
  makeTranslation(x, y, z) { return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1); }
  setPosition(x, y, z) { const te = this.elements; if (x.isVector3 || (x.x !== undefined)) { te[12] = x.x; te[13] = x.y; te[14] = x.z; } else { te[12] = x; te[13] = y; te[14] = z; } return this; }
  multiplyMatrices(a, b) { const ae = a.elements, be = b.elements, r = new Array(16); for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) { let s = 0; for (let k = 0; k < 4; k++) s += ae[k * 4 + row] * be[c * 4 + k]; r[c * 4 + row] = s; } this.elements = r; return this; }
  multiply(m) { return this.multiplyMatrices(this, m); }
  premultiply(m) { return this.multiplyMatrices(m, this); }
  compose(p, q, s) {
    const te = this.elements, x = q.x, y = q.y, z = q.z, w = q.w, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, sx = s.x, sy = s.y, sz = s.z;
    te[0] = (1 - (yy + zz)) * sx; te[1] = (xy + wz) * sx; te[2] = (xz - wy) * sx; te[3] = 0; te[4] = (xy - wz) * sy; te[5] = (1 - (xx + zz)) * sy; te[6] = (yz + wx) * sy; te[7] = 0;
    te[8] = (xz + wy) * sz; te[9] = (yz - wx) * sz; te[10] = (1 - (xx + yy)) * sz; te[11] = 0; te[12] = p.x; te[13] = p.y; te[14] = p.z; te[15] = 1; return this;
  }
  determinant() {
    const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7], n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) + n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) + n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
  }
  invert() {
    const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7], n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44, t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44,
      t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44, t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14; if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const d = 1 / det;
    te[0] = t11 * d; te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d; te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d; te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
    te[4] = t12 * d; te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d; te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d; te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
    te[8] = t13 * d; te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d; te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d; te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
    te[12] = t14 * d; te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d; te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d; te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
    return this;
  }
  decompose(position, quaternion, scale) {
    const te = this.elements; let sx = Math.hypot(te[0], te[1], te[2]); const sy = Math.hypot(te[4], te[5], te[6]), sz = Math.hypot(te[8], te[9], te[10]);
    if (this.determinant() < 0) sx = -sx;
    position.x = te[12]; position.y = te[13]; position.z = te[14];
    const m = this.clone(), e = m.elements; e[0] /= sx; e[1] /= sx; e[2] /= sx; e[4] /= sy; e[5] /= sy; e[6] /= sy; e[8] /= sz; e[9] /= sz; e[10] /= sz;
    quaternion.setFromRotationMatrix(m); scale.x = sx; scale.y = sy; scale.z = sz; return this;
  }
}

const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _m = new Matrix4();
export class Object3D {
  constructor() {
    this.name = ''; this.parent = null; this.children = []; this.position = new Vector3(); this.quaternion = new Quaternion(); this.scale = new Vector3(1, 1, 1);
    this.rotation = new Euler(); this.rotation._cb = () => this.quaternion.setFromEuler(this.rotation);
    this.matrix = new Matrix4(); this.matrixWorld = new Matrix4(); this.matrixAutoUpdate = true; this.matrixWorldNeedsUpdate = false; this.visible = true; this.userData = {}; this.frustumCulled = true; this.renderOrder = 0;
  }
  add(o) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) { o.parent = null; this.children.splice(i, 1); } return this; }
  updateMatrix() { this.matrix.compose(this.position, this.quaternion, this.scale); this.matrixWorldNeedsUpdate = true; }
  updateMatrixWorld(force) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) { if (this.parent === null) this.matrixWorld.copy(this.matrix); else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); this.matrixWorldNeedsUpdate = false; force = true; }
    for (const c of this.children) c.updateMatrixWorld(force);
  }
  updateWorldMatrix(updateParents, updateChildren) {
    if (updateParents && this.parent !== null) this.parent.updateWorldMatrix(true, false);
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.parent === null) this.matrixWorld.copy(this.matrix); else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    if (updateChildren) for (const c of this.children) c.updateWorldMatrix(false, true);
  }
  getWorldPosition(t) { this.updateWorldMatrix(true, false); return t.setFromMatrixPosition(this.matrixWorld); }
  getWorldQuaternion(t) { this.updateWorldMatrix(true, false); this.matrixWorld.decompose(_p, t, _s); return t; }
  worldToLocal(v) { this.updateWorldMatrix(true, false); return v.applyMatrix4(_m.copy(this.matrixWorld).invert()); }
  traverse(cb) { cb(this); for (const c of this.children) c.traverse(cb); }
}
export class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
export class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }

export class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } getZ(i) { return this.array[i * this.itemSize + 2]; } setXYZ(i, x, y, z) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; return this; } }
export class BufferGeometry { constructor() { this.attributes = {}; this.index = null; this.boundingBox = null; } setAttribute(n, a) { this.attributes[n] = a; return this; } setIndex(a) { this.index = a; return this; } computeBoundingBox() { return this; } dispose() { } }
const emptyAttr = () => new BufferAttribute(new Float32Array(0), 3);
export class BoxGeometry extends BufferGeometry { constructor(w, h, d) { super(); this.parameters = { width: w, height: h, depth: d }; this.attributes = { position: emptyAttr(), normal: emptyAttr() }; this.boundingBox = new Box3(new Vector3(-w / 2, -h / 2, -d / 2), new Vector3(w / 2, h / 2, d / 2)); } }
export class CylinderGeometry extends BufferGeometry { constructor(rt, rb, h) { super(); this.parameters = { radiusTop: rt, radiusBottom: rb, height: h }; this.attributes = { position: emptyAttr(), normal: emptyAttr() }; const r = Math.max(rt, rb); this.boundingBox = new Box3(new Vector3(-r, -h / 2, -r), new Vector3(r, h / 2, r)); } }

export class Box3 {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) { this.min = min; this.max = max; }
  copy(b) { this.min.copy(b.min); this.max.copy(b.max); return this; }
  applyMatrix4(m) { const b = this.clone(), pts = []; for (let i = 0; i < 8; i++) pts.push(new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m)); this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); for (const p of pts) { this.min.set(Math.min(this.min.x, p.x), Math.min(this.min.y, p.y), Math.min(this.min.z, p.z)); this.max.set(Math.max(this.max.x, p.x), Math.max(this.max.y, p.y), Math.max(this.max.z, p.z)); } return this; }
  clone() { return new Box3(this.min.clone(), this.max.clone()); }
  expandByScalar(s) { this.min.x -= s; this.min.y -= s; this.min.z -= s; this.max.x += s; this.max.y += s; this.max.z += s; return this; }
  expandByPoint(p) { this.min.set(Math.min(this.min.x, p.x), Math.min(this.min.y, p.y), Math.min(this.min.z, p.z)); this.max.set(Math.max(this.max.x, p.x), Math.max(this.max.y, p.y), Math.max(this.max.z, p.z)); return this; }
  setFromObject(o) { o.updateWorldMatrix(false, false); this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); const rec = (obj) => { if (obj.geometry && obj.geometry.boundingBox) { obj.updateWorldMatrix(false, false); const b = obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld); this.expandByPoint(b.min); this.expandByPoint(b.max); } for (const c of obj.children) rec(c); }; rec(o); return this; }
}

export class Color { constructor(c) { this.r = 0.5; this.g = 0.5; this.b = 0.5; this.hex = c; } clone() { const k = new Color(this.hex); k.r = this.r; k.g = this.g; k.b = this.b; return k; } multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; } lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; } }
export class MeshStandardMaterial { constructor(p = {}) { Object.assign(this, p); } clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); } dispose() { } }
export class MeshBasicMaterial extends MeshStandardMaterial { }
export const REVISION = '147';
export const sRGBEncoding = 3001, LinearEncoding = 3000, ACESFilmicToneMapping = 4, BackSide = 1;
