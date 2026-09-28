// offline asset pipeline: character cutouts + enemy audio + manifest.
// usage: npm run assets   (node scripts/process-assets.mjs [--only=kanye,epstein] [--skip-images] [--skip-audio] [--debug])
// originals in ~/Downloads are only ever read. outputs: public/assets/{img,audio}/*, public/assets/manifest.json.
// needs ffmpeg/ffprobe (FFMPEG_DIR, default /opt/homebrew/bin) and python3 with numpy/scipy/cv2/PIL.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DL = process.env.BR_SOURCES || join(homedir(), 'Downloads');
const FF = process.env.FFMPEG_DIR || '/opt/homebrew/bin';
const ffmpeg = join(FF, 'ffmpeg');
const PY = process.env.PYTHON || 'python3';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const only = args.only ? args.only.split(',') : null;
const OUT = join(root, 'public/assets');
const WORK = join(tmpdir(), 'br-assets-work');
const DEBUG_DIR = args.debug ? join(root, 'shots/assets') : null;

const TARGET_LUFS = -17;
const MAX_TP = -1.5; // dBTP, measured on the decoded mp3
const HEIGHT_M = 2.35;

// ---------- character definitions (all coordinates in source pixels / seconds) ----------
const CHARS = {
  kanye: {
    image: {
      src: 'cover2-1.webp',
      // tight selfie: head fills the frame, the white t-shirt is cut by the crop like the reel's cutout
      params: { crop: [140, 0, 690, 580], outer: [{ e: [415, 260, 222, 345] }, { r: [60, 478, 790, 580] }], inner: [{ e: [415, 300, 165, 245] }, { r: [190, 545, 640, 580] }] },
    },
    audio: {
      src: 'Kanye West - All Of The Lights ft. Rihanna, Kid Cudi.mp3',
      sourceStart: 68.70, // hard onset that matches the reel (docs/REFERENCE.md), re-verified in analyze
      anchor: 68.70, bpmRange: [141.5, 142.7],
      loopBars: [18, 26], // chosen by seam similarity (see docs/ASSETS.md)
      preroll: 0.02,
      rate: 11025, bitrate: '24k', xfade: 0.015, fadeIn: 0.005,
      targetLufs: -7, maxTp: -0.5,
      // meme level: level the quiet build first, then huge sub/bass boost, overdriven hard clip, 5-bit log crush with
      // 8.8 kHz sample hold, clip again, 11 kHz / 24 kbps mp3. loud, crunchy, still recognizable.
      chain: 'loudnorm=I=-16:LRA=4:TP=-3:linear=false,highpass=f=28:poles=2,'
        + 'bass=g=26:f=60:w=0.7,equalizer=f=110:t=q:w=1.0:g=10,lowpass=f=3800:poles=2,'
        + 'volume=14dB,asoftclip=type=hard,'
        + 'acrusher=bits=5:mode=log:samples=5:aa=0:mix=0.9,'
        + 'volume=6dB,asoftclip=type=hard:threshold=0.9,lowpass=f=4500,aresample=11025:filter_size=64:cutoff=0.95',
      chainLabel: 'mono downmix; loudnorm dynamic-mode leveller (I -16, LRA 4); HPF 28 Hz; bass shelf +26 dB @ 60 Hz; peak +10 dB @ 110 Hz; LPF 3.8 kHz; +14 dB into hard clip; acrusher 5-bit log, 5x sample hold, mix 0.9; +6 dB into hard clip at 0.9; LPF 4.5 kHz; swr resample 11025 Hz',
      entranceDelay: 0.25,
    },
  },
  epstein: {
    image: {
      src: 'images (6).jpeg',
      // crop starts at x=205 so the blurred person (x < 195) is excluded entirely; the wall shadow left of the neck is forced to background
      params: {
        crop: [205, 0, 600, 420],
        outer: [{ e: [335, 125, 102, 135] }, { p: [[180, 300], [290, 205], [440, 200], [545, 285], [600, 400], [600, 452], [140, 452]] }],
        inner: [{ e: [340, 150, 58, 88] }, { e: [330, 55, 62, 32] }, { p: [[235, 330], [300, 250], [420, 245], [520, 330], [560, 420], [230, 420]] }],
        bg: [{ p: [[230, 130], [282, 140], [287, 198], [276, 214], [230, 214]] }],
      },
    },
    audio: {
      src: 'Jeffrey Epstein Edit Lil Pump - Boss X Hunnid dolla.mp3',
      sourceStart: 1.50, // inside the 1.10-1.54 s silence that separates the intro from the song
      anchor: 2.04, bpmRange: [110, 130],
      loopBars: [0, 24], // drop -> the song's own second drop at +24 bars
      preroll: 0.02,
      rate: 16000, bitrate: '40k', xfade: 0.012, fadeIn: 0.01,
      targetLufs: -10, maxTp: -0.8,
      // the same recipe, a notch lighter
      chain: 'highpass=f=30:poles=2,bass=g=4:f=70:w=0.8,equalizer=f=900:t=q:w=1:g=4,lowpass=f=5500:poles=2,'
        + 'acrusher=bits=8:mode=lin:samples=3:aa=0.3:mix=0.5,'
        + 'volume=7dB,asoftclip=type=tanh:oversample=2,volume=-2dB,aresample=16000:filter_size=64:cutoff=0.95',
      chainLabel: 'mono downmix; HPF 30 Hz; bass shelf +4 dB @ 70 Hz; +4 dB @ 900 Hz; LPF 5.5 kHz; acrusher 8-bit lin, 3x sample hold, mix 0.5; +7 dB into tanh soft clip, -2 dB; swr resample 16000 Hz',
      entranceDelay: 0.35,
    },
  },
  trump: {
    image: {
      src: 'Donald-Trump-Mugshot-Depth-Of-Field-Culture-1621335357.webp',
      // crop starts at x=400 / y=200: the sheriff badge (x 170-390, y 180-390) is outside it
      params: {
        crop: [400, 200, 1500, 1420],
        outer: [{ e: [905, 700, 450, 510] }, { p: [[400, 1170], [600, 930], [1200, 990], [1500, 1050], [1500, 1500], [400, 1500]] }],
        inner: [{ e: [930, 830, 240, 320] }, { e: [900, 480, 260, 160] }, { p: [[430, 1215], [595, 1000], [660, 1120], [1150, 1130], [1170, 1060], [1480, 1110], [1480, 1420], [430, 1420]] }],
        erode: 3, close: 10, smooth: 3,
      },
    },
    audio: {
      src: 'Donald Trump please save me 🥺🙏 - Meme Asylum.mp3',
      trim: -60, // dBFS (10 ms rms) edge-silence threshold
      rate: 48000, bitrate: '80k', fadeIn: 0.003, fadeOut: 0.02, gap: 0.45, noLimit: true,
      targetLufs: -12, // file stays unprocessed; the extra loudness is playback gain
      chain: 'anull',
      chainLabel: 'mono downmix; edge silence trimmed at -60 dBFS; 3 ms fade-in / 20 ms fade-out; 0.45 s silent gap before the loop repeats; no filtering',
      entranceDelay: 0.15,
    },
  },
};

