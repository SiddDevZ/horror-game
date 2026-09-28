#!/usr/bin/env python3
# head-and-shoulders cutout: grabcut seeded by shapes, mask cleanup, colour bleed, webp with alpha.
# usage: python3 scripts/cutout.py <src> <out.webp> '<json params>' [debug_dir]
# params (source pixel coords):
#   crop: [x0, y0, x1, y1]
#   outer: shapes bounding the subject loosely (outside = definite background)
#   inner: shapes surely inside the subject (definite foreground)
#   bg: optional shapes forced to definite background (e.g. a badge or a stray object)
#   shape: {"e": [cx, cy, rx, ry]} ellipse | {"r": [x0, y0, x1, y1]} rect | {"p": [[x, y], ...]} polygon
#   height: output height (px), erode: px of erosion at source scale, quality: webp quality
import json
import sys
import os

import cv2
import numpy as np
from PIL import Image

cv2.setRNGSeed(1)  # grabcut's gmm init uses kmeans; keep runs reproducible
cv2.setNumThreads(1)


def draw(mask, shape, val, ox, oy):
    if 'e' in shape:
        cx, cy, rx, ry = shape['e']
        cv2.ellipse(mask, (int(round(cx - ox)), int(round(cy - oy))), (int(rx), int(ry)), 0, 0, 360, val, -1)
    elif 'r' in shape:
        x0, y0, x1, y1 = shape['r']
        cv2.rectangle(mask, (int(x0 - ox), int(y0 - oy)), (int(x1 - ox) - 1, int(y1 - oy) - 1), val, -1)
    elif 'p' in shape:
        pts = np.array([[x - ox, y - oy] for x, y in shape['p']], np.int32)
        cv2.fillPoly(mask, [pts], val)


def largest_component(m):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n <= 1:
        return m
    best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(lab == best, 255, 0).astype(np.uint8)


def fill_holes(m):
    # flood the background from a padded border; anything not reached is a hole
    h, w = m.shape
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = m
    ff = pad.copy()
    cv2.floodFill(ff, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 255)
    holes = cv2.bitwise_not(ff)[1:-1, 1:-1]
    return cv2.bitwise_or(m, holes)


