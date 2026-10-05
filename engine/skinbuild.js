// Skin builder: one implicit body (anatomical ellipsoids / round cones on bones, smooth-unioned per bone and across
// joints with blends localised around each joint), machine pads carving contact flats, polygonised with surface nets
// on a three-level narrow band, Newton-projected, SDF normals, SDF ambient occlusion (pads included as occluders),
// soft skin weights for GPU dual-quaternion skinning, and the painted working-muscle map.
//
// This file defines ONE pure function factory (MCE_SKIN_MODULE) with no DOM / three.js dependency. The stage runs it
// inside a Web Worker created from a blob: URL (the factory's source text), or on the main thread as a fallback.
(function (g) {
  'use strict';
  function MCE_SKIN_MODULE() {
    const BIG = 1e9;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
    const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
    // surface fairing (see buildSkinGen): tangential relaxation passes, normal low-pass passes, ambient occlusion passes
    const FAIR_RELAX = 2, FAIR_N = 2, AO_SMOOTH = 3;

    // The body field of a job (also used on its own by tools that sample the sculpture, e.g. tools/body_field.mjs).
    function makeField(J) {
      const H = J.H, NB = J.nb;
      const PT = J.PT, PB = J.PB, PM = J.PM, PP = J.PP, PS = J.PS, PKS = J.PKS, NP = PT.length, NBODY = J.nBody;
      const PA = J.PA, PC = J.PC, PRK = J.PRK, PRR = J.PRR, PTAU = J.PTAU, PX = J.PX, NPR = PA.length;
      const ST = J.steps, NST = ST.length / 3, ROOT = J.rootSlot;
      const KC = J.kc * H;
      const own = new Float64Array(NB), slot = new Float64Array(NB);
      // blend reach of each primitive (for block culling). A body primitive with a negative blend (body.json k < 0) is
      // surface relief on the finished body: -1 < k < 0 is a GROOVE pressing the surface in by up to |k| inside the
      // primitive, k <= -1 a RIDGE raising it by |k| - 1. The profile is a smoothstep from the primitive's outline to its
      // core: a cone's start radius or the smallest radius / half-size of an ellipsoid or box sets the width, so a rounded
      // box keeps a flat top inside its rounded rim (the abdominal pads). Relief therefore only needs to lie across the
      // surface, not exactly on it (tools/body_src.mjs snaps it on). Overlapping relief of one kind (a chain of segments,
      // a crossing) combines by its maximum, not its sum.
      const PK = new Float64Array(NP), CARVE = new Uint8Array(NP), GD = new Float64Array(NP), GW = new Float64Array(NP);
      for (let i = 0; i < NP; i++) {
        if (PB[i] >= 0 && PKS[i] < 0) {
          const kk = -PKS[i] / H;
          CARVE[i] = 1; GD[i] = (kk >= 1 ? -(kk - 1) : kk) * H; PK[i] = 0;
          GW[i] = PT[i] === 1 ? PP[i * 8] : Math.min(PP[i * 8], PP[i * 8 + 1], PP[i * 8 + 2]);
          continue;
        }
        let k = PB[i] >= 0 ? PKS[i] : 0.004 * H;
        if (PB[i] >= 0) for (let q = 0; q < NPR; q++) if (PA[q] === PB[i] || PC[q] === PB[i]) k = Math.max(k, PRK[q]);
        PK[i] = k;
      }
      function evalPrim(i, x, y, z) {
        const o = i * 12, p = i * 8;
        const lx = PM[o] * x + PM[o + 1] * y + PM[o + 2] * z + PM[o + 3];
        const ly = PM[o + 4] * x + PM[o + 5] * y + PM[o + 6] * z + PM[o + 7];
        const lz = PM[o + 8] * x + PM[o + 9] * y + PM[o + 10] * z + PM[o + 11];
        switch (PT[i]) {
          case 0: { // ellipsoid (Quilez bound-corrected)
            const rx = PP[p], ry = PP[p + 1], rz = PP[p + 2], ax = lx / rx, ay = ly / ry, az = lz / rz;
            const k0 = Math.sqrt(ax * ax + ay * ay + az * az), bx = ax / rx, by = ay / ry, bz = az / rz, k1 = Math.sqrt(bx * bx + by * by + bz * bz);
            return k1 < 1e-12 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
          }
          case 1: { // round cone along local +Y (elliptical section via sx, sz)
            const ra = PP[p], rb = PP[p + 1], h = PP[p + 2], sx = PP[p + 3], sz = PP[p + 4], cb = PP[p + 5], ca = PP[p + 6];
            const qx = Math.sqrt((lx / sx) * (lx / sx) + (lz / sz) * (lz / sz)), qy = ly, k = -cb * qx + ca * qy;
            if (k < 0) return Math.sqrt(qx * qx + qy * qy) - ra;
            if (k > ca * h) return Math.sqrt(qx * qx + (qy - h) * (qy - h)) - rb;
            return qx * ca + qy * cb - ra;
          }
          case 2: { // rounded box (machine pad)
            const rr = PP[p + 3], qx = Math.abs(lx) - PP[p] + rr, qy = Math.abs(ly) - PP[p + 1] + rr, qz = Math.abs(lz) - PP[p + 2] + rr;
            const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
            return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - rr;
          }
          default: { // capped cylinder along local Y (machine pad roller)
            const dx = Math.sqrt(lx * lx + lz * lz) - PP[p], dy = Math.abs(ly) - PP[p + 1];
            const mx = dx > 0 ? dx : 0, my = dy > 0 ? dy : 0;
            return Math.min(Math.max(dx, dy), 0) + Math.sqrt(mx * mx + my * my);
          }
        }
      }
      // body field: per-bone smooth union, then the union program (limbs folded distal -> proximal, blends localised
      // around each joint), then pads carved out (smooth subtraction). Fills own[] with the per-bone fields.
      function sdf(x, y, z, L) {
        for (let b = 0; b < NB; b++) own[b] = BIG;
        for (let n = 0; n < L.length; n++) {
          const i = L[n], b = PB[i]; if (b < 0) continue;
          const d = evalPrim(i, x, y, z), cur = own[b];
          if (CARVE[i]) continue; // carves apply to the finished body (below)
          own[b] = cur >= BIG ? d : smin(cur, d, PKS[i]);
        }
        for (let b = 0; b < NB; b++) slot[b] = own[b];
        for (let s = 0; s < NST; s++) {
          const into = ST[s * 3], from = ST[s * 3 + 1], q = ST[s * 3 + 2];
          const a = slot[into], b = slot[from];
          if (b >= BIG) continue; if (a >= BIG) { slot[into] = b; continue; }
          const dx = x - PX[q * 3], dy = y - PX[q * 3 + 1], dz = z - PX[q * 3 + 2], R = PRR[q];
          let w = (R - Math.sqrt(dx * dx + dy * dy + dz * dz)) / (0.55 * R);
          if (w <= 0) { slot[into] = a < b ? a : b; continue; }
          if (w > 1) w = 1;
          slot[into] = smin(a, b, PRK[q] * w * w * (3 - 2 * w));
        }
        let D = slot[ROOT];
        // grooves (body primitives with a negative blend) press the finished surface in, whichever bone's mass forms it
        // there; the per-bone fields used for skin weights and muscle snapping stay as sculpted
        // (relief is shallow, at most a few millimetres, so a limb pressed against a relief line in a deep pose is barely
        // touched; restricting it to its bone's own surface cut it off abruptly where bone ownership changes)
        let gIn = 0, gOut = 0;
        for (let n = 0; n < L.length; n++) {
          const i = L[n]; if (!CARVE[i]) continue;
          const e = evalPrim(i, x, y, z); if (e >= 0) continue;
          const t = -e < GW[i] ? -e / GW[i] : 1, g = GD[i] * t * t * (3 - 2 * t);
          if (g > gIn) gIn = g; else if (-g > gOut) gOut = -g;
        }
        D += gIn - gOut;
        for (let n = 0; n < L.length; n++) { const i = L[n]; if (PB[i] >= 0) continue; D = -smin(-D, evalPrim(i, x, y, z), KC); }
        return D;
      }
      // distance to the nearest occluder (body or pad) for ambient occlusion
      function occDist(x, y, z, L) {
        let D = sdf(x, y, z, L);
        for (let n = 0; n < L.length; n++) { const i = L[n]; if (PB[i] >= 0) continue; const e = evalPrim(i, x, y, z); if (e < D) D = e; }
        return D;
      }
      const allL = Int16Array.from({ length: NP }, (_, i) => i);
      return { H, NB, PT, PB, PM, PP, PS, PKS, NP, NBODY, PA, PC, PRK, PRR, PTAU, PX, NPR, ST, NST, ROOT, KC, own, slot, PK, CARVE,
        evalPrim, sdf, occDist, allL, at: (x, y, z) => sdf(x, y, z, allL) };
    }

    // Generator form: yields at coarse checkpoints so a main-thread fallback can run the build in time slices.
    function* buildSkinGen(J) {
      const T0 = now(); let _y = 0;
      const { H, NB, PT, PB, PP, PS, PKS, NP, NBODY, PA, PC, PRK, PRR, PTAU, PX, NPR, KC, own, PK, CARVE, evalPrim, sdf, occDist } = makeField(J);
      // ---------------------------------------------------------------- narrow band
      const cell = J.cell, BS = 8;
      const mn = [BIG, BIG, BIG], mx = [-BIG, -BIG, -BIG];
      for (let i = 0; i < NBODY; i++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], PS[i * 4 + a] - PS[i * 4 + 3]); mx[a] = Math.max(mx[a], PS[i * 4 + a] + PS[i * 4 + 3]); }
      for (let a = 0; a < 3; a++) { mn[a] -= 0.03 * H; mx[a] += 0.03 * H; }
      const nb = [0, 1, 2].map((a) => Math.ceil((mx[a] - mn[a]) / (cell * BS)));
      const NX = nb[0] * BS + 1, NY = nb[1] * BS + 1, NZ = nb[2] * BS + 1;
      const vals = new Float32Array(NX * NY * NZ).fill(NaN);
      const halfDiag = Math.sqrt(3) * BS * cell / 2;
      const allL = Int16Array.from({ length: NP }, (_, i) => i);
      const blockList = new Map(), subList = new Map(); const skipped = [];
      let nEval = 0; const SB = BS >> 1, halfSub = halfDiag / 2;
      for (let bk = 0; bk < nb[2]; bk++) for (let bj = 0; bj < nb[1]; bj++) for (let bi = 0; bi < nb[0]; bi++) {
        if ((++_y & 3) === 0) yield;
        const cx = mn[0] + (bi + 0.5) * BS * cell, cy = mn[1] + (bj + 0.5) * BS * cell, cz = mn[2] + (bk + 0.5) * BS * cell;
        const D0 = sdf(cx, cy, cz, allL), key = bi + nb[0] * (bj + nb[1] * bk);
        // the blended body field is not a true distance near tight joint blends (smooth unions, pair windows), so a block
        // is skipped only well clear of the surface: at 1.25 x the half-diagonal a block at the anterior axilla of the
        // bayesian curl bind pose was skipped although the surface crossed it, which left a hole in the skin
        if (Math.abs(D0) > halfDiag * 1.6 + cell) { skipped.push(bi * BS, bj * BS, bk * BS, BS, D0 > 0 ? 1 : -1); continue; }
        const Lb = [];
        for (let i = 0; i < NP; i++) {
          const dx = cx - PS[i * 4], dy = cy - PS[i * 4 + 1], dz = cz - PS[i * 4 + 2];
          const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - PS[i * 4 + 3] - halfDiag;
          if (CARVE[i] ? lb < cell : PB[i] >= 0 ? lb < D0 + halfDiag + PK[i] + cell : lb < halfDiag + KC + cell) Lb.push(i);
        }
        const Lt = Int16Array.from(Lb); blockList.set(key, Lt);
        for (let sk = 0; sk < 2; sk++) for (let sj = 0; sj < 2; sj++) for (let si = 0; si < 2; si++) {
          const i0 = bi * BS + si * SB, j0 = bj * BS + sj * SB, k0 = bk * BS + sk * SB;
          const scx = mn[0] + (i0 + SB / 2) * cell, scy = mn[1] + (j0 + SB / 2) * cell, scz = mn[2] + (k0 + SB / 2) * cell;
          const D1 = sdf(scx, scy, scz, Lt);
          if (Math.abs(D1) > halfSub * 1.3 + cell * 0.5) { skipped.push(i0, j0, k0, SB, D1 > 0 ? 1 : -1); continue; }
          const Ls = [];
          for (let n = 0; n < Lt.length; n++) {
            const i = Lt[n], dx = scx - PS[i * 4], dy = scy - PS[i * 4 + 1], dz = scz - PS[i * 4 + 2];
            const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - PS[i * 4 + 3] - halfSub;
            if (CARVE[i] ? lb < cell * 0.5 : PB[i] >= 0 ? lb < D1 + halfSub * 1.3 + PK[i] + cell * 0.5 : lb < halfSub + KC + cell) Ls.push(i);
          }
          const Lst = Int16Array.from(Ls);
          const skey = (i0 / SB) + (NX >> 2) * ((j0 / SB) + (NY >> 2) * (k0 / SB));
          subList.set(skey, Lst);
          const LB = SB >> 1, halfLeaf = halfSub / 2;
          for (let lk = 0; lk < 2; lk++) for (let lj = 0; lj < 2; lj++) for (let li = 0; li < 2; li++) {
            const a0 = i0 + li * LB, b0 = j0 + lj * LB, c0 = k0 + lk * LB;
            const D2 = sdf(mn[0] + (a0 + LB / 2) * cell, mn[1] + (b0 + LB / 2) * cell, mn[2] + (c0 + LB / 2) * cell, Lst);
            if (Math.abs(D2) > halfLeaf * 1.35 + cell * 0.35) { skipped.push(a0, b0, c0, LB, D2 > 0 ? 1 : -1); continue; }
            for (let k = 0; k <= LB; k++) for (let j = 0; j <= LB; j++) for (let i = 0; i <= LB; i++) {
              const gi = a0 + i, gj = b0 + j, gk = c0 + k, id = gi + NX * (gj + NY * gk);
              if (vals[id] === vals[id]) continue;
              vals[id] = sdf(mn[0] + gi * cell, mn[1] + gj * cell, mn[2] + gk * cell, Lst); nEval++;
            }
          }
        }
      }
      for (let s = 0; s < skipped.length; s += 5) {
        const i0 = skipped[s], j0 = skipped[s + 1], k0 = skipped[s + 2], n = skipped[s + 3], sg = skipped[s + 4] * BIG;
        for (let k = 0; k <= n; k++) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
          const id = (i0 + i) + NX * ((j0 + j) + NY * (k0 + k)); if (vals[id] !== vals[id]) vals[id] = sg;
        }
      }
      const T1 = now();
      // list of primitives near an arbitrary point (sub-block, block, or all)
      function listAt(x, y, z) {
        const gi = Math.floor((x - mn[0]) / cell), gj = Math.floor((y - mn[1]) / cell), gk = Math.floor((z - mn[2]) / cell);
        if (gi < 0 || gj < 0 || gk < 0 || gi >= NX - 1 || gj >= NY - 1 || gk >= NZ - 1) return allL;
        const sk = (gi >> 2) + (NX >> 2) * ((gj >> 2) + (NY >> 2) * (gk >> 2));
        const L = subList.get(sk); if (L) return L;
        const bk = Math.floor(gi / BS) + nb[0] * (Math.floor(gj / BS) + nb[1] * Math.floor(gk / BS));
        return blockList.get(bk) || allL;
      }

      // ---------------------------------------------------------------- surface nets
      const CX = NX - 1, CY = NY - 1, CZ = NZ - 1;
      const cellV = new Int32Array(CX * CY * CZ).fill(-1);
      const pos = [];
      const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      const cv = new Float64Array(8);
      for (const [key] of blockList) {
        if ((++_y & 15) === 0) yield;
        const bi = key % nb[0], bj = Math.floor(key / nb[0]) % nb[1], bk = Math.floor(key / (nb[0] * nb[1]));
        for (let k = 0; k < BS; k++) for (let j = 0; j < BS; j++) for (let i = 0; i < BS; i++) {
          const gi = bi * BS + i, gj = bj * BS + j, gk = bk * BS + k;
          let inside = 0;
          for (let c = 0; c < 8; c++) { const v = vals[(gi + (c & 1)) + NX * ((gj + ((c >> 1) & 1)) + NY * (gk + ((c >> 2) & 1)))]; cv[c] = v; if (v < 0) inside++; }
          if (inside === 0 || inside === 8) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [a, b] of EDGES) {
            const va = cv[a], vb = cv[b]; if ((va < 0) === (vb < 0)) continue;
            if (Math.abs(va) >= BIG || Math.abs(vb) >= BIG) continue;
            const t = va / (va - vb);
            sx += (a & 1) + t * ((b & 1) - (a & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); n++;
          }
          if (!n) { sx = sy = sz = 0.5; n = 1; }
          cellV[gi + CX * (gj + CY * gk)] = pos.length / 3;
          pos.push(mn[0] + (gi + sx / n) * cell, mn[1] + (gj + sy / n) * cell, mn[2] + (gk + sz / n) * cell);
        }
      }
      const idx = [];
      const cellAt = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= CX || j >= CY || k >= CZ) ? -1 : cellV[i + CX * (j + CY * k)];
      const d2 = (a, b) => { const x = pos[a * 3] - pos[b * 3], y = pos[a * 3 + 1] - pos[b * 3 + 1], z = pos[a * 3 + 2] - pos[b * 3 + 2]; return x * x + y * y + z * z; };
      for (let k = 1; k < NZ - 1; k++) for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
        if (i === 1 && (j & 15) === 1) yield;
        const v0 = vals[i + NX * (j + NY * k)]; if (Math.abs(v0) >= BIG) continue;
        const in0 = v0 < 0;
        for (let ax = 0; ax < 3; ax++) {
          const i1 = i + (ax === 0), j1 = j + (ax === 1), k1 = k + (ax === 2);
          const v1 = vals[i1 + NX * (j1 + NY * k1)]; if ((v1 < 0) === in0) continue;
          let q;
          if (ax === 0) q = [cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k)];
          else if (ax === 1) q = [cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1)];
          else q = [cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k)];
          if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[3] < 0) continue;
          if (!in0) q.reverse();
          if (d2(q[0], q[2]) <= d2(q[1], q[3])) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[1], q[3], q[1], q[2], q[3]);
        }
      }
      const NV = pos.length / 3; const T2 = now();

      // ---------------------------------------------------------------- projection, normals, weights
      const P = new Float32Array(NV * 3), N = new Float32Array(NV * 3), skI = new Float32Array(NV * 4), skW = new Float32Array(NV * 4);
      const hG = cell * 0.3, TK = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]];
      const gr = [0, 0, 0];
      const grad = (x, y, z, L, h) => { gr[0] = gr[1] = gr[2] = 0; let f = 0;
        for (const t of TK) { const v = sdf(x + t[0] * h, y + t[1] * h, z + t[2] * h, L); f += v; gr[0] += t[0] * v; gr[1] += t[1] * v; gr[2] += t[2] * v; }
        return f / 4; };
      const wTmp = new Float64Array(NB), ownV = new Float64Array(NB);
      for (let v = 0; v < NV; v++) {
        if ((v & 255) === 0) yield;
        let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        const L = listAt(x, y, z);
        for (let it = 0; it < 2; it++) {
          const f = grad(x, y, z, L, hG), g2 = gr[0] * gr[0] + gr[1] * gr[1] + gr[2] * gr[2];
          if (g2 > 1e-24) { let s = f * (4 * hG) / g2; const stepLen = Math.abs(s) * Math.sqrt(g2); if (stepLen > cell) s *= cell / stepLen; x -= s * gr[0]; y -= s * gr[1]; z -= s * gr[2]; }
        }
        grad(x, y, z, L, hG);
        const gl = Math.hypot(gr[0], gr[1], gr[2]) || 1;
        N[v * 3] = gr[0] / gl; N[v * 3 + 1] = gr[1] / gl; N[v * 3 + 2] = gr[2] / gl;
        P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
        sdf(x, y, z, L); for (let b = 0; b < NB; b++) ownV[b] = own[b];
        // owner = nearest bone surface; blend adjacent bones (pairs) by field distance, windowed around the joint
        let ob = 0, od = BIG; for (let b = 0; b < NB; b++) if (ownV[b] < od) { od = ownV[b]; ob = b; }
        wTmp.fill(0); wTmp[ob] = 1;
        for (let q = 0; q < NPR; q++) {
          let o = -1; if (PA[q] === ob) o = PC[q]; else if (PC[q] === ob) o = PA[q]; else continue;
          if (ownV[o] >= BIG || PTAU[q] <= 0) continue;
          const dx = x - PX[q * 3], dy = y - PX[q * 3 + 1], dz = z - PX[q * 3 + 2], R = PRR[q];
          let win = (R - Math.sqrt(dx * dx + dy * dy + dz * dz)) / (0.5 * R); if (win <= 0) continue; win = Math.min(1, win); win = win * win * (3 - 2 * win);
          wTmp[o] = Math.max(wTmp[o], Math.exp(-(ownV[o] - od) / PTAU[q]) * win);
        }
        const top = []; for (let b = 0; b < NB; b++) if (wTmp[b] > 0.01) top.push([wTmp[b], b]);
        top.sort((a, b) => b[0] - a[0]); top.length = Math.min(4, top.length);
        const sum = top.reduce((a, t) => a + t[0], 0);
        for (let s = 0; s < 4; s++) { skI[v * 4 + s] = s < top.length ? top[s][1] : 0; skW[v * 4 + s] = s < top.length ? top[s][0] / sum : 0; }
      }
      // wind triangles against the field normal
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const sx = N[a * 3] + N[b * 3] + N[c * 3], sy = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], sz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
        if (nx * sx + ny * sy + nz * sz < 0) { idx[t + 1] = c; idx[t + 2] = b; }
      }
      // mesh adjacency (CSR)
      const deg = new Int32Array(NV + 1);
      for (let t = 0; t < idx.length; t++) deg[idx[t] + 1] += 2;
      for (let v = 0; v < NV; v++) deg[v + 1] += deg[v];
      const adj = new Int32Array(deg[NV]), fill = deg.slice(0, NV);
      for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
      // ---------------------------------------------------------------- surface fairing
      // Surface-nets vertices lie on the surface but unevenly spaced, and a light finish shows the ~1 cm grid as grain
      // (normals interpolated across irregular triangles, relief edges aliased to the grid). Tangential relaxation evens
      // out the spacing without moving the surface: each step toward the neighbour centroid is projected onto the
      // vertex's tangent plane, so the surface error is second order (~0.03 mm at this cell size) and pad contacts are
      // unchanged. Then the normal field is low-passed over the mesh graph (a Gaussian of ~1 cell), which removes the
      // grain but keeps every form wider than ~3 cm (the sculpted relief is wider than that by design).
      {
        const T = new Float32Array(NV * 3);
        for (let it = 0; it < FAIR_RELAX; it++) {
          yield;
          for (let v = 0; v < NV; v++) {
            const e0 = deg[v], e1 = deg[v + 1], o = v * 3;
            if (e1 === e0) { T[o] = P[o]; T[o + 1] = P[o + 1]; T[o + 2] = P[o + 2]; continue; }
            let dx = 0, dy = 0, dz = 0;
            for (let e = e0; e < e1; e++) { const u = adj[e] * 3; dx += P[u]; dy += P[u + 1]; dz += P[u + 2]; }
            const inv = 1 / (e1 - e0); dx = dx * inv - P[o]; dy = dy * inv - P[o + 1]; dz = dz * inv - P[o + 2];
            const dn = dx * N[o] + dy * N[o + 1] + dz * N[o + 2];
            T[o] = P[o] + 0.5 * (dx - dn * N[o]); T[o + 1] = P[o + 1] + 0.5 * (dy - dn * N[o + 1]); T[o + 2] = P[o + 2] + 0.5 * (dz - dn * N[o + 2]);
          }
          P.set(T);
        }
        for (let it = 0; it < FAIR_N; it++) {
          yield;
          for (let v = 0; v < NV; v++) {
            const e0 = deg[v], e1 = deg[v + 1], o = v * 3;
            let sx = 0, sy = 0, sz = 0;
            for (let e = e0; e < e1; e++) { const u = adj[e] * 3; sx += N[u]; sy += N[u + 1]; sz += N[u + 2]; }
            const inv = e1 > e0 ? 0.5 / (e1 - e0) : 0, k = e1 > e0 ? 0.5 : 1;
            sx = k * N[o] + inv * sx; sy = k * N[o + 1] + inv * sy; sz = k * N[o + 2] + inv * sz;
            const l = Math.hypot(sx, sy, sz) || 1; T[o] = sx / l; T[o + 1] = sy / l; T[o + 2] = sz / l;
          }
          N.set(T);
        }
      }
      // two passes of weight smoothing over the mesh graph (removes seams where ownership flips)
      {
        const acc = new Float64Array(NB), touched = [];
        for (let it = 0; it < 2; it++) {
          const I2 = new Float32Array(skI), W2 = new Float32Array(skW);
          for (let v = 0; v < NV; v++) {
            if ((v & 2047) === 0) yield;
            touched.length = 0;
            const add = (b, w) => { if (acc[b] === 0) touched.push(b); acc[b] += w; };
            for (let k = 0; k < 4; k++) if (skW[v * 4 + k] > 0) add(skI[v * 4 + k], skW[v * 4 + k] * 2);
            const e0 = deg[v], e1 = deg[v + 1], wn = 1 / Math.max(1, e1 - e0);
            for (let e = e0; e < e1; e++) { const u = adj[e]; for (let k = 0; k < 4; k++) if (skW[u * 4 + k] > 0) add(skI[u * 4 + k], skW[u * 4 + k] * 2 * wn); }
            touched.sort((a, b) => acc[b] - acc[a]);
            let s = 0; const n = Math.min(4, touched.length); for (let k = 0; k < n; k++) s += acc[touched[k]];
            for (let k = 0; k < 4; k++) { I2[v * 4 + k] = k < n ? touched[k] : 0; W2[v * 4 + k] = k < n ? acc[touched[k]] / s : 0; }
            for (const b of touched) acc[b] = 0;
          }
          skI.set(I2); skW.set(W2);
        }
      }
      const T3 = now();
      // ---------------------------------------------------------------- ambient occlusion from the field (pads occlude too)
      const AO = new Float32Array(NV);
      if (J.ao) {
        const aoH = J.ao.map((d) => d * H);
        for (let v = 0; v < NV; v++) {
          if ((v & 255) === 0) yield;
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
          let occ = 0, sc = 1;
          for (const hh of aoH) {
            const qx = x + nx * hh, qy = y + ny * hh, qz = z + nz * hh;
            const d = occDist(qx, qy, qz, listAt(qx, qy, qz)); occ += Math.max(0, hh - d) / hh * sc; sc *= 0.75;
          }
          AO[v] = clamp(1 - 0.5 * occ, 0, 1);
        }
        // smoothing passes (the per-vertex samples are noisy at the cell scale)
        const A2 = new Float32Array(AO);
        for (let it = 0; it < AO_SMOOTH; it++) {
          for (let v = 0; v < NV; v++) { let s = AO[v] * 2, w = 2; for (let e = deg[v]; e < deg[v + 1]; e++) { s += AO[adj[e]]; w++; } A2[v] = s / w; }
          AO.set(A2);
        }
      } else AO.fill(1);
      const T4 = now();
      // bone-restricted field for snapping muscle patches: min over the per-bone fields of the group's own bones
      // (so a triceps patch near the armpit snaps onto the arm, never onto the ribs)
      let allowB = null;
      const sdfB = (x, y, z) => { sdf(x, y, z, listAt(x, y, z)); let m = BIG; for (let b = 0; b < NB; b++) if (allowB[b] && own[b] < m) m = own[b]; return m >= BIG ? sdf(x, y, z, listAt(x, y, z)) : m; };
      const gradB = (x, y, z) => { const h = 0.002 * H; gr[0] = gr[1] = gr[2] = 0; let f = 0;
        for (const t of TK) { const v = sdfB(x + t[0] * h, y + t[1] * h, z + t[2] * h); f += v; gr[0] += t[0] * v; gr[1] += t[1] * v; gr[2] += t[2] * v; } return f / 4; };
      const mus = yield* paint(J, P, N, NV, deg, adj, (bones) => { allowB = bones; }, gradB, gr, skI, skW);
      const T5 = now();
      const I32 = new Uint32Array(idx);
      return {
        NV, pos: P, nor: N, idx: I32, skI, skW, ao: AO, ...mus,
        stats: { cellH: +(cell / H).toFixed(4), grid: [NX, NY, NZ], evals: nEval, verts: NV, tris: I32.length / 3,
          fieldMs: +(T1 - T0).toFixed(0), netsMs: +(T2 - T1).toFixed(0), weightsMs: +(T3 - T2).toFixed(0), aoMs: +(T4 - T3).toFixed(0), paintMs: +(T5 - T4).toFixed(0), totalMs: +(T5 - T0).toFixed(0) },
      };
    }

    // ------------------------------------------------------------------ muscle paint
    // Each muscle group is a patch lofted through guide curves (origin -> insertion), snapped onto the skin. Every
    // vertex near the patch gets patch coordinates (u along the fibres, v across, -1..1); each head of the group is a
    // shape in (u, v) giving a signed field (0 on the outline, ~1 in the belly). The field is gated by distance to the
    // patch and by agreement between the vertex normal and the patch normal, so glow never spills onto neighbouring
    // regions that face another way (flank under the pec, glutes under the lats).
    function* paint(J, P, N, NV, deg, adj, setBones, gradAt, gr, skI, skW) {
      const H = J.H;
      const fP = new Float32Array(NV).fill(-1), fS = new Float32Array(NV).fill(-1);
      // per side (figure-left / right groups) and tier: the strongest and second-strongest group field at each vertex, to
      // find seams where two working groups of the same side meet edge to edge (see the seam pass after the group loop)
      const sg1 = [0, 1, 2, 3].map(() => new Float32Array(NV).fill(-9)), sg2 = [0, 1, 2, 3].map(() => new Float32Array(NV).fill(-9));
      const fib = new Float32Array(NV), stA = new Float32Array(NV), hd = new Float32Array(NV * 2);
      const domP = new Float32Array(NV).fill(-2), domS = new Float32Array(NV).fill(-2);
      const bm = new Float32Array(NV * 4);
      const fields = new Map(); // head index -> bulge field
      const gBuf = { u: new Float32Array(NV), v: new Float32Array(NV), g: new Float32Array(NV), t: new Uint8Array(NV), a: new Float32Array(NV), i: new Float32Array(NV) };
      const catmull = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
      function resample(pts, n) { // pts: [[x,y,z]...] -> n points, chord-length Catmull-Rom
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
        const L = cum[cum.length - 1] || 1e-9, out = [];
        for (let s = 0; s < n; s++) {
          const d = s / (n - 1) * L; let i = 0; while (i < pts.length - 2 && cum[i + 1] < d) i++;
          const t = clamp((d - cum[i]) / Math.max(1e-12, cum[i + 1] - cum[i]), 0, 1);
          const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1] || pts[i], p3 = pts[Math.min(pts.length - 1, i + 2)];
          out.push([0, 1, 2].map((k) => catmull(p0[k], p1[k], p2[k], p3[k], t)));
        }
        return out;
      }
      const snap = (p) => {
        let x = p[0], y = p[1], z = p[2];
        for (let it = 0; it < 4; it++) {
          const f = gradAt(x, y, z), gl = Math.hypot(gr[0], gr[1], gr[2]) || 1;
          const s = Math.max(-0.03 * H, Math.min(0.03 * H, f)); x -= gr[0] / gl * s; y -= gr[1] / gl * s; z -= gr[2] / gl * s;
        }
        gradAt(x, y, z); const gl = Math.hypot(gr[0], gr[1], gr[2]) || 1;
        return [x, y, z, gr[0] / gl, gr[1] / gl, gr[2] / gl];
      };
      const headField = (h, u, v) => {
        const x = (u - h.u0) / (h.u1 - h.u0), pk = h.pk;
        const sp = (q) => Math.pow(Math.sin(Math.PI / 2 * clamp(q, 0, 1)), h.sp || 0.7); // width profile: 0.7 full-bodied, >1 spindle
        const wv = x < pk ? h.t0 + (1 - h.t0) * sp(x / pk) : h.t1 + (1 - h.t1) * sp((1 - x) / (1 - pk));
        const lat = 1 - Math.abs(v - h.vc - h.sk * clamp(x, 0, 1)) / (h.hw * Math.max(wv, 0.06)); // sk: the centre line drifts across the patch toward the insertion
        const e0 = x / h.r0, e1 = (1 - x) / h.r1;
        let f = smin(lat, e0, 0.35); f = smin(f, e1, 0.35);
        // along-fibre belly profile: fusiform bellies peak at pk and fade toward both tendons; sheets stay full from the
        // aponeurotic origin and fade only toward the insertion tendon
        const xc = clamp(x, 0, 1);
        const along = h.sheet ? sstep(0.0, 0.18, xc) * (1 - 0.75 * sstep(h.fade, 1.0, xc))
          : Math.pow(xc < pk ? Math.sin(Math.PI / 2 * xc / pk) : Math.sin(Math.PI / 2 * (1 - xc) / (1 - pk)), 0.8);
        return [clamp(f, -1.5, 1.2), along];
      };
      for (const G of J.groups) {
        const K = G.K, M = G.M, NS = 34, SUB = G.sub || 3, NA = (K - 1) * SUB + 1;
        const allow = new Uint8Array(J.nb); for (const b of G.bones) allow[b] = 1; setBones(allow);
        // 1) resample each guide along its length, then across the guides
        const guides = [];
        for (let k = 0; k < K; k++) { const pts = []; for (let m = 0; m < M[k]; m++) { const o = (G.off[k] + m) * 3; pts.push([G.pts[o], G.pts[o + 1], G.pts[o + 2]]); } guides.push(resample(pts, NS)); }
        const node = new Float64Array(NA * NS * 6), U = new Float32Array(NA * NS), Vv = new Float32Array(NA * NS);
        let wSum = 0;
        for (let i = 0; i < NS; i++) {
          const row = [];
          for (let a = 0; a < NA; a++) {
            const kf = a / SUB, k = Math.min(K - 2, Math.floor(kf)), t = kf - k;
            const p0 = guides[Math.max(0, k - 1)][i], p1 = guides[k][i], p2 = guides[k + 1][i], p3 = guides[Math.min(K - 1, k + 2)][i];
            row.push([0, 1, 2].map((c) => catmull(p0[c], p1[c], p2[c], p3[c], t)));
          }
          // 2) snap onto the skin
          const snapped = row.map(snap);
          // across coordinate by chord length
          const cum = [0]; for (let a = 1; a < NA; a++) cum.push(cum[a - 1] + Math.hypot(snapped[a][0] - snapped[a - 1][0], snapped[a][1] - snapped[a - 1][1], snapped[a][2] - snapped[a - 1][2]));
          const W = cum[NA - 1] || 1e-9; wSum += W;
          for (let a = 0; a < NA; a++) { const o = (a * NS + i) * 6; for (let c = 0; c < 6; c++) node[o + c] = snapped[a][c]; Vv[a * NS + i] = -1 + 2 * cum[a] / W; U[a * NS + i] = i / (NS - 1); }
        }
        const Wmean = wSum / NS, nStripes = Wmean / (J.stripe * H);
        // 3) per-vertex projection
        const lo = [BIG, BIG, BIG], hi = [-BIG, -BIG, -BIG], mg = Math.max(0.035 * H, G.tol * 3 * H);
        for (let n = 0; n < NA * NS; n++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], node[n * 6 + c] - mg); hi[c] = Math.max(hi[c], node[n * 6 + c] + mg); }
        const tol = G.tol * H;
        // Patch surface: bilinear over the snapped node grid in grid coordinates (sa across 0..NA-1, si along 0..NS-1),
        // extrapolated linearly past the border cells. u = si / (NS - 1); v interpolates the per-row chord coordinate.
        const ev = { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, ix: 0, iy: 0, iz: 0, nx: 0, ny: 0, nz: 0, v: 0 };
        const evalGrid = (sa, si) => {
          const a0 = sa < 0 ? 0 : sa > NA - 2 ? NA - 2 : Math.floor(sa), i0 = si < 0 ? 0 : si > NS - 2 ? NS - 2 : Math.floor(si);
          const ta = sa - a0, ti = si - i0;
          const n00 = (a0 * NS + i0) * 6, n10 = ((a0 + 1) * NS + i0) * 6, n01 = (a0 * NS + i0 + 1) * 6, n11 = ((a0 + 1) * NS + i0 + 1) * 6;
          const w00 = (1 - ta) * (1 - ti), w10 = ta * (1 - ti), w01 = (1 - ta) * ti, w11 = ta * ti;
          ev.x = w00 * node[n00] + w10 * node[n10] + w01 * node[n01] + w11 * node[n11];
          ev.y = w00 * node[n00 + 1] + w10 * node[n10 + 1] + w01 * node[n01 + 1] + w11 * node[n11 + 1];
          ev.z = w00 * node[n00 + 2] + w10 * node[n10 + 2] + w01 * node[n01 + 2] + w11 * node[n11 + 2];
          ev.ax = (1 - ti) * (node[n10] - node[n00]) + ti * (node[n11] - node[n01]);
          ev.ay = (1 - ti) * (node[n10 + 1] - node[n00 + 1]) + ti * (node[n11 + 1] - node[n01 + 1]);
          ev.az = (1 - ti) * (node[n10 + 2] - node[n00 + 2]) + ti * (node[n11 + 2] - node[n01 + 2]);
          ev.ix = (1 - ta) * (node[n01] - node[n00]) + ta * (node[n11] - node[n10]);
          ev.iy = (1 - ta) * (node[n01 + 1] - node[n00 + 1]) + ta * (node[n11 + 1] - node[n10 + 1]);
          ev.iz = (1 - ta) * (node[n01 + 2] - node[n00 + 2]) + ta * (node[n11 + 2] - node[n10 + 2]);
          // surface normal from the tangents, oriented like the snapped skin normals of the cell
          let nx = ev.ay * ev.iz - ev.az * ev.iy, ny = ev.az * ev.ix - ev.ax * ev.iz, nz = ev.ax * ev.iy - ev.ay * ev.ix;
          const sx = node[n00 + 3] + node[n10 + 3] + node[n01 + 3] + node[n11 + 3], sy = node[n00 + 4] + node[n10 + 4] + node[n01 + 4] + node[n11 + 4], sz = node[n00 + 5] + node[n10 + 5] + node[n01 + 5] + node[n11 + 5];
          const nl = Math.hypot(nx, ny, nz);
          if (nl < 1e-14) { const sl = Math.hypot(sx, sy, sz) || 1; nx = sx / sl; ny = sy / sl; nz = sz / sl; } else { nx /= nl; ny /= nl; nz /= nl; if (nx * sx + ny * sy + nz * sz < 0) { nx = -nx; ny = -ny; nz = -nz; } }
          ev.nx = nx; ev.ny = ny; ev.nz = nz;
          ev.v = w00 * Vv[a0 * NS + i0] + w10 * Vv[(a0 + 1) * NS + i0] + w01 * Vv[a0 * NS + i0 + 1] + w11 * Vv[(a0 + 1) * NS + i0 + 1];
          return ev;
        };
        // pass 1: closest point on the patch surface (Gauss-Newton on the grid coordinates, started at the nearest node).
        // Continuous across the whole patch and its extrapolated border, so (u, v) never flip between neighbouring cells
        // (the nearest-triangle projection used before jumped where the patch crosses a joint crease or a concavity).
        const touched = [], gU = gBuf.u, gV = gBuf.v, gG = gBuf.g, gT = gBuf.t, gA = gBuf.a, gI = gBuf.i;
        for (let v = 0; v < NV; v++) {
          if ((v & 1023) === 0) yield;
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
          let bn = -1, bd = BIG;
          for (let n = 0; n < NA * NS; n++) { const dx = x - node[n * 6], dy = y - node[n * 6 + 1], dz = z - node[n * 6 + 2], dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; bn = n; } }
          if (bd > mg * mg * 4) continue;
          let sa = Math.floor(bn / NS), si = bn % NS;
          for (let it = 0; it < 10; it++) {
            evalGrid(sa, si);
            const rx = x - ev.x, ry = y - ev.y, rz = z - ev.z;
            const aa = ev.ax * ev.ax + ev.ay * ev.ay + ev.az * ev.az, ai = ev.ax * ev.ix + ev.ay * ev.iy + ev.az * ev.iz, ii = ev.ix * ev.ix + ev.iy * ev.iy + ev.iz * ev.iz;
            const ba = ev.ax * rx + ev.ay * ry + ev.az * rz, bi = ev.ix * rx + ev.iy * ry + ev.iz * rz, det = aa * ii - ai * ai;
            if (Math.abs(det) < 1e-24) break;
            let da = (ii * ba - ai * bi) / det, di = (aa * bi - ai * ba) / det;
            const m = Math.max(Math.abs(da), Math.abs(di)); if (m > 1.5) { da *= 1.5 / m; di *= 1.5 / m; }
            // do not run far past the border: extrapolation stays within a few cells of the patch
            sa = clamp(sa + da, -6, NA + 5); si = clamp(si + di, -8, NS + 7);
            if (m < 1e-3) break;
          }
          gA[v] = sa; gI[v] = si; gG[v] = 0;
          gT[v] = 1; touched.push(v);
        }
        // pass 2a: light Laplacian smoothing of the grid coordinates over the skin (touched vertices only)
        const UVS = J.uvSmooth == null ? 8 : J.uvSmooth;
        if (UVS > 0 && touched.length) {
          const ta = new Float32Array(touched.length), ti = new Float32Array(touched.length);
          for (let it = 0; it < UVS; it++) {
            yield;
            for (let q = 0; q < touched.length; q++) {
              const v = touched[q]; let sa = 0, si = 0, n = 0;
              for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; if (gT[u]) { sa += gA[u]; si += gI[u]; n++; } }
              ta[q] = n ? 0.5 * gA[v] + 0.5 * sa / n : gA[v]; ti[q] = n ? 0.5 * gI[v] + 0.5 * si / n : gI[v];
            }
            for (let q = 0; q < touched.length; q++) { gA[touched[q]] = ta[q]; gI[touched[q]] = ti[q]; }
          }
        }
        // pass 2b: (u, v) and the gates at the smoothed surface point: depth along the patch normal, agreement between the
        // vertex and patch normals, and skin ownership by the group's own bones
        for (let q = 0; q < touched.length; q++) {
          if ((q & 2047) === 0) yield;
          const v = touched[q];
          evalGrid(gA[v], gI[v]);
          gU[v] = gI[v] / (NS - 1); gV[v] = ev.v;
          const dep = (P[v * 3] - ev.x) * ev.nx + (P[v * 3 + 1] - ev.y) * ev.ny + (P[v * 3 + 2] - ev.z) * ev.nz;
          const nd = N[v * 3] * ev.nx + N[v * 3 + 1] * ev.ny + N[v * 3 + 2] * ev.nz;
          let wOwn = 0; for (let k = 0; k < 4; k++) if (allow[skI[v * 4 + k]]) wOwn += skW[v * 4 + k];
          gG[v] = (1 - sstep(tol, 2.2 * tol, Math.abs(dep))) * sstep(-0.05, 0.45, nd) * sstep(0.25, 0.7, wOwn);
        }
        // gate smoothing (untouched neighbours count as 0, so the gate only softens, never grows past the patch)
        const GS = J.gateSmooth == null ? 6 : J.gateSmooth;
        if (GS > 0 && touched.length) {
          const tmp = new Float32Array(touched.length);
          for (let it = 0; it < GS; it++) {
            yield;
            for (let q = 0; q < touched.length; q++) {
              const v = touched[q]; let s = 0, n = 0;
              for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; s += gT[u] ? gG[u] : 0; n++; }
              tmp[q] = n ? 0.4 * gG[v] + 0.6 * s / n : gG[v];
            }
            for (let q = 0; q < touched.length; q++) gG[touched[q]] = tmp[q];
          }
        }
        // pass 3a: evaluate the heads (per touched vertex, per head)
        const nT = touched.length, NH = G.heads.length;
        const tP = new Float32Array(nT).fill(-9), tS = new Float32Array(nT).fill(-9);
        const hF = new Float32Array(nT * NH).fill(-9), hA = new Float32Array(nT * NH);
        const km = G.merge === 'groove' ? 0 : 0.3; // groove: heads keep a shallow valley between their bellies (quads, triceps...)
        for (let q = 0; q < nT; q++) {
          if ((q & 1023) === 0) yield;
          const v = touched[q], gate = sstep(0.12, 0.88, gG[v]);
          if (gate <= 0) continue;
          // heads of one group and tier merge with a smooth max (no crease between heads of the same muscle)
          for (let j = 0; j < NH; j++) {
            const h = G.heads[j];
            let [f, along] = headField(h, gU[v], gV[v]);
            f = Math.min(f, -0.6 + 1.6 * gate);
            if (f < -0.9) continue;
            hF[q * NH + j] = f; hA[q * NH + j] = along;
            if (h.tier === 1) tP[q] = tP[q] <= -9 ? f : km ? -smin(-tP[q], -f, km) : Math.max(tP[q], f);
            else tS[q] = tS[q] <= -9 ? f : km ? -smin(-tS[q], -f, km) : Math.max(tS[q], f);
          }
          // groove groups: where two heads meet with similar strength the merged field dips into a shallow valley (kept
          // above 0.1, so it darkens toward the edge colour without opening a gap): the heads read as separate bellies
          if (!km && NH > 1) for (const tier of [1, 2]) {
            let f1 = -9, f2 = -9;
            for (let j = 0; j < NH; j++) { if (G.heads[j].tier !== tier) continue; const f = hF[q * NH + j]; if (f > f1) { f2 = f1; f1 = f; } else if (f > f2) f2 = f; }
            if (f2 <= -0.3 || f1 <= 0.1) continue;
            const t = Math.max(0, 1 - (f1 - f2) / 0.4), d = 0.55 * t * t * clamp(f2 + 0.3, 0, 1);
            if (tier === 1) tP[q] = Math.max(Math.min(tP[q], f1 - d), 0.1); else tS[q] = Math.max(Math.min(tS[q], f1 - d), 0.1);
          }
        }
        // pass 3b: connected components over the skin: drop small detached islands of glow (a patch end that projects
        // onto a fold, e.g. the forearm at the elbow crease) and fill small enclosed holes
        {
          const qOf = new Int32Array(NV).fill(-1); for (let q = 0; q < nT; q++) qOf[touched[q]] = q;
          const comp = new Int32Array(nT), stack = [];
          const components = (T, inside) => { // label components of {q : inside(T[q])}; returns [[size, touchesOutside], ...]
            comp.fill(-1); const out = [];
            for (let q0 = 0; q0 < nT; q0++) {
              if (comp[q0] >= 0 || !inside(T[q0])) continue;
              const id = out.length; let size = 0, edge = false; comp[q0] = id; stack.length = 0; stack.push(q0);
              while (stack.length) {
                const q = stack.pop(); size++; const v = touched[q];
                for (let e = deg[v]; e < deg[v + 1]; e++) { const qq = qOf[adj[e]]; if (qq < 0) { edge = true; continue; } if (comp[qq] < 0 && inside(T[qq])) { comp[qq] = id; stack.push(qq); } }
              }
              out.push([size, edge]);
            }
            return out;
          };
          for (const [T, tier] of [[tP, 1], [tS, 2]]) {
            const cs = components(T, (x) => x > 0); if (!cs.length) continue;
            const big = Math.max(...cs.map((c) => c[0])), minKeep = Math.max(12, 0.1 * big);
            const lab = comp.slice();
            for (let q = 0; q < nT; q++) if (lab[q] >= 0 && cs[lab[q]][0] < minKeep) {
              T[q] = -9; for (let j = 0; j < NH; j++) if (G.heads[j].tier === tier) hF[q * NH + j] = -9;
            }
            // holes: non-glowing components that never reach the patch border or the far outside and are small
            // (a seam where three heads of a groove group all taper away leaves such an enclosed gap)
            const hs = components(T, (x) => x < -0.2); // deep gaps only: a thin groove between heads must not link a hole to the outside
            for (let q = 0; q < nT; q++) if (comp[q] >= 0) { const hsz = hs[comp[q]]; if (!hsz[1] && hsz[0] < Math.max(8, 0.04 * big)) T[q] = Math.max(T[q], 0.06); }
            // morphological closing (2 rings, ~2 cm): fills narrow gaps and pinholes inside the glow and small notches in
            // its outline, where two or three heads taper away from each other
            const inG = new Uint8Array(nT); for (let q = 0; q < nT; q++) inG[q] = T[q] > 0 ? 1 : 0;
            let Dm = inG.slice();
            for (let r = 0; r < 2; r++) { const n2 = Dm.slice(); for (let q = 0; q < nT; q++) if (!Dm[q]) { const v = touched[q]; for (let e = deg[v]; e < deg[v + 1]; e++) { const qq = qOf[adj[e]]; if (qq >= 0 && Dm[qq]) { n2[q] = 1; break; } } } Dm = n2; }
            for (let r = 0; r < 2; r++) { const n2 = Dm.slice(); for (let q = 0; q < nT; q++) if (Dm[q]) { const v = touched[q]; for (let e = deg[v]; e < deg[v + 1]; e++) { const qq = qOf[adj[e]]; if (qq < 0 || !Dm[qq]) { n2[q] = 0; break; } } } Dm = n2; }
            for (let q = 0; q < nT; q++) if (Dm[q] && !inG[q]) T[q] = Math.max(T[q], 0.06);
          }
        }
        // pass 3c: commit
        for (let q = 0; q < nT; q++) {
          if ((q & 1023) === 0) yield;
          const v = touched[q], bv = gV[v];
          gT[v] = 0;
          for (let j = 0; j < NH; j++) {
            const f = hF[q * NH + j]; if (f <= -9) continue;
            const h = G.heads[j], along = hA[q * NH + j];
            if (h.tier === 1) { if (f > domP[v]) { domP[v] = f; hd[v * 2] = h.hi; fib[v] = (bv + 1) / 2 * nStripes; stA[v] = along * sstep(0.05, 0.5, f); } }
            else if (f > domS[v]) { domS[v] = f; hd[v * 2 + 1] = h.hi; if (domP[v] < -0.5) { fib[v] = (bv + 1) / 2 * nStripes; stA[v] = along * sstep(0.05, 0.5, f) * 0.7; } }
            const bw = sstep(0.0, 0.85, f) * along;
            if (bw > 0) {
              let F = fields.get(h.hi); if (!F) { F = new Float32Array(NV); fields.set(h.hi, F); }
              if (bw > F[v]) F[v] = bw;
            }
          }
          const gP = tP[q], gS = tS[q], sd = /_r$/.test(G.id) ? 1 : 0;
          for (const [slot, gv] of [[sd, gP], [2 + sd, gS]]) { if (gv <= -9) continue; if (gv > sg1[slot][v]) { sg2[slot][v] = sg1[slot][v]; sg1[slot][v] = gv; } else if (gv > sg2[slot][v]) sg2[slot][v] = gv; }
          if (gP > fP[v]) fP[v] = Math.min(gP, 1.2);
          if (gS > fS[v]) fS[v] = Math.min(gS, 1.2);
        }
      }
      // seams between two working groups of one side (lats / upper back, upper back / mid traps): each group fades to its
      // own outline, so where two outlines meet the merged field (the max) dips to ~0 along the junction and pinches into
      // dark specks. Where both groups are within a hair of their outlines, the junction is lifted just inside the glow.
      // Deliberate gaps (the glute / vastus lateralis seam, the linea alba, left vs right) are wider or across sides.
      for (let v = 0; v < NV; v++) {
        for (const sd of [0, 1]) if (sg2[sd][v] > -0.1 && sg1[sd][v] > -0.1) fP[v] = Math.max(fP[v], 0.1);
        for (const sd of [2, 3]) if (sg2[sd][v] > -0.1 && sg1[sd][v] > -0.1) fS[v] = Math.max(fS[v], 0.1);
      }
      // light Laplacian smoothing of the mask fields where they are near the outline (removes projection jitter)
      const smooth = function* (F, iters, keep, hiF = 0.9) {
        const tmp = new Float32Array(NV);
        for (let it = 0; it < iters; it++) {
          yield;
          for (let v = 0; v < NV; v++) {
            if (F[v] <= -0.99 || F[v] > hiF) { tmp[v] = F[v]; continue; }
            let s = 0, n = 0; for (let e = deg[v]; e < deg[v + 1]; e++) { s += F[adj[e]]; n++; }
            tmp[v] = n ? keep * F[v] + (1 - keep) * s / n : F[v];
          }
          F.set(tmp);
        }
      };
      yield* smooth(fP, J.maskSmooth || 10, 0.5, 0.3); yield* smooth(fS, J.maskSmooth || 10, 0.5, 0.3);
      // pinholes where two groups meet (lats / upper back / mid traps): each group's own cleanup sees only an open notch
      // at its border, but where two fading edges meet the merged field (the max of the groups) dips to ~0 in a small
      // closed pocket that renders as a dark speck. After smoothing, lift small low pockets that are enclosed by glow on
      // every side (never the midline channel or the bare body, which are large or open) to the edge level.
      // two levels: pockets that dip below the outline (<= 0: a dark speck) inside a dim valley, then shallow pockets
      for (const [F, TAU] of [[fP, 0], [fS, 0], [fP, 0.1], [fS, 0.1]]) {
        yield;
        const seen = new Uint8Array(NV), stack = [], comp = [];
        for (let v0 = 0; v0 < NV; v0++) {
          if (seen[v0] || F[v0] > TAU) continue;
          let enclosed = true, glowNb = false; comp.length = 0; stack.length = 0; stack.push(v0); seen[v0] = 1;
          while (stack.length) {
            const v = stack.pop(); comp.push(v);
            if (comp.length > 80) enclosed = false; // too big to be a pinhole (~4 cm across): keep walking only to mark it seen
            for (let e = deg[v]; e < deg[v + 1]; e++) {
              const u = adj[e];
              if (F[u] > TAU) { glowNb = true; continue; }
              if (!seen[u]) { seen[u] = 1; stack.push(u); }
            }
          }
          if (enclosed && glowNb) for (const v of comp) F[v] = Math.max(F[v], TAU + 0.06);
        }
      }
      // specks: the outline smoothing above can cut the thin bridge that tied a patch end to its region (the hamstring
      // insertion running into the knee pit left a detached dot on the calf at the leg curl peak). Drop connected glow
      // components that are tiny next to the largest one of their tier (under 3 % of it and under 40 vertices), along
      // with their swell, so every working muscle reads as one clean shape per side.
      {
        const tierHeads = [new Set(), new Set()];
        for (const G of J.groups) for (const h of G.heads) tierHeads[h.tier === 1 ? 0 : 1].add(h.hi);
        const comp = new Int32Array(NV), stack = [];
        for (const [F, ti] of [[fP, 0], [fS, 1]]) {
          yield;
          comp.fill(-1); const sizes = [];
          for (let v0 = 0; v0 < NV; v0++) {
            if (comp[v0] >= 0 || !(F[v0] > 0)) continue;
            const id = sizes.length; let n = 0; comp[v0] = id; stack.length = 0; stack.push(v0);
            while (stack.length) { const v = stack.pop(); n++; for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; if (comp[u] < 0 && F[u] > 0) { comp[u] = id; stack.push(u); } } }
            sizes.push(n);
          }
          if (sizes.length < 2) continue;
          const big = Math.max(...sizes), drop = sizes.map((n) => n < 0.03 * big && n < 40);
          if (!drop.some(Boolean)) continue;
          const gone = [];
          for (let v = 0; v < NV; v++) {
            if (comp[v] < 0 || !drop[comp[v]]) continue;
            gone.push(v);
            for (const [hi, B] of fields) if (tierHeads[ti].has(hi)) B[v] = 0;
          }
          // the speck's own outline band (2 rings of non-glowing vertices) goes too, or its anti-aliased edge still
          // draws a faint ring; vertices that border a kept region keep their value (its outline stays as it was)
          const kept = (u) => F[u] > 0 && comp[u] >= 0 && !drop[comp[u]];
          let ring = gone.slice(); const seen = new Set(ring);
          for (let r = 0; r < 2; r++) {
            const next = [];
            for (const v of ring) for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; if (!seen.has(u) && !(F[u] > 0)) { seen.add(u); next.push(u); } }
            ring = next;
          }
          for (const v of seen) {
            let nearKept = false;
            for (let e = deg[v]; e < deg[v + 1] && !nearKept; e++) if (kept(adj[e])) nearKept = true;
            if (!nearKept) F[v] = Math.min(F[v], -0.5);
          }
        }
      }
      // fibre coordinate smoothing inside the painted regions
      {
        const tmp = new Float32Array(NV);
        for (let it = 0; it < (J.fibSmooth || 16); it++) {
          yield;
          for (let v = 0; v < NV; v++) {
            if (fP[v] < -0.3 && fS[v] < -0.3) { tmp[v] = fib[v]; continue; }
            let s = fib[v] * 2, n = 2; for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; if (fP[u] >= -0.3 || fS[u] >= -0.3) { s += fib[u]; n++; } }
            tmp[v] = s / n;
          }
          fib.set(tmp);
        }
      }
      // keep the two strongest bulge fields per vertex, with their surface gradients (for normal perturbation)
      for (const [hi, F] of fields) {
        yield* smooth(F, 2, 0.5);
        for (let v = 0; v < NV; v++) {
          const w = F[v]; if (w <= 0.001) continue; const o = v * 4;
          if (w > bm[o + 1]) { bm[o + 2] = bm[o]; bm[o + 3] = bm[o + 1]; bm[o] = hi; bm[o + 1] = w; }
          else if (w > bm[o + 3]) { bm[o + 2] = hi; bm[o + 3] = w; }
        }
      }
      const g0 = new Float32Array(NV * 3), g1 = new Float32Array(NV * 3);
      yield;
      for (let v = 0; v < NV; v++) for (let s = 0; s < 2; s++) {
        const w = bm[v * 4 + s * 2 + 1]; if (w <= 0) continue;
        const F = fields.get(bm[v * 4 + s * 2]); if (!F) continue;
        let gx = 0, gy = 0, gz = 0, ws = 0;
        for (let e = deg[v]; e < deg[v + 1]; e++) { const j = adj[e]; const dx = P[j * 3] - P[v * 3], dy = P[j * 3 + 1] - P[v * 3 + 1], dz = P[j * 3 + 2] - P[v * 3 + 2], df = F[j] - F[v]; gx += df * dx; gy += df * dy; gz += df * dz; ws += dx * dx + dy * dy + dz * dz; }
        if (ws <= 0) continue; gx *= 2 / ws; gy *= 2 / ws; gz *= 2 / ws;
        const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2], dn = gx * nx + gy * ny + gz * nz;
        const Gd = s ? g1 : g0; Gd[v * 3] = gx - dn * nx; Gd[v * 3 + 1] = gy - dn * ny; Gd[v * 3 + 2] = gz - dn * nz;
      }
      const musA = new Float32Array(NV * 4);
      for (let v = 0; v < NV; v++) { musA[v * 4] = fP[v]; musA[v * 4 + 1] = fS[v]; musA[v * 4 + 2] = fib[v]; musA[v * 4 + 3] = stA[v]; }
      return { musA, hd, bm, g0, g1 };
    }
    // The static figure (engine/figure.js): the working muscles painted onto its welded mesh. Guides snap to the mesh
    // itself: the signed distance to the tangent plane of the nearest vertex owned (weight >= 0.5) by the group's bones.
    function* paintFigureGen(J) {
      const T0 = now(), H = J.H, F = J.figure, NV = F.pos.length / 3, P = F.pos, N = F.nor, idx = F.idx, skI = F.skI, skW = F.skW;
      const deg = new Int32Array(NV + 1);
      for (let t = 0; t < idx.length; t++) deg[idx[t] + 1] += 2;
      for (let v = 0; v < NV; v++) deg[v + 1] += deg[v];
      const adj = new Int32Array(deg[NV]), fill = deg.slice(0, NV);
      for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
      // vertex hash grid
      const cs = 0.02 * H, key = (i, j, k) => ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) | 0, grid = new Map();
      for (let v = 0; v < NV; v++) { const k = key(Math.floor(P[v * 3] / cs), Math.floor(P[v * 3 + 1] / cs), Math.floor(P[v * 3 + 2] / cs)); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(v); }
      let allowB = null; const gr = [0, 0, 0];
      const owned = (v) => { if (!allowB) return true; let w = 0; for (let k = 0; k < 4; k++) if (allowB[skI[v * 4 + k]]) w += skW[v * 4 + k]; return w >= 0.5; };
      const nearest = (x, y, z, any) => {
        const ci = Math.floor(x / cs), cj = Math.floor(y / cs), ck = Math.floor(z / cs);
        let best = -1, bd = BIG;
        for (let r = 0; r <= 6; r++) {
          for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
            const L = grid.get(key(i, j, k)); if (!L) continue;
            for (const v of L) { if (!any && !owned(v)) continue; const dx = x - P[v * 3], dy = y - P[v * 3 + 1], dz = z - P[v * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = v; } }
          }
          if (best >= 0 && Math.sqrt(bd) < r * cs) break;
        }
        return best;
      };
      const gradAt = (x, y, z) => {
        let v = nearest(x, y, z, false); if (v < 0) v = nearest(x, y, z, true);
        if (v < 0) { gr[0] = 0; gr[1] = 1; gr[2] = 0; return 0; }
        gr[0] = N[v * 3]; gr[1] = N[v * 3 + 1]; gr[2] = N[v * 3 + 2];
        return (x - P[v * 3]) * gr[0] + (y - P[v * 3 + 1]) * gr[1] + (z - P[v * 3 + 2]) * gr[2];
      };
      const mus = yield* paint(J, P, N, NV, deg, adj, (b) => { allowB = b; }, gradAt, gr, skI, skW);
      return { ...mus, NW: NV, stats: { verts: J.renderVerts || NV, tris: idx.length / 3, paintMs: +(now() - T0).toFixed(0), totalMs: +(now() - T0).toFixed(0), figure: true } };
    }
    function buildSkin(J) { const it = J.figure ? paintFigureGen(J) : buildSkinGen(J); for (;;) { const r = it.next(); if (r.done) return r.value; } }
    return { buildSkin, buildSkinGen, paintFigureGen, makeField };
  }
  g.MCE = g.MCE || {};
  g.MCE.SKIN_MODULE = MCE_SKIN_MODULE;
})(typeof window !== 'undefined' ? window : globalThis);