// extra trump sounds (user added 2026-09-27). audio only; each trump encounter picks one of trump + these.
// processed like the original: unfiltered, edge-trimmed, loudness via playback gain.
const TRUMP_CLIP = { rate: 48000, bitrate: '80k', fadeIn: 0.003, fadeOut: 0.02, gap: 0.45, noLimit: true, targetLufs: -12, chain: 'anull', entranceDelay: 0.15 };
const CLIPS = {
  trump_dogs: {
    ...TRUMP_CLIP,
    src: "Trump They're eating the dogs, the cats.mp3",
    trim: -60,
    chainLabel: 'mono downmix; edge silence trimmed at -60 dBFS; 3 ms fade-in / 20 ms fade-out; 0.45 s gap before the loop repeats; no filtering',
  },
  trump_china: {
    ...TRUMP_CLIP,
    src: 'Donald Trump Says China.mp3',
    // the 180 s file is a speech supercut with gaps; densest 30-45 s window (93% of 50 ms frames above -35 dB),
    // both edges on >= 200 ms silences
    window: [77.725, 107.975],
    chainLabel: 'mono downmix; source window 77.725-107.975 s (densest speech between silence gaps); 3 ms fade-in / 20 ms fade-out; 0.45 s gap before the loop repeats; no filtering',
  },
};

