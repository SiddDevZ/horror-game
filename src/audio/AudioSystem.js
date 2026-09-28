// webaudio for the backrooms: buses wired to settings, one positioned enemy track, a procedural ambience bed,
// pooled feature emitters (cooler / phone / vent), pre-rendered procedural one-shots, downloaded meme clips
// (audio.meme), quiet positional objective beacons (audio.beacon) and the v4 jukebox party track (audio.partyStart).
// the webaudio listener stays at the origin facing -z; every source is placed relative to the player so large
// world coordinates never reach the panner (precision).
import { keyCx, keyCz, CHUNK_CELLS, CELL, ZONE } from '../world/constants.js';
import { makeRng } from '../core/rng.js';
import { renderOneShots, makeLoopBuffers, makeFarIR } from './synth.js';

const BUS_KEYS = { master: 'volMaster', ambience: 'volAmbience', enemy: 'volEnemy', interaction: 'volInteraction', sudden: 'volSudden' };
const SFX_BUS = {
  step: 'interaction', stepRun: 'interaction', doorOpen: 'interaction', doorClose: 'interaction', switch: 'interaction', recover: 'interaction',
  impact: 'sudden', sting: 'sudden', death: 'sudden',
  flickerBuzz: 'ambience', distantDoor: 'ambience', ventKnock: 'ambience', phoneRing: 'ambience',
};
const SFX_GAIN = {
  step: 0.32, stepRun: 0.42, doorOpen: 0.6, doorClose: 0.7, switch: 0.55, recover: 0.4,
  impact: 0.9, sting: 0.55, death: 0.75, flickerBuzz: 0.28, distantDoor: 0.5, ventKnock: 0.55, phoneRing: 0.4,
};
const EMITTER_TYPES = { cooler: 1, phone: 2, vent: 3 };
const EMIT_RADIUS = 15;
const MAX_EMITTERS = 4;
const SPATIAL_VOICES = 8;
const ENEMY_HEAD = 1.55; // metres above the sprite bottom where the sound comes from
const vol = (v) => v * v; // slider -> gain, roughly perceptual

// meme categories (manifest.memeCategories): bus + gain. the files are already mastered hot (-9 LUFS); KEEP IT LOUD.
// far: muffled, distant and through a long dark room (creepy-funny). ref/roll: panner distance model when positioned.
const MEME_CAT = {
  reveal: { bus: 'sudden', gain: 1.0 }, hit: { bus: 'sudden', gain: 1.0 }, death: { bus: 'sudden', gain: 1.0 },
  win: { bus: 'sudden', gain: 1.0 }, escape: { bus: 'sudden', gain: 0.95 }, airhorn: { bus: 'sudden', gain: 1.15 },
  collect: { bus: 'interaction', gain: 1.0 }, poster: { bus: 'interaction', gain: 1.0 }, tv: { bus: 'interaction', gain: 0.9 },
  phone: { bus: 'interaction', gain: 1.0 }, radio: { bus: 'interaction', gain: 0.85 }, drink: { bus: 'interaction', gain: 1.0 },
  vending: { bus: 'interaction', gain: 1.0 }, breaker: { bus: 'interaction', gain: 1.0 },
  ambientFar: { bus: 'ambience', gain: 1.6, far: true },
  // v3 tasks: taskStart is a small click, ok / fail land hard
  taskStart: { bus: 'interaction', gain: 0.9 }, taskOk: { bus: 'sudden', gain: 1.0 }, taskFail: { bus: 'sudden', gain: 1.0 },
  party: { bus: 'sudden', gain: 1.0 }, // stingers over the sigma boy track (airhorns, erm what the sigma)
};
const MEME_DEFAULT = { bus: 'sudden', gain: 1.0 };
const MEME_PREFIXED = { bus: 'interaction', gain: 1.0 }; // task:<kind> and meme:<kind>
// a prop or task kind with no clips of its own still makes a noise
const MEME_FALLBACK = { 'meme:': 'poster', 'task:': 'taskStart' };
const MEME_CORE = ['reveal', 'hit', 'death', 'collect', 'escape', 'airhorn', 'ambientFar', 'taskStart', 'taskOk', 'taskFail'];
const catInfo = (cat) => (cat && (MEME_CAT[cat] || (cat.indexOf(':') > 0 ? MEME_PREFIXED : null))) || MEME_DEFAULT;
const MEME_VOICES = 6; // positional
const MEME_2D = 4;
const MEME_LATE = 0.8; // a lazily decoded clip still plays if it is ready within this many seconds
const MAX_BEACONS = 4;
const BEACON_GAIN = 0.45;
// party: sigma boy plays 2D on the enemy bus (same +4 dB hot level as the villain tracks); ambience ducks under it
const PARTY_DUCK = 0.2;
const PARTY_LEAD = 0.03; // seconds between asking for the track and its first sample
const PARTY_WAIT_MAX = 6; // a party started before the track decoded waits this long for it, then the clock runs anyway
const wallNow = () => performance.now() / 1000;

export class AudioSystem {
  constructor(settings, world) {
    this.settings = settings;
    this.world = world;
    this.ctx = null;
    this.ready = false; // procedural buffers rendered
    this.paused = false;
    this.lx = 0; this.ly = 1.68; this.lz = 0; this.yaw = 0;
    this._cos = 1; this._sin = 0;
    this.clips = new Map(); // id -> { buffer, loopStart, loopEnd, entranceDelay, gain, offsetMs }
    this._loading = new Map(); // id -> promise
    this.variants = new Map(); // charId -> [clip ids]
    this.lastVariant = new Map();
    this.voices = 0; // live AudioBufferSourceNodes (debug / release checks)
    this.rng = makeRng(0x5eed1e55);
    this.oneShots = null;
    this.loops = null;
    this.chase = 0;
    // enemy state (two chains so a stopping track can fade while the next starts)
    this.enemy = { active: false, charId: null, x: 0, y: 0, z: 0, muffle: 0, slot: 0, pending: null };
    this._emitTimer = 0;
    this._distantTimer = 20;
    this._zoneDark = 0;
    // emitter scan scratch (no allocation in update)
    this._candF = new Array(16).fill(null);
    this._candD = new Float64Array(16);
    this._candN = 0;
    this._scanChunk = this._scanChunk.bind(this);
    // memes
    this.memeManifest = null;
    this.memeBufs = new Map(); // id -> AudioBuffer
    this._memeLoading = new Map(); // id -> promise
    this._memeLast = new Map(); // category -> last id
    this._memeEpoch = 0; // bumped by stopAll so late lazy decodes never play into a reset
    this.lastMeme = null;
    this.beacons = [];
    // party: `wall0` anchors the song position to a pause-aware wall clock, so the beat keeps going while the track is
    // still decoding or the game is muted; while the track plays, `startAt` (context time of file position 0) wins
    this.party = { active: false, info: null, buf: null, loading: null, bytes: null, failed: false, waiting: false, reqAt: 0, src: null, gn: null, live: 0, loop: false, gain: 1, startAt: 0, wall0: 0, offset: 0 };
    this._pauseAcc = 0; this._pausedAt = 0;
    settings.on((k, v) => this._onSetting(k, v));
  }

