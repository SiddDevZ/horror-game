#!/usr/bin/env python3
# numeric audio helpers for process-assets.mjs. every command prints one json line.
#   analyze <wav> <anchor_s> <bpm_lo> <bpm_hi>      onset near anchor, tempo fit, per-bar rms, loop similarity helper data
#   refine <wav> <loop_start_s> <loop_end_s>        nudge loop end (+-15 ms) so the audio after it best matches the audio after loop start
#   loopsim <wav> <ls> <le> <bar_s>                 feature similarity after/before the two points (0..1, higher = better seam)
#   trimpoints <wav> <thresh_db>                    first/last 10 ms window above threshold
#   bake <in> <out> <json>                          fades + loop-end crossfade baked into a float wav
#   align <ref_wav> <test_wav>                      sample offset of test relative to ref (e.g. mp3 decode vs encoder input)
#   onset <wav> <thresh_lin>                        time of first |sample| above thresh (runtime uses the same rule)
#   spectrum <wav>                                  centroid, band energy shares, crest factor
#   limited <pre_wav> <post_wav> <gain_db>          how much a limiter changed the signal (10 ms windows)
#   seam <wav> <ls> <le>                            sample jump at the loop wrap vs typical sample-to-sample step
import json
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft


def load(path):
    sr, x = wavfile.read(path)
    if x.dtype == np.int16:
        x = x.astype(np.float32) / 32768.0
    elif x.dtype == np.int32:
        x = x.astype(np.float32) / 2147483648.0
    else:
        x = x.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return sr, x


def bands(x, sr, hop=128, n=1024):
    f, t, Z = stft(x, sr, nperseg=n, noverlap=n - hop, boundary=None, padded=False)
    P = np.abs(Z) ** 2
    edges = np.unique(np.r_[0, np.geomspace(100, 9000, 36)])
    out = []
    for i in range(len(edges) - 1):
        m = (f >= edges[i]) & (f < edges[i + 1])
        if m.sum():
            out.append(P[m].sum(0))
    L = np.log(np.stack(out) + 1e-8)
    flux = np.r_[0, np.maximum(0, np.diff(L, axis=1)).sum(0)]
    return t, L, flux


def sim_windows(L, t, a, b, W, fr):
    ia, ib = np.searchsorted(t, a), np.searchsorted(t, b)
    n = int(W * fr)
    A, B = L[:, ia:ia + n], L[:, ib:ib + n]
    n = min(A.shape[1], B.shape[1])
    A, B = A[:, :n] - A[:, :n].mean(1, keepdims=True), B[:, :n] - B[:, :n].mean(1, keepdims=True)
    return float((A * B).sum() / np.sqrt((A * A).sum() * (B * B).sum() + 1e-12))


def cmd_analyze(path, anchor, lo, hi):
    sr, x = load(path)
    t, L, flux = bands(x, sr)
    fr = sr / 128
    w = (t > anchor - 0.15) & (t < anchor + 0.15)
    k = np.where(w)[0][np.argmax(flux[w])]
    t0 = float(t[k])
    # sharpen to the steepest 1 ms energy rise within +-25 ms of the flux peak
    a0 = int((t0 - 0.025) * sr)
    seg = x[a0:int((t0 + 0.025) * sr)]
    env = np.convolve(seg ** 2, np.ones(int(sr / 1000)) / int(sr / 1000), 'same')
    rise = np.diff(10 * np.log10(env + 1e-12))
    t0s = (a0 + int(np.argmax(rise))) / sr
    span = min(60.0, len(x) / sr - t0 - 1)
    at = lambda tt: np.interp(tt, t, flux)
    best = max((float(at(np.arange(t0, t0 + span, 60 / b)).mean()), float(b)) for b in np.arange(lo, hi, 0.005))
    bpm = best[1]
    beat = 60 / bpm
    bar = 4 * beat
    bars = []
    for i in range(int(span / bar)):
        s = x[int((t0 + i * bar) * sr):int((t0 + (i + 1) * bar) * sr)]
        bars.append(round(float(20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-12)), 1))
    print(json.dumps({'fluxOnset': round(t0, 4), 'onset': round(t0s, 4), 'bpm': round(bpm, 3), 'beat': round(beat, 6), 'bar': round(bar, 6), 'barRmsDb': bars}))


def cmd_loopsim(path, ls, le, bar):
    sr, x = load(path)
    t, L, _ = bands(x, sr)
    fr = sr / 128
    post = sim_windows(L, t, ls, le, 2 * bar, fr)
    pre = sim_windows(L, t, ls - bar, le - bar, bar, fr)
    print(json.dumps({'post': round(post, 3), 'pre': round(pre, 3)}))


def cmd_refine(path, ls, le):
    sr, x = load(path)
    # match the 120 ms after each point on a smoothed envelope + raw waveform, lag within +-15 ms
    n = int(0.12 * sr)
    A = x[int(ls * sr):int(ls * sr) + n]
    best = (-2, 0)
    for lag in range(-int(0.015 * sr), int(0.015 * sr) + 1):
        s = int(le * sr) + lag
        B = x[s:s + n]
        c = float(np.dot(A, B) / (np.sqrt(np.dot(A, A) * np.dot(B, B)) + 1e-12))
        if c > best[0]:
            best = (c, lag)
    print(json.dumps({'loopEnd': round(le + best[1] / sr, 6), 'lagMs': round(1000 * best[1] / sr, 3), 'corr': round(best[0], 3)}))


