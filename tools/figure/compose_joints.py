# Joint close-up sheet: one row per exercise, two joints each, current body then MPFB body.
#   python tools/compose_joints.py <joints dir> <out.png>
import sys, os, json
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(src, 'meta.json')))
NAMES = {'chest_press': 'Chest press', 'leg_press': '45\u00b0 leg press\n(deep)', 'lateral_raise': 'Cable lateral\nraise', 'hip_thrust': 'Hip thrust'}
PH = {'0': 'stretch', 'peak': 'contraction'}
def font(sz):
    for f in ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F1, F2 = font(22), font(17)
exs = []
for m in meta:
    if m['ex'] not in exs: exs.append(m['ex'])
T = int(sys.argv[3]) if len(sys.argv) > 3 else 420
LW, TH = 200, 64
W, H = LW + 4 * T, TH + len(exs) * T + 40
img = Image.new('RGB', (W, H), (14, 18, 22))
d = ImageDraw.Draw(img)
d.text((12, 12), 'Joint close-ups: current body vs MakeHuman/MPFB body, the app engine\'s own pose and skin (software render, machine hidden)', fill=(220, 224, 226), font=F2)
for i, ex in enumerate(exs):
    y = TH + i * T
    nm = NAMES.get(ex, ex)
    d.multiline_text((12, y + T // 2 - 14 * (1 + nm.count('\n'))), nm, fill=(235, 235, 235), font=F1, spacing=6)
    row = [m for m in meta if m['ex'] == ex]
    joints = []
    for m in row:
        if m['joint'] not in joints: joints.append(m['joint'])
    for j, jn in enumerate(joints):
        for k, body in enumerate(['sdf', 'mpfb']):
            m = next(m for m in row if m['joint'] == jn and m['body'] == body)
            x = LW + (2 * j + k) * T
            im = Image.open(os.path.join(src, m['file'])).convert('RGB').resize((T, T), Image.LANCZOS)
            img.paste(im, (x, y))
            lab = ('Current' if body == 'sdf' else 'MPFB') + ' \u00b7 ' + jn + ' \u00b7 ' + PH[m['phase']]
            d.text((x + 10, y + 8), lab, fill=(150, 200, 215) if body == 'mpfb' else (200, 200, 200), font=F2)
    d.line([(LW, y), (W, y)], fill=(40, 46, 52))
for j in range(1, 4):
    d.line([(LW + j * T, TH), (LW + j * T, TH + T * len(exs))], fill=(70, 76, 82) if j == 2 else (34, 40, 46), width=3 if j == 2 else 1)
d.text((12, H - 30), 'Same camera for both bodies; no machine drawn so the joint is visible. Glow is the engine\'s muscle paint.', fill=(140, 146, 150), font=F2)
img.save(out)
print('wrote', out, img.size)
