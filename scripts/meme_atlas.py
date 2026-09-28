# builds public/assets/img/posters.webp and tv.webp from the cached meme images, the generated posters in
# public/assets/gen/posters (read only) and the villain cutouts. prints one json line for the manifest.
# usage: python3 scripts/meme_atlas.py <cache dir> <public/assets> <project root> [debug dir]
import json, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import numpy as np

CACHE, OUT, ROOT = sys.argv[1], sys.argv[2], sys.argv[3]
DEBUG = sys.argv[4] if len(sys.argv) > 4 else None
IMG = os.path.join(CACHE, 'img')
GEN = os.path.join(OUT, 'gen', 'posters')
UIGEN = os.path.join(OUT, 'ui-gen', 'posters')  # this script's own generated posters (see ui-gen/README.md)
CUT = os.path.join(OUT, 'img')
known = json.load(open(os.path.join(CACHE, 'images.json')))

PW, PH = 256, 356  # poster cell, aspect 0.719
TW, TH = 256, 192  # tv cell, 4:3
PAPER = (236, 229, 207)
INK = (28, 24, 18)
SUP = '/System/Library/Fonts/Supplemental/'
rng = np.random.default_rng(0x9057e5)


def font(name, size):
    for f in (SUP + name, '/Library/Fonts/' + name):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def cover(im, w, h, fx=0.5, fy=0.5, box=None):
    """crop to w:h around a focus point (fractions of the (optionally pre-cropped) image), then resize"""
    if box:
        W0, H0 = im.size
        im = im.crop((int(box[0] * W0), int(box[1] * H0), int(box[2] * W0), int(box[3] * H0)))
    W0, H0 = im.size
    r = w / h
    if W0 / H0 > r:
        cw, ch = int(H0 * r), H0
    else:
        cw, ch = W0, int(W0 / r)
    x = min(max(0, int(fx * W0 - cw / 2)), W0 - cw)
    y = min(max(0, int(fy * H0 - ch / 2)), H0 - ch)
    return im.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)


def fit_text(d, text, fnt_name, box_w, box_h, max_size, min_size=10, spacing=0.08):
    """largest size (<= max) at which the text wraps into box; returns (font, lines)"""
    for size in range(max_size, min_size - 1, -1):
        f = font(fnt_name, size)
        words, lines, cur = text.split(), [], ''
        for wd in words:
            t = (cur + ' ' + wd).strip()
            if d.textlength(t, font=f) <= box_w:
                cur = t
            else:
                if cur:
                    lines.append(cur)
                cur = wd
        lines.append(cur)
        lh = size * (1 + spacing)
        if len(lines) * lh <= box_h and all(d.textlength(l, font=f) <= box_w for l in lines):
            return f, lines, lh
    f = font(fnt_name, min_size)
    return f, [text], min_size * 1.1


