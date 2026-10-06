// Small vector / 3x3 matrix / quaternion helpers (row-major 3x3 as [9]).
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mid = (a, b) => lerp(a, b, 0.5);
export const D2R = Math.PI / 180;

export const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
export const mm = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
export const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
// matrix from columns
export const cols = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
export const col = (M, j) => [M[j], M[3 + j], M[6 + j]];
// rotation about a unit axis by angle (radians)
export function axisAngle(a, t) {
  const [x, y, z] = norm(a), c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
// minimal rotation taking unit a to unit b
export function fromTo(a, b) {
  a = norm(a); b = norm(b);
  const c = dot(a, b);
  if (c > 1 - 1e-12) return I3();
  if (c < -1 + 1e-12) { const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; return axisAngle(norm(cross(a, p)), Math.PI); }
  return axisAngle(norm(cross(a, b)), Math.acos(Math.max(-1, Math.min(1, c))));
}
// orthonormal frame from a primary and a secondary direction (columns e1 = p, e2 = s orthogonalised, e3 = e1 x e2)
export function frame2(p, s) { const e1 = norm(p); const e2 = norm(sub(s, mul(e1, dot(s, e1)))); return [e1, e2, cross(e1, e2)]; }
// rotation R with R a1 = b1 (exactly) and R a2 ~ b2 (in the plane)
export function align2(a1, a2, b1, b2) {
  const A = frame2(a1, a2), B = frame2(b1, b2);
  return mm(cols(...B), tr(cols(...A)));
}
export function quatFromMat(m) { // [x, y, z, w]
  const t = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); w = 0.25 / s; x = (m[7] - m[5]) * s; y = (m[2] - m[6]) * s; z = (m[3] - m[1]) * s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]); w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]); w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s; }
  else { const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]); w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l];
}
export const deg = (r) => r / D2R;
export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));
// circle through three points: centre and radius
export function circle3(a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac), n2 = dot(n, n);
  const t = add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab)));
  const cen = add(a, mul(t, 1 / (2 * n2)));
  return { c: cen, r: len(sub(a, cen)), n: norm(n) };
}
