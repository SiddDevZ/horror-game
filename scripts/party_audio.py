#!/usr/bin/env python3
# party (sigma boy) edit helpers for fetch-memes.mjs --party. every command prints one json line.
#   locate <full_wav> <clip_wav>          where a short reference clip sits inside the full track (flux search, waveform refine)
#   splice <in_wav> <out_wav> <json>      bar-aligned edit: [a0,a1) + [b0,end) with b0 phase-refined against `ref`, fades, trailing trim
#   beats <wav> <first_beat> <bpm>        how well a beat grid fits the file: mean flux on the grid vs off the grid
import json
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, stft


def load(path, mono=True):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim == 1:
        x = x[:, None]
    return sr, (x.mean(1) if mono else x)


def flux(x, sr, hop=128):
    f, t, Z = stft(x, sr, nperseg=1024, noverlap=1024 - hop, boundary=None, padded=False)
    P = np.log(np.abs(Z) ** 2 + 1e-9)
    fl = np.r_[0, np.maximum(0, np.diff(P, axis=1)).sum(0)]
    return t, (fl - fl.mean()) / (fl.std() + 1e-9)


def best_lag(a, b, i, j, n, span):
    # lag (samples) that makes b[j+lag:] best match a[i:] over n samples
    A = a[i:i + n]
    best = (-2.0, 0)
    for lag in range(-span, span + 1):
        B = b[j + lag:j + lag + n]
        if len(B) < n or j + lag < 0:
            continue
        c = float(np.dot(A, B) / (np.sqrt(np.dot(A, A) * np.dot(B, B)) + 1e-12))
        if c > best[0]:
            best = (c, lag)
    return best


def cmd_locate(full, clip):
    sr, x = load(full)
    sr2, c = load(clip)
    assert sr == sr2, 'locate needs equal rates'
    t, F = flux(x, sr)
    _, C = flux(c, sr)
    r = fftconvolve(F, C[::-1], 'valid') / len(C)
    k = int(np.argmax(r))
    coarse = int(t[k] * sr) - int(t[0] * sr)
    n = min(len(c), int(4 * sr))
    corr, lag = best_lag(c, x, 0, coarse, n, int(0.03 * sr))
    print(json.dumps({'offset': round((coarse + lag) / sr, 4), 'waveCorr': round(corr, 4), 'fluxCorr': round(float(r[k]), 3), 'clipDuration': round(len(c) / sr, 3)}))


def cmd_splice(src, dst, p):
    sr, X = load(src, mono=False)
    m = X.mean(1)
    a0, a1, b0 = int(round(p['a0'] * sr)), int(round(p['a1'] * sr)), int(round(p['b0'] * sr))
    # b0 should continue the music the way `ref` (default a1) would: refine b0 so the waveforms line up
    ref = int(round(p.get('ref', p['a1']) * sr))
    look = int(p.get('match', 0.25) * sr)
    corr, lag = best_lag(m, m, ref, b0, look, int(p.get('lagSearch', 0.02) * sr))
    b0 += lag
    # cut a little before the downbeat (between events) with a short equal-power crossfade
    pre = int(p.get('cutBefore', 0.06) * sr)
    xf = int(p.get('xfade', 0.012) * sr)
    ca, cb = a1 - pre, b0 - pre
    A = X[a0:ca + xf].copy()
    B = X[cb:].copy()
    g = np.linspace(0, 1, xf)[:, None]
    A[-xf:] = A[-xf:] * np.cos(g * np.pi / 2) + B[:xf] * np.sin(g * np.pi / 2)
    Y = np.r_[A, B[xf:]]
    # trailing trim at -50 dB (10 ms windows), then fades
    w = int(0.01 * sr)
    n = len(Y) // w
    db = 20 * np.log10(np.sqrt((Y[:n * w].mean(1).reshape(n, w) ** 2).mean(1)) + 1e-12)
    last = int(np.where(db > p.get('tailDb', -50))[0][-1])
    Y = Y[:(last + 1) * w]
    fi, fo = int(p.get('fadeIn', 0.004) * sr), int(p.get('fadeOut', 0.5) * sr)
    Y[:fi] *= (np.sin(np.linspace(0, np.pi / 2, fi)) ** 2)[:, None]
    Y[-fo:] *= (np.cos(np.linspace(0, np.pi / 2, fo)) ** 2)[:, None]
    wavfile.write(dst, sr, Y.astype(np.float32))
    print(json.dumps({'b0': round(b0 / sr, 5), 'lagMs': round(1000 * lag / sr, 3), 'matchCorr': round(corr, 4), 'cutAt': round((ca - a0) / sr, 5),
                      'duration': round(len(Y) / sr, 5), 'channels': int(Y.shape[1]), 'sr': int(sr)}))


def cmd_beats(path, first, bpm):
    sr, x = load(path)
    t, F = flux(x, sr)
    beat = 60 / bpm
    grid = np.arange(first, t[-1] - 0.05, beat)
    at = lambda tt: np.interp(tt, t, F)
    on = float(at(grid).mean())
    off = float(at(grid + beat / 2).mean())
    # per-beat onset error: strongest flux peak within +-60 ms of each grid point
    errs = []
    for g in grid:
        m = (t > g - 0.06) & (t < g + 0.06)
        if m.sum() and F[m].max() > 1.0:
            errs.append(float(t[m][np.argmax(F[m])] - g))
    e = np.array(errs) if errs else np.zeros(1)
    print(json.dumps({'beats': int(len(grid)), 'onGrid': round(on, 3), 'offGrid': round(off, 3), 'peaked': len(errs),
                      'medianErrMs': round(1000 * float(np.median(e)), 2), 'p90AbsErrMs': round(1000 * float(np.percentile(np.abs(e), 90)), 2)}))


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    if c == 'locate':
        cmd_locate(a[0], a[1])
    elif c == 'splice':
        cmd_splice(a[0], a[1], json.loads(a[2]))
    elif c == 'beats':
        cmd_beats(a[0], float(a[1]), float(a[2]))
    else:
        raise SystemExit('unknown command ' + c)
