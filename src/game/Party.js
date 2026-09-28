// v4 PARTY MODE: E on the spawn jukebox plays Sigma Boy. the villain is blasted away, the director is held
// (no warnings, spawns, slow or chase timers), then a short grace and a cooldown. idle -> active -> grace -> idle.
import { CHUNK } from '../world/constants.js';
import { PARTY } from './tuning.js';
import { LINES } from './lore.js';

export class Party {
  constructor(game) {
    this.g = game;
    this.jukebox = null; // { id, x, z, virtual }
    this.reset(false);
    this._resolve();
  }

  // the world's guaranteed spawn jukebox (data.spawn), else the nearest jukebox around spawn
  _resolve() {
    const g = this.g, w = g.world, sp = g.spawn;
    const scx = Math.floor(sp.x / CHUNK), scz = Math.floor(sp.z / CHUNK);
    let best = null, bd = Infinity;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      for (const f of w.getChunk(scx + dx, scz + dz).features || []) {
        if (f.type !== 'jukebox') continue;
        const d = Math.hypot(f.x - sp.x, f.z - sp.z) - (f.data && f.data.spawn ? 1000 : 0);
        if (d < bd) { bd = d; best = f; }
      }
    }
    this.jukebox = best ? { id: best.id, x: best.x, z: best.z } : { id: null, x: sp.x, z: sp.z };
  }

  _meta() {
    const m = this.g.manifest && this.g.manifest.party;
    const ok = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
    return { duration: ok(m && m.duration, PARTY.duration), bpm: ok(m && m.bpm, PARTY.bpm), firstBeat: m && Number.isFinite(m.firstBeat) ? m.firstBeat : 0 };
  }

  get active() { return this.state === 'active'; }
  // the director is held while the party runs and through the grace after it
  get holds() { return this.state !== 'idle'; }

  label() {
    if (this.active) return 'E  Stop the party';
    if (this.cooldownT > 0) return `Jukebox recharging its aura (${Math.ceil(this.cooldownT)} s)`;
    return 'E  Press the button'; // keep the song a surprise
  }

  use(f) {
    if (this.active) return this.stop(true);
    return this.start(f);
  }

  start(f) {
    const g = this.g;
    if (this.active) return false;
    if (this.cooldownT > 0) { g.toast(LINES.partyCooldown(Math.ceil(this.cooldownT)), 'meme', 2200); return false; }
    const m = this._meta();
    this.state = 'active';
    this.t = 0;
    this.duration = Math.min(m.duration, PARTY.maxDuration); this.bpm = m.bpm; this.firstBeat = m.firstBeat;
    this.x = f ? f.x : this.jukebox.x; this.z = f ? f.z : this.jukebox.z;
    this.starts++;
    g.tasks.close();
    const blasted = g.director.partyStart();
    this._audio('partyStart', { sting: true }); // airhorn on the drop
    g.events.emit('party:start', { duration: this.duration, bpm: this.bpm, firstBeat: this.firstBeat, x: this.x, z: this.z });
    g.toast(blasted ? LINES.partyBlast : LINES.partyStart, 'meme', 3200);
    return true;
  }

  // early: E again; quiet: restart / death / win
  stop(early = false, quiet = false) {
    const g = this.g;
    if (!this.active) return false;
    this.state = 'grace';
    this.graceT = PARTY.grace;
    this.cooldownT = PARTY.cooldown;
    this._audio('partyStop', quiet ? 0.1 : 0.6);
    g.events.emit('party:end', { early, t: +this.t.toFixed(2) });
    if (!quiet) g.toast(early ? LINES.partyStopped : LINES.partyOver, 'meme', 2600);
    return true;
  }

  // immediate clean end (restart, death, win)
  reset(emit = true) {
    if (emit && this.active) this.stop(true, true);
    this.state = 'idle';
    this.t = 0; this.graceT = 0; this.cooldownT = 0; this.intensity = 0;
    this.duration = PARTY.duration; this.bpm = PARTY.bpm; this.firstBeat = 0;
    this.x = 0; this.z = 0;
    if (!emit) this.starts = 0;
  }

  // per render frame while the sim is live (lore and pause hold it)
  update(dt) {
    if (this.active) {
      this.t += dt;
      // the song position from the audio clock when available, else the sim clock
      const pos = this.songPos();
      if ((Number.isFinite(pos) ? pos : this.t) >= this.duration) this.stop(false);
    } else if (this.state === 'grace') {
      this.t += dt;
      this.graceT -= dt;
      if (this.graceT <= 0) { this.state = 'idle'; this.g.director.partyEnd(); }
    }
    if (!this.active && this.cooldownT > 0) this.cooldownT = Math.max(0, this.cooldownT - dt);
    const want = this.active ? 1 : 0;
    const step = dt / PARTY.fade;
    if (want > this.intensity) this.intensity = Math.min(1, this.intensity + step);
    else if (want < this.intensity) this.intensity = Math.max(0, this.intensity - step);
  }

  // an audio failure must never leave the party half-started (state set, events not sent)
  _audio(name, arg) {
    const a = this.g.audio;
    if (typeof a[name] !== 'function') return;
    try { a[name](arg); } catch (err) { console.warn(`party audio ${name} failed`, err); }
  }

  // seconds into the clip per the audio clock (partyTime, or derived from partyBeat); NaN when unavailable
  songPos() {
    const a = this.g.audio;
    if (typeof a.partyTime === 'function') { const v = a.partyTime(); if (Number.isFinite(v)) return v; }
    if (typeof a.partyBeat === 'function') { const b = a.partyBeat(); if (Number.isFinite(b)) return this.firstBeat + (b * 60) / this.bpm; }
    return NaN;
  }

  fill(fp) {
    const on = this.active || this.intensity > 0;
    fp.active = on;
    fp.intensity = this.intensity;
    fp.t = on ? this.t : 0;
    fp.bpm = this.bpm;
    fp.x = this.x; fp.z = this.z;
    if (!on) { fp.beat = 0; return; }
    const a = this.g.audio;
    const b = this.active && typeof a.partyBeat === 'function' ? a.partyBeat() : NaN;
    fp.beat = Number.isFinite(b) ? b : Math.max(0, ((this.t - this.firstBeat) * this.bpm) / 60);
  }
}
