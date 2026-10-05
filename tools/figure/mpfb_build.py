# Blender 4.5 + MPFB 2.0.17, headless:
#   blender -b --factory-startup? (no: the extension must load) -P mpfb_build.py -- <out.json> '<params json>'
# Builds one MakeHuman body with MPFB (macro sliders + a few local targets), solves the "height" slider so the stature is
# the requested one, and writes every base-mesh vertex (shape keys mixed, helpers included, MPFB vertex order) plus the
# MPFB default rig fitted to it, as JSON. Everything else (weights, joints, posing, faceless head, skinning to the
# engine skeleton) is done by the node pipeline from these positions and MPFB's CC0 data files.
import bpy, sys, json, time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0]
P = (json.load(open(argv[1])) if argv[1].endswith('.json') else json.loads(argv[1])) if len(argv) > 1 else {}
t0 = time.time()

try:
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
except Exception as e:  # already enabled
    print('enable:', e)

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

def build(OUT, P):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    macro = {
        'gender': P.get('gender', 1.0), 'age': P.get('age', 0.5), 'muscle': P.get('muscle', 1.0), 'weight': P.get('weight', 0.35),
        'proportions': P.get('proportions', 1.0), 'height': P.get('height', 0.5), 'cupsize': 0.5, 'firmness': 0.5,
        'race': P.get('race', {'asian': 1 / 3, 'caucasian': 1 / 3, 'african': 1 / 3}),
    }
    basemesh = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True,
                                         feet_on_ground=False, scale=0.1, macro_detail_dict=macro)

    for name, w in (P.get('targets') or {}).items():
        path = TargetService.target_full_path(name)
        if not path:
            raise RuntimeError('no target ' + name)
        TargetService.load_target(basemesh, path, weight=float(w))

    body_n = 13380  # MakeHuman hm08: vertices 0..13379 are the body, the rest are helpers


    def coords():
        dg = bpy.context.evaluated_depsgraph_get()
        ev = basemesh.evaluated_get(dg)
        me = ev.to_mesh()
        mw = basemesh.matrix_world
        co = [mw @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        return co


    def stature(co):
        zs = [c.z for c in co[:body_n]]
        return max(zs) - min(zs)


    target_h = P.get('stature')
    if target_h:
        # secant search on the height slider (macro targets are re-mixed by MPFB each time)
        def set_h(h):
            HumanObjectProperties.set_value('height', h, entity_reference=basemesh)
            TargetService.reapply_macro_details(basemesh)
            return stature(coords())
        h0, h1 = 0.5, 0.7
        s0, s1 = set_h(h0), set_h(h1)
        for it in range(6):
            if abs(s1 - target_h) < 0.0005 or s1 == s0:
                break
            h2 = min(1.0, max(0.0, h1 + (target_h - s1) * (h1 - h0) / (s1 - s0)))
            h0, s0, h1 = h1, s1, h2
            s1 = set_h(h1)
            print('height %.4f -> stature %.4f' % (h1, s1))
        macro['height'] = h1

    co = coords()
    st = stature(co)
    print('stature', st)

    # MPFB's own fitted default rig, for cross-checking the node joint fit
    bones = {}
    try:
        arm = HumanService.add_builtin_rig(basemesh, 'default', import_weights=False)
        mw = arm.matrix_world
        for b in arm.data.bones:
            h, t = mw @ b.head_local, mw @ b.tail_local
            bones[b.name] = {'head': [h.x, h.y, h.z], 'tail': [t.x, t.y, t.z], 'parent': b.parent.name if b.parent else None}
    except Exception as e:
        print('rig:', e)

    flat = []
    for c in co:
        flat += [round(c.x, 6), round(c.y, 6), round(c.z, 6)]
    meta = {'macro': macro, 'targets': P.get('targets') or {}, 'stature': st, 'mpfb': '2.0.17', 'blender': bpy.app.version_string,
            'seconds': round(time.time() - t0, 1)}
    with open(OUT, 'w') as f:
        json.dump({'co': flat, 'bones': bones, 'meta': meta}, f)
    print('wrote', OUT, len(co), 'vertices', meta)


for v in (P.get('variants') or [dict(P, out=OUT)]):
    build(v.get('out', OUT), v)
