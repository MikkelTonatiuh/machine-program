# Contact sheets from body_tests/frames28.mjs shots (the phone page's figure area, bottom and top frame of each exercise).
#   python tools/frames_sheet.py <frames dir> <out.png> [--per 4] [--tile 412] [--crop 0.72] [--only a,b] [--page 1] [--title 'text'] [--all]
#   --per N: exercises per sheet (two tiles each, in rows of 2 exercises per row); --all: one overview sheet of every exercise (small tiles)
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
src, out = args[0], args[1]
def opt(k, d):
    return args[args.index(k) + 1] if k in args else d
tile = int(opt('--tile', 412)); crop = float(opt('--crop', 0.72)); per = int(opt('--per', 4)); page = int(opt('--page', 1))
only = opt('--only', '').split(',') if '--only' in args else None
title = opt('--title', 'Machine Program: MakeHuman (CC0) body, bottom and top frame of every exercise, 412 px wide phone')
res = json.load(open(os.path.join(src, 'results.json'), encoding='utf8'))
ids = []
for s in res['shots']:
    if s['id'] not in ids and (not only or s['id'] in only):
        ids.append(s['id'])
def font(sz):
    for f in ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
NAMES = {}
try:
    NAMES = {}
except Exception:
    pass
def load(id, ph):
    p = os.path.join(src, id + '_' + ('bottom' if ph == '0' else 'top') + '.png')
    if not os.path.exists(p):
        return None
    im = Image.open(p).convert('RGB')
    w, h = im.size
    return im.crop((0, 0, w, int(h * crop)))
ASPECT = 0.72 * 915 / 412
for id0 in ids:
    im0 = load(id0, '0')
    if im0 is not None:
        ASPECT = im0.size[1] / im0.size[0]
        break
if '--all' in args:
    cols, tw = 4, 206
    th = int(tw * ASPECT)
    F1, F2 = font(15), font(13)
    rows = (len(ids) + cols - 1) // cols
    cw, ch = tw * 2 + 6, th + 22
    FOOT = opt('--footer', '')
    img = Image.new('RGB', (cols * (cw + 8) + 8, 44 + rows * (ch + 8) + (26 if FOOT else 0)), (14, 18, 22))
    d = ImageDraw.Draw(img)
    d.text((10, 10), title, fill=(225, 228, 230), font=F1)
    if FOOT:
        d.text((10, img.size[1] - 22), FOOT, fill=(140, 146, 150), font=F2)
    for i, id in enumerate(ids):
        x, y = 8 + (i % cols) * (cw + 8), 44 + (i // cols) * (ch + 8)
        for k, ph in enumerate(('0', 'peak')):
            im = load(id, ph)
            if im is not None:
                img.paste(im.resize((tw, th), Image.LANCZOS), (x + k * (tw + 6), y + 20))
        d.text((x + 2, y + 1), id.replace('_', ' '), fill=(235, 235, 235), font=F2)
        d.text((x + tw - 30, y + 3), 'bottom', fill=(130, 140, 146), font=font(10))
        d.text((x + tw * 2 - 12, y + 3), 'top', fill=(130, 140, 146), font=font(10))
    img.save(out)
    print('wrote', out, img.size, len(ids), 'exercises')
    sys.exit(0)
chunk = ids[(page - 1) * per: page * per]
th = int(tile * ASPECT)
F1, F2 = font(20), font(17)
cols = 2
rows = (len(chunk) + cols - 1) // cols
cw = tile * 2 + 6
img = Image.new('RGB', (cols * (cw + 10) + 10, 40 + rows * (th + 32)), (14, 18, 22))
d = ImageDraw.Draw(img)
d.text((12, 10), title, fill=(225, 228, 230), font=F2)
for i, id in enumerate(chunk):
    x, y = 10 + (i % cols) * (cw + 10), 40 + (i // cols) * (th + 32)
    d.text((x + 2, y + 2), id.replace('_', ' ') + '   (bottom | top)', fill=(235, 235, 235), font=F1)
    for k, ph in enumerate(('0', 'peak')):
        im = load(id, ph)
        if im is not None:
            img.paste(im.resize((tile, th), Image.LANCZOS), (x + k * (tile + 6), y + 28))
img.save(out)
print('wrote', out, img.size, chunk)
