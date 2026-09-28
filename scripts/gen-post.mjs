// cleans the raw gen-assets.mjs output into public/assets/gen: true pixel-art icons + atlas,
// cropped webp posters and labels, native-res pixel logo. needs python3 with numpy/scipy/PIL
// and the gpt-image-mchat skill's pixelize.py. usage: node scripts/gen-post.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = process.env.GEN_RAW || '/tmp/horror-gen-raw';
const PIXELIZE = process.env.GEN_PIXELIZE || join(homedir(), '.claude/skills/gpt-image-mchat/pixelize.py');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../public/assets/gen');
for (const d of ['icons', 'posters', 'labels']) mkdirSync(join(OUT, d), { recursive: true });

const py = String.raw`
import json, sys, subprocess, numpy as np
from PIL import Image, ImageDraw
RAW, OUT, PIX = sys.argv[1], sys.argv[2], sys.argv[3]

def pixelize(src, dst, *args):
    r = subprocess.run([sys.executable, PIX, src, dst, *args], capture_output=True, text=True)
    print(r.stdout.strip(), r.stderr.strip())

# icons: 32x32 canvas, native model grid (capped at 31 cells), 16-colour palette
ICONS = ['almond_water', 'airhorn', 'vhs_tape', 'breaker', 'exit_door', 'phone',
         'compass_arrow', 'skull', 'trophy', 'note']
for n in ICONS:
    pixelize(f'{RAW}/{n}.png', f'{OUT}/icons/{n}.png', '--canvas=32', '--maxgrid=31', '--colors=16', '--despeckle=3')

# checkboxes are simpler to draw than to generate: minecraft slot bevel + green tick
def checkbox(checked):
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([5, 5, 26, 26], fill=(27, 7, 7, 255))          # outline (heart outline colour)
    d.rectangle([7, 7, 24, 24], fill=(139, 139, 139, 255))     # slot grey
    d.line([7, 7, 24, 7], fill=(55, 55, 55, 255), width=2)     # inset shadow top/left
    d.line([7, 7, 7, 24], fill=(55, 55, 55, 255), width=2)
    d.line([8, 24, 24, 24], fill=(255, 255, 255, 255), width=1) # highlight bottom/right
    d.line([24, 8, 24, 24], fill=(255, 255, 255, 255), width=1)
    if checked:
        tick = [(9, 15), (13, 19), (22, 9)]
        d.line(tick, fill=(18, 60, 14, 255), width=5)
        d.line(tick, fill=(92, 200, 52, 255), width=3)
    return im
checkbox(False).save(f'{OUT}/icons/checkbox_unchecked.png', optimize=True)
checkbox(True).save(f'{OUT}/icons/checkbox_checked.png', optimize=True)
ICONS += ['checkbox_unchecked', 'checkbox_checked']

# atlas: 32px cells, 4 columns
cell, cols = 32, 4
rows = (len(ICONS) + cols - 1) // cols
atlas = Image.new('RGBA', (cols * cell, rows * cell), (0, 0, 0, 0))
meta = {'image': 'icons.png', 'cell': cell, 'cols': cols, 'rows': rows, 'pixelated': True, 'icons': {}}
for i, n in enumerate(ICONS):
    x, y = (i % cols) * cell, (i // cols) * cell
    atlas.alpha_composite(Image.open(f'{OUT}/icons/{n}.png').convert('RGBA'), (x, y))
    meta['icons'][n] = {'x': x, 'y': y, 'w': cell, 'h': cell, 'col': i % cols, 'row': i // cols}
atlas.save(f'{OUT}/icons.png', optimize=True)
json.dump(meta, open(f'{OUT}/icons.json', 'w'), indent=2)

# posters: centre crop to 0.72 portrait, 512x711 webp
PAD = {'poster_almond'}
for n in ['meg_notice', 'employee_month', 'poster_almond', 'have_you_seen', 'not_a_vibe', 'moist_carpet']:
    im = Image.open(f'{RAW}/{n}.png').convert('RGB')
    w, h = im.size
    if n in PAD:
        # text runs to the top/bottom edge: widen with plain paper instead of cropping
        cw = round(h * 0.72); pl = (cw - w) // 2
        a = np.array(im)
        paper = np.median(np.concatenate([a[:, :6], a[:, -6:]], 1).reshape(-1, 3), 0)
        side = lambda k: np.clip(paper + np.random.default_rng(k).normal(0, 3, (h, 1, 3)), 0, 255)
        L = np.broadcast_to(side(1), (h, pl, 3)); R = np.broadcast_to(side(2), (h, cw - w - pl, 3))
        im = Image.fromarray(np.concatenate([L, a, R], 1).astype(np.uint8))
    elif w / h > 0.72:
        cw = round(h * 0.72); im = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    else:
        ch = round(w / 0.72); im = im.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
    name = 'almond_water' if n == 'poster_almond' else n
    im.resize((512, 711), Image.LANCZOS).save(f'{OUT}/posters/{name}.webp', quality=80, method=6)

# labels: trim transparent margin, 512 wide
vhs = Image.open(f'{RAW}/vhs_label.png').convert('RGBA')
vhs = vhs.crop(vhs.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox())
vhs.resize((512, round(512 * vhs.height / vhs.width)), Image.LANCZOS).save(f'{OUT}/labels/vhs_label.webp', quality=82, method=6)
al = Image.open(f'{RAW}/almond_label.png').convert('RGB')
al.resize((768, round(768 * al.height / al.width)), Image.LANCZOS).save(f'{OUT}/labels/almond_water_label.webp', quality=82, method=6)

# logo: native pixel grid, drop the soft glow (alpha < 200), then strip bright glow
# crumbs left on the outside of the dark outline
pixelize(f'{RAW}/logo.png', f'{OUT}/logo.png', '--canvas=0', '--alpha=200', '--colors=24', '--despeckle=6')
lg = np.array(Image.open(f'{OUT}/logo.png').convert('RGBA')).astype(int)
for _ in range(2):
    op = lg[..., 3] > 0
    pad = np.pad(op, 1)
    edge = op & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    lum = lg[..., :3] @ np.array([0.3, 0.59, 0.11])
    kill = edge & (lum > 110)
    lg[kill] = 0
ys, xs = np.where(lg[..., 3] > 0)
Image.fromarray(lg[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.uint8), 'RGBA').save(f'{OUT}/logo.png', optimize=True)
print('done')
`;
const r = spawnSync('python3', ['-c', py, RAW, OUT, PIXELIZE], { stdio: 'inherit' });
process.exit(r.status ?? 1);