def draw_block(d, text, fnt_name, box, max_size, fill=INK, stroke=0, stroke_fill=None, valign='center'):
    x0, y0, x1, y1 = box
    f, lines, lh = fit_text(d, text, fnt_name, x1 - x0, y1 - y0, max_size)
    total = lh * len(lines)
    y = y0 + ((y1 - y0 - total) / 2 if valign == 'center' else 0)
    for l in lines:
        w = d.textlength(l, font=f)
        d.text((x0 + (x1 - x0 - w) / 2, y), l, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
        y += lh


def age(im, amount=0.06):
    """printed-paper grain + a faint vignette so the posters sit in the corridor light"""
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    h, w = a.shape[:2]
    a += rng.normal(0, 255 * amount * 0.35, (h, w, 1))
    yy, xx = np.mgrid[0:h, 0:w]
    v = 1 - 0.18 * (((xx / w - 0.5) ** 2 + (yy / h - 0.5) ** 2) * 2.2)
    a *= v[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def load(id_):
    return Image.open(os.path.join(IMG, known[id_]['file'])).convert('RGB')


def tape(p):
    d = ImageDraw.Draw(p, 'RGBA')
    for cx in (22, PW - 22):
        d.polygon([(cx - 20, -2), (cx + 18, 4), (cx + 14, 20), (cx - 24, 14)], fill=(214, 206, 170, 150))


def meme_poster(id_, top, bottom, focus=(0.5, 0.5), box=None, caption=None):
    """classic meme: picture on paper, impact caption band underneath, optional impact top text"""
    p = Image.new('RGB', (PW, PH), PAPER)
    ph = 262
    pic = cover(load(id_), PW - 20, ph, focus[0], focus[1], box)
    p.paste(pic, (10, 10))
    d = ImageDraw.Draw(p)
    if top:
        draw_block(d, top.upper(), 'Impact.ttf', (16, 14, PW - 16, 70), 34, fill=(250, 250, 246), stroke=3, stroke_fill=(12, 12, 12), valign='top')
    d.rectangle((10, 10, PW - 11, 10 + ph - 1), outline=(60, 52, 40), width=1)
    draw_block(d, bottom.upper(), 'Impact.ttf', (14, 10 + ph + 6, PW - 14, PH - 10), 30)
    tape(p)
    return age(p), {'caption': caption or f'{top + " " if top else ""}{bottom}'.strip(), 'source': f'imgflip template "{known[id_]["title"]}" {known[id_]["url"]} (page {known[id_]["page"]}); caption added', 'kind': 'meme'}


def drake_poster():
    p = Image.new('RGB', (PW, PH), PAPER)
    src = load('drake')  # 2x2: drake left column, empty right column
    pic = src.resize((PW - 20, PW - 20), Image.LANCZOS)
    p.paste(pic, (10, 24))
    d = ImageDraw.Draw(p)
    half = (PW - 20) // 2
    draw_block(d, 'LEAVING THE BACKROOMS', 'Impact.ttf', (10 + half + 6, 30, PW - 16, 24 + half - 6), 24)
    draw_block(d, 'ONE MORE HALLWAY', 'Impact.ttf', (10 + half + 6, 24 + half + 6, PW - 16, 24 + 2 * half - 6), 24)
    draw_block(d, 'EVERY SINGLE TIME', 'Impact.ttf', (14, 24 + PW - 20 + 8, PW - 14, PH - 12), 28)
    tape(p)
    return age(p), {'caption': 'Leaving the Backrooms? Nah. One more hallway? Yeah.', 'source': f'imgflip template "{known["drake"]["title"]}" {known["drake"]["url"]}; captions added', 'kind': 'meme'}


def gen_poster(name, caption, composite=None, folder=None):
    path = os.path.join(folder or GEN, name + '.webp')
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert('RGB')  # 512x711
    if composite:
        composite(im)
    p = im.resize((PW, PH), Image.LANCZOS)
    where = 'ui-gen/README.md (ui-gen/posters' if folder else 'gen/README.md (gen/posters'
    return p, {'caption': caption, 'source': f'generated: gpt-image via mchat, see {where}/{name}.webp)' + (', villain cutout composited' if composite else ''), 'kind': 'generated'}


def cutout(name):
    return Image.open(os.path.join(CUT, name + '.webp')).convert('RGBA')


def put_eotm(im):
    # kanye in the empty gold frame (interior x 142-378, y 188-452 at 512 px)
    x0, y0, x1, y1 = 144, 190, 377, 451
    k = cutout('kanye')
    s = (y1 - y0 - 8) / k.height
    k = k.resize((int(k.width * s), int(k.height * s)), Image.LANCZOS)
    if k.width > x1 - x0:
        k = k.crop(((k.width - (x1 - x0)) // 2, 0, (k.width - (x1 - x0)) // 2 + (x1 - x0), k.height))
    im.paste(k, (x0 + (x1 - x0 - k.width) // 2, y1 - k.height), k)


def put_missing(im):
    # trump replaces the "?" silhouette: photocopied grey, bottom of the photo box (x 91-421, y 170-488)
    x0, y0, x1, y1 = 93, 172, 419, 486
    box = im.crop((x0, y0, x1, y1))
    bg = np.asarray(box).reshape(-1, 3)
    light = np.median(bg[bg.mean(1) > 150], axis=0) if (bg.mean(1) > 150).any() else np.array([205, 205, 200])
    d = ImageDraw.Draw(im)
    d.rectangle((x0, y0, x1, y1), fill=tuple(int(v) for v in light))
    t = cutout('trump')
    s = (y1 - y0 - 6) / t.height
    t = t.resize((int(t.width * s), int(t.height * s)), Image.LANCZOS)
    g = ImageOps.autocontrast(t.convert('L'), cutoff=2).point(lambda v: min(255, int(v * 1.05)))
    g = Image.merge('RGBA', (g, g, g, t.split()[3]))
    im.paste(g, (x0 + (x1 - x0 - t.width) // 2, y1 - t.height), g)
    # a little toner speckle over the photo so it matches the flyer
    a = np.asarray(im).astype(np.int16)
    n = rng.normal(0, 10, (y1 - y0, x1 - x0, 1)).astype(np.int16)
    a[y0:y1, x0:x1] = np.clip(a[y0:y1, x0:x1] + n, 0, 255)
    im.paste(Image.fromarray(a.astype(np.uint8)))


def wanted_poster():
    p = Image.new('RGB', (PW, PH), (226, 212, 176))
    d = ImageDraw.Draw(p)
    d.rectangle((6, 6, PW - 7, PH - 7), outline=(74, 50, 26), width=3)
    draw_block(d, 'WANTED', 'Impact.ttf', (14, 12, PW - 14, 70), 58, fill=(92, 36, 20))
    draw_block(d, 'FOR LOITERING IN LEVEL 0', 'Arial Black.ttf', (14, 72, PW - 14, 96), 15, fill=(60, 40, 22))
    xs = [(18, -5), (88, 3), (160, -3)]
    for (x, rot), n in zip(xs, ('kanye', 'epstein', 'trump')):
        c = cutout(n)
        c = c.resize((int(c.width * 150 / c.height), 150), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC, expand=True)
        sep = ImageOps.colorize(c.convert('L'), (60, 36, 16), (238, 220, 180))
        sep.putalpha(c.split()[3])
        p.paste(sep, (x, 102), sep)
    d.line((20, 268, PW - 20, 268), fill=(74, 50, 26), width=2)
    draw_block(d, 'REWARD: 3 ALMOND WATER', 'Impact.ttf', (14, 274, PW - 14, 312), 28, fill=(92, 36, 20))
    draw_block(d, 'do not approach. they are flat. they are fast.', 'Arial Bold.ttf', (18, 314, PW - 18, PH - 14), 13, fill=(60, 40, 22))
    return age(p, 0.08), {'caption': 'WANTED for loitering in Level 0. Reward: 3 almond water.', 'source': 'original: composed from the villain cutouts (public/assets/img) with Impact / Arial Black', 'kind': 'original'}


def build_posters():
    cells = [
        meme_poster('doge', 'such hallway', 'very moist. wow.', (0.5, 0.45)),
        meme_poster('stonks', None, 'almond water futures: stonks', (0.5, 0.5), box=(0, 0, 0.6, 1)),
        meme_poster('this_is_fine', None, 'this is fine', (0.5, 0.5), box=(0, 0, 0.5, 1)),
        meme_poster('harold', None, '0 days since last noclip', (0.5, 0.35)),
        meme_poster('gigachad', None, 'average level 0 enjoyer', (0.5, 0.3)),
        meme_poster('trollface', 'problem,', 'wanderer?', (0.5, 0.5)),
        meme_poster('surprised_pikachu', 'the hallway had', 'another hallway', (0.5, 0.5), box=(0.08, 0.36, 0.92, 1)),
        meme_poster('among_us', None, 'when the cutout is sus', (0.5, 0.5)),
        drake_poster(),
        gen_poster('employee_month', 'Employee of the Month: nobody (again). Month: ongoing.', put_eotm),
        gen_poster('have_you_seen', 'Have you seen this man? Answers to: Kevin.', put_missing),
        gen_poster('almond_water', 'Stay hydrated. It is probably fine.'),
        gen_poster('meg_notice', 'M.E.G. safety notice: do not make eye contact with the PNG.'),
        gen_poster('moist_carpet', 'Caution: moist carpet. Do not ask why.'),
        gen_poster('not_a_vibe', 'Level 0 is not a vibe.'),
        wanted_poster(),
        # v3: appended so existing cell indices stay put
        meme_poster('sad_pablo', None, 'waiting for the exit to get power', (0.5, 0.5)),
        meme_poster('pigeon', None, 'is this the exit?', (0.5, 0.5)),
        meme_poster('bernie', None, 'i am once again asking you to do your tasks', (0.5, 0.4)),
        gen_poster('touch_grass', 'Touch grass. Mandatory. Level 0 has none, so do it here.', folder=UIGEN),
        gen_poster('work_order', 'M.E.G. work order: do your tasks. No, you cannot vote anyone out.', folder=UIGEN),
        gen_poster('off_on', 'IT helpdesk: have you tried turning it off and on again?', folder=UIGEN),
        gen_poster('microwave', 'Microwave rules: no fish, no screaming. mmmmmm BEEP.', folder=UIGEN),
        gen_poster('skill_issue', 'Wet floor: skill issue.', folder=UIGEN),
    ]
    return [c for c in cells if c]


# ---------- tv ----------
def tv_still(id_, caption, focus=(0.5, 0.5), box=None):
    im = cover(load(id_), TW, TH, focus[0], focus[1], box)
    return im, {'caption': caption, 'source': f'imgflip template "{known[id_]["title"]}" {known[id_]["url"]}', 'kind': 'meme'}


def stand_by():
    im = Image.new('RGB', (TW, TH), (16, 16, 16))
    d = ImageDraw.Draw(im)
    bars = [(192, 192, 192), (192, 192, 0), (0, 192, 192), (0, 192, 0), (192, 0, 192), (192, 0, 0), (0, 0, 192)]
    bw = TW / 7
    for i, c in enumerate(bars):
        d.rectangle((int(i * bw), 0, int((i + 1) * bw), int(TH * 0.66)), fill=c)
    d.rectangle((0, int(TH * 0.66), TW, TH), fill=(18, 18, 30))
    d.rectangle((20, 50, TW - 20, 98), fill=(16, 16, 16))
    draw_block(d, 'PLEASE STAND BY', 'Impact.ttf', (26, 54, TW - 26, 94), 34, fill=(236, 232, 214))
    draw_block(d, 'M.E.G. EMERGENCY BROADCAST', 'Arial Black.ttf', (10, int(TH * 0.7), TW - 10, TH - 30), 14, fill=(200, 196, 170))
    draw_block(d, 'CH 0', 'Arial Black.ttf', (10, TH - 28, TW - 10, TH - 8), 12, fill=(140, 136, 120))
    return im, {'caption': 'PLEASE STAND BY. M.E.G. emergency broadcast.', 'source': 'original: SMPTE-style test card drawn in the script', 'kind': 'original'}


def to_be_continued():
    base = os.path.join(GEN, 'not_a_vibe.webp')
    if os.path.exists(base):
        im = Image.open(base).convert('RGB').crop((40, 30, 472, 354)).resize((TW, TH), Image.LANCZOS)
    else:
        im = Image.new('RGB', (TW, TH), (170, 150, 90))
    im = ImageOps.colorize(ImageOps.autocontrast(im.convert('L')), (40, 26, 10), (240, 214, 150))
    d = ImageDraw.Draw(im)
    # jojo arrow bottom left
    x0, y0 = 14, TH - 46
    d.polygon([(x0, y0 + 16), (x0 + 22, y0), (x0 + 22, y0 + 8), (x0 + 150, y0 + 8), (x0 + 150, y0 + 24), (x0 + 22, y0 + 24), (x0 + 22, y0 + 32)], fill=(236, 226, 196), outline=(60, 40, 20))
    draw_block(d, 'TO BE CONTINUED', 'Arial Black.ttf', (x0 + 26, y0 + 8, x0 + 148, y0 + 24), 12, fill=(60, 40, 20))
    return im, {'caption': 'To be continued...', 'source': 'original: sepia freeze of gen/posters/not_a_vibe.webp (generated: gpt-image via mchat) with a drawn arrow', 'kind': 'original'}


def build_tv():
    return [
        stand_by(),
        tv_still('distracted', 'Distracted boyfriend: you, the exit sign, almond water.'),
        tv_still('this_is_fine', 'This is fine.', box=(0, 0, 0.5, 1)),
        tv_still('rollsafe', "Can't get caught if you never stop running."),
        tv_still('cat_yell', 'Woman yelling at cat (reruns).', box=(0, 0.23, 1, 1)),
        tv_still('impostor', 'There is 1 impostor among us.'),
        tv_still('monkey_puppet', '*looks away from the cutout*', box=(0, 0.37, 1, 1)),
        tv_still('disaster_girl', 'Somebody touched the breaker.'),
        to_be_continued(),
        tv_still('left_exit', 'Left exit 12: the EXIT. Also left: one more hallway.'),
        tv_still('evil_kermit', 'Do not do your tasks. (Do your tasks.)'),
        tv_still('two_buttons', 'Run, or hide. Sweating intensifies.', box=(0, 0.42, 1, 1)),
    ]


def atlas(cells, cw, ch, cols, name, q):
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGB', (cw * cols, ch * rows), (20, 18, 12))
    for i, (im, _) in enumerate(cells):
        sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
    path = os.path.join(OUT, 'img', name)
    sheet.save(path, 'WEBP', quality=q, method=6)
    if DEBUG:
        os.makedirs(DEBUG, exist_ok=True)
        sheet.save(os.path.join(DEBUG, name.replace('.webp', '.png')))
    return {
        'image': 'img/' + name, 'cols': cols, 'rows': rows, 'cellW': cw, 'cellH': ch, 'aspect': round(cw / ch, 4),
        'count': len(cells), 'bytes': os.path.getsize(path),
        'cells': [meta for _, meta in cells],
    }


posters = atlas(build_posters(), PW, PH, 4, 'posters.webp', 72)
tv = atlas(build_tv(), TW, TH, 4, 'tv.webp', 80)
print(json.dumps({'posters': posters, 'tv': tv}))
