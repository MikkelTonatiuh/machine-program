# The static figure (Stage option `body: 'mpfb'`)

`data/figure_mpfb.glb` and `data/figure_mpfb_nrm.webp` are made here, once, offline. Blender is never needed at run time.
`?body=mpfb` in the page address (or `Stage.create(el, { body: 'mpfb' })`) shows the figure; the default is still the
sculpted body. If the figure files fail to load, the stage falls back to the sculpted body.

## What is made

- A male MakeHuman body (muscle 100 %, weight 0.35, idealistic proportions, 1.78 m) from the MPFB add-on, with a smooth
  faceless head (no eyes, brows, teeth, tongue), 13,380 vertices and 26,756 triangles, UVs kept.
- Skinned to the app's own 21 bones (`data/rig.json`) plus two forearm twist helpers: every exercise's keyframes, IK, pins,
  contacts and machines work unchanged. The bind pose is the figure's own (A-pose, fists closed around a 30 mm handle);
  `extras` in the file carries the bind pose of each bone, the fist's grip centre (`grip.offset`, hand-local, H) and the
  landmarks re-measured on this skin (`rig.json` landmarks keep their names).
- Muscle glow: the engine's own painter (`engine/skinbuild.js`, `paintFigureGen`) runs per exercise in the worker on the
  shared mesh with the same `data/muscles.json` heads and guides, about 80 ms; nothing is meshed per exercise.
- Definition: a 1024 x 1024 tangent-space normal map baked from the muscle heads (bellies, grooves where heads meet) and the
  relief lines of `data/body.json` (linea alba, intersections, V-lines, pec edge, natal cleft, spinal furrow) plus
  `figure_relief_extra.json` (abs borders, serratus), so the visible separations line up with the glow.
- Pads: `engine/shading.js` (`PADS`) pushes skin out of up to 8 pads (rounded boxes and cylinders, from the machine parts that
  carve the sculpted body) in the vertex shader; `Instance.samplePositions` does the same on the CPU for framing and probes.
- `data/figure_mpfb_fit.json`: per exercise, machine parts moved by a vector (H) so the pads meet this body where they met
  the sculpted one; `{ exercise: { part: [dx, dy, dz] | { at|from|to|pivot: [dx, dy, dz] } } }`.

## Steps

1. Blender 4.5 with MPFB 2.0.17 (extensions.blender.org, `add-on-mpfb-v2.0.17.zip`, SHA-256
   `4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87`):
   `blender -b --command extension install-file --repo user_default --enable add-on-mpfb-v2.0.17.zip`
2. Unpack the add-on's `data/` folder to `tools/figure/mpfb_src/data/` (`3dobjs`, `rigs/standard`, `mesh_metadata`, `targets`).
3. Shape the body in Blender (writes every base-mesh vertex and the add-on's fitted rig as JSON):
   `blender -b -P mpfb_build.py -- shaped/body.json '{"weight":0.35,"stature":1.78}'`
4. Map it to the engine's skeleton, faceless head, weights, ambient occlusion, GLB:
   `node figure_out.mjs --shaped shaped/body.json --targets targets_athletic.json --name figure --headT0 0.2 --nippleR 0.05 --nippleIters 400`
   (`targets_athletic.json`: local MPFB targets mixed in node on top of the shaped body; `figure_backfill.json`: the deeper
   back that makes the torso meet the machines' back pads where the sculpted body did).
5. Bake the definition map: `node bake_definition.mjs --name figure --relief 1.6`, then encode `out/figure/nrm.png` as WebP
   (`PIL.Image.save(..., 'WEBP', quality=90, method=6)`).
6. Copy `out/figure/figure.glb` to `data/figure_mpfb.glb` and the WebP to `data/figure_mpfb_nrm.webp`, then `node tools/pwa.mjs`.

Checks without a browser: `pose_preview.mjs` (an exercise's key poses by FK, dual-quaternion skinned like the engine),
`glow_preview.mjs` (where the glow lands), `nm_preview.mjs` (the normal map decoded the way three.js does, next to the
geometry), `mesh_views.mjs`, `depth_rest.mjs` (torso depth against the sculpted body).

## The engine in node (no browser)

`engine_sim.mjs` runs the app's own engine files (core, rig, motion, machine, shading, skinbuild, instance, figure) on
`three_shim.mjs`, a small stand-in for the parts of three.js the solve path uses, with the same data. It reproduces the
browser's verify numbers exactly (the authoring workspace's reports for hip thrust, leg curl and preacher curl match to the
last digit: joint angles, hand and pin errors, pad contact distances). `probe.js` is the verification probe of the authoring
workspace (`engine/probe.js`) with the figure's pad press, a pad-fit probe and the pad normal of failing skin checks added.

- `node sim_look.mjs` / `node sim_looks_close.mjs <exercise> <phase>`: the four preview exercises, or a close view of the torso under
  several finish settings, with the app's skin shading emulated in software (`engine_shade.mjs`: the clay finish, the definition map, the
  glow, ACES tone mapping; its skin luminance matches a headless-Chrome render of the engine to within a few per cent).
  `python compose.py out/simlook sheet.png 440 emu` lays the tiles out as the preview contact sheet.
- `node sim_joints.mjs out/joints` and `python compose_joints.py out/joints sheet.png`: close-ups of the groin, armpit, knee and
  elbow of the four preview exercises (both bodies, one camera per joint, machine hidden, same skin shading emulation).
- `node cpu_frame.mjs`: per-frame CPU time (solve and skin uniforms), triangle and vertex counts and scene build time, both bodies.
- `node sim_probe.mjs chest_press,leg_press mpfb [--skin] [--fit none|file]`: reach, pins, pad contacts, skin penetration and
  clearance checks, ROM, for the figure (`mpfb`) or the sculpted body (`sdf`); all 28 exercises take about 11 s.
- `node fit_offline.mjs all [--dry]`: moves the pads the figure does not meet toward it (by the gap along the pad's normal) and
  checks again; writes `data/figure_mpfb_fit.json`.
- `node sim_sheet.mjs <exercises> out/sim` and `python compose.py out/sim sheet.png`: both bodies at the stretch and the peak,
  software-rendered next to the machine parts (geometry, contact and glow placement, not the app's shading); `sim_close.mjs`
  renders a joint close up.

## Licence

MakeHuman's base mesh, targets, rig definitions, weights and UVs are CC0 (the base mesh file says so; the weights file says
CC0): the shipped GLB and normal map are CC0-derived data, no credit required. The MPFB add-on's code is GPL-3.0-or-later; it
is only a tool here, nothing of it is shipped or linked, and `mpfb_src/` (its data folder) is not committed.
