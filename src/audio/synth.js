// procedural sound: seamless ambience loops written straight into buffers, and one-shots rendered once through
// OfflineAudioContext graphs. everything is seeded, so the same build always sounds the same.
import { makeRng } from '../core/rng.js';

const TAU = Math.PI * 2;

function normRms(d, target) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = target / (Math.sqrt(s / d.length) || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

// loop-safe: every periodic component has an integer number of cycles in the buffer
export function makeLoopBuffers(ctx) {
  const sr = ctx.sampleRate;
  const rng = makeRng(0xa11b1e);

  // fluorescent bed: 120 hz ballast buzz (mains x2) with a nonlinear edge, slow 0.5 hz breathing, faint whine
  const humLen = 2 * sr;
  const hum = ctx.createBuffer(1, humLen, sr);
  const h = hum.getChannelData(0);
  const amps = [1, 0.55, 0.42, 0.22, 0.16, 0.1, 0.07, 0.05, 0.035, 0.025];
  const ph = amps.map(() => rng.next() * TAU);
  for (let i = 0; i < humLen; i++) {
    const t = i / sr;
    let v = 0;
    for (let k = 0; k < amps.length; k++) v += amps[k] * Math.sin(TAU * 120 * (k + 1) * t + ph[k]);
    v = Math.tanh(v * 1.4);
    v *= 1 + 0.08 * Math.sin(TAU * 0.5 * t);
    v += 0.012 * Math.sin(TAU * 7200 * t) * (1 + 0.3 * Math.sin(TAU * 1.5 * t));
    h[i] = v;
  }
  normRms(h, 0.022);

  // ventilation: soft brown-ish air, 4 s with the tail crossfaded into the head
  const airLen = 4 * sr, xf = Math.floor(0.25 * sr);
  const raw = new Float32Array(airLen + xf);
  let b1 = 0, b2 = 0;
  const c1 = Math.exp(-TAU * 260 / sr), c2 = Math.exp(-TAU * 1400 / sr);
  for (let i = 0; i < raw.length; i++) {
    const w = rng.next() * 2 - 1;
    b1 = c1 * b1 + (1 - c1) * w;
    b2 = c2 * b2 + (1 - c2) * w;
    raw[i] = b1 * 3 + b2 * 0.35;
  }
  const air = ctx.createBuffer(1, airLen, sr);
  const a = air.getChannelData(0);
  for (let i = 0; i < airLen; i++) a[i] = raw[i];
  for (let i = 0; i < xf; i++) {
    const g = i / xf;
    a[i] = raw[i] * Math.sin(g * Math.PI / 2) + raw[airLen + i] * Math.cos(g * Math.PI / 2);
  }
  for (let i = 0; i < airLen; i++) a[i] *= 1 + 0.15 * Math.sin(TAU * 0.25 * i / sr);
  normRms(a, 0.02);

  // water cooler: compressor motor (60 hz family) with a slow 0.33 hz wobble and a little bubbling band
  const coLen = 3 * sr;
  const cooler = ctx.createBuffer(1, coLen, sr);
  const c = cooler.getChannelData(0);
  let bb = 0;
  const cb = Math.exp(-TAU * 500 / sr);
  for (let i = 0; i < coLen; i++) {
    const t = i / sr;
    let v = Math.sin(TAU * 60 * t) + 0.6 * Math.sin(TAU * 120 * t + 1) + 0.25 * Math.sin(TAU * 180 * t + 2) + 0.12 * Math.sin(TAU * 300 * t);
    v *= 1 + 0.12 * Math.sin(TAU * (1 / 3) * t);
    bb = cb * bb + (1 - cb) * (rng.next() * 2 - 1);
    c[i] = v + bb * 0.9;
  }
  normRms(c, 0.06);

  // objective beacon: faint vhs tape hiss with flutter, a thin mains hum and a soft locator blip once a second.
  // 2 s, every periodic part is a whole number of cycles and the hiss tail is crossfaded, so it loops clean.
  const bLen = 2 * sr, bxf = Math.floor(0.2 * sr);
  const hiss = new Float32Array(bLen + bxf);
  let h1 = 0, h2 = 0;
  const k1 = Math.exp(-TAU * 5200 / sr), k2 = Math.exp(-TAU * 900 / sr);
  for (let i = 0; i < hiss.length; i++) {
    const w = rng.next() * 2 - 1;
    h1 = k1 * h1 + (1 - k1) * w; // lowpassed
    h2 = k2 * h2 + (1 - k2) * w;
    hiss[i] = h1 - h2; // band 900-5200 hz: tape hiss
  }
  const beacon = ctx.createBuffer(1, bLen, sr);
  const bd = beacon.getChannelData(0);
  for (let i = 0; i < bLen; i++) {
    const t = i / sr;
    let v = i < bxf ? hiss[i] * Math.sin((i / bxf) * Math.PI / 2) + hiss[bLen + i] * Math.cos((i / bxf) * Math.PI / 2) : hiss[i];
    v *= 0.75 + 0.25 * Math.sin(TAU * 4 * t) * Math.sin(TAU * 0.5 * t); // tape flutter
    v += 0.35 * Math.tanh(1.5 * Math.sin(TAU * 60 * t)) + 0.12 * Math.sin(TAU * 180 * t);
    const bt = t % 1; // 90 ms blip at 880 hz, ramped both ends
    if (bt < 0.09) v += 0.9 * Math.sin(TAU * 880 * t) * Math.sin((bt / 0.09) * Math.PI);
    bd[i] = v;
  }
  normRms(bd, 0.05);
  return { hum, air, cooler, beacon };
}

/** exponentially decaying noise: a long, dark room for far-away meme sounds */
export function makeFarIR(ctx, seconds = 2.2) {
  const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
  const rng = makeRng(0xfa12);
  const ir = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp = 0.7 * lp + 0.3 * (rng.next() * 2 - 1);
      d[i] = lp * Math.exp(-i / (0.5 * sr)) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
  }
  return ir;
}