// ---------- helpers ----------
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const ff = (a) => {
  try { return execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }); }
  catch (e) { throw new Error(`ffmpeg failed: ${a.join(' ')}\n${e.stderr?.slice(-1500)}`); }
};
const ffReport = (a) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(r.stderr.slice(-1500));
  return r.stderr;
};
const py = (...a) => JSON.parse(run(PY, [join(root, 'scripts/audio_tools.py'), ...a.map(String)]).trim().split('\n').pop());
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const size = (f) => statSync(f).size;

function measureLoudness(file) {
  // loudnorm analysis pass (json) for I/TP/LRA at 0.01 resolution
  const err = ffReport(['-i', file, '-af', `loudnorm=I=${TARGET_LUFS}:TP=${MAX_TP}:LRA=11:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  return { lufs: +j.input_i, tp: +j.input_tp, lra: +j.input_lra };
}

function ebur128(file) {
  const err = ffReport(['-i', file, '-af', 'ebur128=peak=true+sample', '-f', 'null', '-']);
  const s = err.slice(err.lastIndexOf('Summary:'));
  const num = (re) => { const m = s.match(re); return m ? +m[1] : null; };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/True peak:\s+Peak:\s+(-?[\d.]+)/), samplePeak: num(/Sample peak:\s+Peak:\s+(-?[\d.]+)/) };
}

// ---------- images ----------
function processImage(id, def) {
  const src = join(DL, def.src);
  if (!existsSync(src)) throw new Error(`missing source image ${src}`);
  const out = join(OUT, 'img', `${id}.webp`);
  const res = JSON.parse(run(PY, [join(root, 'scripts/cutout.py'), src, out, JSON.stringify({ height: 512, ...def.params }), ...(DEBUG_DIR ? [DEBUG_DIR] : [])]).trim());
  const probe = run(join(FF, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).trim().split('\n')[0].split(',').map(Number);
  console.log(`img ${id}: ${res.w}x${res.h} aspect ${res.aspect} (${size(out)} B) from ${def.src} ${probe.join('x')}`);
  return { image: `img/${id}.webp`, imageSource: def.src, imageSourceSize: { w: probe[0], h: probe[1], bytes: size(src) }, imageCrop: def.params.crop, imageSubjectBox: res.bbox, imageSize: { w: res.w, h: res.h, bytes: size(out) }, aspect: res.aspect, heightM: HEIGHT_M };
}

// ---------- audio ----------
function processAudio(id, def) {
  const src = join(DL, def.src);
  if (!existsSync(src)) throw new Error(`missing source audio ${src}`);
  const w = (n) => join(WORK, `${id}-${n}`);
  const srcInfo = JSON.parse(run(join(FF, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,sample_rate,channels', '-of', 'json', src]));
  const workRate = def.rate === 48000 ? 48000 : 44100;
  // prepared mono at a fixed working rate (float) for analysis and processing
  ff(['-i', src, '-map', '0:a:0', '-ac', '1', '-ar', String(workRate), '-c:a', 'pcm_f32le', w('src.wav')]);
  const analysis = { sourceCodec: srcInfo.streams[0].codec_name, sourceRate: +srcInfo.streams[0].sample_rate, sourceChannels: srcInfo.streams[0].channels, sourceDuration: r3(+srcInfo.format.duration), sourceBytes: size(src) };
  let sourceStart, sourceEnd, lsSrc, leSrc;

  if (def.loopBars) {
    const a = py('analyze', w('src.wav'), def.anchor, def.bpmRange[0], def.bpmRange[1]);
    const anchor = a.fluxOnset;
    lsSrc = anchor + def.loopBars[0] * a.bar - def.preroll;
    const leGuess = anchor + def.loopBars[1] * a.bar - def.preroll;
    const ref = py('refine', w('src.wav'), lsSrc, leGuess);
    leSrc = ref.loopEnd;
    const sim = py('loopsim', w('src.wav'), lsSrc, leSrc, a.bar);
    sourceStart = def.sourceStart;
    sourceEnd = leSrc + 0.06;
    Object.assign(analysis, { anchorOnset: a.fluxOnset, attackOnset: a.onset, bpm: a.bpm, barSec: a.bar, loopBars: def.loopBars, loopRefineMs: ref.lagMs, loopRefineCorr: ref.corr, loopSimilarity: sim, barRmsDb: a.barRmsDb.slice(0, 32) });
  } else if (def.window) {
    [sourceStart, sourceEnd] = def.window;
    Object.assign(analysis, { window: def.window });
  } else {
    const t = py('trimpoints', w('src.wav'), def.trim);
    sourceStart = Math.max(0, t.start - 0.005);
    sourceEnd = Math.min(t.duration, t.end + 0.01);
    Object.assign(analysis, { trimThresholdDb: def.trim, contentStart: t.start, contentEnd: t.end });
  }

  // 1) trim + degrade (sample-accurate atrim on the float working copy)
  ff(['-i', w('src.wav'), '-af', `atrim=start=${sourceStart}:end=${sourceEnd},asetpts=N/SR/TB,${def.chain}`, '-ac', '1', '-ar', String(def.rate), '-c:a', 'pcm_f32le', w('a.wav')]);
  // 2) fades, baked loop crossfade, optional gap
  let loopStart, loopEnd;
  const bake = { fadeIn: def.fadeIn || 0, fadeOut: def.fadeOut || 0 };
  if (def.loopBars) {
    loopStart = lsSrc - sourceStart;
    loopEnd = leSrc - sourceStart;
    Object.assign(bake, { loopStart, loopEnd, xfade: def.xfade });
  } else {
    bake.padEnd = def.gap;
  }
  const baked = py('bake', w('a.wav'), w('b.wav'), JSON.stringify(bake));
  if (!def.loopBars) { loopStart = 0; loopEnd = baked.duration; }

  // 3) two-pass loudness: measure, static gain, lookahead limiter as a peak guard, encode, re-measure the decoded mp3.
  // noLimit clips (trump) never touch the limiter: the file gain stops at the true-peak budget and the rest of the
  // loudness match is applied at playback as playbackGainDb (float graph, no clipping).
  const pre = measureLoudness(w('b.wav'));
  const T = def.targetLufs ?? TARGET_LUFS, TPMAX = def.maxTp ?? MAX_TP;
  let gainDb = T - pre.lufs;
  if (def.noLimit) gainDb = Math.min(gainDb, TPMAX - 0.4 - pre.tp);
  let limit = TPMAX - 0.5;
  let final, loud;
  for (let pass = 0; pass < 5; pass++) {
    const lim = Math.pow(10, limit / 20);
    const af = `volume=${gainDb.toFixed(3)}dB` + (def.noLimit ? '' : `,alimiter=limit=${lim.toFixed(5)}:attack=4:release=60:level=0:latency=1`);
    ff(['-i', w('b.wav'), '-af', af, '-c:a', 'pcm_f32le', w('c.wav')]);
    const out = join(OUT, 'audio', `${id}.mp3`);
    ff(['-i', w('c.wav'), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-ac', '1', '-ar', String(def.rate), '-c:a', 'libmp3lame', '-b:a', def.bitrate, '-write_id3v1', '0', '-id3v2_version', '0', out]);
    final = out;
    loud = ebur128(out);
    const lufsErr = loud.I - T;
    const tpOver = loud.truePeak - TPMAX;
    console.log(`  ${id} pass ${pass}: gain ${gainDb.toFixed(2)} dB ${def.noLimit ? 'no limiter' : `limit ${limit.toFixed(2)}`} -> I ${loud.I} LUFS, TP ${loud.truePeak} dBTP`);
    if (def.noLimit) { if (tpOver <= 0 && tpOver > -0.4) break; gainDb -= tpOver + 0.15; continue; }
    if (Math.abs(lufsErr) <= 0.25 && tpOver <= 0) break;
    if (tpOver > 0) limit -= tpOver + 0.2;
    if (Math.abs(lufsErr) > 0.25) gainDb -= lufsErr;
  }
  const playbackGainDb = r2(T - loud.I);
  const limited = py('limited', w('b.wav'), w('c.wav'), gainDb);
  // 4) decoded-timeline loop points: align the ffmpeg decode of the mp3 against the pre-limiter wav
  ff(['-i', final, '-c:a', 'pcm_f32le', w('d.wav')]);
  const al = py('align', w('b.wav'), w('d.wav'));
  const off = al.offsetSamples / al.sr;
  const onset = py('onset', w('d.wav'), 0.05);
  const seam = py('seam', w('d.wav'), loopStart + off, loopEnd + off);
  const spec = py('spectrum', w('d.wav'));
  const srcSpec = py('spectrum', w('src.wav'));
  Object.assign(analysis, { decodeOffsetMs: al.offsetMs, decodeAlignCorr: al.corr, decodedSamples: onset.samples, seam, spectrum: spec, sourceSpectrum: srcSpec, preGainLufs: pre.lufs, preGainTruePeak: pre.tp, limiter: def.noLimit ? 'off' : limited });
  console.log(`aud ${id}: ${r3(sourceStart)}-${r3(sourceEnd)} loop ${r3(loopStart + off)}-${r3(loopEnd + off)} gain ${r2(gainDb)} dB I ${loud.I} TP ${loud.truePeak} (${size(final)} B)`);
  return {
    audio: `audio/${id}.mp3`, audioSource: def.src,
    sourceStart: r3(sourceStart), sourceEnd: r3(sourceEnd),
    loopStart: +(loopStart + off).toFixed(4), loopEnd: +(loopEnd + off).toFixed(4),
    duration: +onset.duration.toFixed(4), onsetAt: +onset.onsetAt.toFixed(4), onsetThreshold: 0.05,
    entranceDelay: def.entranceDelay, gainDb: r2(gainDb), playbackGainDb, limiterCeilingDb: def.noLimit ? null : r2(limit),
    lufs: loud.I, truePeak: loud.truePeak, samplePeak: loud.samplePeak, lra: loud.LRA,
    rate: def.rate, bitrate: def.bitrate, bytes: size(final),
    processing: def.chainLabel + `; static gain ${r2(gainDb)} dB (${loud.I} LUFS in file, playback trim ${playbackGainDb} dB to ${T} LUFS); ${def.noLimit ? 'no limiter' : `lookahead limiter ceiling ${r2(limit)} dBFS`}; libmp3lame ${def.bitrate} CBR mono ${def.rate} Hz`,
    analysis,
  };
}

// ---------- main ----------
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(join(OUT, 'img'), { recursive: true });
mkdirSync(join(OUT, 'audio'), { recursive: true });

const manifestPath = join(OUT, 'manifest.json');
const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { characters: {} };
const manifest = { version: 1, targetLufs: TARGET_LUFS, maxTruePeak: MAX_TP, characters: {} };
for (const id of Object.keys(CHARS)) {
  const def = CHARS[id];
  const entry = { ...(prev.characters?.[id] || {}) };
  if (!only || only.includes(id)) {
    if (!args['skip-images']) Object.assign(entry, processImage(id, def.image));
    if (!args['skip-audio']) Object.assign(entry, processAudio(id, def.audio));
  }
  // stable key order: the architecture's manifest shape first
  const order = ['image', 'imageSource', 'aspect', 'heightM', 'audio', 'audioSource', 'sourceStart', 'sourceEnd', 'loopStart', 'loopEnd', 'entranceDelay', 'gainDb', 'playbackGainDb', 'lufs', 'truePeak', 'processing'];
  const sorted = {};
  for (const k of order) if (k in entry) sorted[k] = entry[k];
  for (const k of Object.keys(entry)) if (!(k in sorted)) sorted[k] = entry[k];
  manifest.characters[id] = sorted;
}
manifest.clips = {};
for (const id of Object.keys(CLIPS)) {
  manifest.clips[id] = (!only || only.includes(id)) && !args['skip-audio'] ? processAudio(id, CLIPS[id]) : prev.clips?.[id];
}
manifest.characters.trump.audioVariants = ['trump', ...Object.keys(CLIPS).filter((k) => k.startsWith('trump_'))];
// keys written by other scripts (fetch-memes.mjs: sfx, memeCategories, sfxMeta, posters, tv) pass through untouched
for (const k of Object.keys(prev)) if (!(k in manifest)) manifest[k] = prev[k];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
rmSync(WORK, { recursive: true, force: true });
console.log('wrote', manifestPath);