def cmd_trimpoints(path, thresh):
    sr, x = load(path)
    w = int(0.01 * sr)
    n = len(x) // w
    db = 20 * np.log10(np.sqrt((x[:n * w].reshape(n, w) ** 2).mean(1)) + 1e-12)
    on = np.where(db > thresh)[0]
    print(json.dumps({'start': round(on[0] * w / sr, 4), 'end': round((on[-1] + 1) * w / sr, 4), 'duration': round(len(x) / sr, 4)}))


def cmd_bake(src, dst, p):
    sr, x = load(src)
    x = x.astype(np.float64)
    fi = int(p.get('fadeIn', 0) * sr)
    if fi:
        x[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi)) ** 2
    fo = int(p.get('fadeOut', 0) * sr)
    if fo:
        x[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    if 'loopStart' in p and p.get('xfade'):
        ls, le = int(round(p['loopStart'] * sr)), int(round(p['loopEnd'] * sr))
        d = min(int(p['xfade'] * sr), ls)
        if d > 0:
            # equal-power blend of the approach to loop end with the approach to loop start, so the wrap is continuous
            g = np.linspace(0, 1, d)
            x[le - d:le] = x[le - d:le] * np.cos(g * np.pi / 2) + x[ls - d:ls] * np.sin(g * np.pi / 2)
    if 'padEnd' in p:
        x = np.r_[x, np.zeros(int(p['padEnd'] * sr))]
    if 'cut' in p:
        x = x[:int(round(p['cut'] * sr))]
    wavfile.write(dst, sr, x.astype(np.float32))
    print(json.dumps({'samples': int(len(x)), 'sr': int(sr), 'duration': round(len(x) / sr, 6)}))


def cmd_align(ref, test):
    sr, a = load(ref)
    sr2, b = load(test)
    assert sr == sr2, 'align needs equal rates'
    # correlate the first loud 1.5 s region
    i = int(np.argmax(np.abs(a) > 0.05))
    n = int(1.5 * sr)
    A = a[i:i + n]
    best = (-2, 0)
    for lag in range(-3000, 3001):
        s = i + lag
        if s < 0:
            continue
        B = b[s:s + n]
        if len(B) < n:
            continue
        c = float(np.dot(A, B) / (np.sqrt(np.dot(A, A) * np.dot(B, B)) + 1e-12))
        if c > best[0]:
            best = (c, lag)
    print(json.dumps({'offsetSamples': best[1], 'offsetMs': round(1000 * best[1] / sr, 3), 'corr': round(best[0], 4), 'refSamples': len(a), 'testSamples': len(b), 'sr': sr}))


def cmd_onset(path, th):
    sr, x = load(path)
    i = int(np.argmax(np.abs(x) > th))
    print(json.dumps({'onsetAt': round(i / sr, 6), 'duration': round(len(x) / sr, 6), 'samples': len(x), 'sr': sr}))


def cmd_spectrum(path):
    sr, x = load(path)
    f, t, Z = stft(x, sr, nperseg=2048, noverlap=1024)
    P = (np.abs(Z) ** 2).sum(1)
    tot = P.sum() + 1e-20
    share = lambda a, b: round(float(P[(f >= a) & (f < b)].sum() / tot), 4)
    rms = np.sqrt((x ** 2).mean())
    print(json.dumps({'centroidHz': round(float((f * P).sum() / tot), 1), 'lt300': share(0, 300), 'b300_3500': share(300, 3500), 'b3500_6000': share(3500, 6000), 'gt6000': share(6000, sr / 2),
                      'crestDb': round(float(20 * np.log10(np.abs(x).max() / (rms + 1e-12))), 2), 'rmsDb': round(float(20 * np.log10(rms + 1e-12)), 2)}))


def cmd_seam(path, ls, le):
    sr, x = load(path)
    i, j = int(round(ls * sr)), int(round(le * sr))
    jump = abs(float(x[i]) - float(x[j - 1]))
    typical = float(np.percentile(np.abs(np.diff(x[max(0, j - sr):j])), 99))
    print(json.dumps({'jump': round(jump, 5), 'p99Step': round(typical, 5), 'ratio': round(jump / (typical + 1e-12), 3)}))


def cmd_limited(a_path, b_path, gain_db):
    sr, a = load(a_path)
    _, b = load(b_path)
    n = min(len(a), len(b))
    a = a[:n] * 10 ** (gain_db / 20)
    b = b[:n]
    w = int(0.01 * sr)
    m = n // w
    pa = np.abs(a[:m * w]).reshape(m, w).max(1)
    pb = np.abs(b[:m * w]).reshape(m, w).max(1)
    gr = 20 * np.log10((pa + 1e-9) / (pb + 1e-9))
    print(json.dumps({'windowsOver0_5dB': round(float(100 * (gr > 0.5).mean()), 3), 'windowsOver1dB': round(float(100 * (gr > 1).mean()), 3), 'maxGrDb': round(float(gr.max()), 2)}))


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    if c == 'analyze':
        cmd_analyze(a[0], float(a[1]), float(a[2]), float(a[3]))
    elif c == 'loopsim':
        cmd_loopsim(a[0], float(a[1]), float(a[2]), float(a[3]))
    elif c == 'refine':
        cmd_refine(a[0], float(a[1]), float(a[2]))
    elif c == 'trimpoints':
        cmd_trimpoints(a[0], float(a[1]))
    elif c == 'bake':
        cmd_bake(a[0], a[1], json.loads(a[2]))
    elif c == 'align':
        cmd_align(a[0], a[1])
    elif c == 'onset':
        cmd_onset(a[0], float(a[1]))
    elif c == 'spectrum':
        cmd_spectrum(a[0])
    elif c == 'limited':
        cmd_limited(a[0], a[1], float(a[2]))
    elif c == 'seam':
        cmd_seam(a[0], float(a[1]), float(a[2]))
    else:
        raise SystemExit('unknown command ' + c)
