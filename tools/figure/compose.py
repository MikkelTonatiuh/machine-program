# Contact sheet: rows = exercises, columns = current body / MPFB body at the stretch and at the contraction.
#   python tools/compose.py <shots dir> <out.png> [tile px]
import sys, os
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
T = int(sys.argv[3]) if len(sys.argv) > 3 else 400
EMU = len(sys.argv) > 4 and sys.argv[4] == 'emu'
EX = [('chest_press', 'Chest press'), ('leg_press', '45\u00b0 leg press\n(deep)'), ('lateral_raise', 'Cable lateral\nraise'), ('hip_thrust', 'Hip thrust')]
COLS = [('sdf', 'stretch', 'Current body \u00b7 stretch'), ('mpfb', 'stretch', 'MPFB body \u00b7 stretch'), ('sdf', 'peak', 'Current body \u00b7 contraction'), ('mpfb', 'peak', 'MPFB body \u00b7 contraction')]
def font(sz):
    for f in ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F1, F2 = font(22), font(17)
LW, TH = 200, 64
W, Hh = LW + T * len(COLS), TH + T * len(EX) + 40
img = Image.new('RGB', (W, Hh), (14, 18, 22))
d = ImageDraw.Draw(img)
d.text((12, 12), 'Machine Program figure preview: current SDF body vs MakeHuman/MPFB body (same engine, camera, clay finish, glow)', fill=(220, 224, 226), font=F2)
for j, (_, _, lab) in enumerate(COLS):
    d.text((LW + j * T + 10, 38), lab, fill=(150, 200, 215) if 'MPFB' in lab else (190, 190, 190), font=F2)
import json
RES = {}
try:
    RES = json.load(open(os.path.join(src, 'results.json')))
except Exception:
    pass
def crop_box(ex, w, h):
    # union of the figure's screen extent over the loop for both bodies, as a square with a margin
    xs0, xs1, ys0, ys1 = [], [], [], []
    for b in ('sdf', 'mpfb'):
        e = (RES.get(b + ':' + ex) or {}).get('extent')
        if e: xs0.append(e['fig']['x0']); xs1.append(e['fig']['x1']); ys0.append(e['fig']['y0']); ys1.append(e['fig']['y1'])
    if not xs0: return (0, 0, w, h)
    x0, x1, y0, y1 = min(xs0), max(xs1), min(ys0), max(ys1)
    side = max(x1 - x0, y1 - y0) * 1.32
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = min(side, w, h)
    bx = max(0, min(w - side, cx - side / 2)); by = max(0, min(h - side, cy - side / 2))
    return (int(bx), int(by), int(bx + side), int(by + side))
for i, (ex, name) in enumerate(EX):
    y = TH + i * T
    d.multiline_text((12, y + T // 2 - 14 * (1 + name.count('\n'))), name, fill=(235, 235, 235), font=F1, spacing=6)
    for j, (body, ph, _) in enumerate(COLS):
        p = os.path.join(src, f'{ex}_{body}_{ph}.png')
        if os.path.exists(p):
            im0 = Image.open(p).convert('RGB')
            im = im0.crop(crop_box(ex, *im0.size)).resize((T, T), Image.LANCZOS)
            img.paste(im, (LW + j * T, y))
        else:
            d.rectangle([LW + j * T, y, LW + (j + 1) * T - 1, y + T - 1], outline=(80, 40, 40))
            d.text((LW + j * T + 10, y + 10), 'missing', fill=(200, 80, 80), font=F2)
    d.line([(LW, y), (W, y)], fill=(40, 46, 52))
for j in range(1, len(COLS)):
    d.line([(LW + j * T, TH), (LW + j * T, TH + T * len(EX))], fill=(60, 66, 72) if j == 2 else (34, 40, 46), width=3 if j == 2 else 1)
if EMU:
    d.text((12, Hh - 30), 'Software render of the app engine\'s own solve, skin, pads and glow data, with the clay shading emulated (not a GPU frame). Stretch = loop start, contraction = peak hold. MPFB body = CC0 MakeHuman mesh.', fill=(140, 146, 150), font=F2)
else:
    d.text((12, Hh - 30), 'Stretch = loop start, contraction = peak hold. Same engine, camera, clay finish and glow. MPFB body = CC0 MakeHuman mesh.', fill=(140, 146, 150), font=F2)
img.save(out)
print('wrote', out, img.size)
