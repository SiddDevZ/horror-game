# post-process the gpt-image (mchat) raws in .cache/ui-gen-raw into public/assets/ui-gen and write ui-gen/README.md.
# posters: pad to 0.72 with the median edge colour (text touches the edges, so never crop) -> 512x711 webp.
# props: trim to alpha (or keep opaque), cap the long side, webp. prints the manifest block as json.
import json, os, sys
from PIL import Image
import numpy as np

ROOT = sys.argv[1]
RAW = os.path.join(ROOT, '.cache/ui-gen-raw')
OUT = os.path.join(ROOT, 'public/assets/ui-gen')
jobs = {j['id']: j for j in json.load(open(os.path.join(RAW, 'jobs.json')))}
log = {}
for line in open(os.path.join(RAW, 'run.log')):
    parts = line.split(' ', 2)
    if len(parts) == 3 and parts[2].startswith('{'):
        log[parts[0]] = json.loads(parts[2])
os.makedirs(os.path.join(OUT, 'posters'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'props'), exist_ok=True)
PROPS = {'sign_ohio': 768, 'note_fanum_tax': 512, 'label_hydrate': 1024, 'sign_nerd': 512, 'decal_sus': 768}
man, rows = {}, []
for jid, j in jobs.items():
    im = Image.open(os.path.join(RAW, f'raw_{jid}.png')).convert('RGBA')
    if jid.startswith('poster_'):
        name = jid[len('poster_'):]
        rgb = im.convert('RGB')
        a = np.asarray(rgb)
        edge = np.concatenate([a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
        fill = tuple(int(v) for v in np.median(edge, axis=0))
        w, h = rgb.size
        tw = round(h * 0.72)
        if tw > w:
            c = Image.new('RGB', (tw, h), fill); c.paste(rgb, ((tw - w) // 2, 0)); rgb = c
        else:
            th = round(w / 0.72); c = Image.new('RGB', (w, th), fill); c.paste(rgb, (0, (th - h) // 2)); rgb = c
        rgb = rgb.resize((512, 711), Image.LANCZOS)
        path = f'posters/{name}.webp'
        rgb.save(os.path.join(OUT, path), 'WEBP', quality=80, method=6)
        size = rgb.size
    else:
        name = jid
        alpha = im.getchannel('A')
        has_alpha = alpha.getextrema()[0] < 250
        if has_alpha:
            bb = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
            if bb: im = im.crop(bb)
        cap = PROPS.get(jid, 768)
        s = cap / max(im.size)
        if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        path = f'props/{name}.webp'
        (im if has_alpha else im.convert('RGB')).save(os.path.join(OUT, path), 'WEBP', quality=82, method=6, **({'exact': True} if has_alpha else {}))
        size = im.size
        man[name] = {'image': 'ui-gen/' + path, 'w': size[0], 'h': size[1], 'alpha': bool(has_alpha), 'aspect': round(size[0] / size[1], 4)}
    L = log.get(jid, {})
    rows.append(f"| `{path}` | {size[0]}x{size[1]}, {os.path.getsize(os.path.join(OUT, path)) / 1024:.1f} KB | {L.get('size', '?')} / {L.get('quality', '?')} / {L.get('background', '?')} | {L.get('secs', '?')}s | {j['p']} |")
readme = ['# ui-gen: original meme textures (gpt-image via mchat)', '',
          'Made by the assets/ui agent with the `gpt-image-mchat` skill, model **gpt-image-2** through the local mchat gateway, 2026-09-27. ',
          'Raw PNGs, the job list and the run log are in `.cache/ui-gen-raw/`; `python3 scripts/ui_gen_post.py .` rebuilds this folder from them. Generation is not deterministic.', '',
          '- `posters/*.webp`: 512x711 (0.72), padded with the median edge colour. They are packed into `img/posters.webp` by `scripts/meme_atlas.py` (cells 19-23).',
          '- `props/*.webp`: textures for meme props (`manifest.memeTextures`): alpha-trimmed when the model returned transparency.', '',
          '| file | size | returned size / quality / bg | latency | prompt |', '|---|---|---|---|---|'] + rows
open(os.path.join(OUT, 'README.md'), 'w').write('\n'.join(readme) + '\n')
print(json.dumps(man))