def bleed(rgb, alpha, iters=24):
    # push foreground colour outward into transparent pixels so filtering/mips never pull in the old background
    rgb = rgb.astype(np.float32)
    known = (alpha >= 128).astype(np.float32)
    acc = rgb * known[..., None]
    wsum = known.copy()
    out = acc.copy()
    k = np.ones((3, 3), np.float32)
    cur_rgb, cur_w = acc, wsum
    for _ in range(iters):
        s = cv2.filter2D(cur_rgb, -1, k, borderType=cv2.BORDER_REPLICATE)
        ws = cv2.filter2D(cur_w, -1, k, borderType=cv2.BORDER_REPLICATE)
        newly = (cur_w == 0) & (ws > 0)
        cur_rgb = cur_rgb.copy()
        cur_rgb[newly] = s[newly] / ws[newly][:, None]
        cur_w = np.where(newly, 1.0, cur_w).astype(np.float32)
    rest = cur_w == 0
    if rest.any():
        mean = rgb[known > 0].mean(axis=0)
        cur_rgb[rest] = mean
    out = np.where(known[..., None] > 0, rgb, cur_rgb)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def main():
    src, out = sys.argv[1], sys.argv[2]
    p = json.loads(sys.argv[3])
    dbg = sys.argv[4] if len(sys.argv) > 4 else None
    name = os.path.splitext(os.path.basename(out))[0]

    im = Image.open(src).convert('RGB')
    img = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    x0, y0, x1, y1 = p['crop']
    img = img[y0:y1, x0:x1].copy()
    h, w = img.shape[:2]

    # seed mask: probable background everywhere, outer = probable fg, inner = definite fg, bg shapes and outside-outer = definite bg
    outer = np.zeros((h, w), np.uint8)
    for s in p['outer']:
        draw(outer, s, 255, x0, y0)
    seed = np.full((h, w), cv2.GC_BGD, np.uint8)
    seed[outer > 0] = cv2.GC_PR_FGD
    band = cv2.dilate(outer, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * p.get('band', 14) + 1,) * 2))
    seed[(band > 0) & (outer == 0)] = cv2.GC_PR_BGD
    for s in p['inner']:
        m = np.zeros((h, w), np.uint8)
        draw(m, s, 255, x0, y0)
        seed[m > 0] = cv2.GC_FGD
    for s in p.get('bg', []):
        m = np.zeros((h, w), np.uint8)
        draw(m, s, 255, x0, y0)
        seed[m > 0] = cv2.GC_BGD

    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    mask = seed.copy()
    cv2.grabCut(img, mask, None, bgd, fgd, p.get('iters', 8), cv2.GC_INIT_WITH_MASK)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # cleanup: open away specks, largest blob, fill holes, smooth outline, slight erosion
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k3)
    fg = largest_component(fg)
    fg = fill_holes(fg)
    close_r = p.get('close', 6)
    if close_r:
        # pad so closing does not eat the cut edges at the crop border
        pad = close_r * 2
        fp = cv2.copyMakeBorder(fg, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
        fp = cv2.morphologyEx(fp, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * close_r + 1,) * 2))
        fg = fp[pad:-pad, pad:-pad]
        fg = fill_holes(fg)
    # smooth jaggies: blur then re-threshold (keeps a crisp but not stair-stepped outline)
    sm = p.get('smooth', 2.0)
    if sm:
        fg = (cv2.GaussianBlur(fg.astype(np.float32), (0, 0), sm) > 127).astype(np.uint8) * 255
    er = p.get('erode', 2)
    if er:
        fp = cv2.copyMakeBorder(fg, er + 1, er + 1, er + 1, er + 1, cv2.BORDER_REPLICATE)
        fp = cv2.erode(fp, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * er + 1,) * 2))
        fg = fp[er + 1:-(er + 1), er + 1:-(er + 1)]
    fg = largest_component(fg)

    # tight bbox of the subject, then resize to the target height
    ys, xs = np.nonzero(fg)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    img = img[by0:by1, bx0:bx1]
    fg = fg[by0:by1, bx0:bx1]
    th = p.get('height', 512)
    s = th / fg.shape[0]
    tw = max(1, int(round(fg.shape[1] * s)))
    interp = cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    rgb = bleed(rgb, fg)
    rgb = cv2.resize(rgb, (tw, th), interpolation=interp)
    a = cv2.resize(fg.astype(np.float32), (tw, th), interpolation=cv2.INTER_LINEAR)
    # hard-ish edge: steep ramp around 0.5 gives ~1 px of antialias and a clean alpha-test at 0.5
    a = np.clip((a - 127.5) * 3.0 + 127.5, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb, a])
    Image.fromarray(rgba, 'RGBA').save(out, 'WEBP', quality=p.get('quality', 82), alpha_quality=100, method=6, exact=False)

    if dbg:
        os.makedirs(dbg, exist_ok=True)
        # seed overlay on the crop and a composite on the game's mustard to check edges
        full = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)[y0:y1, x0:x1].copy()
        ov = full.copy()
        ov[seed == cv2.GC_BGD] = (ov[seed == cv2.GC_BGD] * 0.5 + np.array([0, 0, 160]) * 0.5).astype(np.uint8)
        ov[seed == cv2.GC_FGD] = (ov[seed == cv2.GC_FGD] * 0.5 + np.array([0, 160, 0]) * 0.5).astype(np.uint8)
        cv2.imwrite(os.path.join(dbg, f'{name}-seed.png'), ov)
        bgc = np.array([60, 170, 190], np.float32)  # mustard-ish (bgr)
        comp = np.where((a >= 128)[..., None], cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).astype(np.float32), bgc)
        cv2.imwrite(os.path.join(dbg, f'{name}-comp.png'), comp.astype(np.uint8))

    print(json.dumps({'w': tw, 'h': th, 'aspect': round(tw / th, 4), 'bbox': [int(bx0 + x0), int(by0 + y0), int(bx1 + x0), int(by1 + y0)]}))


if __name__ == '__main__':
    main()