  // ---------- lifecycle ----------
  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const g = () => ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    // brickwall-ish safety just under full scale: the meme tracks are meant to be loud, so it only catches overs
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
    this.bus = { master: g(), ambience: g(), enemy: g(), interaction: g(), sudden: g() };
    this.duck = g(); // ambience chase duck
    this.bus.master.connect(this.limiter).connect(ctx.destination);
    this.bus.ambience.connect(this.duck).connect(this.bus.master);
    this.bus.enemy.connect(this.bus.master);
    this.bus.interaction.connect(this.bus.master);
    this.bus.sudden.connect(this.bus.master);
    for (const b in BUS_KEYS) this.bus[b].gain.value = this._busTarget(b);

    // enemy chains: env (fades) -> lowpass (muffle) -> muffle gain -> panner (hrtf) -> enemy bus
    this.enemySlots = [0, 1].map(() => {
      const env = g(), lp = ctx.createBiquadFilter(), mg = g(), pan = this._panner('HRTF', 6, 0.55);
      lp.type = 'lowpass'; lp.frequency.value = 18000; lp.Q.value = 0.5;
      env.gain.value = 0;
      env.connect(lp).connect(mg).connect(pan).connect(this.bus.enemy);
      return { env, lp, mg, pan, src: null, stopAt: 0 };
    });

    // ambience bed: hum + whine + air, each a looping buffer through its own gain
    this.bed = { hum: g(), air: g() };
    this.bed.hum.gain.value = 0; this.bed.air.gain.value = 0;
    this.bed.hum.connect(this.bus.ambience);
    this.bed.air.connect(this.bus.ambience);

