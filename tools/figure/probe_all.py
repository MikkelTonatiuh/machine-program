# Runs the offline probe (tools/sim_probe.mjs) on all exercises and summarises which pass every check.
#   python probe_all.py [mpfb|sdf] [out.txt] [--fit file] [--only a,b,c]
import re, subprocess, sys, os
args = sys.argv[1:]
body = args[0] if args and not args[0].startswith('--') else 'mpfb'
out = args[1] if len(args) > 1 and not args[1].startswith('--') else 'out/probe_all_%s.txt' % body
here = os.path.dirname(os.path.abspath(__file__))
root = here
repo = os.path.normpath(os.path.join(here, '..', '..'))
only = None
extra = []
if '--only' in args:
    only = args[args.index('--only') + 1]
if '--fit' in args:
    extra = ['--fit', args[args.index('--fit') + 1]]
exs = only if only else ','.join(sorted(f[:-5] for f in os.listdir(os.path.join(repo, 'exercises')) if f.endswith('.json') and not f.startswith('_')))
p = subprocess.run(['node', os.path.join(here, 'sim_probe.mjs'), exs, body, '--skin'] + extra, cwd=root, capture_output=True, text=True, encoding='utf8')
txt = p.stdout + p.stderr
open(os.path.join(root, out), 'w', encoding='utf8').write(txt)
blocks = re.split(r'^== ', txt, flags=re.M)[1:]
ok, bad = [], {}
for b in blocks:
    name = b.split()[0]
    issues = []
    m = re.search(r'hand ([\d.e-]+) foot ([\d.e-]+) pin ([\d.e-]+)', b)
    if m:
        h, f, pn = map(float, m.groups())
        if h > 0.004 or f > 0.004 or pn > 0.004:
            issues.append('reach hand %.4f foot %.4f pin %.4f' % (h, f, pn))
    for l in b.splitlines():
        if ' OUT' in l:
            issues.append(re.sub(r'\s+', ' ', l.strip())[:120])
    m = re.search(r'rom violations (\[.*\])', b)
    if m and m.group(1) != '[]':
        issues.append('rom ' + m.group(1)[:90])
    pen = re.findall(r'"(\w+)":\{"maxPen":([\d.]+),[^}]*"ok":false', b)
    if pen:
        issues.append('penetration ' + ', '.join('%s %.1f mm' % (n, float(v) * 1000) for n, v in pen))
    if issues:
        bad[name] = issues
    else:
        ok.append(name)
print('%d of %d pass (%s)' % (len(ok), len(blocks), body))
for k, v in bad.items():
    print('FAIL', k)
    for i in v:
        print('     ', i)
