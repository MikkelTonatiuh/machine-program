// Joint close-ups (groin, armpit, knee, elbow) of the four preview exercises, current body and MPFB body, with the app's skin
// shading emulated and no machine in the way (software render; the pose, skin and glow are the engine's own).
// The camera is worked out once from the MPFB body's skeleton and used for both bodies: a knee or an elbow is seen in profile
// (along the normal of the plane it bends in; a nearly straight arm from the front), the armpit from the front three-quarter,
// the groin from the side; the working limb (the arm whose hand reaches farthest, the leg whose foot does), from outside.
//   node tools/sim_joints.mjs [out dir] [size]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScene, engineTile, skinPose } from './engine_sim.mjs';
import { savePNG } from './engine_shade.mjs';
import { HERE } from './paths.mjs';

const out = join(HERE, process.argv[2] || 'out/joints'), size = +(process.argv[3] || 420);
mkdirSync(out, { recursive: true });
const opts = { texPng: join(HERE, 'out/figure/nrm.png'), normalScale: 1.6, knee: 0.17, keep: 0.45, machine: false };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), nrm = (a) => mul(a, 1 / (len(a) || 1));
const perp = (d, a) => nrm(sub(d, mul(a, dot(d, a)))); // d without its part along a

// [exercise, phase ('0' = stretch, 'peak' = contraction), joint, span m]
const SPECS = [
  ['chest_press', '0', 'armpit', 0.5], ['chest_press', '0', 'elbow', 0.4],
  ['leg_press', '0', 'groin', 0.6], ['leg_press', '0', 'knee', 0.5],
  ['lateral_raise', 'peak', 'armpit', 0.5], ['lateral_raise', 'peak', 'elbow', 0.4],
  ['hip_thrust', 'peak', 'groin', 0.6], ['hip_thrust', '0', 'knee', 0.5],
];
const meta = [], scenes = {};
// everything the camera needs, from one scene at one phase (figure space)
function viewFor(S, t, joint, span) {
  skinPose(S, t);
  const B = (n) => S.inst.skel.bones[n].obj;
  const toFig = (v) => { S.inst.group.updateMatrixWorld(true); const q = S.inst.group.worldToLocal(v); return [q.x, q.y, q.z]; }; // bones live in the yawed world, the skin in figure space
  const P = (n) => { B(n).updateMatrixWorld(true); return toFig(B(n).getWorldPosition(new globalThis.THREE.Vector3())); };
  const LM = (n) => { const [bn, at] = S.D.rig.landmarks[n]; return toFig(S.inst.skel.world(bn, at, new globalThis.THREE.Vector3())); };
  const lat = nrm(sub(P('thigh_r'), P('thigh_l'))); // from the left side to the right
  let fwd = nrm(sub(LM('chest_front'), LM('thorax_back'))); fwd = nrm(sub(fwd, mul(lat, dot(fwd, lat))));
  const upB = nrm(sub(P('neck'), P('pelvis')));
  const reach = (a, b) => len(sub(P(a), P(b)));
  const side = joint === 'armpit' || joint === 'elbow' ? (reach('hand_l', 'thorax') >= reach('hand_r', 'thorax') ? 'l' : 'r') : (reach('foot_l', 'pelvis') >= reach('foot_r', 'pelvis') ? 'l' : 'r');
  const outS = mul(lat, side === 'l' ? -1 : 1), sd = '_' + side; // out of that side
  const sideOf = (n) => (dot(n, outS) >= 0 ? n : mul(n, -1));
  const bendOf = (a, b, c) => { const u1 = sub(P(b), P(a)), u2 = sub(P(c), P(b)); return { n: cross(u1, u2), ang: Math.acos(Math.max(-1, Math.min(1, dot(nrm(u1), nrm(u2))))) * 180 / Math.PI, u1: nrm(u1) }; };
  let c, d;
  if (joint === 'armpit') {
    c = add(P('arm' + sd), mul(sub(P('thorax'), P('arm' + sd)), 0.2)); c = add(c, mul(upB, -0.03));
    d = nrm(add(add(mul(fwd, 0.8), mul(outS, 0.5)), mul(upB, 0.12)));
  } else if (joint === 'elbow') {
    c = P('fore' + sd); const b = bendOf('arm' + sd, 'fore' + sd, 'hand' + sd);
    d = b.ang > 30 ? sideOf(nrm(b.n)) : perp(add(add(mul(fwd, 0.8), mul(outS, 0.4)), mul(upB, 0.15)), b.u1);
  } else if (joint === 'knee') {
    c = P('shank' + sd); const b = bendOf('thigh' + sd, 'shank' + sd, 'foot' + sd);
    d = b.ang > 30 ? sideOf(nrm(b.n)) : outS;
  } else { // groin: the hip from outside, the crease where thigh meets belly
    c = add(P('thigh' + sd), mul(fwd, 0.04));
    const b = bendOf('thorax', 'thigh' + sd, 'shank' + sd);
    d = b.ang > 30 ? sideOf(nrm(b.n)) : outS;
    d = nrm(add(d, mul(fwd, 0.25)));
  }
  const az = Math.atan2(d[0], d[2]) * 180 / Math.PI, el = Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180 / Math.PI;
  return { az, el, center: c, span, side };
}
for (const [ex, ph, joint, span] of SPECS) {
  const Ss = scenes[ex] || (scenes[ex] = { sdf: makeScene(ex, { body: 'sdf' }), mpfb: makeScene(ex, { body: 'mpfb' }) });
  const t = ph === 'peak' ? Ss.mpfb.inst.motion.peak : 0, V = viewFor(Ss.mpfb, t, joint, span);
  for (const body of ['sdf', 'mpfb']) {
    const S = Ss[body], tt = ph === 'peak' ? S.inst.motion.peak : 0;
    const img = engineTile(S, tt, { az: V.az, el: V.el, center: V.center, span }, size, { ...opts, yawDeg: -V.az }); // lights stay where the stage has them relative to the camera
    const f = `${ex}_${joint}_${body}.png`;
    savePNG(join(out, f), size, img);
    meta.push({ ex, phase: ph, joint, body, file: f, az: V.az, el: V.el, span, side: V.side });
  }
  console.log(ex, joint, V.side, V.az.toFixed(0), V.el.toFixed(0));
}
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