    // emitter pool
    this.emitters = [];
    for (let i = 0; i < MAX_EMITTERS; i++) {
      const lp = ctx.createBiquadFilter(), gn = g(), pan = this._panner('equalpower', 1.5, 1.2);
      lp.type = 'lowpass'; lp.frequency.value = 16000;
      gn.gain.value = 0;
      lp.connect(gn).connect(pan).connect(this.bus.ambience);
      this.emitters.push({ lp, gn, pan, feature: null, type: 0, loopSrc: null, next: 0, phase: 0, x: 0, z: 0, occl: 0 });
    }
    // spatial one-shot pool (round robin, oldest stolen)
    this.spatial = [];
    this._spatialNext = 0;
    for (let i = 0; i < SPATIAL_VOICES; i++) {
      const lp = ctx.createBiquadFilter(), gn = g(), pan = this._panner('equalpower', 2, 1);
      lp.type = 'lowpass'; lp.frequency.value = 20000;
      lp.connect(gn).connect(pan);
      this.spatial.push({ lp, gn, pan, src: null, bus: null });
    }
    // meme voices: src -> lp -> gn -> panner -> bus, plus gn -> farSend -> shared dark room -> ambience
    this.farRoom = ctx.createConvolver();
    this.farRoom.buffer = makeFarIR(ctx);
    this.farRoom.connect(this.bus.ambience);
    this.memeVoices = [];
    this._memeNext = 0;
    for (let i = 0; i < MEME_VOICES; i++) {
      const lp = ctx.createBiquadFilter(), gn = g(), send = g(), pan = this._panner('equalpower', 3, 0.9);
      lp.type = 'lowpass'; lp.frequency.value = 20000;
      send.gain.value = 0;
      lp.connect(gn).connect(pan);
      gn.connect(send).connect(this.farRoom);
      this.memeVoices.push({ lp, gn, send, pan, src: null, bus: null, id: null, at: 0 });
    }
    this.meme2d = [];
    this._meme2dNext = 0;
    for (let i = 0; i < MEME_2D; i++) this.meme2d.push({ gn: g(), src: null, bus: null, id: null, at: 0 });
    // objective beacons: looped hiss/hum, hrtf so they can be found by ear, occlusion lowpass
    for (let i = 0; i < MAX_BEACONS; i++) {
      const lp = ctx.createBiquadFilter(), gn = g(), pan = this._panner('HRTF', 2, 1.0);
      lp.type = 'lowpass'; lp.frequency.value = 9000;
      gn.gain.value = 0;
      lp.connect(gn).connect(pan).connect(this.bus.ambience);
      const b = this.beacons[i] || (this.beacons[i] = { id: null, x: 0, z: 0 });
      Object.assign(b, { lp, gn, pan, src: null, occl: 0 });
    }
    this._applyMute();
    return ctx;
  }

  _panner(model, ref, rolloff) {
    const p = this.ctx.createPanner();
    p.panningModel = model;
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 200;
    p.positionX.value = 0; p.positionY.value = 0; p.positionZ.value = -1;
    return p;
  }

  /** call synchronously inside the start click */
  unlock() {
    const ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state !== 'running' && !this._mutedNow()) ctx.resume();
    // a silent one-sample blip keeps older safari happy
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start();
    if (!this._initPromise) this._initPromise = this._init();
  }

  async _init() {
    const ctx = this.ctx;
    this.loops = makeLoopBuffers(ctx);
    this.oneShots = await renderOneShots(ctx.sampleRate, 0x0ff1ce);
    this.ready = true;
    this._startBed();
  }

  _startBed() {
    const ctx = this.ctx;
    const mk = (buf, dest) => {
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true; s.connect(dest); s.start();
      return s;
    };
    this._humSrc = mk(this.loops.hum, this.bed.hum);
    this._airSrc = mk(this.loops.air, this.bed.air);
    const t = ctx.currentTime;
    this.bed.hum.gain.setTargetAtTime(0.9, t, 1.2);
    this.bed.air.gain.setTargetAtTime(0.9, t, 1.5);
  }

  /** fetch + decode only the listed clips; resolves when all listed are ready */
  preload(manifest, ids) {
    const ctx = this._ensure();
    if (!ctx || !manifest) return Promise.resolve();
    const jobs = [];
    for (const id of ids) {
      const m = manifest.characters?.[id];
      if (!m) continue;
      // a character can own several tracks (trump); each encounter picks one
      const variants = (m.audioVariants || [id]).filter((v) => v === id || manifest.clips?.[v]);
      this.variants.set(id, variants);
      for (const v of variants) {
        if (!this._loading.has(v)) this._loading.set(v, this._loadClip(v, v === id ? m : manifest.clips[v]));
        jobs.push(this._loading.get(v));
      }
    }
    const all = Promise.all(jobs).then(() => undefined);
    // first preload happens right after Start: the meme core set follows the first enemy track
    if (manifest.sfx && !this._memeCoreStarted) {
      this._memeCoreStarted = true;
      this.setMemes(manifest);
      // the jukebox sits a few metres from spawn: its track decodes first, alongside the first villain track
      this.preloadParty();
      Promise.all([all, this.preloadParty()]).then(() => this.preloadMemes(MEME_CORE)).then(() => this.preloadMemes(['party'])).catch(() => {});
    }
    return all;
  }

  async _loadClip(id, m) {
    const res = await fetch(new URL(`./assets/${m.audio}`, document.baseURI));
    if (!res.ok) throw new Error(`audio ${id}: http ${res.status}`);
    const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    // mp3 decoders differ on encoder-delay trimming: find the first sample over the manifest's threshold and shift
    // the loop points by the difference to the offline (ffmpeg) decode
    let offset = 0;
    if (Number.isFinite(m.onsetAt)) {
      const d = buffer.getChannelData(0), th = m.onsetThreshold || 0.05;
      const lim = Math.min(d.length, Math.floor(buffer.sampleRate * (m.onsetAt + 0.25)));
      let i = 0;
      while (i < lim && Math.abs(d[i]) <= th) i++;
      if (i < lim) offset = i / buffer.sampleRate - m.onsetAt;
      if (Math.abs(offset) > 0.1) offset = 0;
    }
    const clip = {
      buffer,
      loopStart: Math.max(0, (m.loopStart || 0) + offset),
      loopEnd: Math.min(buffer.duration, (m.loopEnd || buffer.duration) + offset),
      entranceDelay: m.entranceDelay || 0,
      gain: Math.pow(10, (m.playbackGainDb || 0) / 20),
      offsetMs: Math.round(offset * 1e5) / 100,
    };
    this.clips.set(id, clip);
    const p = this.enemy.pending;
    if (p && p === id && this.enemy.active) this._playEnemy(id, 0);
    return clip;
  }

  // ---------- settings / buses ----------
  _busTarget(b) {
    // enemy tracks run +4 dB hot on top of the slider: KEEP IT LOUD
    return vol(this.settings.get(BUS_KEYS[b])) * (b === 'enemy' ? 1.58 : 1);
  }

  _mutedNow() { return !!this.settings.get('muted'); }

  _onSetting(k, v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const b in BUS_KEYS) {
      if (BUS_KEYS[b] !== k || (b === 'master' && this._mutedNow())) continue;
      this.bus[b].gain.setTargetAtTime(vol(v), t, 0.04);
    }
    if (k === 'muted') this._applyMute();
  }

  _applyMute() {
    // muted or paused -> the context is suspended (nothing renders, nothing advances); otherwise running
    const ctx = this.ctx;
    if (!ctx) return;
    const muted = this._mutedNow();
    this.bus.master.gain.cancelScheduledValues(ctx.currentTime);
    this.bus.master.gain.value = muted ? 0 : this._busTarget('master');
    // muted: the party track is released (the beat carries on from the wall clock) and restarts in place on unmute
    if (muted) this._partyRelease(0);
    if (muted || this.paused) { if (ctx.state === 'running') ctx.suspend(); }
    else if (ctx.state === 'suspended' && this._initPromise) ctx.resume();
  }

  pauseAll() {
    if (!this.paused) this._pausedAt = wallNow();
    this.paused = true; this._applyMute();
  }
  resumeAll() {
    if (this.paused) this._pauseAcc += wallNow() - this._pausedAt;
    this.paused = false; this._applyMute();
  }

  /** stop everything game-related (restart / death reset). the ambience bed keeps running */
  stopAll() {
    this.partyStop(0.05);
    this.enemyStop(0.05);
    this.enemy.pending = null;
    if (!this.ctx) { for (const b of this.beacons) b.id = null; return; }
    for (const v of this.spatial) this._stopSrc(v, 0.03);
    for (const e of this.emitters) this._releaseEmitter(e);
    this._memeEpoch++;
    for (const v of this.memeVoices) this._stopSrc(v, 0.03);
    for (const v of this.meme2d) this._stopSrc(v, 0.03);
    for (const b of this.beacons) if (b.id != null) this._beaconRelease(b, 0.05);
    this.setChase(0);
  }

  setChase(c) {
    this.chase = c < 0 ? 0 : c > 1 ? 1 : c;
    this._applyDuck(0.4);
  }

  _applyDuck(tau) {
    if (this.ctx) this.duck.gain.setTargetAtTime((1 - 0.4 * this.chase) * (this.party.active ? PARTY_DUCK : 1), this.ctx.currentTime, tau);
  }

  setListener(x, y, z, yaw) {
    this.lx = x; this.ly = y; this.lz = z;
    if (yaw !== this.yaw) { this.yaw = yaw; this._cos = Math.cos(yaw); this._sin = Math.sin(yaw); }
  }

  // world -> listener space (listener at origin facing -z)
  _place(pan, x, y, z, tau) {
    const dx = x - this.lx, dz = z - this.lz;
    const rx = dx * this._cos - dz * this._sin;
    const rz = dx * this._sin + dz * this._cos;
    const t = this.ctx.currentTime;
    if (tau > 0) {
      pan.positionX.setTargetAtTime(rx, t, tau);
      pan.positionY.setTargetAtTime(y - this.ly, t, tau);
      pan.positionZ.setTargetAtTime(rz, t, tau);
    } else {
      pan.positionX.cancelScheduledValues(t); pan.positionY.cancelScheduledValues(t); pan.positionZ.cancelScheduledValues(t);
      pan.positionX.setValueAtTime(rx, t); pan.positionY.setValueAtTime(y - this.ly, t); pan.positionZ.setValueAtTime(rz, t);
    }
    return Math.hypot(dx, dz);
  }

  // ---------- enemy ----------
  enemyStart(charId, x, y, z, opts) {
    const e = this.enemy;
    e.x = x; e.y = y; e.z = z;
    // same character already running: never restart the entrance (corners, re-sightings)
    if (e.active && e.charId === charId) return;
    if (e.active) this.enemyStop(0.25);
    e.active = true; e.charId = charId; e.muffle = 0;
    if (!this._ensure()) return;
    const clipId = this._pickVariant(charId);
    if (!this.clips.has(clipId)) { e.pending = clipId; return; }
    e.pending = null;
    this._playEnemy(clipId, this.clips.get(clipId).entranceDelay, opts && opts.offset);
  }

  // random loaded variant, never the same one twice in a row for that character
  _pickVariant(charId) {
    const all = this.variants.get(charId);
    if (!all || all.length < 2) return charId;
    const last = this.lastVariant.get(charId);
    let n = 0;
    for (const v of all) if (v !== last && this.clips.has(v)) n++;
    if (!n) return this.clips.has(charId) ? charId : all[0];
    let k = Math.floor(this.rng.next() * n);
    for (const v of all) {
      if (v === last || !this.clips.has(v)) continue;
      if (k-- === 0) { this.lastVariant.set(charId, v); return v; }
    }
    return charId;
  }

  _playEnemy(charId, delay, offset) {
    const ctx = this.ctx, clip = this.clips.get(charId), e = this.enemy;
    e.pending = null;
    e.slot ^= 1;
    const s = this.enemySlots[e.slot];
    this._stopSlot(s, 0.02);
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    src.loopStart = clip.loopStart;
    src.loopEnd = clip.loopEnd;
    src.connect(s.env);
    const t = ctx.currentTime + delay;
    s.env.gain.cancelScheduledValues(ctx.currentTime);
    s.env.gain.setValueAtTime(0, ctx.currentTime);
    s.env.gain.setValueAtTime(0, t);
    s.env.gain.linearRampToValueAtTime(clip.gain, t + 0.015);
    this._placeEnemy(s, 0);
    s.lp.frequency.cancelScheduledValues(ctx.currentTime);
    this._muffle(s, e.muffle, 0);
    src.start(t, offset || 0);
    this._track(src);
    s.src = src;
    s.stopAt = 0;
  }

  enemyUpdate(x, y, z, muffle01) {
    const e = this.enemy;
    e.x = x; e.y = y; e.z = z;
    e.muffle = muffle01 < 0 ? 0 : muffle01 > 1 ? 1 : muffle01;
  }

  enemyStop(fadeSec = 0.6) {
    const e = this.enemy;
    e.active = false; e.pending = null; e.charId = null;
    if (!this.ctx) return;
    for (const s of this.enemySlots) if (s.src && !s.stopAt) this._stopSlot(s, fadeSec);
  }

  _stopSlot(s, fade) {
    if (!s.src) return;
    const ctx = this.ctx, t = ctx.currentTime, f = Math.max(0.01, fade);
    s.env.gain.cancelScheduledValues(t);
    s.env.gain.setValueAtTime(s.env.gain.value, t);
    s.env.gain.linearRampToValueAtTime(0, t + f);
    try { s.src.stop(t + f + 0.02); } catch {}
    s.stopAt = t + f;
    s.src = null;
  }

  _placeEnemy(s, tau) {
    const e = this.enemy;
    return this._place(s.pan, e.x, e.y + ENEMY_HEAD, e.z, tau);
  }

  _muffle(s, m, tau) {
    // geometry muffling: exponential cutoff sweep + a gentle level drop
    const f = 18000 * Math.pow(500 / 18000, m);
    const gn = 1 - 0.3 * m;
    const t = this.ctx.currentTime;
    if (tau > 0) { s.lp.frequency.setTargetAtTime(f, t, tau); s.mg.gain.setTargetAtTime(gn, t, tau); }
    else { s.lp.frequency.setValueAtTime(f, t); s.mg.gain.setValueAtTime(gn, t); }
  }

  // ---------- one-shots ----------
  /** name from SFX_BUS; opts { x, z, gain } (x/z -> positioned) */
  sfx(name, opts) {
    const ctx = this.ctx;
    if (!ctx || !this.ready || ctx.state !== 'running') return;
    const set = this.oneShots[name];
    if (!set) return;
    const buf = set.length > 1 ? set[(this.rng.next() * set.length) | 0] : set[0];
    const busName = SFX_BUS[name] || 'interaction';
    const gain = (SFX_GAIN[name] || 0.5) * (opts && opts.gain != null ? opts.gain : 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (name === 'step' || name === 'stepRun') src.playbackRate.value = 0.93 + this.rng.next() * 0.14;
    if (opts && opts.x != null && opts.z != null) {
      const v = this.spatial[this._spatialNext];
      this._spatialNext = (this._spatialNext + 1) % SPATIAL_VOICES;
      this._stopSrc(v, 0.01);
      if (v.bus !== busName) { v.pan.disconnect(); v.pan.connect(this.bus[busName]); v.bus = busName; }
      v.gn.gain.setValueAtTime(gain, ctx.currentTime);
      v.lp.frequency.setValueAtTime(opts.muffle ? 900 : 20000, ctx.currentTime);
      this._place(v.pan, opts.x, opts.y != null ? opts.y : 1.2, opts.z, 0);
      src.connect(v.lp);
      v.src = src;
    } else {
      const gn = ctx.createGain();
      gn.gain.value = gain;
      src.connect(gn).connect(this.bus[busName]);
    }
    src.start();
    this._track(src);
  }

  _stopSrc(v, fade) {
    if (!v.src) return;
    try { v.src.stop(this.ctx.currentTime + fade); } catch {}
    v.src = null;
  }

  _track(src) {
    this.voices++;
    src.onended = () => { this.voices--; src.disconnect(); };
  }

  // ---------- per frame ----------
  update(dt) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // enemy: position + muffle, smoothed
    const e = this.enemy;
    if (e.active) {
      const s = this.enemySlots[e.slot];
      if (s.src) { this._placeEnemy(s, 0.03); this._muffle(s, e.muffle, 0.12); }
    }
    // stopped slots keep following the enemy position while they fade
    const o = this.enemySlots[e.slot ^ 1];
    if (o.stopAt && ctx.currentTime < o.stopAt) this._placeEnemy(o, 0.03);
    if (this.party.active && !this.party.src) this._partyPlay();
    if (!this.ready) return;
    for (let i = 0; i < MAX_BEACONS; i++) {
      const b = this.beacons[i];
      if (b.id == null) continue;
      if (!b.src) this._beaconStart(b);
      this._place(b.pan, b.x, 1.0, b.z, 0.05);
    }

    this._emitTimer -= dt;
    if (this._emitTimer <= 0) { this._emitTimer = 0.3; this._scanEmitters(); }
    this._updateEmitters();

    this._distantTimer -= dt;
    if (this._distantTimer <= 0) {
      this._distantTimer = 18 + this.rng.next() * 34;
      if (this.chase < 0.2) {
        const a = this.rng.next() * Math.PI * 2, r = 16 + this.rng.next() * 16;
        const name = this.rng.next() < 0.6 ? 'distantDoor' : 'ventKnock';
        this.sfx(name, { x: this.lx + Math.cos(a) * r, z: this.lz + Math.sin(a) * r, gain: 0.55 + this.rng.next() * 0.3, muffle: true });
      }
    }
  }

  _scanChunk(key) {
    const c = this.world.getChunk(keyCx(key), keyCz(key));
    const fs = c && c.features;
    if (!fs) return;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!EMITTER_TYPES[f.type]) continue;
      if (f.ringing === false || (f.data && (f.data.silent || f.data.ringing === false))) continue;
      const dx = f.x - this.lx, dz = f.z - this.lz;
      const d = dx * dx + dz * dz;
      if (d > EMIT_RADIUS * EMIT_RADIUS) continue;
      // keep the nearest MAX_EMITTERS (insertion into a tiny sorted list)
      let n = this._candN;
      if (n === MAX_EMITTERS && d >= this._candD[n - 1]) continue;
      if (n < MAX_EMITTERS) n = ++this._candN;
      let j = n - 1;
      while (j > 0 && this._candD[j - 1] > d) { this._candD[j] = this._candD[j - 1]; this._candF[j] = this._candF[j - 1]; j--; }
      this._candD[j] = d; this._candF[j] = f;
    }
  }

  _scanEmitters() {
    const w = this.world;
    this._candN = 0;
    if (w && w.active) w.active.forEach(this._scanChunk);
    // darker zones: fewer live ballasts, quieter hum
    let dark = 0;
    if (w && w.getChunk) {
      const ix = Math.floor(this.lx / CELL), iz = Math.floor(this.lz / CELL);
      const cx = Math.floor(ix / CHUNK_CELLS), cz = Math.floor(iz / CHUNK_CELLS);
      const c = w.getChunk(cx, cz);
      if (c && c.zone) dark = c.zone[(iz - cz * CHUNK_CELLS) * CHUNK_CELLS + (ix - cx * CHUNK_CELLS)] === ZONE.DARK ? 1 : 0;
    }
    if (dark !== this._zoneDark) { this._zoneDark = dark; this.bed.hum.gain.setTargetAtTime(dark ? 0.25 : 0.9, this.ctx.currentTime, 0.8); }
    // release voices whose feature dropped out, then assign new ones
    for (let i = 0; i < MAX_EMITTERS; i++) {
      const em = this.emitters[i];
      if (!em.feature) continue;
      let keep = false;
      for (let k = 0; k < this._candN; k++) if (this._candF[k] === em.feature) { keep = true; this._candF[k] = null; }
      if (!keep) this._releaseEmitter(em);
    }
    for (let k = 0; k < this._candN; k++) {
      const f = this._candF[k];
      if (!f) continue;
      for (let i = 0; i < MAX_EMITTERS; i++) if (!this.emitters[i].feature) { this._assignEmitter(this.emitters[i], f); break; }
    }
    // occlusion: one grid ray per live emitter every scan
    for (let i = 0; i < MAX_EMITTERS; i++) {
      const em = this.emitters[i];
      if (!em.feature) continue;
      const occl = w.lineOfSight && !w.lineOfSight(this.lx, this.lz, em.x, em.z) ? 1 : 0;
      if (occl !== em.occl) {
        em.occl = occl;
        em.lp.frequency.setTargetAtTime(occl ? 700 : 16000, this.ctx.currentTime, 0.2);
      }
    }
    for (let i = 0; i < MAX_BEACONS; i++) {
      const b = this.beacons[i];
      if (b.id == null || !b.src) continue;
      const occl = w && w.lineOfSight && !w.lineOfSight(this.lx, this.lz, b.x, b.z) ? 1 : 0;
      if (occl !== b.occl) { b.occl = occl; b.lp.frequency.setTargetAtTime(occl ? 900 : 9000, this.ctx.currentTime, 0.25); }
    }
  }

  _assignEmitter(em, f) {
    const ctx = this.ctx, t = ctx.currentTime;
    em.feature = f; em.type = EMITTER_TYPES[f.type]; em.x = f.x; em.z = f.z; em.occl = 0;
    em.lp.frequency.setValueAtTime(16000, t);
    // per-feature phase so rings/knocks never sync up
    const h = ((f.x * 73.1 + f.z * 19.7) % 1 + 1) % 1;
    if (em.type === 1) {
      const s = ctx.createBufferSource();
      s.buffer = this.loops.cooler; s.loop = true;
      s.connect(em.lp); s.start(t, h * this.loops.cooler.duration);
      this._track(s);
      em.loopSrc = s;
      em.gn.gain.setValueAtTime(0, t); em.gn.gain.setTargetAtTime(0.5, t, 0.5);
    } else {
      em.gn.gain.setValueAtTime(em.type === 2 ? 0.55 : 0.8, t);
      em.next = t + 0.5 + h * (em.type === 2 ? 4 : 8);
      em.phase = 0;
    }
    this._place(em.pan, em.x, em.type === 3 ? 2.6 : 0.9, em.z, 0);
  }

  _releaseEmitter(em) {
    if (!em.feature) return;
    const t = this.ctx.currentTime;
    em.gn.gain.cancelScheduledValues(t);
    em.gn.gain.setTargetAtTime(0, t, 0.15);
    if (em.loopSrc) { try { em.loopSrc.stop(t + 0.6); } catch {} em.loopSrc = null; }
    em.feature = null; em.type = 0;
  }

  _updateEmitters() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < MAX_EMITTERS; i++) {
      const em = this.emitters[i];
      if (!em.feature) continue;
      this._place(em.pan, em.x, em.type === 3 ? 2.6 : 0.9, em.z, 0.02);
      if (em.type === 1 || t < em.next) continue;
      const src = this.ctx.createBufferSource();
      if (em.type === 2) {
        // phone: rings in bursts of four, then a long pause
        src.buffer = this.oneShots.phoneRing[0];
        em.phase = (em.phase + 1) % 5;
        em.next = t + (em.phase === 0 ? 14 + this.rng.next() * 10 : 3.6);
        if (em.phase === 0) continue; // the pause slot plays nothing
      } else {
        const set = this.oneShots.ventKnock;
        src.buffer = set[(this.rng.next() * set.length) | 0];
        em.next = t + 5 + this.rng.next() * 11;
      }
      src.connect(em.lp);
      src.start(t);
      this._track(src);
    }
  }

  // ---------- memes ----------
  /** manifest with sfx + memeCategories (preload() calls this on its own) */
  setMemes(manifest) {
    if (manifest && manifest.sfx) this.memeManifest = manifest;
    this.setParty(manifest);
  }

  /** decode every clip of the listed categories (or ids); max 3 decodes in flight */
  preloadMemes(names) {
    const m = this.memeManifest;
    if (!m || !this._ensure()) return Promise.resolve();
    const ids = new Set();
    for (const n of names) {
      const cat = m.memeCategories && m.memeCategories[n];
      if (cat) for (const id of cat) ids.add(id);
      else if (m.sfx[n]) ids.add(n);
    }
    const list = [...ids];
    let i = 0;
    const worker = async () => { while (i < list.length) { const id = list[i++]; await this._loadMeme(id).catch(() => null); } };
    return Promise.all([worker(), worker(), worker()]).then(() => undefined);
  }

  _loadMeme(id) {
    if (this.memeBufs.has(id)) return Promise.resolve(this.memeBufs.get(id));
    if (this._memeLoading.has(id)) return this._memeLoading.get(id);
    const e = this.memeManifest && this.memeManifest.sfx[id];
    if (!e || !this.ctx) return Promise.resolve(null);
    const p = fetch(new URL(`./assets/${e.file}`, document.baseURI))
      .then((r) => { if (!r.ok) throw new Error(`meme ${id}: http ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => { this.memeBufs.set(id, buf); this._memeLoading.delete(id); return buf; })
      .catch((err) => { this._memeLoading.delete(id); console.warn(String(err)); return null; });
    this._memeLoading.set(id, p);
    return p;
  }

  // random clip of a category, never the one it played last; prefers already decoded clips
  _pickMeme(cat) {
    const all = this.memeManifest.memeCategories[cat];
    if (!all || !all.length) return null;
    const last = this._memeLast.get(cat);
    let n = 0;
    for (const id of all) if (id !== last && this.memeBufs.has(id)) n++;
    const loadedOnly = n > 0;
    if (!loadedOnly) for (const id of all) if (id !== last) n++;
    if (!n) return all[0];
    let k = Math.floor(this.rng.next() * n);
    for (const id of all) {
      if (id === last || (loadedOnly && !this.memeBufs.has(id))) continue;
      if (k-- === 0) { this._memeLast.set(cat, id); return id; }
    }
    return all[0];
  }

  /**
   * play one meme clip: a category (random, no immediate repeat) or a clip id.
   * opts { x, z, y, gain, far }: x/z -> positioned in the world, else 2D. ambientFar without x/z is placed 18-32 m away;
   * far: false plays an ambientFar clip dry, far: true gives any clip the distant treatment.
   * returns the clip id (it may start a moment later if it still had to decode), or null.
   */
  meme(name, opts) {
    const m = this.memeManifest;
    if (!m || !this._ensure() || this.paused || this._mutedNow()) return null;
    let cat = null, id = name;
    const cats = m.memeCategories || {};
    if (!cats[name] && !m.sfx[name] && typeof name === 'string') {
      const pre = name.slice(0, 5);
      if (MEME_FALLBACK[pre] && cats[MEME_FALLBACK[pre]]) name = MEME_FALLBACK[pre];
    }
    if (cats[name] && cats[name].length) { cat = name; id = this._pickMeme(name); }
    else if (m.sfx[name]) cat = m.sfx[name].categories ? m.sfx[name].categories[0] : null;
    else return null;
    if (!id) return null;
    const buf = this.memeBufs.get(id);
    if (buf) { this._playMeme(id, buf, cat, opts); return id; }
    // not decoded yet: decode (plus the rest of its category) and play if it is still timely
    const epoch = this._memeEpoch, t0 = this.ctx.currentTime;
    const o = opts ? { x: opts.x, y: opts.y, z: opts.z, gain: opts.gain, far: opts.far } : null;
    this._loadMeme(id).then((b) => {
      if (b && epoch === this._memeEpoch && this.ctx.currentTime - t0 < MEME_LATE) this._playMeme(id, b, cat, o);
    });
    if (cat) this.preloadMemes([cat]);
    return id;
  }

  _playMeme(id, buf, cat, opts) {
    const ctx = this.ctx;
    if (ctx.state !== 'running' || this.paused) return;
    const e = this.memeManifest.sfx[id];
    const c = catInfo(cat);
    const isFar = opts && opts.far != null ? !!opts.far : !!c.far;
    const t = ctx.currentTime;
    const gain = c.gain * Math.pow(10, (e.playbackGainDb || 0) / 20) * (opts && opts.gain != null ? opts.gain : 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let x = opts && opts.x, z = opts && opts.z;
    if (isFar && (x == null || z == null)) {
      const a = this.rng.next() * Math.PI * 2, r = 18 + this.rng.next() * 14;
      x = this.lx + Math.cos(a) * r; z = this.lz + Math.sin(a) * r;
    }
    let v;
    if (x != null && z != null) {
      v = this.memeVoices[this._memeNext];
      this._memeNext = (this._memeNext + 1) % MEME_VOICES;
      this._stopSrc(v, 0.01);
      if (v.bus !== c.bus) { v.pan.disconnect(); v.pan.connect(this.bus[c.bus]); v.bus = c.bus; }
      const d = this._place(v.pan, x, opts && opts.y != null ? opts.y : 1.4, z, 0);
      if (isFar) {
        // far away through walls: darker the further it is, plus a little of a long dark room
        v.lp.frequency.setValueAtTime(Math.max(380, 1600 - d * 35), t);
        v.pan.rolloffFactor = 0.5; // carries further than near memes: heard, never seen
        v.gn.gain.setValueAtTime(gain, t);
        v.send.gain.setValueAtTime(0.3, t);
        src.playbackRate.value = 0.9 + this.rng.next() * 0.08;
      } else {
        v.lp.frequency.setValueAtTime(20000, t);
        v.pan.rolloffFactor = 0.9;
        v.gn.gain.setValueAtTime(gain, t);
        v.send.gain.setValueAtTime(0, t);
      }
      src.connect(v.lp);
    } else {
      v = this.meme2d[this._meme2dNext];
      this._meme2dNext = (this._meme2dNext + 1) % MEME_2D;
      this._stopSrc(v, 0.01);
      if (v.bus !== c.bus) { v.gn.disconnect(); v.gn.connect(this.bus[c.bus]); v.bus = c.bus; }
      v.gn.gain.setValueAtTime(gain, t);
      src.connect(v.gn);
    }
    v.src = src; v.id = id; v.at = t;
    src.start(t);
    this._track(src);
    this.lastMeme = id;
  }

  // ---------- objective beacons ----------
  /** quiet positional loop for an objective (pooled, max 4). calling again with the same id moves it */
  beacon(id, x, z) {
    let b = null, far = null, farD = -1;
    for (let i = 0; i < MAX_BEACONS; i++) {
      const c = this.beacons[i] || (this.beacons[i] = { id: null, x: 0, z: 0, src: null });
      if (c.id === id) { c.x = x; c.z = z; return true; }
      if (c.id == null) { if (!b) b = c; continue; }
      const d = (c.x - this.lx) ** 2 + (c.z - this.lz) ** 2;
      if (d > farD) { farD = d; far = c; }
    }
    if (!b) {
      // pool full: the farthest one yields if the new beacon is nearer
      if ((x - this.lx) ** 2 + (z - this.lz) ** 2 >= farD) return false;
      if (this.ctx) this._beaconRelease(far, 0.3); else far.id = null;
      b = far;
    }
    b.id = id; b.x = x; b.z = z;
    if (this.ctx && this.ready) this._beaconStart(b);
    return true;
  }

  beaconStop(id) {
    for (const b of this.beacons) {
      if (b.id !== id) continue;
      if (this.ctx) this._beaconRelease(b, 0.4); else b.id = null;
    }
  }

  _beaconStart(b) {
    if (!b.lp || b.src || !this.loops) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.loops.beacon; s.loop = true;
    s.connect(b.lp);
    // per-beacon phase so two beacons never blip together
    const h = ((b.x * 12.9898 + b.z * 78.233) % 1 + 1) % 1;
    s.start(t, h * this.loops.beacon.duration);
    this._track(s);
    b.src = s; b.occl = 0;
    b.lp.frequency.setValueAtTime(9000, t);
    this._place(b.pan, b.x, 1.0, b.z, 0);
    b.gn.gain.cancelScheduledValues(t);
    b.gn.gain.setValueAtTime(0, t);
    b.gn.gain.setTargetAtTime(BEACON_GAIN, t, 0.25);
  }

  _beaconRelease(b, fade) {
    b.id = null;
    if (!b.src) return;
    const t = this.ctx.currentTime;
    b.gn.gain.cancelScheduledValues(t);
    b.gn.gain.setValueAtTime(b.gn.gain.value, t);
    b.gn.gain.linearRampToValueAtTime(0, t + fade);
    try { b.src.stop(t + fade + 0.02); } catch {}
    b.src = null;
  }

  // ---------- party (v4 jukebox) ----------
  /** manifest.party (preload() calls this through setMemes) */
  setParty(manifest) {
    if (manifest && manifest.party && manifest.party.audio) this.party.info = manifest.party;
  }

  /** start downloading the party track's bytes at boot (no AudioContext needed); decoded after Start */
  prefetchParty(manifest) {
    const p = this.party;
    if (manifest) this.setParty(manifest);
    if (p.bytes || !p.info) return;
    p.bytes = fetch(new URL(`./assets/${p.info.audio}`, document.baseURI))
      .then((r) => { if (!r.ok) throw new Error(`party: http ${r.status}`); return r.arrayBuffer(); });
    p.bytes.catch(() => {});
  }

  /** fetch + decode the sigma boy track (preload() starts this right after Start) */
  preloadParty() {
    const p = this.party;
    if (p.buf) return Promise.resolve(p.buf);
    if (p.loading) return p.loading;
    if (!p.info || !this._ensure()) return Promise.resolve(null);
    const m = p.info;
    // reuse the boot-time download; a failed prefetch is retried once here
    const bytes = p.bytes ? p.bytes.catch(() => null) : Promise.resolve(null);
    p.bytes = null;
    p.loading = bytes
      .then((ab) => ab || fetch(new URL(`./assets/${m.audio}`, document.baseURI))
        .then((r) => { if (!r.ok) throw new Error(`party: http ${r.status}`); return r.arrayBuffer(); }))
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => {
        // same decoder-delay check as the villain tracks: shift the beat grid by the difference to the offline decode
        let off = 0;
        if (Number.isFinite(m.onsetAt)) {
          const d = buf.getChannelData(0), th = m.onsetThreshold || 0.05;
          const lim = Math.min(d.length, Math.floor(buf.sampleRate * (m.onsetAt + 0.25)));
          let i = 0;
          while (i < lim && Math.abs(d[i]) <= th) i++;
          if (i < lim) off = i / buf.sampleRate - m.onsetAt;
          if (Math.abs(off) > 0.1) off = 0;
        }
        p.offset = off; p.buf = buf; p.loading = null; p.failed = false;
        return buf;
      })
      .catch((err) => { p.loading = null; p.failed = true; console.warn(String(err)); return null; });
    return p.loading;
  }

  /**
   * start PARTY MODE music: stops any villain track, ducks ambience, plays sigma boy 2D on the enemy bus.
   * opts { loop: wrap the 16 chorus bars instead of ending on the outro, gain, sting: play a 'party' meme stinger }.
   * returns false when there is no party track in the manifest.
   */
  partyStart(opts) {
    const p = this.party;
    if (!p.info && this.memeManifest) this.setParty(this.memeManifest);
    if (!p.info || !this._ensure()) return false;
    if (p.active) this._partyRelease(0.05);
    this.enemyStop(0.3);
    p.active = true;
    p.loop = !!(opts && opts.loop);
    p.gain = (opts && opts.gain != null ? opts.gain : 1) * Math.pow(10, (p.info.playbackGainDb || 0) / 20);
    // the song starts from the top once it's decoded; the party clock waits for it (up to PARTY_WAIT_MAX)
    p.reqAt = this._wall();
    p.waiting = !p.buf;
    p.wall0 = p.reqAt + PARTY_LEAD;
    if (p.waiting) this.preloadParty();
    this._applyDuck(0.25);
    this._partyPlay();
    if (opts && opts.sting) this.meme('party');
    return true;
  }

  /** end the party track with a fade (seconds); ambience comes back */
  partyStop(fade = 0.8) {
    const p = this.party;
    if (!p.active && !p.src) return;
    p.active = false;
    p.waiting = false;
    this._partyRelease(fade);
    this._applyDuck(0.8);
  }

  /** current beat as a float (0 = first downbeat of the file, 2 = the drop) from the audio clock; null when no party */
  partyBeat() {
    const p = this.party;
    if (!p.active || !p.info) return null;
    return (this._partyPos() - p.info.firstBeat) * p.info.bpm / 60;
  }

  /** seconds into the party track (file time, what is heard); NaN when no party */
  partyTime() {
    const p = this.party;
    return p.active && p.info ? this._partyPos() : NaN;
  }

  /** debug / tests: { active, playing, live (sources not yet ended), pos, beat, duration, pending, decoded } */
  partyState() {
    const p = this.party;
    return { active: p.active, playing: !!p.src, live: p.live, pos: p.active ? this._partyPos() : 0, beat: this.partyBeat(), duration: p.info ? p.info.duration : 0, pending: !!p.loading, decoded: !!p.buf };
  }

  _wall() { return wallNow() - this._pauseAcc - (this.paused ? wallNow() - this._pausedAt : 0); }

  // song position in seconds (file time, loop-wrapped when looping); what is heard, so output latency is removed
  _partyPos() {
    const p = this.party, ctx = this.ctx;
    let pos;
    if (p.src && ctx) pos = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - p.startAt;
    else if (p.waiting && !p.failed) {
      // still downloading/decoding: hold at the top of the song, then let the clock run so a party can't hang
      const w = this._wall() - p.reqAt;
      pos = w > PARTY_WAIT_MAX ? w - PARTY_WAIT_MAX : 0;
    } else pos = this._wall() - p.wall0;
    const m = p.info;
    if (p.loop && pos > m.loopEnd) pos = m.loopStart + ((pos - m.loopStart) % (m.loopEnd - m.loopStart));
    return pos;
  }

  _partyPlay() {
    const p = this.party, ctx = this.ctx;
    if (!p.active || p.src || !ctx || ctx.state !== 'running' || this.paused || this._mutedNow()) return;
    if (!p.buf) { if (!p.loading) this.preloadParty(); return; } // update() retries once decoded
    if (p.waiting) {
      // decoded after the party started: begin at the top (or where the capped wait says the song should be)
      const w = this._wall() - p.reqAt;
      p.wall0 = p.reqAt + Math.min(w, PARTY_WAIT_MAX) + PARTY_LEAD;
      p.waiting = false;
    }
    // join the song where the wall clock says it is (late decode, unmute), never replaying the pickup
    let pos = this._wall() - p.wall0 + PARTY_LEAD;
    const m = p.info, dur = p.buf.duration;
    if (!p.loop && pos >= dur - 0.05) return;
    const t = ctx.currentTime;
    const when = t + PARTY_LEAD + (pos < 0 ? -pos : 0);
    if (pos < 0) pos = 0;
    let offset = pos;
    if (p.loop && offset > m.loopEnd) offset = m.loopStart + ((offset - m.loopStart) % (m.loopEnd - m.loopStart));
    // a gain node per start (not per frame): a fading old track can never be pulled back up by the next start
    const src = ctx.createBufferSource(), gn = ctx.createGain();
    src.buffer = p.buf;
    if (p.loop) { src.loop = true; src.loopStart = m.loopStart + p.offset; src.loopEnd = m.loopEnd + p.offset; }
    gn.gain.setValueAtTime(0, t);
    gn.gain.setValueAtTime(0, when);
    gn.gain.linearRampToValueAtTime(p.gain, when + (pos > 0 ? 0.08 : 0.004));
    src.connect(gn).connect(this.bus.enemy);
    const bo = offset + p.offset; // buffer time; a decoder that starts early can make it slightly negative
    src.start(bo < 0 ? when - bo : when, bo < 0 ? 0 : bo);
    src.onended = () => { this.voices--; p.live--; src.disconnect(); gn.disconnect(); if (p.src === src) { p.src = null; p.gn = null; } };
    this.voices++; p.live++;
    p.src = src; p.gn = gn;
    p.startAt = when - pos; // file position `pos` is heard at `when`
  }

  _partyRelease(fade) {
    const p = this.party;
    if (!p.src) return;
    const src = p.src, gn = p.gn;
    p.src = null; p.gn = null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    gn.gain.cancelScheduledValues(t);
    if (fade <= 0) { gn.gain.setValueAtTime(0, t); try { src.stop(); } catch {} return; }
    gn.gain.setValueAtTime(gn.gain.value, t);
    gn.gain.linearRampToValueAtTime(0, t + fade);
    try { src.stop(t + fade + 0.02); } catch {}
  }

  // ---------- debug ----------
  stats() {
    const c = {};
    for (const [id, v] of this.clips) c[id] = { duration: +v.buffer.duration.toFixed(3), loopStart: +v.loopStart.toFixed(4), loopEnd: +v.loopEnd.toFixed(4), offsetMs: v.offsetMs, rate: v.buffer.sampleRate };
    return {
      state: this.ctx ? this.ctx.state : 'none', ready: this.ready, voices: this.voices, paused: this.paused,
      enemy: { active: this.enemy.active, charId: this.enemy.charId, pending: this.enemy.pending, muffle: this.enemy.muffle },
      emitters: this.emitters ? this.emitters.filter((e) => e.feature).map((e) => e.feature.type) : [],
      memes: { decoded: this.memeBufs.size, loading: this._memeLoading.size, last: this.lastMeme, playing: this.memeVoices ? [...this.memeVoices, ...this.meme2d].filter((v) => v.src).map((v) => v.id) : [] },
      beacons: this.beacons.filter((b) => b.id != null).map((b) => ({ id: b.id, x: b.x, z: b.z, live: !!b.src })),
      party: this.partyState(),
      clips: c,
    };
  }

  /** analyser tapped off a bus (tests only; created on demand) */
  debugTap(bus = 'master') {
    if (!this.ctx) return null;
    this._taps = this._taps || {};
    if (!this._taps[bus]) {
      const a = this.ctx.createAnalyser();
      a.fftSize = 2048;
      (bus === 'master' ? this.limiter : this.bus[bus]).connect(a);
      this._taps[bus] = a;
    }
    return this._taps[bus];
  }
}
