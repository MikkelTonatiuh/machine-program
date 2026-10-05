// Stage: the public API the app shell uses.
//   const stage = MCE.Stage.create(container, opts)
//   await stage.load(id)        -> info { id, name, cue, muscles: { primary: [labels], secondary: [labels] }, unilateral, duration, peak, still }
//   stage.prefetch(ids)         -> builds skins in the background (Web Worker) so a later load() is a match cut
//   stage.play() / pause() / isPlaying() / setPhase(t) / suspend(on) / on(event, fn) / off(event, fn) / destroy()
//   stage.orbitStart() / orbitBy(dYaw, dTilt) / orbitEnd(vYaw) / resetView() / setView(v) / view()   the viewer's turn
//   stage.setTimer(p, opts) / setDim(k)                                                             rim light, rest dim
//   stage.screenBounds()        -> { w, h, fig, all } the figure's (and with the machine, all) extent on screen over the
//                                  whole loop at the authored view, CSS px in the stage; null while nothing is shown
//   stage.on('seg', fn)         fn({ phase: 'con' | 'hold' | 'ecc' | 'pause' | 'cycle', dur }) each time the loop enters
//                                  another phase of the rep (dur: its length in seconds)
// One WebGL renderer for the whole app, composited over the 2D horizon backdrop, with grain on top.
// The exercise always plays (autoplay) and loops, whatever prefers-reduced-motion says: the animation is the content.
// Reduced motion only softens the stage's own motion: no easing of the framing, no inertia after a turn, a static grain,
// no fades.
(function (g) {
  'use strict';
  const MCE = g.MCE;
  const { D2R, clamp, EASE } = MCE.util;
  // the viewer's turn: tilt range (deg, added to the exercise's elevation), inertia and reset timing
  const TILT = [-8, 14], FRICTION = 0.32, RESET_MS = 650, ENGAGE_TAU = 0.13;
  const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };
  const FIT_N = 24; // loop phases the framing samples (the frames verify's fill check measures)

  // A solid of revolution about a vertical axis that holds the figure over its whole loop and the machine: the axis is
  // the centre of the smallest circle around them seen from above (Badoiu-Clarkson on a subsample), and each of 12
  // height bands keeps its largest radius (r: figure and machine, rf: the figure alone). Seen from a camera at any
  // elevation it projects the same at every turn of the figure, so a framing of it keeps the figure and the machine in
  // view at any yaw (the orbit view).
  function lathe(fig, nf, mach) {
    const sub = [];
    for (let i = 0; i < nf; i += 3 * 9) sub.push(fig[i], fig[i + 2]);
    for (const p of mach) sub.push(p.x, p.z);
    const n = sub.length / 2;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += sub[i * 2]; cz += sub[i * 2 + 1]; }
    cx /= n; cz /= n;
    for (let it = 1; it <= 90; it++) {
      let far = 0, fd = -1;
      for (let i = 0; i < n; i++) { const dx = sub[i * 2] - cx, dz = sub[i * 2 + 1] - cz, d = dx * dx + dz * dz; if (d > fd) { fd = d; far = i; } }
      cx += (sub[far * 2] - cx) / (it + 1); cz += (sub[far * 2 + 1] - cz) / (it + 1);
    }
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < nf; i += 3) { const y = fig[i + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (const p of mach) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    const NB = 12, hb = Math.max(1e-6, (y1 - y0) / NB), r = new Float64Array(NB), rf = new Float64Array(NB);
    const add = (R, x, y, z) => { const b = Math.min(NB - 1, Math.max(0, Math.floor((y - y0) / hb))), d = Math.hypot(x - cx, z - cz); if (d > R[b]) R[b] = d; };
    for (let i = 0; i < nf; i += 3) add(rf, fig[i], fig[i + 1], fig[i + 2]);
    r.set(rf);
    for (const p of mach) add(r, p.x, p.y, p.z);
    return { cx, cz, y0, y1, hb, r, rf };
  }

  // The vertices of the 2D convex hull (Andrew's monotone chain) of the points (X[i], Y[i]) for i in ord, which is sorted
  // by X then Y; pushed to out. Collinear points are dropped (they are never more extreme than the ends of their edge).
  function hullInto(ord, n, X, Y, H, out) {
    let k = 0;
    const cross = (o, a, b) => (X[a] - X[o]) * (Y[b] - Y[o]) - (Y[a] - Y[o]) * (X[b] - X[o]);
    for (let i = 0; i < n; i++) { const p = ord[i]; while (k >= 2 && cross(H[k - 2], H[k - 1], p) <= 0) k--; H[k++] = p; }
    for (let i = n - 2, t = k + 1; i >= 0; i--) { const p = ord[i]; while (k >= t && cross(H[k - 2], H[k - 1], p) <= 0) k--; H[k++] = p; }
    for (let i = 0; i < k - 1; i++) out.push(H[i]);
  }
  // The points of a set that can be extreme in the framing projection (engine/stage.js _fitFor). The framing camera sits
  // on the line T + d dir (dir = (0, sin el, cos el): the exercise's elevation) and looks at T, so its axes are fixed:
  // right (1, 0, 0), up (0, cos el, -sin el), back dir. A point's NDC x and y are then a / (d - c) and b / (d - c) up to a
  // constant (a, b, c: its coordinates on those axes), a linear-fractional function that takes its extremes over a point
  // set at a vertex of the convex hull of (c, a), resp. (c, b), for every camera distance d beyond the set. So the hull
  // vertices of both planes frame exactly as all the points do. Returns the indices (into pts, 3 values per point).
  function framingCandidates(pts, i0, i1, el) {
    const n = (i1 - i0) / 3, s = Math.sin(el), c = Math.cos(el);
    const C = new Float64Array(n), A = new Float64Array(n), Bv = new Float64Array(n), ord = new Int32Array(n), H = new Int32Array(2 * n + 2), out = [];
    for (let k = 0; k < n; k++) { const j = i0 + k * 3, y = pts[j + 1], z = pts[j + 2]; A[k] = pts[j]; Bv[k] = y * c - z * s; C[k] = y * s + z * c; ord[k] = k; }
    ord.sort((u, v) => C[u] - C[v] || A[u] - A[v]); hullInto(ord, n, C, A, H, out);
    ord.sort((u, v) => C[u] - C[v] || Bv[u] - Bv[v]); hullInto(ord, n, C, Bv, H, out);
    const seen = new Set(), res = [];
    for (const k of out) if (!seen.has(k)) { seen.add(k); res.push(i0 + k * 3); }
    return res;
  }

  // idle scheduling (requestIdleCallback where available; Safari has none: a short timeout and a small time budget)
  const hasRIC = typeof g.requestIdleCallback === 'function';
  const idle = (fn, timeout) => (hasRIC ? g.requestIdleCallback(fn, { timeout: timeout || 1500 })
    : setTimeout(() => { const t0 = MCE.now(); fn({ didTimeout: false, timeRemaining: () => Math.max(0, 5 - (MCE.now() - t0)) }); }, 50));
  const idleP = (timeout) => new Promise((r) => idle(r, timeout));

  // ---------------------------------------------------------------- worker pool (blob: URL workers, main-thread fallback)
  // Worker mode: jobs run in 1-2 blob: workers. Fallback (workers blocked by CSP / sandbox, or a worker that never
  // answers): priority jobs run on the main thread right away, background (prefetch) jobs only one at a time in idle
  // callbacks, so a blocked worker never turns prefetching into a multi-second freeze.
  class SkinWorkers {
    constructor(n, timeoutMs) {
      this.n = Math.max(1, n); this.workers = []; this.queue = []; this.seq = 0; this.pending = new Map(); this.fallback = false;
      this.mod = null; this._logged = false; this._active = []; this.timeoutMs = timeoutMs || 20000;
    }
    _log() {
      if (this._logged) return; this._logged = true;
      try { console.info(this.fallback ? 'MCE: skin builds run on the main thread (Web Workers unavailable)' : 'MCE: skin builds run in a Web Worker'); } catch (_) { /* */ }
    }
    _spawn() {
      if (this.fallback) return null;
      try {
        if (!this.url) {
          const src = 'const M = (' + MCE.SKIN_MODULE.toString() + ')();\n' +
            'self.onmessage = (e) => { const { id, job } = e.data; try { const r = M.buildSkin(job);' +
            ' const tr = Object.values(r).filter((x) => x && x.buffer instanceof ArrayBuffer).map((x) => x.buffer);' +
            ' self.postMessage({ id, r }, tr); } catch (err) { self.postMessage({ id, error: String((err && err.stack) || err) }); } };';
          this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        }
        const w = new Worker(this.url);
        const rec = { w, busy: null, wd: 0 };
        w.onmessage = (e) => { clearTimeout(rec.wd); const p = this.pending.get(e.data.id); this.pending.delete(e.data.id); rec.busy = null; this._log(); if (p) { if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.r); } this._pump(); };
        w.onerror = (e) => { // worker blocked (CSP / sandbox): fall back to the main thread for this and later jobs
          e.preventDefault && e.preventDefault(); this._drop(rec, true);
        };
        this.workers.push(rec); return rec;
      } catch (e) { this.fallback = true; this._log(); return null; }
    }
    // a worker that failed or never answered: it goes, its job is built on the main thread, and so is every later one
    _drop(rec, requeue) {
      clearTimeout(rec.wd); this.fallback = true; this._log();
      const job = rec.busy; rec.busy = null; this.workers = this.workers.filter((x) => x !== rec); try { rec.w.terminate(); } catch (_) { /* */ }
      if (job && requeue) { this.pending.delete(job.id); this.queue.unshift(job); }
      this._pump();
    }
    run(job, priority, tag, idleJob) {
      return new Promise((resolve, reject) => {
        const item = { id: ++this.seq, job, resolve, reject, priority: !!priority, tag, idle: !!idleJob };
        if (priority) { this.queue.unshift(item); this._preempt(); } else this.queue.push(item);
        this._pump();
      });
    }
    // move a queued (not yet started) job to the front, e.g. when the user opens an exercise that is still prefetching;
    // a job the user now waits for is no longer an idle prebuild, so it is never cancelled
    bump(tag) {
      const act = (this._active || []).find((a) => a.item.tag === tag); if (act) { act.item.priority = true; act.item.idle = false; }
      for (const r of this.workers) if (r.busy && r.busy.tag === tag) { r.busy.priority = true; r.busy.idle = false; }
      const i = this.queue.findIndex((q) => q.tag === tag); if (i >= 0) { const it = this.queue.splice(i, 1)[0]; it.priority = true; it.idle = false; this.queue.unshift(it); this._preempt(); }
      this._pump();
    }
    // the user moved on from this exercise before it was built: its build is an ordinary background job again
    demote(tag) {
      for (const a of this._active || []) if (a.item.tag === tag) a.item.priority = false;
      for (const r of this.workers) if (r.busy && r.busy.tag === tag) r.busy.priority = false;
      const i = this.queue.findIndex((q) => q.tag === tag); if (i >= 0) { const it = this.queue.splice(i, 1)[0]; it.priority = false; this.queue.push(it); }
    }
    // cancel queued (not started) background jobs the stage no longer wants (a previous day's neighbours)
    dropQueued(keep) {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const it = this.queue[i]; if (it.priority || keep(it.tag)) continue;
        this.queue.splice(i, 1); const e = new Error('build cancelled'); e.cancelled = true; it.reject(e);
      }
    }
    // anything queued or building (the stage's idle prebuilds wait until this is false)
    busy() { return this.queue.length > 0 || this.pending.size > 0 || (this._active || []).length > 0; }
    // A build the user is waiting for never waits behind a build nobody needs now: when every worker is taken, a worker
    // running an idle prebuild (or else a background build the stage calls stale) is terminated and its job dropped
    // (the stage retries a prebuild in idle time; anything else is built again when it is asked for).
    _preempt() {
      if (this.fallback || this.workers.length < this.n || this.workers.some((r) => !r.busy)) return;
      const rec = this.workers.find((r) => r.busy && r.busy.idle) || this.workers.find((r) => r.busy && !r.busy.priority && this.stale && this.stale(r.busy.tag));
      if (!rec) return;
      clearTimeout(rec.wd);
      const item = rec.busy; rec.busy = null; this.workers = this.workers.filter((x) => x !== rec);
      try { rec.w.terminate(); } catch (_) { /* already gone */ }
      this.pending.delete(item.id);
      const e = new Error('build cancelled'); e.cancelled = true; item.reject(e);
    }
    _pump() {
      while (this.queue.length) {
        if (this.fallback) { this._pumpMain(); return; }
        let rec = this.workers.find((r) => !r.busy);
        if (!rec && this.workers.length < this.n) rec = this._spawn();
        if (!rec) { if (this.fallback) continue; return; }
        const item = this.queue.shift(); rec.busy = item; this.pending.set(item.id, item);
        // a worker that never answers (a hung or silently blocked worker): after timeoutMs it is dropped and the job built
        // on the main thread
        rec.wd = setTimeout(() => { if (rec.busy === item) { try { console.info('MCE: a skin build worker did not answer; building on the main thread'); } catch (_) { /* */ } this._drop(rec, true); } }, this.timeoutMs);
        try { rec.w.postMessage({ id: item.id, job: item.job }); } catch (e) { clearTimeout(rec.wd); this.pending.delete(item.id); rec.busy = null; item.reject(e); }
      }
    }
    // Main-thread fallback: builds run as generator slices (about 12 ms for a load the user is waiting on, up to 10 ms of
    // idle time for prefetches), so the current exercise keeps animating while another one builds. A priority job
    // (or a bumped prefetch) takes the next slice even when a background build is half done.
    _pumpMain() {
      this._active = this._active || [];
      for (let i = 0; i < this.queue.length;) { const q = this.queue[i]; if (q.priority || !this._active.length) { this._active.push({ item: q, it: null }); this.queue.splice(i, 1); } else i++; }
      if (!this._active.length) return;
      const slice = (deadline) => {
        const a = this._active.find((x) => x.item.priority) || this._active[0]; if (!a) return;
        const budget = a.item.priority ? 12 : Math.max(4, Math.min(10, deadline && deadline.timeRemaining ? deadline.timeRemaining() : 8));
        const t0 = MCE.now();
        try {
          if (!this.mod) this.mod = MCE.SKIN_MODULE();
          if (!a.it) a.it = a.item.job.figure ? this.mod.paintFigureGen(a.item.job) : this.mod.buildSkinGen(a.item.job);
          for (;;) { const r = a.it.next(); if (r.done) { this._active.splice(this._active.indexOf(a), 1); a.item.resolve(r.value); break; } if (MCE.now() - t0 > budget) break; }
        } catch (e) { this._active.splice(this._active.indexOf(a), 1); a.item.reject(e); }
        this._pumpMain();
      };
      if (this._active.some((x) => x.item.priority)) { if (!this._prT) this._prT = setTimeout(() => { this._prT = 0; slice(); }, 0); }
      else if (!this._idleT) this._idleT = idle((d) => { this._idleT = 0; slice(d); }, 4000);
    }
    destroy() { for (const r of this.workers) { clearTimeout(r.wd); r.w.terminate(); } this.workers = []; if (this.url) URL.revokeObjectURL(this.url); }
  }

  // ---------------------------------------------------------------- stage
  class Stage {
    static create(container, opts) { return new Stage(container, opts); }
    constructor(container, opts = {}) {
      const THREE = g.THREE; if (!THREE) throw new Error('three.js r147 must be loaded before the engine');
      // reducedMotion: softens the stage's own motion only (see the top of this file); followed live from the media query
      // unless given
      const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
      const rmAuto = opts.reducedMotion == null;
      // finish: the skin finish, 'satin' (the film look: dark satin backlit by the horizon; the Stage default) or 'clay'
      // (light matte clay lit by the key light, after the owner's reference mannequin; the finish the app ships, set in
      // engine/app.js); see MCE.shading.FINISHES
      this.opts = Object.assign({ base: '', maxDpr: 2, fill: 0.58, autoplay: true, workers: Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)),
        cacheSize: 8, grain: true, preserveDrawingBuffer: false, debugMode: 'skin', arc: null, compose: null, finish: 'satin', exercisePath: (id) => 'exercises/' + id + '.json' }, opts);
      // body: 'sdf' (the sculpted body meshed per exercise, the default) or 'mpfb' (the static MakeHuman / MPFB figure,
      // engine/figure.js); a page that passes nothing can try the figure with ?body=mpfb in its address
      if (!this.opts.body) this.opts.body = (typeof location !== 'undefined' && /[?&]body=mpfb(&|$)/.test(location.search)) ? 'mpfb' : 'sdf';
      this.opts.reducedMotion = rmAuto ? !!(mq && mq.matches) : !!opts.reducedMotion;
      this.container = container;
      this.listeners = {};
      // DOM: sky (2D) < rim timer (2D, screen) < gl (WebGL, transparent) < rim bloom (2D, screen) < grain (2D overlay)
      const wrap = this.wrap = document.createElement('div');
      wrap.className = 'mce-stage';
      wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#0e1216;contain:strict;';
      const mk = (cls, css) => { const c = document.createElement('canvas'); c.className = cls; c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;' + (css || ''); wrap.appendChild(c); return c; };
      this.skyCanvas = mk('mce-sky'); this.timerCanvas = mk('mce-rim', 'pointer-events:none;mix-blend-mode:screen;');
      this.glCanvas = mk('mce-gl');
      this.bloomCanvas = mk('mce-bloom', 'pointer-events:none;mix-blend-mode:screen;');
      this.grainCanvas = this.opts.grain ? mk('mce-grain', 'pointer-events:none;mix-blend-mode:overlay;opacity:.17;') : null;
      container.appendChild(wrap);
      this._glTransition();
      if (mq && rmAuto) {
        this._rmMQ = mq; this._onRM = () => this._setReducedMotion(mq.matches);
        if (mq.addEventListener) mq.addEventListener('change', this._onRM); else if (mq.addListener) mq.addListener(this._onRM);
      }
      this.backdrop = new MCE.Backdrop(this.skyCanvas, this.grainCanvas);
      this.rim = new MCE.RimTimer(this.timerCanvas, this.bloomCanvas); this._timer = null;
      // the viewer's turn of the figure: yaw (deg, turntable about the lathe axis), tilt (deg, added to the elevation),
      // w (0 = the authored framing, 1 = the orbit framing that keeps figure and machine in view at any yaw)
      this.viewS = { yaw: 0, tilt: 0, w: 0, vYaw: 0, engaged: false, dragging: false, anim: null };
      THREE.ColorManagement.legacyMode = false;
      const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: !!this.opts.preserveDrawingBuffer, powerPreference: 'high-performance' });
      r.setClearColor(0x000000, 0); r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(24, 1, 0.05, 80);
      this.scene.add(this.camera);
      this.scene.environment = MCE.shading.makeEnvironment(r);
      this.lights = MCE.shading.makeLights(this.scene);
      this.mats = MCE.shading.machineMaterials();
      // WebGL context loss (a GPU reset, a driver update, too many contexts): three.js keeps its objects and uploads them
      // again once the context is back; the environment map lived only on the GPU and is rebuilt, the prefetched figures
      // are warmed again and the frame is redrawn. A context that never comes back: 'contextfail' (the shell shows its
      // quiet placeholder).
      this.lost = false;
      this._onLost = (e) => { e.preventDefault(); this.lost = true; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; clearTimeout(this._lostT); this._lostT = setTimeout(() => { if (this.lost) this.emit('contextfail', {}); }, 4000); this.emit('contextlost', {}); };
      this._onRestored = () => { this.lost = false; clearTimeout(this._lostT); try { this._restoreGL(); } catch (e) { console.warn('MCE: could not restore the WebGL scene', e); } this.emit('contextrestored', {}); };
      this.glCanvas.addEventListener('webglcontextlost', this._onLost, false);
      this.glCanvas.addEventListener('webglcontextrestored', this._onRestored, false);
      this.workers = new SkinWorkers(this.opts.workers, this.opts.workerTimeoutMs);
      // a background build nobody needs now: not the exercise being loaded, not one of the current neighbours
      this.workers.stale = (tag) => tag !== this._wanted && !(this._protect && this._protect.has(tag));
      this.cache = new Map(); this.lru = [];
      this.cur = null; this.phase = 0; this.playing = false; this.suspended = false; this.visible = true; this.pageVisible = !document.hidden; this.raf = 0;
      this.size = { w: 1, h: 1, dpr: 1 };
      this._data().catch(() => { /* reported by the load that needs it; retried then */ });
      this._onVis = () => { this.pageVisible = !document.hidden; this._kick(); };
      document.addEventListener('visibilitychange', this._onVis);
      // resizes are laid out once per frame (a drag of a window edge or a rotation sends a burst of them)
      if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(() => this._layoutSoon()); this.ro.observe(wrap); }
      else addEventListener('resize', this._onResize = () => this._layoutSoon());
      if (typeof IntersectionObserver === 'function') { this.io = new IntersectionObserver((es) => { for (const e of es) this.visible = e.isIntersecting; this._kick(); }); this.io.observe(wrap); }
      this._layout();
    }
    // ------------------------------------------------ events
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return () => this.off(ev, fn); }
    off(ev, fn) { const L = this.listeners[ev]; if (L) this.listeners[ev] = L.filter((f) => f !== fn); }
    emit(ev, d) { for (const f of this.listeners[ev] || []) { try { f(d); } catch (e) { console.error(e); } } }
    // ------------------------------------------------ reduced motion (the stage's own motion only)
    _glTransition() { this.glCanvas.style.transition = this.opts.reducedMotion ? 'none' : 'filter .6s cubic-bezier(.2,0,0,1),opacity .45s cubic-bezier(.2,0,0,1)'; }
    _setReducedMotion(on) {
      this.opts.reducedMotion = !!on; this._glTransition();
      if (on) { this.viewS.vYaw = 0; if (this.viewS.anim) { this.viewS.anim = null; this.viewS.yaw = 0; this.viewS.tilt = 0; this.viewS.w = this.viewS.engaged ? 1 : 0; } }
      this._draw(); this._kick();
    }
    // ------------------------------------------------ data (rig, body, muscles): a failed fetch is retried, never kept
    // A rejected load is forgotten at once, so the next build asks again, after a back-off that doubles per failure
    // (0.6 s, 1.2 s, ... up to 15 s); a transient failure of one file is also retried inside MCE.loadJSON.
    _data() {
      if (this.dataP) return this.dataP;
      const wait = this._dataRetryAt ? Math.max(0, this._dataRetryAt - MCE.now()) : 0;
      const p = this.dataP = (wait ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve())
        .then(() => Promise.all(['data/rig.json', 'data/body.json', 'data/muscles.json'].map((f) => MCE.loadJSON(f, this.opts.base))))
        .then(([rig, body, muscles]) => ({ rig, body: MCE.prepBody(body), muscles: MCE.prepMuscles(muscles) }))
        .then((D) => (this.opts.body === 'mpfb' ? this._figure(D) : D));
      p.then(() => { this._dataFails = 0; this._dataRetryAt = 0; }, () => {
        if (this.dataP === p) this.dataP = null;
        this._dataFails = (this._dataFails || 0) + 1; this._dataRetryAt = MCE.now() + Math.min(15000, 600 * 2 ** (this._dataFails - 1));
      });
      return p;
    }
    // the static figure: its mesh, its definition map, and the rig with the figure's own grip centre and landmarks
    _figure(D) {
      const THREE = g.THREE, base = this.opts.base || '';
      // the definition map: a tangent-space normal map in the file's own uv convention (v down), so no flip and no colour transform
      const map = new Promise((res) => {
        const tex = new THREE.Texture(); tex.flipY = false; tex.encoding = THREE.LinearEncoding; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        new THREE.ImageLoader().load(base + 'data/figure_mpfb_nrm.webp', (img) => { tex.image = img; tex.needsUpdate = true; res(tex); }, undefined, () => res(null));
      });
      // engine/figure.js is loaded here on first use, so a page that never asks for the figure needs no change
      const lib = MCE.Figure ? Promise.resolve() : new Promise((res, rej) => { const el = document.createElement('script'); el.src = base + 'engine/figure.js'; el.onload = res; el.onerror = () => rej(new Error('engine/figure.js did not load')); document.head.appendChild(el); });
      const fit = MCE.loadJSON('data/figure_mpfb_fit.json', base).catch(() => ({}));
      return Promise.all([lib.then(() => MCE.Figure.load(base + 'data/figure_mpfb.glb')), map, fit]).then(([fig, tex, fitTable]) => {
        fig.fit = fitTable;
        if (tex) { tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); fig.normalTex = tex; }
        // look of the figure (Stage option figure: { normalScale, knee, keep, roughness }; the defaults are the tuned ones)
        const look = Object.assign({ normalScale: 1.6, knee: 0.17, keep: 0.45, roughness: null }, this.opts.figure || {});
        fig.normalScale = look.normalScale; fig.knee = look.knee; fig.keep = look.keep; fig.roughness = look.roughness;
        const rig = { ...D.rig, grip: { ...D.rig.grip, ...fig.grip }, landmarks: { ...D.rig.landmarks, ...fig.landmarks } };
        return { ...D, rig, figure: fig };
      });
    }
    // ------------------------------------------------ loading and cache
    // One background build at a time prepares its job (the Instance and its compiled skin job, 10-100 ms of main-thread
    // work on a phone), each step in an idle period, so the exercise on screen keeps its frame rate while the neighbours
    // prefetch; a build the user waits for prepares at once.
    _bgTurn() {
      const prev = this._bgQ || Promise.resolve();
      let release; const mine = new Promise((r) => { release = r; });
      this._bgQ = prev.then(() => mine);
      return prev.then(() => idleP(1500)).then(() => release);
    }
    // low: an idle prebuild (lowest priority; cancelled when the user needs the worker; first to be evicted)
    async _instance(id, priority, low) {
      let rec = this.cache.get(id);
      if (!rec) {
        const t0 = MCE.now();
        const p = (async () => {
          const [D, EX] = await Promise.all([this._data(), MCE.loadJSON(this.opts.exercisePath(id), this.opts.base)]);
          const bg = () => !(priority || this._wanted === id);
          const release = bg() ? await this._bgTurn() : null;
          let inst, job;
          try {
            inst = new MCE.Instance(this, id, EX, D);
            MCE.shading.setFinish(inst.U, this.opts.finish);
            if (release && bg()) await idleP(1500); // the job compiles in the next idle period
            job = inst.compileJob();
          } finally { if (release) release(); }
          const tj = MCE.now();
          const R = await this.workers.run(job, priority || this._wanted === id, id, low && this._wanted !== id);
          inst.attachSkin(R);
          inst.buildStats = { ...R.stats, prepMs: +(tj - t0).toFixed(0), wallMs: +(MCE.now() - t0).toFixed(0), worker: !this.workers.fallback };
          this.emit('build', { id, stats: inst.buildStats });
          return inst;
        })();
        rec = { id, p, inst: null, low: !!low };
        p.then((inst) => {
          if (this.cache.get(id) !== rec) { inst.dispose(); return; } // evicted while it was building
          rec.inst = inst; if (this._wanted !== id) this._scheduleWarm(inst);
          this._trim(); // builds that were in flight may have held the cache over its limit
        }, () => { if (this.cache.get(id) === rec) { this.cache.delete(id); this.lru = this.lru.filter((x) => x !== id); } });
        this.cache.set(id, rec);
      } else if (priority && !rec.inst) this.workers.bump(id);
      if (!low) rec.low = false; // loaded or prefetched for the current day: a normal entry from now on
      this._touch(id, rec.low);
      return rec.p;
    }
    // is this exercise built (a load() of it is a scene swap)?
    isBuilt(id) { const rec = this.cache.get(id); return !!(rec && rec.inst); }
    // Prefetched instances are warmed in idle time so a later load() is only a scene swap: their framing data (a loop
    // phase per idle slice), the framing for the current stage size, then the GPU buffer upload and program binding via
    // one scissored 1x1 draw.
    _scheduleWarm(inst) {
      if (this.destroyed || inst.warm || inst._warming) return;
      inst._warming = true;
      this._prepIdle(inst, () => {
        if (this.destroyed || inst.disposed || inst === this.cur) { inst._warming = false; return; }
        try { this._fitFor(inst); } catch (e) { console.warn('MCE warm', e); }
        idle(() => { inst._warming = false; try { this._warm(inst); } catch (e) { console.warn('MCE warm', e); } }, 600);
      });
    }
    _warm(inst) {
      // an instance evicted before its idle warm-up must not be uploaded again (its buffers would never be freed)
      if (this.destroyed || this.lost || inst.warm || !inst.ready || inst === this.cur || inst.disposed) return;
      inst.warm = true;
      this._fitFor(inst);
      const r = this.renderer, cur = this.cur, vis = cur ? cur.group.visible : false;
      if (cur) cur.group.visible = false;
      this.scene.add(inst.group); inst.frame(inst.motion.peak);
      const F = inst.fits[this.size.w + 'x' + this.size.h];
      const cam = this._warmCam || (this._warmCam = new g.THREE.PerspectiveCamera(24, 1, 0.05, 80));
      cam.aspect = this.size.w / this.size.h; cam.position.copy(F.pos); cam.lookAt(F.T); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      const ac = r.autoClear; r.autoClear = false;
      r.setScissorTest(true); r.setScissor(0, 0, 1, 1);
      r.render(this.scene, cam);
      r.setScissorTest(false); r.autoClear = ac;
      this.scene.remove(inst.group);
      if (cur) cur.group.visible = vis;
      this._draw(); // the scissored pass touched one pixel of the back buffer: redraw the current frame
    }
    // after a WebGL context loss: the environment map again, the prefetched figures warmed again, the frame redrawn
    _restoreGL() {
      const old = this.scene.environment;
      this.scene.environment = MCE.shading.makeEnvironment(this.renderer);
      if (old && old.dispose) { try { old.dispose(); } catch (_) { /* gone with the context */ } }
      for (const rec of this.cache.values()) if (rec.inst) { rec.inst.warm = false; if (rec.inst !== this.cur) this._scheduleWarm(rec.inst); }
      this._draw(); this._kick();
    }
    // LRU with at most cacheSize entries. The exercise on screen (or being loaded) and entries still building are never
    // evicted; evicted instances free their GPU buffers at once. Eviction order: least recently used first among entries
    // that are neither current neighbours (the last prefetch) nor prebuild targets (the other days' first exercises),
    // then among prebuild targets (a prebuilt one enters at the least-recently-used end), and neighbours last.
    _touch(id, low) {
      this.lru = this.lru.filter((x) => x !== id);
      if (low) this.lru.unshift(id); else this.lru.push(id);
      this._trim();
    }
    _trim() {
      const ok = (x) => { const r = this.cache.get(x); return !r || (r.inst && r.inst !== this.cur && x !== this._wanted); };
      const near = (x) => !!(this._protect && this._protect.has(x)), target = (x) => !!(this._idleAll && this._idleAll.has(x));
      while (this.lru.length > this.opts.cacheSize) {
        const old = this.lru.find((x) => ok(x) && !near(x) && !target(x)) ?? this.lru.find((x) => ok(x) && !near(x)) ?? this.lru.find(ok);
        if (old === undefined) break;
        this._evict(old);
      }
    }
    _evict(id) {
      const rec = this.cache.get(id);
      if (rec && rec.inst) rec.inst.dispose();
      this.cache.delete(id); this.lru = this.lru.filter((x) => x !== id);
    }
    // Background builds. With workers blocked (main-thread fallback) only the first two ids are built (pass the
    // neighbours first), each in its own idle callback.
    // prefetch(ids, { idle: true }): idle prebuilds (the app passes the other days' first exercises). The lowest
    // priority: one at a time, only while nothing else is queued or building, the wanted exercise is on screen and the
    // page is visible; only into a free cache slot or the slot of a stale entry (built, not on screen, not in the last
    // normal prefetch, not another prebuild or prebuild target), so they never push out what the user needs next; a
    // build the user is waiting for cancels a running prebuild (it is retried later). Not run when workers are blocked.
    prefetch(ids, opts) {
      if (opts && opts.idle) { this._idleIds = (ids || []).slice(); this._idleAll = new Set(this._idleIds); this._pumpIdle(); return; }
      this._protect = new Set(ids || []);
      this.workers.dropQueued((tag) => tag === this._wanted || this._protect.has(tag)); // a previous day's queued neighbours
      let list = (ids || []).filter((id) => !this.cache.has(id));
      if (this.workers.fallback) list = list.slice(0, 2);
      for (const id of list) this._instance(id, false).catch((e) => { if (!(e && e.cancelled)) this.emit('error', { id, error: e }); });
    }
    _pumpIdle(delay) {
      if (this.destroyed || this._idleWait || this._idleBusy || !(this._idleIds && this._idleIds.length)) return;
      const run = () => {
        this._idleWait = false;
        if (this.destroyed || this.workers.fallback || !this._idleIds.length) return;
        if (this.workers.busy() || !this.pageVisible || (this._wanted && !(this.cur && this.cur.id === this._wanted))) { this._pumpIdle(600); return; }
        let id; do id = this._idleIds.shift(); while (id !== undefined && this.cache.has(id));
        if (id === undefined) return;
        if (!this._makeRoom()) { this._idleIds.length = 0; return; } // full of what the user needs: stop here
        this._idleBusy = true;
        this._instance(id, false, true).then(() => {}, (e) => {
          if (e && e.cancelled) { if (this._idleAll.has(id)) this._idleIds.unshift(id); } // the user needed the worker: retry later
          else this.emit('error', { id, error: e });
        }).then(() => { this._idleBusy = false; this._pumpIdle(400); });
      };
      this._idleWait = true;
      this._idleTimer = setTimeout(() => idle(run, 3000), delay || 0);
    }
    _makeRoom() {
      if (this.cache.size < this.opts.cacheSize) return true;
      const keep = (x) => x === this._wanted || (this._protect && this._protect.has(x)) || (this._idleAll && this._idleAll.has(x));
      const stale = this.lru.find((x) => { const r = this.cache.get(x); return r && r.inst && !r.low && r.inst !== this.cur && !keep(x); });
      if (stale === undefined) return false;
      this._evict(stale); return true;
    }
    // Resolves when the exercise is on screen with its info. If another load() was called meanwhile, this call resolves
    // with { ...info, superseded: true } and does NOT switch; the shell must ignore superseded results.
    async load(id) {
      const token = this._token = (this._token || 0) + 1;
      const prev = this._wanted; this._wanted = id;
      if (prev && prev !== id && !this.isBuilt(prev)) this.workers.demote(prev); // the user moved on before it was built
      // a jump outside the current neighbours (another day): their background builds are stale now, so they give way
      if (this._protect && !this._protect.has(id)) { this._protect = new Set(); this.workers.dropQueued((tag) => tag === id); }
      this.emit('loadstart', { id, cached: !!(this.cache.get(id) && this.cache.get(id).inst) });
      let inst;
      try { inst = await this._instance(id, true); } catch (e) { if (token === this._token) this.emit('error', { id, error: e }); throw e; }
      if (token !== this._token) return Object.assign(this.info(inst), { superseded: true });
      this._show(inst);
      return Object.assign(this.info(inst), { superseded: false });
    }
    info(inst = this.cur) {
      if (!inst) return null;
      const EX = inst.ex;
      const side = EX.muscles && EX.muscles.side;
      return { id: inst.id, name: EX.name, cue: EX.cue || '', muscles: { primary: inst.labels.primary.slice(), secondary: inst.labels.secondary.slice() },
        unilateral: side === 'l' || side === 'r',
        duration: inst.motion.duration, peak: inst.motion.peak, still: inst.motion.still, phase: this.phase, playing: this.playing, build: inst.buildStats };
    }
    _show(inst) {
      if (this.cur && this.cur !== inst) { this.scene.remove(this.cur.group); this.cur.uYaw = 0; }
      this.cur = inst; this.scene.add(inst.group); this._segKey = null;
      // a new exercise opens at its authored view (the viewer's turn resets)
      this.viewS = { yaw: 0, tilt: 0, w: 0, vYaw: 0, engaged: false, dragging: false, anim: null };
      this._fit();
      // the loop starts at the stretched position and plays (autoplay), reduced motion or not
      this.phase = 0; this.phase0 = 0; this.tStart = MCE.now();
      this._draw();
      this.emit('load', this.info());
      this.emit('view', this.view());
      if (this.opts.autoplay) this.play(); else this.pause();
    }
    // ------------------------------------------------ playback
    play() { if (!this.cur) { this.playing = true; return; } if (!this.playing) { this.playing = true; this.phase0 = this.phase; this.tStart = MCE.now(); this.emit('play', {}); } this._kick(); }
    pause() { if (this.playing) { this.playing = false; this.emit('pause', {}); } this._draw(); }
    isPlaying() { return this.playing; }
    setPhase(t) { this.phase = ((+t % 1) + 1) % 1; this.phase0 = this.phase; this.tStart = MCE.now(); this._draw(); return this.phase; }
    // The shell hides the figure (no figure on this step, the end of the day, a figure still loading, an opaque dialog
    // over the stage): nothing renders until it shows again, and the loop goes on from where it was.
    suspend(on) {
      on = !!on; if (this.suspended === on) return;
      this.suspended = on;
      if (on) { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; } else { this._draw(); this._kick(); }
    }
    _kick() {
      const run = (this.playing || this._viewBusy()) && this.visible && this.pageVisible && this.cur && !this.suspended && !this.lost;
      if (run && !this.raf) { this.phase0 = this.phase; this.tStart = MCE.now(); this._tPrev = MCE.now(); this.raf = requestAnimationFrame((t) => this._tick(t)); }
    }
    _tick() {
      this.raf = 0;
      if (!(this.visible && this.pageVisible && this.cur) || this.suspended || this.lost) return;
      const now = MCE.now(), dt = Math.min(0.1, Math.max(0, (now - (this._tPrev || now)) / 1000)); this._tPrev = now;
      const turning = this._stepView(now, dt);
      if (this.playing) {
        const dur = this.cur.motion.duration;
        const ph = this.phase0 + (now - this.tStart) / 1000 / dur;
        const prev = this.phase; this.phase = ((ph % 1) + 1) % 1;
        if (this.phase < prev) this.emit('loop', {});
      }
      this._draw(this.playing ? Math.floor(now / 1000 * 12) : undefined);
      if (turning) this.emit('view', this.view());
      if (this.playing || this._viewBusy()) this.raf = requestAnimationFrame((t) => this._tick(t));
    }
    _draw(grainStep) {
      if (!this.cur || this.suspended) return;
      this._applyView();
      const st = this.cur.frame(this.phase);
      // the shell's coaching text follows the rep: told when the loop enters another phase (lift, hold, lower, pause)
      const sk = st.phase + '|' + (st.seg ? st.seg.t0 : 0);
      if (sk !== this._segKey) { this._segKey = sk; this.emit('seg', { phase: st.phase, dur: st.seg ? st.seg.t1 - st.seg.t0 : 0 }); }
      this._keyDir();
      this.renderer.render(this.scene, this.camera);
      if (this.grainCanvas) this.backdrop.drawGrain(this.size.w, this.size.h, this.size.dpr, this.opts.reducedMotion || grainStep === undefined ? (this.backdrop.lastStep >= 0 ? this.backdrop.lastStep : 0) : grainStep);
      this.lastState = st;
    }
    // ------------------------------------------------ the viewer's turn (orbit)
    // A horizontal drag turns the figure and its machine on a turntable about the lathe axis (the light rig stays with
    // the camera, so the figure is lit the same way from every side); a small vertical tilt is allowed. As soon as the
    // viewer starts turning, the framing eases (ENGAGE_TAU) from the authored one to the orbit framing: the lathe fitted
    // into the figure box, which keeps the figure and the whole machine in frame at every yaw (a gentle zoom, never a
    // clip). resetView() eases back to the authored view; a new exercise opens there.
    view() { const V = this.viewS; return { yaw: +V.yaw.toFixed(2), tilt: +V.tilt.toFixed(2), w: +V.w.toFixed(3), turned: V.engaged || V.w > 0.001 || Math.abs(V.yaw) > 0.01 }; }
    orbitStart() { const V = this.viewS; V.anim = null; V.vYaw = 0; V.dragging = true; V.engaged = true; this._kick(); }
    orbitBy(dYaw, dTilt) {
      const V = this.viewS; if (!this.cur) return;
      V.anim = null; V.engaged = true;
      V.yaw = wrap180(V.yaw + (dYaw || 0)); V.tilt = clamp(V.tilt + (dTilt || 0), TILT[0], TILT[1]);
      if (!this.playing && !this.raf) this._draw(); else this._kick();
      this.emit('view', this.view());
    }
    // vYaw: the release velocity (deg/s); the turn coasts to a stop (no inertia under reduced motion)
    orbitEnd(vYaw) { const V = this.viewS; V.dragging = false; V.vYaw = this.opts.reducedMotion ? 0 : clamp(vYaw || 0, -900, 900); this._kick(); }
    resetView(animate = true) {
      const V = this.viewS;
      if (!animate || this.opts.reducedMotion || !this.cur) { this.viewS = { yaw: 0, tilt: 0, w: 0, vYaw: 0, engaged: false, dragging: false, anim: null }; this._draw(); this.emit('view', this.view()); return; }
      V.vYaw = 0; V.dragging = false; V.engaged = false;
      V.anim = { t0: MCE.now(), yaw: V.yaw, tilt: V.tilt, w: V.w };
      this._kick();
    }
    // an explicit view at once (verification): { yaw, tilt, w } (w defaults to 1 for any turned view)
    setView(v) {
      const turned = !!(v && (v.yaw || v.tilt || v.w));
      this.viewS = { yaw: wrap180((v && v.yaw) || 0), tilt: clamp((v && v.tilt) || 0, TILT[0], TILT[1]), w: v && v.w != null ? clamp(v.w) : turned ? 1 : 0, vYaw: 0, engaged: turned, dragging: false, anim: null };
      this._draw(); this.emit('view', this.view());
    }
    _viewBusy() { const V = this.viewS; return !!(V.anim || V.vYaw || V.dragging || V.w !== (V.engaged ? 1 : 0)); }
    // advance the reset animation, the inertia and the framing weight; true while anything moved
    _stepView(now, dt) {
      const V = this.viewS;
      if (V.anim) {
        const t = clamp((now - V.anim.t0) / RESET_MS), e = EASE.sine(t);
        V.yaw = V.anim.yaw * (1 - e); V.tilt = V.anim.tilt * (1 - e); V.w = V.anim.w * (1 - e);
        if (t >= 1) { V.anim = null; V.yaw = 0; V.tilt = 0; V.w = 0; }
        return true;
      }
      let moved = false;
      if (V.vYaw && !V.dragging) {
        V.yaw = wrap180(V.yaw + V.vYaw * dt); V.vYaw *= Math.exp(-dt / FRICTION);
        if (Math.abs(V.vYaw) < 4) V.vYaw = 0;
        moved = true;
      }
      const wt = V.engaged ? 1 : 0;
      if (V.w !== wt) {
        V.w += (wt - V.w) * (1 - Math.exp(-dt / ENGAGE_TAU));
        if (Math.abs(V.w - wt) < 0.003 || this.opts.reducedMotion) V.w = wt; // reduced motion: the framing changes at once
        moved = true;
      }
      return moved;
    }
    // ------------------------------------------------ rim-light timer, rest dim
    // p: 0..1 along the rim (null: off); opts: { head: false (a steady lit rim), k: 0..1 strength } (MCE.RimTimer)
    setTimer(p, o) { this._timer = p == null ? null : { p, o: o || {} }; this._drawTimer(); }
    _drawTimer() { const T = this._timer; this.rim.draw(this.size.w, this.size.h, this.size.dpr, this.arc, T ? T.p : 0, T ? T.o : null); }
    // dim the figure (not the horizon): 1 = normal; the player rests at about 0.6 and opens the rep picker at about 0.35
    setDim(k) {
      k = clamp(+k || 0, 0.1, 1);
      if (this._dim === k) return; this._dim = k;
      this.glCanvas.style.filter = k < 0.999 ? 'brightness(' + k.toFixed(3) + ')' : '';
    }
    _keyDir() { // key light direction in view space for the glow's form shading
      const k = this.lights.key, d = k.position.clone().sub(k.target.position).normalize();
      d.transformDirection(this.camera.matrixWorldInverse);
      if (this.cur) this.cur.U.uKeyV.value.copy(d);
    }
    // ------------------------------------------------ layout + framing
    _arc(w, h) {
      if (this.opts.arc) return this.opts.arc(w, h);
      const aspect = w / h;
      const y = h * (aspect >= 1.1 ? 0.84 : aspect >= 0.9 ? 0.83 : 0.81);
      const R = (aspect < 0.9 ? 1.9 : 1.25) * Math.max(w, h);
      return { y, R };
    }
    // The composition: the horizon arc { x, y, R } and the box the figure is framed in { x0, y0, x1, y1 } (CSS px).
    // Default: the classic stage (the arc at 0.84 / 0.83 / 0.81 of the height for landscape / square / portrait, the box
    // the whole stage; opts.arc(w, h) replaces the arc). opts.compose(w, h) replaces both: the guided player passes
    // MCE.playerLayout (engine/backdrop.js), whose box is a virtual classic stage above its text.
    _compose(w, h) {
      if (this.opts.compose) { const c = this.opts.compose(w, h); return Object.assign({}, c, { arc: Object.assign({ x: w / 2 }, c.arc), box: c.box || { x0: 0, y0: 0, x1: w, y1: h } }); }
      return { arc: Object.assign({ x: w / 2 }, this._arc(w, h)), box: { x0: 0, y0: 0, x1: w, y1: h } };
    }
    // the arc's y at stage x (CSS px): a figure framed off the apex stands on the curve, not on the apex height
    _arcY(x) { const A = this.arc, dx = x - A.x; return A.y + A.R - Math.sqrt(Math.max(0, A.R * A.R - dx * dx)); }
    _layoutSoon() { if (this._lq || this.destroyed) return; this._lq = requestAnimationFrame(() => { this._lq = 0; this._layout(); }); }
    _layout() {
      if (this._lq) { cancelAnimationFrame(this._lq); this._lq = 0; }
      const rect = this.wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(g.devicePixelRatio || 1, this.opts.maxDpr);
      if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
      this.size = { w, h, dpr };
      this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
      this.comp = this._compose(w, h); this.arc = this.comp.arc;
      this.backdrop.draw(w, h, dpr, this.arc);
      this._drawTimer();
      if (this.cur) this._fit();
      this.backdrop.lastStep = -1;
      this._draw(0); // a resize clears the WebGL buffer: redraw now
      this.emit('resize', { w, h, dpr, arc: this.arc, comp: this.comp, edge: this.backdrop.edge });
    }
    // comp.fade [y0, y1] (the player's composition): the figure layer is fully transparent from y1 down (the text lives
    // there) and fades in above it, from the figure's lowest point (+ 4 px, within [y0, y1 - 6]), so only machine parts
    // reaching further down fade and none of them touches the text; turned (weight k of the orbit framing), the figure may
    // reach down to the arc + comp.dip.fig, and the fade moves there. A CSS mask on the figure layer only (the horizon
    // and the grain stay); updated only when it changes.
    _applyMask(F, k) {
      const D = this.comp.fade; let css = '';
      if (D) {
        const lo = D[0], y1 = D[1], hi = Math.max(lo, y1 - 6);
        let y0 = F && Number.isFinite(F.figBottom) ? clamp(F.figBottom + 4, lo, hi) : lo;
        if (k > 0 && this.comp.dip) { const B = this.comp.box, yo = clamp(this._arcY((B.x0 + B.x1) / 2) + this.comp.dip.fig + 2, lo, hi); y0 += (yo - y0) * k; }
        css = 'linear-gradient(to bottom, #000 ' + Math.round(y0) + 'px, rgba(0,0,0,0) ' + Math.round(y1) + 'px)';
      }
      if (css !== this._maskCss) { this._maskCss = css; this.glCanvas.style.webkitMaskImage = css; this.glCanvas.style.maskImage = css; }
    }
    // The size-independent framing data of an instance: its sampled skin over FIT_N loop phases at the authored view,
    // reduced to the points that can be extreme in the framing projection (framingCandidates), their bounding-box centre
    // T, the machine's bounds points and the lathe. A generator, one loop phase per step: prefetched instances run it in
    // idle slices (_prepIdle), an instance needed now runs the rest at once (_prepNow).
    *_prepGen(inst) {
      const N = FIT_N, ns = inst.sampleIds ? inst.sampleIds.length : 0, fig = new Float64Array(N * ns * 3), mach = [], machT = [], cand = [];
      let nf = 0, bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
      for (let i = 0; i < N; i++) {
        const uYaw = inst.uYaw || 0; inst.uYaw = 0;
        inst.frame(i / N); const o = nf; nf = inst.samplePositions(fig, nf); inst.machine.boundsPoints(mach, machT);
        inst.uYaw = uYaw;
        for (let j = o; j < nf; j += 3) {
          const x = fig[j], y = fig[j + 1], z = fig[j + 2];
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
        }
        for (const j of framingCandidates(fig, o, nf, inst.el)) cand.push(fig[j], fig[j + 1], fig[j + 2]);
        if (i < N - 1) yield i;
      }
      // the candidates of all phases reduced once more (the extreme points of the whole loop are among them)
      const reduce = (A) => { const C = Float64Array.from(A), keep = framingCandidates(C, 0, C.length, inst.el), P = new Float64Array(keep.length * 3);
        keep.forEach((j, k) => { P[k * 3] = C[j]; P[k * 3 + 1] = C[j + 1]; P[k * 3 + 2] = C[j + 2]; }); return P; };
      const pts = reduce(cand), mpts = reduce(machT); // the machine's oriented part boxes over the loop, reduced the same way
      inst.lathe = inst.lathe || lathe(fig, nf, mach); // size-independent: built once per instance
      inst.fitPrep = { T: new g.THREE.Vector3((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2), pts, np: pts.length / 3, mach, mpts, samples: nf / 3 };
      inst._prepIt = null;
      if (inst === this.cur) inst.frame(this.phase);
    }
    _prepNow(inst) {
      if (inst.fitPrep) return inst.fitPrep;
      const it = inst._prepIt || (inst._prepIt = this._prepGen(inst));
      while (!it.next().done) { /* the rest at once */ }
      return inst.fitPrep;
    }
    // One instance at a time, in idle slices: steps while the idle period has room for one more (at least one per
    // callback). A page that is never idle (every frame drawn back to back, as on a busy phone) still gets a callback
    // within 200 ms: one loop phase (about 10 ms at a phone's speed) per 200 ms, never a stall.
    _prepIdle(inst, done) {
      if (inst.fitPrep) { done(); return; }
      (this._prepQ = this._prepQ || []).push({ inst, done });
      this._prepPump();
    }
    _prepPump() {
      if (this._prepBusy || this.destroyed || !this._prepQ || !this._prepQ.length) return;
      const { inst, done } = this._prepQ.shift();
      if (inst.disposed) { this._prepPump(); return; }
      if (inst.fitPrep) { done(); this._prepPump(); return; }
      this._prepBusy = true;
      const it = inst._prepIt || (inst._prepIt = this._prepGen(inst));
      let cost = 3;
      const next = (ok) => { this._prepBusy = false; if (ok) done(); this._prepPump(); };
      const slice = (dl) => {
        if (this.destroyed) return;
        if (inst.disposed) { next(false); return; }
        if (inst.fitPrep) { next(true); return; } // finished meanwhile (a load or a resize needed it at once)
        for (;;) {
          const t0 = MCE.now(), r = it.next(); cost = 0.6 * cost + 0.4 * (MCE.now() - t0);
          if (r.done || inst.fitPrep) { next(true); return; }
          const left = dl && typeof dl.timeRemaining === 'function' ? dl.timeRemaining() : 0;
          if (left < cost + 1) break;
        }
        idle(slice, 200);
      };
      idle(slice, 200);
    }
    // Framing for an instance at the current stage size, cached per size on the instance. Uses its own camera so it can
    // run for a prefetched instance in idle time without touching the live view. The figure is framed in the box: its
    // height is fill x the box height, it stays within 88 % of the box width and 3.5 % of the box height below its top,
    // it is centred in the box, and the floor point under it sits on the arc (with the box the whole stage: the classic
    // framing, unchanged). The figure's extent comes from its framing candidates (_prepGen: exactly the extent of all
    // its sampled points over the loop), so a new size costs well under a millisecond.
    _fitFor(inst) {
      const THREE = g.THREE, { w, h } = this.size, key = w + 'x' + h;
      inst.fits = inst.fits || {};
      if (inst.fits[key]) return inst.fits[key];
      const FP = this._prepNow(inst), fig = FP.pts, nf = FP.np * 3, mach = FP.mach, T = FP.T;
      const cam = this._fitCam || (this._fitCam = new THREE.PerspectiveCamera(24, 1, 0.05, 80));
      const Bx = this.comp.box, bw = Bx.x1 - Bx.x0, bh = Bx.y1 - Bx.y0, bcx = (Bx.x0 + Bx.x1) / 2, arcY = this._arcY(bcx);
      const el = inst.el, dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
      // the figure's height is fill x the box height (NDC: a fraction of the stage height), its width at most 88 % of
      // the box width
      const fill = (inst.cam.fill || this.opts.fill) * bh / h, wmax = 0.88 * bw / w;
      cam.fov = 24; cam.aspect = w / h; cam.clearViewOffset(); cam.updateProjectionMatrix();
      let d = 5 * inst.H;
      const place = () => { cam.position.copy(T).addScaledVector(dir, d); cam.lookAt(T); cam.updateMatrixWorld(true); };
      // projected extent (NDC) of the figure points, and with withMach of the machine bounds too: Vector3.project inlined
      // with one combined view-projection matrix
      const PV = this._fitPV || (this._fitPV = new THREE.Matrix4());
      const ext = (withMach, tight) => {
        const e = PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        const flat = (P, n) => { for (let i = 0; i < n; i += 3) {
          const px = P[i], py = P[i + 1], pz = P[i + 2], iw = 1 / (e[3] * px + e[7] * py + e[11] * pz + e[15]);
          const x = (e[0] * px + e[4] * py + e[8] * pz + e[12]) * iw, y = (e[1] * px + e[5] * py + e[9] * pz + e[13]) * iw;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        } };
        flat(fig, nf);
        if (tight && FP.mpts) flat(FP.mpts, FP.mpts.length);
        if (withMach) for (const p of mach) {
          const iw = 1 / (e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15]);
          const x = (e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12]) * iw, y = (e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13]) * iw;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return { x0, x1, y0, y1 };
      };
      for (let it = 0; it < 5; it++) { place(); const e = ext(false); d *= ((e.y1 - e.y0) / 2) / fill; }
      place();
      // the whole figure must also fit the width (reclined / lying figures): at most 88% of the box width
      { const e0 = ext(false), wf = (e0.x1 - e0.x0) / 2; if (wf > wmax) { d *= wf / wmax; place(); } }
      // horizontal: centre the figure in the box. fitMachine: centre figure + machine together, and back off only if that
      // combined extent is wider than 88 % of the box (a machine on one side of the figure no longer doubles the back-off)
      let e = ext(false);
      const cxOf = () => { const q = inst.cam.fitMachine ? ext(true) : e; return (q.x0 + q.x1) / 2; };
      if (inst.cam.fitMachine) { const m = ext(true), hw = (m.x1 - m.x0) / 2; if (hw > wmax) { d *= hw / wmax; place(); e = ext(false); } }
      let cxN = cxOf();
      // vertical: the floor point under the figure goes on the arc
      const fp = new THREE.Vector3(T.x, 0, T.z).project(cam);
      const yFloor = (1 - fp.y) / 2 * h, xC = (1 + cxN) / 2 * w;
      let offY = yFloor - arcY, offX = xC - bcx;
      // keep the figure's top inside the box with a small margin (and under comp.figTop when the composition reserves a
      // band above the figure for the shell's coaching text: the figure backs off until it clears it)
      const topPx = (1 - e.y1) / 2 * h - offY, topMin = Math.max(Bx.y0 + 0.035 * bh, this.comp.figTop || 0);
      if (topPx < topMin) { const k = (arcY - topMin) / Math.max(1, arcY - topPx); d /= Math.max(0.5, k); place(); const fp2 = new THREE.Vector3(T.x, 0, T.z).project(cam); e = ext(false); cxN = cxOf(); offY = (1 - fp2.y) / 2 * h - arcY; offX = (1 + cxN) / 2 * w - bcx; }
      // camera.shiftX: move the figure by this fraction of the box width (+ right), e.g. to keep a foot plate or a
      // weight stack on one side of the figure inside the frame without shrinking the figure (fitMachine)
      offX -= (inst.cam.shiftX || 0) * bw;
      // The figure reaches no deeper below the arc than the composition allows it (comp.dip.fig, the orbit view's
      // allowance; the fade mask can then always start under the figure): a figure whose feet reach further down (the
      // incline press's feet on their plate, seen from above, reached 1-2 px short of the text, so the fade took their
      // lowest 8-9 px on every phone and panel) backs off until they fit. Every other framing: unchanged.
      let dipBack = null; // the distance factor when this had to act (diagnostics)
      if (this.comp.dip && this.comp.fade) {
        const allow = arcY + this.comp.dip.fig, d0 = d;
        for (let it = 0; it < 8; it++) {
          const low = (1 - e.y0) / 2 * h - offY;
          if (low <= allow + 0.25) break;
          d *= Math.max(1.001, (low - arcY) / Math.max(1, allow - arcY)); place(); e = ext(false); cxN = cxOf();
          const fp4 = new THREE.Vector3(T.x, 0, T.z).project(cam);
          offY = (1 - fp4.y) / 2 * h - arcY; offX = (1 + cxN) / 2 * w - bcx - (inst.cam.shiftX || 0) * bw;
          dipBack = +(d / d0).toFixed(4);
        }
      }
      // The side layout (the text in a column right of the box, engine/backdrop.js playerLayout): nothing of the figure
      // or its machine enters the text column (a long machine, the hip thrust's levers and plates or the leg press's
      // sled, ran behind the title). The machine counts with the oriented boxes of its parts over the loop (mpts). The
      // right edge of figure and machine stays 3 % of the box width inside the box (as in the orbit framing): the view
      // moves left while the figure has room (its left edge stays 3 % inside the box too; machine parts on the left may
      // crop at the stage edge), then backs off until both fit. Every other layout: unchanged.
      let clear = null; // { dx: px moved left, back: distance factor } when the side layout had to act (diagnostics)
      if (this.comp.mode === 'side' && FP.mpts && FP.mpts.length) {
        const xL = Bx.x0 + 0.03 * bw, xR = Bx.x1 - 0.03 * bw, d0 = d, ox0 = offX;
        for (let it = 0; it < 8; it++) {
          const r = (1 + ext(false, true).x1) / 2 * w - offX, over = r - xR;
          if (over <= 0.5) break;
          const fl = (1 + e.x0) / 2 * w - offX;
          clear = true;
          if (fl - xL >= over) { offX += over; break; }
          d *= Math.max(1.001, (r - fl) / Math.max(1, xR - xL)); place(); e = ext(false);
          const fp3 = new THREE.Vector3(T.x, 0, T.z).project(cam);
          offY = (1 - fp3.y) / 2 * h - arcY; offX = (1 + e.x0) / 2 * w - xL;
        }
        if (clear) clear = { dx: +(offX - ox0).toFixed(1), back: +(d / d0).toFixed(4) };
      }
      // the figure's lowest point on screen over the loop (CSS px): where the fade of machine parts may start
      const figBottom = (1 - e.y0) / 2 * h - offY;
      return (inst.fits[key] = { pos: cam.position.clone(), T, offX, offY, d, figBottom, clear, dipBack });
    }
    // Where the figure is on screen: its extent over the whole loop at the authored view (the framing _fitFor chose), and
    // with the machine's parts too (all), in CSS px of the stage. The shell places its coaching text in the free space
    // around it. Not the viewer's turn: while the figure is turned the shell hides that text. Cached per size.
    screenBounds() {
      const inst = this.cur; if (!inst) return null;
      const THREE = g.THREE, { w, h } = this.size, key = w + 'x' + h;
      inst.bounds = inst.bounds || {};
      if (inst.bounds[key]) return inst.bounds[key];
      const F = this._fitFor(inst), FP = inst.fitPrep;
      const cam = this._boundsCam || (this._boundsCam = new THREE.PerspectiveCamera(24, 1, 0.05, 80));
      cam.fov = 24; cam.aspect = w / h; cam.position.copy(F.pos); cam.lookAt(F.T);
      cam.setViewOffset(w, h, F.offX, F.offY, w, h); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      const v = new THREE.Vector3(), fig = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, all = Object.assign({}, fig);
      const add = (o, P, n) => {
        for (let i = 0; i < n; i += 3) {
          v.set(P[i], P[i + 1], P[i + 2]).project(cam);
          const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
          if (x < o.x0) o.x0 = x; if (x > o.x1) o.x1 = x; if (y < o.y0) o.y0 = y; if (y > o.y1) o.y1 = y;
        }
      };
      add(fig, FP.pts, FP.pts.length);
      Object.assign(all, fig);
      if (FP.mpts) add(all, FP.mpts, FP.mpts.length);
      return (inst.bounds[key] = { w, h, fig, all });
    }
    // The orbit framing at the current size for a tilt (deg): the lathe (figure over the loop + machine, about its axis)
    // fitted into the box from the exercise's elevation plus the tilt, its floor point (the axis at the floor) on the
    // arc; its top stays 1.5 % of the box height under the top band (comp.top; the box top on a classic stage), its
    // sides 3 % inside the box, and below the arc the
    // figure reaches at most comp.dip.fig px and the machine comp.dip.all px (the player's text starts under that; the
    // classic stage allows its whole lower band). It never frames closer than the authored view (turning never zooms
    // in). Cached per size and tilt (to 0.1 deg): a drag that tilts refits in well under a millisecond.
    _orbitFit(inst, tilt) {
      const THREE = g.THREE, { w, h } = this.size, key = w + 'x' + h + '|' + tilt.toFixed(1);
      inst.ofits = inst.ofits || {};
      if (inst.ofits[key]) return inst.ofits[key];
      const L = inst.lathe, Bx = this.comp.box, bw = Bx.x1 - Bx.x0, bh = Bx.y1 - Bx.y0, bcx = (Bx.x0 + Bx.x1) / 2, arcY = this._arcY(bcx);
      const el = inst.el + tilt * D2R, dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
      const Tc = new THREE.Vector3(L.cx, (L.y0 + L.y1) / 2, L.cz);
      // the lathe's rings: each band's radius at its lower and upper edge, 32 points around (figure-only rings apart)
      const rings = (R) => { const P = []; for (let b = 0; b < R.length; b++) { const r = R[b]; if (!(r > 0)) continue; for (const y of [L.y0 + b * L.hb, L.y0 + (b + 1) * L.hb]) for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2; P.push(L.cx + r * Math.cos(a), y, L.cz + r * Math.sin(a)); } } return P; };
      const PA = rings(L.r), PF = rings(L.rf);
      // the top: under the composition's top band when it has one (the sky above the figure box is free), else the box
      const D = this.comp.dip, room = Bx.y1 - arcY, topY = (this.comp.top != null ? this.comp.top : Bx.y0) + 0.015 * bh;
      const up = Math.max(8, arcY - topY), downF = Math.max(4, D ? D.fig : room), downA = Math.max(4, D ? D.all : room), half = 0.47 * bw;
      const cam = this._orbitCam || (this._orbitCam = new THREE.PerspectiveCamera(24, 1, 0.05, 80));
      cam.fov = 24; cam.aspect = w / h; cam.clearViewOffset(); cam.updateProjectionMatrix();
      const PV = this._orbPV || (this._orbPV = new THREE.Matrix4());
      let d = 5 * inst.H, ax = 0, ay = 0, e = null;
      const place = () => { cam.position.copy(Tc).addScaledVector(dir, d); cam.lookAt(Tc); cam.updateMatrixWorld(true); e = PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements; };
      const pr = (x, y, z) => { const iw = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]); return [((e[0] * x + e[4] * y + e[8] * z + e[12]) * iw + 1) / 2 * w, (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw) / 2 * h]; };
      for (let it = 0; it < 12; it++) {
        place(); [ax, ay] = pr(L.cx, 0, L.cz);
        let mu = 0, md = 0, mh = 0, mf = 0;
        for (let i = 0; i < PA.length; i += 3) { const [x, y] = pr(PA[i], PA[i + 1], PA[i + 2]); mu = Math.max(mu, ay - y); md = Math.max(md, y - ay); mh = Math.max(mh, Math.abs(x - ax)); }
        for (let i = 0; i < PF.length; i += 3) mf = Math.max(mf, pr(PF[i], PF[i + 1], PF[i + 2])[1] - ay);
        const s = Math.max(mu / up, md / downA, mf / downF, mh / half);
        if (Math.abs(s - 1) < 0.001) break;
        d *= s;
      }
      // never closer than the authored view: the same projected size per unit length at the target
      const F = this._fitFor(inst);
      if (d < F.pos.distanceTo(F.T)) { d = F.pos.distanceTo(F.T); place(); [ax, ay] = pr(L.cx, 0, L.cz); }
      return (inst.ofits[key] = { pos: cam.position.clone(), T: Tc, offX: ax - bcx, offY: ay - arcY });
    }
    // The live camera for the current view: the authored framing, blended toward the orbit framing by the view's weight,
    // and the figure group turned by the viewer's yaw about the lathe axis (Instance.frame applies it).
    _applyView() {
      const inst = this.cur; if (!inst || this.opts.view) return;
      const V = this.viewS, cam = this.camera, { w, h } = this.size, F = this._fitFor(inst), L = inst.lathe;
      inst.uYaw = L ? V.yaw * D2R : 0; inst.pivot = L ? [L.cx, L.cz] : null;
      let pos = F.pos, T = F.T, ox = F.offX, oy = F.offY;
      const k = L && V.w > 0 ? EASE.sine(V.w) : 0;
      if (k > 0) {
        const O = this._orbitFit(inst, Math.round(V.tilt * 10) / 10);
        pos = (this._vp || (this._vp = new g.THREE.Vector3())).copy(F.pos).lerp(O.pos, k);
        T = (this._vt || (this._vt = new g.THREE.Vector3())).copy(F.T).lerp(O.T, k);
        ox += (O.offX - ox) * k; oy += (O.offY - oy) * k;
      }
      cam.fov = 24; cam.aspect = w / h; cam.position.copy(pos); cam.lookAt(T);
      cam.setViewOffset(w, h, ox, oy, w, h); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      this._applyMask(F, k);
    }
    // Per-exercise auto-fit: the figure (sampled skin over the whole loop) fills `fill` of the box height, the floor
    // under the figure sits on the fixed arc, the figure is centred; machine parts may extend (and crop at the top).
    _fit() {
      const THREE = g.THREE, inst = this.cur, { w, h } = this.size, cam = this.camera;
      if (this.opts.view) { // explicit camera for close-up study renders: { az, el, dist (H), target: [x, y, z] (H, figure space) }
        const V = this.opts.view, H = inst.H;
        inst.yaw = (V.az ?? inst.cam.az) * D2R; const el = (V.el ?? 8) * D2R;
        inst.frame(V.t ?? this.phase);
        // target: figure-space point (H), or a bone's world position at phase V.t (e.g. { bone: 'hand_l', t: 0.3 })
        const T = V.bone && inst.skel.bones[V.bone] ? inst.skel.bones[V.bone].obj.getWorldPosition(new THREE.Vector3())
          : new THREE.Vector3(...(V.target || [0, 0.6, 0])).multiplyScalar(H).applyAxisAngle(new THREE.Vector3(0, 1, 0), inst.yaw);
        inst.frame(this.phase);
        cam.fov = V.fov || 24; cam.aspect = w / h; cam.clearViewOffset();
        cam.position.copy(T).add(new THREE.Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar((V.dist || 1.2) * H)); cam.lookAt(T);
        cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); return;
      }
      this._applyView();
    }
    destroy() {
      this.destroyed = true; this._idleIds = []; clearTimeout(this._idleTimer); clearTimeout(this._lostT);
      cancelAnimationFrame(this.raf); this.raf = 0; this.playing = false; if (this._lq) cancelAnimationFrame(this._lq);
      document.removeEventListener('visibilitychange', this._onVis);
      if (this._rmMQ) { if (this._rmMQ.removeEventListener) this._rmMQ.removeEventListener('change', this._onRM); else if (this._rmMQ.removeListener) this._rmMQ.removeListener(this._onRM); }
      this.glCanvas.removeEventListener('webglcontextlost', this._onLost); this.glCanvas.removeEventListener('webglcontextrestored', this._onRestored);
      if (this.ro) this.ro.disconnect(); if (this.io) this.io.disconnect(); if (this._onResize) removeEventListener('resize', this._onResize);
      for (const rec of this.cache.values()) if (rec.inst) rec.inst.dispose();
      this.cache.clear(); this.workers.destroy();
      this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss();
      this.wrap.remove(); this.listeners = {};
    }
  }
  MCE.Stage = Stage;
  MCE.SkinWorkers = SkinWorkers;
})(typeof window !== 'undefined' ? window : globalThis);