// ---------- offline one-shots ----------
function noise(ctx, dur, rng) {
  const b = ctx.createBuffer(1, Math.max(1, Math.ceil(dur * ctx.sampleRate)), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
  return b;
}

function src(ctx, buf, t = 0) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.start(t);
  return s;
}

function filt(ctx, type, f, q = 0.7) {
  const n = ctx.createBiquadFilter();
  n.type = type; n.frequency.value = f; n.Q.value = q;
  return n;
}

// percussive envelope: 0 -> peak over atk, then exponential decay (tau)
function hit(ctx, t, atk, peak, tau) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.setTargetAtTime(0, t + atk, tau);
  return g;
}

function osc(ctx, type, f, t0 = 0, t1 = null) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = f;
  o.start(t0);
  if (t1 != null) o.stop(t1);
  return o;
}

function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function shaper(ctx, drive) {
  const w = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  w.curve = curve;
  w.oversample = '2x';
  return w;
}

const RECIPES = {
  step(ctx, out, r) {
    const t = 0.004;
    chain(src(ctx, noise(ctx, 0.2, r), t), filt(ctx, 'bandpass', r.range(380, 620), 0.9), hit(ctx, t, 0.006, 0.9, r.range(0.02, 0.03)), out);
    chain(src(ctx, noise(ctx, 0.15, r), t + 0.012), filt(ctx, 'highpass', 2400), hit(ctx, t + 0.012, 0.004, 0.12, 0.014), out);
    chain(osc(ctx, 'sine', r.range(70, 92), 0, 0.2), hit(ctx, t, 0.004, 0.45, 0.03), out);
    return 0.26;
  },
  stepRun(ctx, out, r) {
    const t = 0.004;
    chain(src(ctx, noise(ctx, 0.2, r), t), filt(ctx, 'bandpass', r.range(560, 820), 0.8), hit(ctx, t, 0.004, 1, r.range(0.018, 0.024)), out);
    chain(src(ctx, noise(ctx, 0.2, r), t + 0.025), filt(ctx, 'highpass', 2000), hit(ctx, t + 0.025, 0.006, 0.18, 0.03), out);
    chain(osc(ctx, 'sine', r.range(62, 80), 0, 0.2), hit(ctx, t, 0.003, 0.75, 0.035), out);
    return 0.24;
  },
  doorOpen(ctx, out, r) {
    chain(src(ctx, noise(ctx, 0.05, r), 0.02), filt(ctx, 'highpass', 3000), hit(ctx, 0.02, 0.001, 0.55, 0.005), out);
    // hinge creak: stick-slip sawtooth through two resonances, pitch wandering
    const o = osc(ctx, 'sawtooth', 100, 0.08, 1.05);
    const curve = new Float32Array(32);
    for (let i = 0; i < 32; i++) curve[i] = 95 + 45 * Math.sin(i / 31 * Math.PI) + r.range(-12, 12);
    o.frequency.setValueCurveAtTime(curve, 0.08, 0.95);
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = osc(ctx, 'square', r.range(18, 26), 0.08, 1.05); const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, 0); env.gain.setValueAtTime(0, 0.08);
    env.gain.linearRampToValueAtTime(0.35, 0.2); env.gain.setValueAtTime(0.35, 0.6); env.gain.linearRampToValueAtTime(0, 1.0);
    const b1 = filt(ctx, 'bandpass', 900, 6), b2 = filt(ctx, 'bandpass', 2300, 9);
    o.connect(am); am.connect(b1); am.connect(b2); b1.connect(env); b2.connect(env); env.connect(out);
    chain(src(ctx, noise(ctx, 1, r), 0.1), filt(ctx, 'lowpass', 380), hit(ctx, 0.1, 0.25, 0.12, 0.3), out);
    return 1.15;
  },
  doorClose(ctx, out, r) {
    chain(osc(ctx, 'sine', 55, 0, 0.6), hit(ctx, 0.0, 0.003, 0.9, 0.08), out);
    chain(src(ctx, noise(ctx, 0.5, r)), filt(ctx, 'lowpass', 350), hit(ctx, 0.0, 0.002, 0.8, 0.05), out);
    chain(src(ctx, noise(ctx, 0.05, r), 0.05), filt(ctx, 'highpass', 2500), hit(ctx, 0.05, 0.001, 0.5, 0.005), out);
    chain(src(ctx, noise(ctx, 0.05, r), 0.095), filt(ctx, 'highpass', 2500), hit(ctx, 0.095, 0.001, 0.25, 0.004), out);
    chain(src(ctx, noise(ctx, 0.4, r), 0.02), filt(ctx, 'bandpass', 1800, 10), hit(ctx, 0.02, 0.002, 0.5, 0.06), out);
    return 0.7;
  },
  impact(ctx, out, r) {
    const drive = shaper(ctx, 2.2); drive.connect(out);
    const o = osc(ctx, 'sine', 140, 0, 0.9);
    o.frequency.setValueAtTime(140, 0); o.frequency.exponentialRampToValueAtTime(38, 0.3);
    chain(o, hit(ctx, 0, 0.002, 1, 0.15), drive);
    chain(src(ctx, noise(ctx, 0.6, r)), filt(ctx, 'lowpass', 1200), hit(ctx, 0, 0.001, 0.9, 0.06), drive);
    chain(src(ctx, noise(ctx, 0.6, r)), filt(ctx, 'bandpass', 500, 2), hit(ctx, 0.01, 0.002, 0.5, 0.1), drive);
    return 0.9;
  },
  sting(ctx, out, r) {
    const lp = filt(ctx, 'lowpass', 300, 2);
    lp.frequency.setValueAtTime(300, 0); lp.frequency.exponentialRampToValueAtTime(2600, 0.08); lp.frequency.exponentialRampToValueAtTime(500, 1.8);
    const env = hit(ctx, 0, 0.015, 0.22, 0.55);
    lp.connect(env).connect(out);
    for (const f of [146.8, 155.6, 207.7, 311.1]) { const o = osc(ctx, 'sawtooth', f * r.range(0.997, 1.003), 0, 2.2); o.connect(lp); }
    chain(osc(ctx, 'sine', 45, 0, 1.2), hit(ctx, 0, 0.005, 0.7, 0.3), out);
    chain(src(ctx, noise(ctx, 1.5, r)), filt(ctx, 'highpass', 3000), hit(ctx, 0, 0.01, 0.08, 0.4), out);
    return 2.2;
  },
  death(ctx, out, r) {
    // tape-stop slump: a detuned chord that sinks and darkens, then a soft floor thump
    const lp = filt(ctx, 'lowpass', 3000, 1);
    lp.frequency.setValueAtTime(3000, 0); lp.frequency.exponentialRampToValueAtTime(180, 1.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, 0); env.gain.linearRampToValueAtTime(0.25, 0.02); env.gain.setValueAtTime(0.25, 1.1); env.gain.linearRampToValueAtTime(0, 1.45);
    lp.connect(env).connect(out);
    for (const [type, f] of [['sawtooth', 220], ['square', 329.6], ['sawtooth', 221.5]]) {
      const o = osc(ctx, type, f, 0, 1.5);
      o.frequency.setValueAtTime(f, 0); o.frequency.exponentialRampToValueAtTime(f * 0.12, 1.4);
      o.connect(lp);
    }
    chain(osc(ctx, 'sine', 50, 1.4, 2.0), hit(ctx, 1.4, 0.003, 0.8, 0.09), out);
    chain(src(ctx, noise(ctx, 0.5, r), 1.4), filt(ctx, 'lowpass', 300), hit(ctx, 1.4, 0.002, 0.6, 0.06), out);
    return 2.0;
  },
  recover(ctx, out) {
    chain(osc(ctx, 'triangle', 523.3, 0, 0.9), hit(ctx, 0, 0.01, 0.3, 0.18), out);
    chain(osc(ctx, 'triangle', 784, 0.12, 0.9), hit(ctx, 0.12, 0.01, 0.28, 0.22), out);
    chain(osc(ctx, 'sine', 1046.5, 0.12, 0.9), hit(ctx, 0.12, 0.01, 0.06, 0.15), out);
    return 0.9;
  },
  switch(ctx, out, r) {
    chain(src(ctx, noise(ctx, 0.03, r), 0.005), filt(ctx, 'bandpass', 3200, 2), hit(ctx, 0.005, 0.0005, 0.9, 0.003), out);
    chain(osc(ctx, 'sine', 1800, 0.005, 0.05), hit(ctx, 0.005, 0.0005, 0.15, 0.004), out);
    chain(src(ctx, noise(ctx, 0.03, r), 0.032), filt(ctx, 'bandpass', 2600, 2), hit(ctx, 0.032, 0.0005, 0.45, 0.003), out);
    chain(osc(ctx, 'sine', 180, 0.005, 0.12), hit(ctx, 0.005, 0.002, 0.3, 0.02), out);
    return 0.2;
  },
  flickerBuzz(ctx, out, r) {
    const gate = ctx.createGain();
    gate.gain.setValueAtTime(0, 0);
    let t = 0.01;
    while (t < 0.55) {
      const on = r.range(0.02, 0.09), off = r.range(0.01, 0.06);
      gate.gain.setValueAtTime(r.range(0.5, 1), t); gate.gain.setValueAtTime(0, t + on);
      t += on + off;
    }
    const bp = filt(ctx, 'bandpass', 1100, 0.8);
    osc(ctx, 'sawtooth', 120, 0, 0.6).connect(bp);
    const sq = osc(ctx, 'square', 240, 0, 0.6); const sg = ctx.createGain(); sg.gain.value = 0.4; sq.connect(sg).connect(bp);
    chain(src(ctx, noise(ctx, 0.6, r)), filt(ctx, 'highpass', 4000), ctx.createGain(), gate);
    bp.connect(gate);
    const level = ctx.createGain(); level.gain.value = 0.45;
    gate.connect(level).connect(out);
    return 0.62;
  },
  distantDoor(ctx, out, r) {
    // a far slam: low thud + latch, darkened, through a long synthetic room
    const dry = ctx.createGain(); dry.gain.value = 0.35;
    const conv = ctx.createConvolver();
    const len = Math.floor(1.8 * ctx.sampleRate);
    const ir = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = ir.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (r.next() * 2 - 1) * Math.exp(-i / (0.38 * ctx.sampleRate));
    conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.9;
    const lp = filt(ctx, 'lowpass', 520);
    const bus = ctx.createGain();
    bus.connect(lp); lp.connect(dry).connect(out); lp.connect(conv).connect(wet).connect(out);
    chain(osc(ctx, 'sine', 60, 0.02, 0.6), hit(ctx, 0.02, 0.003, 1, 0.07), bus);
    chain(src(ctx, noise(ctx, 0.4, r), 0.02), filt(ctx, 'lowpass', 900), hit(ctx, 0.02, 0.002, 1, 0.05), bus);
    chain(src(ctx, noise(ctx, 0.05, r), 0.08), filt(ctx, 'bandpass', 1500, 3), hit(ctx, 0.08, 0.001, 0.6, 0.01), bus);
    return 2.3;
  },
  ventKnock(ctx, out, r) {
    const n = r.chance(0.5) ? 3 : 2;
    let t = 0.005;
    for (let k = 0; k < n; k++) {
      const pk = k === 0 ? 1 : r.range(0.5, 0.85);
      const m1 = filt(ctx, 'bandpass', r.range(380, 460), 14), m2 = filt(ctx, 'bandpass', r.range(1050, 1250), 18);
      const exc = chain(src(ctx, noise(ctx, 0.05, r), t), hit(ctx, t, 0.0008, pk, 0.006));
      exc.connect(m1); exc.connect(m2);
      const g = ctx.createGain(); g.gain.value = 3.2;
      m1.connect(g); m2.connect(g); g.connect(out);
      chain(osc(ctx, 'sine', r.range(85, 110), t, t + 0.3), hit(ctx, t, 0.002, 0.35 * pk, 0.04), out);
      t += r.range(0.14, 0.26);
    }
    return t + 0.5;
  },
  phoneRing(ctx, out) {
    // electronic office trill in two bursts through a tiny speaker
    const o = osc(ctx, 'square', 1100, 0, 2.2);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, 0);
    for (const [a, b] of [[0.0, 0.9], [1.15, 2.05]]) {
      for (let t = a, k = 0; t < b; t += 1 / 40, k++) o.frequency.setValueAtTime(k % 2 ? 1370 : 1100, t);
      env.gain.setValueAtTime(0, a); env.gain.linearRampToValueAtTime(0.3, a + 0.006);
      env.gain.setValueAtTime(0.3, b - 0.006); env.gain.linearRampToValueAtTime(0, b);
    }
    chain(o, filt(ctx, 'bandpass', 1500, 1.4), env, out);
    return 2.2;
  },
};
const VARIANTS = { step: 4, stepRun: 4, ventKnock: 3 };

