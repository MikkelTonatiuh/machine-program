// Loop timing: frame = pure function of loop phase in [0, 1).
//  - rep mode: a timeline of segments (concentric / hold / eccentric / pause). Move segments interpolate between
//    named key poses, optionally through intermediate keys ("via") with a monotone cubic in the eased parameter.
//  - cycle mode (bike): a crank dof advances at constant angular velocity; poses are keyed by crank angle.
// Activation follows the brief: primary 0.55 at stretch -> 1.0 in concentric and hold -> 0.8 in eccentric,
// secondary = 0.5x, with ~200 ms ramps (never a flash).
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const { clamp, sstep, EASE, monotone, sideOf, mirId } = MCE.util;
  const RAMP = 0.2; // s

  // merge pose dictionaries: { bone: {param: v} }, later wins per param
  function mergePose(...ps) {
    const out = {};
    for (const p of ps) if (p) for (const [k, v] of Object.entries(p)) {
      if (k === 'root') { out.root = v.slice(); continue; }
      out[k] = { ...(out[k] || {}), ...v };
    }
    return out;
  }
  // _l entries apply to _r as well unless _r is given explicitly (unilateral exercises author _r keys)
  function mirrorPose(p, enabled = true) {
    const out = {};
    for (const [k, v] of Object.entries(p)) out[k] = k === 'root' ? v : { ...v };
    if (!enabled) return out;
    for (const [k, v] of Object.entries(p)) if (k !== 'm' && k !== 'root' && sideOf(k) === 1) { const r = mirId(k); if (!p[r]) out[r] = { ...v }; }
    return out;
  }
  // flatten a pose to a list of [bone, param] channels (union over several poses)
  function channels(poses) {
    const set = new Map();
    for (const p of poses) for (const [k, v] of Object.entries(p)) {
      if (k === 'root') { for (let i = 0; i < 3; i++) set.set('root|' + i, ['root', i]); continue; }
      for (const d of Object.keys(v)) set.set(k + '|' + d, [k, d]);
    }
    return [...set.values()];
  }
  const getv = (p, [k, d]) => (k === 'root' ? (p.root ? p.root[d] : undefined) : p[k] ? p[k][d] : undefined);

  class Motion {
    // ex: exercise json. rootDefault: [x,y,z] (H units).
    constructor(ex) {
      const M = ex.motion || {};
      this.mode = M.mode || 'rep';
      const mir = M.mirror !== false;
      const base = M.base || {};
      this.keys = {};
      for (const [id, k] of Object.entries(M.keys || {})) this.keys[id] = mirrorPose(mergePose(base, k), mir);
      if (!this.keys.A) this.keys.A = mirrorPose(mergePose(base), mir);
      this.root = M.root || [0, 0.53, 0];
      if (this.mode === 'cycle') this._initCycle(M); else this._initRep(M);
      this.chan = channels(Object.values(this.keys));
    }
    _initRep(M) {
      let segs = M.timeline;
      if (!segs) { // default: A (stretched) -> B (contracted) with the brief's tempo (lift, top hold, lower, stretch pause;
        // the default is the compound tempo, BRIEF section 2)
        const [c, h, e, p] = M.tempo || [1.0, 0.2, 2.5, 0.5];
        segs = [{ phase: 'con', from: 'A', to: 'B', dur: c }, { phase: 'hold', at: 'B', dur: h }, { phase: 'ecc', from: 'B', to: 'A', dur: e }, { phase: 'pause', at: 'A', dur: p }];
      }
      let t = 0;
      this.segs = segs.filter((s) => s.dur > 0).map((s) => {
        const o = { ...s, t0: t, t1: t + s.dur }; t += s.dur;
        if (s.phase === 'hold' || s.phase === 'pause') { o.kind = 'hold'; o.at = s.at || s.to || s.from; }
        else {
          o.kind = 'move';
          o.path = [s.from, ...(s.via || []), s.to];
          o.knots = s.at && s.at.length === o.path.length ? s.at.slice() : o.path.map((_, i) => i / (o.path.length - 1));
          o.ease = EASE[s.ease || (s.phase === 'ecc' ? 'ecc' : 'con')] || EASE.con;
        }
        return o;
      });
      this.duration = t;
      // group consecutive segments of the same phase type (for activation ramps)
      for (let i = 0; i < this.segs.length; i++) {
        const s = this.segs[i]; let a = i, b = i;
        while (a > 0 && this.segs[a - 1].phase === s.phase) a--;
        while (b < this.segs.length - 1 && this.segs[b + 1].phase === s.phase) b++;
        s.g0 = this.segs[a].t0; s.g1 = this.segs[b].t1;
      }
      // peak = middle of the first hold after a concentric (or middle of the loop if none)
      const hold = this.segs.find((s) => s.phase === 'hold');
      this.peak = hold ? (hold.t0 + hold.t1) / 2 / this.duration : 0.5;
      this.still = this.phaseOf(M.still);
      // interpolators per move segment (lazily built per channel)
      this._interp = new Map();
    }
    // A frame named by an exercise (motion.still, motion.bind) as a loop phase: the peak for null / 'peak', a loop phase
    // (0..1) as it is, or { phase: 'con' | 'hold' | 'ecc' | 'pause', at: 0..1 } = that fraction of the way through the
    // phase's time (the first run of segments of that phase), which names the same pose whatever the tempo.
    // The reduced-motion still (the frame shown paused under prefers-reduced-motion) is the peak unless the exercise names
    // a frame where its working muscle reads better.
    phaseOf(s) {
      if (s == null || s === 'peak') return this.peak;
      if (typeof s === 'number') return ((s % 1) + 1) % 1;
      const seg = this.segs && this.segs.find((x) => x.phase === s.phase);
      if (!seg) { console.warn('MCE: motion.still names no ' + s.phase + ' phase; using the peak'); return this.peak; }
      return (seg.g0 + clamp(+s.at || 0, 0, 1) * (seg.g1 - seg.g0)) / this.duration;
    }
    _initCycle(M) {
      this.duration = M.period * (M.revs || 1);
      this.revs = M.revs || 1;
      this.dof = M.dof || 'crank';
      this.offset = M.offset || 0;
      this.peak = 0.25 / this.revs; // crank at 90 deg: the power phase of the left leg
      this.still = typeof M.still === 'number' ? ((M.still % 1) + 1) % 1 : this.peak;
      this.cycleKeys = (M.crankPose || []).slice().sort((a, b) => a.deg - b.deg); // [{ deg, pose }] crank-keyed channels
      this.cycleAct = M.activation || {};
    }
    // named phases for verification renders
    namedPhases() {
      if (this.mode === 'cycle') return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `crank ${i * 45}`, t: i / 8 / this.revs }));
      const D = this.duration, out = [];
      const con = this.segs.filter((s) => s.phase === 'con'), ecc = this.segs.filter((s) => s.phase === 'ecc');
      const c0 = con.length ? con[0].t0 : 0, c1 = con.length ? con[con.length - 1].t1 : 0;
      const e0 = ecc.length ? ecc[0].t0 : 0.5 * D, e1 = ecc.length ? ecc[ecc.length - 1].t1 : D;
      const pause = this.segs.find((s) => s.phase === 'pause');
      out.push({ name: 'start', t: 0 });
      out.push({ name: 'concentric 40%', t: (c0 + 0.4 * (c1 - c0)) / D });
      out.push({ name: 'concentric 75%', t: (c0 + 0.75 * (c1 - c0)) / D });
      out.push({ name: 'peak', t: this.peak });
      out.push({ name: 'eccentric 25%', t: (e0 + 0.25 * (e1 - e0)) / D });
      out.push({ name: 'eccentric 50%', t: (e0 + 0.5 * (e1 - e0)) / D });
      out.push({ name: 'eccentric 80%', t: (e0 + 0.8 * (e1 - e0)) / D });
      out.push({ name: 'pause', t: pause ? (pause.t0 + pause.t1) / 2 / D : 0.98 });
      return out;
    }
    _segInterp(seg, ch) {
      const key = seg.t0 + '|' + ch[0] + '|' + ch[1];
      let f = this._interp.get(key);
      if (!f) {
        const ys = seg.path.map((k) => { const p = this.keys[k]; if (!p) throw new Error('motion: unknown key ' + k); return getv(p, ch); });
        // channels missing in some keys inherit from the nearest key that has them (or 0)
        const known = ys.map((y) => y !== undefined);
        for (let i = 0; i < ys.length; i++) if (!known[i]) { let j = i; while (j >= 0 && !known[j]) j--; if (j < 0) { j = i; while (j < ys.length && !known[j]) j++; } ys[i] = j >= 0 && j < ys.length ? ys[j] : 0; }
        f = monotone(seg.knots, ys); this._interp.set(key, f);
      }
      return f;
    }
    // -> { pose, s (0 stretched .. 1 contracted, rep mode), seg, act: primary activation, crank (deg, cycle mode) }
    sample(phase) {
      const ph = ((phase % 1) + 1) % 1;
      if (this.mode === 'cycle') {
        const deg = (ph * 360 * this.revs + this.offset) % 360;
        const pose = JSON.parse(JSON.stringify(this.keys.A));
        pose.m = { ...(pose.m || {}), [this.dof]: deg };
        // crank-keyed pose channels (e.g. ankling): periodic cosine blend between keys; _r channels run 180 deg behind
        if (this.cycleKeys.length) {
          const K = this.cycleKeys;
          const valAt = (bone, prm, a) => {
            a = ((a % 360) + 360) % 360;
            let i = K.length - 1; for (let j = 0; j < K.length; j++) if (K[j].deg <= a) i = j;
            const k0 = K[i], k1 = K[(i + 1) % K.length], span = ((k1.deg - k0.deg) + 360) % 360 || 360;
            const t = (((a - k0.deg) + 360) % 360) / span, e = 0.5 - 0.5 * Math.cos(Math.PI * t);
            const v0 = (k0.pose[bone] || {})[prm], v1 = (k1.pose[bone] || {})[prm];
            return v0 == null ? v1 : v1 == null ? v0 : v0 + (v1 - v0) * e;
          };
          const chans = new Set(); for (const k of K) for (const [b, v] of Object.entries(k.pose)) for (const prm of Object.keys(v)) chans.add(b + '|' + prm);
          for (const c of chans) {
            const [b, prm] = c.split('|');
            (pose[b] = pose[b] || {})[prm] = valAt(b, prm, deg);
            if (sideOf(b) === 1) (pose[mirId(b)] = pose[mirId(b)] || {})[prm] = valAt(b, prm, deg + 180);
          }
        }
        return { pose, s: 0.5, crank: deg, act: 1, phase: 'cycle' };
      }
      const t = ph * this.duration;
      let seg = this.segs[this.segs.length - 1];
      for (const s of this.segs) if (t < s.t1) { seg = s; break; }
      const pose = {};
      let sv = 0;
      if (seg.kind === 'hold') {
        const p = this.keys[seg.at];
        for (const ch of this.chan) { const v = getv(p, ch); if (v === undefined) continue; if (ch[0] === 'root') { pose.root = pose.root || this.root.slice(); pose.root[ch[1]] = v; } else (pose[ch[0]] = pose[ch[0]] || {})[ch[1]] = v; }
        sv = seg.phase === 'hold' ? 1 : 0;
      } else {
        const x = clamp((t - seg.t0) / (seg.t1 - seg.t0)), e = seg.ease(x);
        for (const ch of this.chan) {
          const v = this._segInterp(seg, ch)(e);
          if (ch[0] === 'root') { pose.root = pose.root || this.root.slice(); pose.root[ch[1]] = v; } else (pose[ch[0]] = pose[ch[0]] || {})[ch[1]] = v;
        }
        sv = seg.phase === 'ecc' ? 1 - e : e;
      }
      return { pose, s: sv, seg, act: this.activation(t, seg), phase: seg.phase };
    }
    // primary activation at loop time t (s)
    activation(t, seg) {
      const a = t - seg.g0, b = seg.g1 - t;
      switch (seg.phase) {
        case 'con': return 0.55 + 0.45 * sstep(0, RAMP, a);
        case 'hold': return 1.0;
        case 'ecc': return 0.8 + 0.2 * (1 - sstep(0, RAMP, a)) - 0.25 * sstep(RAMP, 0, b);
        default: return 0.55;
      }
    }
    // cycle mode: activation of a muscle whose peak is at crank angle `peakDeg` for the given side (left leads by 0, right by 180)
    cycleActivation(crankDeg, peakDeg, side) {
      const th = (crankDeg + (side < 0 ? 180 : 0) - peakDeg) * Math.PI / 180;
      return 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos(th), 1.5);
    }
  }
  MCE.Motion = Motion;
  MCE.mergePose = mergePose;
})(typeof window !== 'undefined' ? window : globalThis);