/** renders every recipe once; resolves to { name: AudioBuffer[] } */
export async function renderOneShots(sampleRate, seed) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const out = {};
  const jobs = [];
  let n = 0;
  for (const name of Object.keys(RECIPES)) {
    out[name] = [];
    for (let v = 0; v < (VARIANTS[name] || 1); v++) {
      const r = makeRng((seed ^ (++n * 0x9e3779b1)) >>> 0);
      // recipes report their length; render into a generous context and trim
      const max = 2.5;
      const ctx = new OAC(1, Math.ceil(max * sampleRate), sampleRate);
      const master = ctx.createGain();
      master.connect(ctx.destination);
      const len = RECIPES[name](ctx, master, r);
      const idx = v;
      jobs.push(ctx.startRendering().then((buf) => { out[name][idx] = trim(buf, len, sampleRate); }));
    }
  }
  await Promise.all(jobs);
  return out;
}

function trim(buf, len, sr) {
  const n = Math.min(buf.length, Math.ceil(len * sr));
  if (n === buf.length) return buf;
  const b = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr });
  b.copyToChannel(buf.getChannelData(0).subarray(0, n), 0);
  // 5 ms fade on the cut so nothing clicks
  const d = b.getChannelData(0), f = Math.min(n, Math.floor(0.005 * sr));
  for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
  return b;
}
