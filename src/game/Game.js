// gameplay root: input, fixed-step player sim, navigation, enemy, director, interactions, camera frame.
// no dom access outside Input/DebugOverlay and the guarded debug hooks, so the sim also runs in node.
import { CELL, EYE_H } from '../world/constants.js';
import { SIM_DT, PLAYER, DIRECTOR as D, ITEMS } from './tuning.js';
import { collide, untrap } from './collision.js';
import { Nav } from './Nav.js';
import { Enemy } from './Enemy.js';
import { Director } from './Director.js';
import { Input } from './Input.js';
import { Interactions } from './Interact.js';
import { Objectives } from './Objectives.js';
import { TaskBoard } from './Tasks.js';
import { Party } from './Party.js';
import { INTRO, BRIEFING, LINES } from './lore.js';
import { DebugOverlay } from './DebugOverlay.js';
import { CHARS } from './characters.js';
import { loadSave, writeSave } from './save.js';

const PI = Math.PI;
const NOOP_AUDIO = { setListener() {}, enemyStart() {}, enemyUpdate() {}, enemyStop() {}, sfx() {}, setChase() {}, pauseAll() {}, resumeAll() {}, stopAll() {}, meme() {}, beacon() {}, beaconStop() {}, partyStart() {}, partyStop() {} };

export class Game {
  constructor({ world, renderer = null, audio = null, settings, events, params = {}, spawn = null, canvas = null }) {
    this.world = world;
    this.renderer = renderer;
    this.audio = audio || NOOP_AUDIO;
    this.settings = settings;
    this.events = events;
    this.params = { encounterSeed: 1, ...params };
    this.manifest = null;
    const sp = spawn || world.spawnPoint();
    this.spawn = { x: sp.x, z: sp.z, yaw: sp.yaw || 0 };
    this.state = 'menu';
    this.run = 0;
    this.save = loadSave();

    this.player = {
      x: sp.x, z: sp.z, vx: 0, vz: 0, yaw: this.spawn.yaw, pitch: 0,
      prevX: sp.x, prevZ: sp.z, speed: 0, distance: 0, hp: 16, protect: 0,
    };
    this.frame = {
      cam: { x: sp.x, y: EYE_H, z: sp.z, yaw: this.spawn.yaw, pitch: 0, roll: 0, fov: 74 },
      viewmodel: { bobX: 0, bobY: 0, swayX: 0, swayY: 0, sprint: 0, swing: 0, visible: true, item: null, useT: 0 },
      flashlight: false,
      enemy: { active: false, charId: 'kanye', x: 0, y: 0, z: 0, alpha: 1, facingYaw: 0 },
      fx: { impact: 0, shake: 0, chase: 0, death: 0, protect: 0, lookBehind: 0 },
      paused: false,
      // interaction target under the crosshair (progress = held breaker 0..1)
      highlight: { active: false, x: 0, y: 0, z: 0, r: 0, kind: null, progress: 0 },
      // world yaw and straight distance to the active objective's nearest target
      compass: { active: false, bearing: 0, dist: 0, id: null },
      // party mode (sigma boy jukebox): beat = float beats, intensity fades 0..1 in/out
      party: { active: false, t: 0, beat: 0, bpm: 0, intensity: 0, x: 0, z: 0 },
    };

    this.nav = new Nav(world, 192, true); // enemy nav: closed doors are walls for walkable()
    this.enemy = new Enemy(this);
    this.director = new Director(this);
    this.interact = new Interactions(this);
    this.tasks = new TaskBoard(this);
    this.objectives = new Objectives(this);
    this.party = new Party(this);
    const cv = canvas || renderer?.canvas || (typeof document !== 'undefined' ? document.getElementById('game') : null);
    this.input = new Input(this, cv);
    this.overlay = new DebugOverlay(this, !!this.params.debug);

    this.inp = { fwd: 0, strafe: 0, sprint: false, lookBehind: false };
    this.cinfo = { hit: false, door: false, doorIx: 0, doorIz: 0 };
    this.acc = 0;
    this.simTime = 0;
    this.protectedT = 0;
    this.camYaw = this.spawn.yaw;
    this.viewCos = Math.cos((62 + 18) * PI / 180); // half horizontal view plus margin
    this.lb = 0; this.lbLin = 0;
    this.bobPhase = 0; this.bobAmt = 0; this.sprintAmt = 0; this.stepAcc = 0;
    this.swingT = -1; this.swingHit = false;
    this.impactT = 0; this.deathT = -1;
    this.doorPushT = 0;
    this.sway = { x: 0, y: 0 };
    this.shakeT = 0;
    this.frameMs = 0;
    this.maxSteps = 0;
    this.reading = null; // null | 'intro' | 'lore': a card is open and the sim is held
    this.loreCard = null;
    this.loreGuard = 0;
    this.introShown = false;
    this.useKind = null; // viewmodel item in use: 'almond' | 'airhorn'
    this.useT = 0;
    this.useDur = 1;
    this.airhornCd = 0;
    this.winInfo = null;

    this._debugHooks();
  }

  setManifest(m) { this.manifest = m; }

  // ---- lifecycle ----
  _setState(s) {
    this.state = s;
    this.frame.paused = s === 'paused';
    this.events.emit('game:state', { state: s });
  }

  start() {
    if (this.state === 'paused') return this.resume();
    if (this.state === 'dead' || this.state === 'won') return this.restart();
    if (this.state !== 'menu') return;
    this.input.requestLock();
    this.acc = 0;
    this._setState('playing');
    this.director._log('start');
    this.objectives.publish();
    // start straight into play; the ringing phone delivers the briefing (showIntro() stays for ?intro=1)
    if (!this.introShown && this.params.intro) this.showIntro();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.input.releaseAll();
    this.audio.pauseAll();
    this._setState('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.input.requestLock();
    this.audio.resumeAll();
    this.acc = 0;
    this._setState('playing');
  }

  restart() {
    const p = this.player, sp = this.spawn;
    // cut the enemy track plus any leftover meme voices, emitters and beacons from the last run
    this.party.reset();
    this.party.fill(this.frame.party); // no stale party frame between restart and the next render
    this.audio.stopAll();
    this.enemy.despawn();
    this.run++;
    this.director.reset((this.params.encounterSeed + Math.imul(this.run, 0x9e3779b1)) >>> 0);
    Object.assign(p, { x: sp.x, z: sp.z, prevX: sp.x, prevZ: sp.z, vx: 0, vz: 0, yaw: sp.yaw, pitch: 0, speed: 0, distance: 0, hp: D.maxHp, protect: 0 });
    this.events.emit('game:hearts', { hp: p.hp, max: D.maxHp, delta: 0 });
    this.interact.reset();
    if (this.reading) { this.reading = null; this.loreCard = null; this.events.emit('lore:close'); }
    this.useKind = null; this.useT = 0; this.airhornCd = 0; this.loreGuard = 0;
    this.winInfo = null;
    this.objectives.reset(true);
    this.objectives.publish();
    this.input.releaseAll();
    this.acc = 0;
    this.simTime = 0;
    this.protectedT = 0;
    this.lb = this.lbLin = 0;
    this.impactT = 0; this.deathT = -1; this.swingT = -1;
    this.frame.flashlight = false;
    const fx = this.frame.fx;
    fx.impact = fx.shake = fx.chase = fx.death = fx.protect = fx.lookBehind = 0;
    this.frame.viewmodel.visible = true;
    this.input.requestLock();
    this._setState('playing');
    this.director._log('start');
  }

  _hit(ax, az, charId) {
    const p = this.player;
    p.vx += ax * 7;
    p.vz += az * 7;
    this.impactT = 1;
    this.tasks.close();
    this.audio.sfx('impact', { x: p.x, z: p.z, gain: 1 });
    this.events.emit('game:hit', { charId, hp: p.hp, protect: p.protect });
  }

  _die(charId) {
    if (this.state !== 'playing') return;
    const p = this.player, d = this.director;
    d.onDeath();
    this.audio.sfx('death', { x: p.x, z: p.z, gain: 1 });
    this.meme('death', p, 1);
    this.party.reset();
    this.tasks.close();
    this.objectives.stopBeacons();
    this.impactT = 1;
    this.deathT = 0;
    const distance = Math.round(p.distance);
    const s = this.save;
    s.runs++;
    s.totalEscapes += d.escapes;
    s.best = Math.max(s.best, distance);
    s.bestEscapes = Math.max(s.bestEscapes, d.escapes);
    s.last = { distance, escapes: d.escapes };
    writeSave(s);
    const lines = CHARS[charId].lines;
    const line = lines[s.runs % lines.length];
    this.deathInfo = { distance, escapes: d.escapes, best: s.best, line, charId };
    this.input.releaseAll();
    this._setState('dead');
    this.events.emit('game:death', this.deathInfo);
    this.input.exitLock();
  }

  // ---- v2: toasts, memes, lore, items, win ----
  toast(text, kind = 'info', ms = 2600) {
    this.events.emit('toast', { text, kind, ms });
  }

  meme(cat, at, gain = 1) {
    const a = this.audio;
    if (typeof a.meme === 'function') a.meme(cat, at ? { x: at.x, z: at.z, gain } : { gain });
  }

  openLore(card, kind = 'lore') {
    if (!card) return;
    this.reading = kind;
    this.loreCard = card;
    this.input.releaseAll();
    this.tasks.close();
    this.director._log(kind === 'intro' ? 'intro' : 'lore', { title: card.title });
    this.events.emit(kind === 'intro' ? 'game:intro' : 'lore:open', { title: card.title, body: card.body });
  }

  // ui calls this when the reader / intro card is dismissed; idempotent
  closeLore() {
    if (!this.reading) return false;
    const card = this.loreCard;
    this.reading = null;
    this.loreCard = null;
    this.loreGuard = 0.25;
    this.input.mdx = this.input.mdy = 0;
    this.acc = 0;
    this.events.emit('lore:close');
    if (card === BRIEFING) this.director.onCall();
    return true;
  }

  showIntro() {
    this.introShown = true;
    this.openLore(INTRO, 'intro');
  }

  drink() {
    if (this.state !== 'playing' || this.reading) return false;
    return this.objectives.drink();
  }

  airhorn() {
    if (this.state !== 'playing' || this.reading) return false;
    return this.objectives.airhorn();
  }

  beginUse(kind, dur) {
    this.useKind = kind;
    this.useT = 0;
    this.useDur = dur;
  }

  _tickUse(dt) {
    if (this.airhornCd > 0) this.airhornCd -= dt;
    if (!this.useKind) return;
    this.useT += dt / this.useDur;
    if (this.useT < 1) return;
    const k = this.useKind;
    this.useKind = null;
    this.useT = 0;
    if (k === 'almond') {
      const p = this.player;
      const heal = Math.min(ITEMS.almondHeal, D.maxHp - p.hp);
      if (heal > 0) {
        p.hp += heal;
        this.events.emit('game:recover', { source: 'almond' });
        this.events.emit('game:hearts', { hp: p.hp, max: D.maxHp, delta: heal });
      }
      this.toast(LINES.drink, 'info', 2200);
    }
  }

  win() {
    if (this.state !== 'playing') return;
    const p = this.player, d = this.director, s = this.save, o = this.objectives;
    this.party.reset();
    if (this.enemy.active) d._endEncounter('win', false); else d._stopTrack(0.4);
    d._log('win');
    const time = +this.simTime.toFixed(1);
    const distance = Math.round(p.distance);
    s.runs++;
    s.wins = (s.wins || 0) + 1;
    s.totalEscapes += d.escapes;
    s.best = Math.max(s.best, distance);
    s.bestEscapes = Math.max(s.bestEscapes, d.escapes);
    const newBest = !(s.bestTime > 0) || time < s.bestTime;
    if (newBest) s.bestTime = time;
    s.last = { distance, escapes: d.escapes };
    writeSave(s);
    o.stopBeacons();
    this.tasks.close();
    this.meme('win', p, 1);
    this.winInfo = { time, distance, escapes: d.escapes, tapes: Math.min(5, o.check.tasks), tasks: o.check.tasks, best: s.bestTime, newBest, title: LINES.winTitle, line: LINES.win[s.wins % LINES.win.length] };
    this.input.releaseAll();
    this._setState('won');
    this.events.emit('game:win', this.winInfo);
    this.input.exitLock();
  }

  toggleFlashlight() {
    this.frame.flashlight = !this.frame.flashlight;
    this.audio.sfx('switch', { gain: 0.45 });
  }

  toggleDebug() { this.overlay.toggle(); }

  swing() {
    if (this.state !== 'playing' || (this.swingT >= 0 && this.swingT < 0.5)) return;
    this.swingT = 0;
    this.swingHit = false;
  }

  // ---- per render frame ----
  update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    if (this.loreGuard > 0) this.loreGuard -= dt;
    // a lore card holds the whole sim (director timers included), like a pause that keeps the frame live
    const playing = this.state === 'playing' && !this.reading;
    if (playing) {
      this._look(dt);
      this.input.read(this.inp, dt);
      this.acc += dt;
      let n = 0;
      while (this.acc >= SIM_DT && n < 12) {
        this._step(SIM_DT);
        this.acc -= SIM_DT;
        n++;
        if (this.state !== 'playing') break;
      }
      if (n >= 12) this.acc = 0;
      if (n > this.maxSteps) this.maxSteps = n;
      this.world.tickDoors(dt);
      if (this.state === 'playing') {
        this.interact.update(dt);
        this._tickUse(dt);
        this.objectives.update(dt);
      }
      if (this.protectedT > 0) this.protectedT -= dt;
    }
    // the song keeps playing under a lore card, so the party clock does too (esc pause stops both)
    if (this.state === 'playing') this.party.update(dt);
    this._fillFrame(dt, playing);
    if (playing) this.director.frame(dt, this.frame.enemy.x, this.frame.enemy.z);
    const c = this.frame.cam;
    this.audio.setListener(c.x, c.y, c.z, c.yaw);
    this.overlay.update(dt);
  }

  _look(dt) {
    const p = this.player, inp = this.input, v = inp.virtual, s = this.settings;
    const sens = PLAYER.lookSens * (s.get('sensitivity') || 1);
    const dx = inp.mdx, dy = inp.mdy;
    inp.mdx = inp.mdy = 0;
    p.yaw -= dx * sens;
    p.pitch -= dy * sens * (s.get('invertY') ? -1 : 1);
    if (v.active && v.lookYaw != null) p.yaw = v.lookYaw;
    if (v.active && v.lookPitch != null) p.pitch = v.lookPitch;
    if (p.yaw > PI * 64 || p.yaw < -PI * 64) p.yaw %= PI * 2;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    // viewmodel sway lags the look
    const k = 1 - Math.exp(-dt * 10);
    const tx = Math.max(-0.06, Math.min(0.06, -dx * 0.0009)), ty = Math.max(-0.05, Math.min(0.05, dy * 0.0009));
    this.sway.x += (tx - this.sway.x) * k;
    this.sway.y += (ty - this.sway.y) * k;
  }

  _step(h) {
    const p = this.player, inp = this.inp, w = this.world;
    this.simTime += h;
    p.prevX = p.x; p.prevZ = p.z;

    let f = inp.fwd, s = inp.strafe;
    const len = Math.sqrt(f * f + s * s);
    let wx = 0, wz = 0;
    if (len > 0.01) {
      if (len > 1) { f /= len; s /= len; }
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      wx = -sy * f + cy * s;
      wz = -cy * f - sy * s;
      const max = inp.sprint && f > -0.1 ? PLAYER.sprint : f < -0.1 ? PLAYER.backMax : PLAYER.walk;
      wx *= max; wz *= max;
    }
    const dvx = wx - p.vx, dvz = wz - p.vz;
    const dl = Math.sqrt(dvx * dvx + dvz * dvz);
    const rate = (len > 0.01 ? PLAYER.accel : PLAYER.decel) * h;
    if (dl <= rate) { p.vx = wx; p.vz = wz; } else { p.vx += (dvx / dl) * rate; p.vz += (dvz / dl) * rate; }

    p.x += p.vx * h;
    p.z += p.vz * h;
    collide(w, p, PLAYER.radius, this.cinfo);
    untrap(w, p, PLAYER.radius);

    // pushing into a closed door swings it open (no need to stop and press E mid-chase)
    if (this.cinfo.door && len > 0.01) {
      this.doorPushT += h;
      if (this.doorPushT >= PLAYER.doorPush) {
        const d = w.doorAt(this.cinfo.doorIx, this.cinfo.doorIz);
        if (d && d.target < 1) this.interact.setDoor(d, true, (this.cinfo.doorIx + 0.5) * CELL, (this.cinfo.doorIz + 0.5) * CELL);
        this.doorPushT = 0;
      }
    } else this.doorPushT = 0;

    const mx = p.x - p.prevX, mz = p.z - p.prevZ;
    const moved = Math.sqrt(mx * mx + mz * mz);
    p.speed = moved / h;
    p.distance += moved;

    // footsteps by distance travelled
    const run = p.speed > 4.6;
    const stride = run ? PLAYER.strideRun : PLAYER.strideWalk;
    this.stepAcc += moved;
    this.bobPhase += (moved / stride) * PI;
    if (this.stepAcc >= stride) {
      this.stepAcc -= stride;
      this.audio.sfx(run ? 'stepRun' : 'step', { x: p.x, z: p.z, gain: run ? 1 : 0.75 });
    }
    if (p.speed < 0.2) this.stepAcc = Math.min(this.stepAcc, stride * 0.6);

    // hatchet swing: cosmetic, but a swing into a closed door bumps it open
    if (this.swingT >= 0) {
      this.swingT += h;
      if (!this.swingHit && this.swingT >= 0.16) {
        this.swingHit = true;
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        for (let d = 0.4; d <= 1.4; d += 0.2) {
          const ix = Math.floor((p.x + fx * d) / CELL), iz = Math.floor((p.z + fz * d) / CELL);
          const door = w.doorAt(ix, iz);
          if (door) { if (door.target < 1) this.interact.setDoor(door, true, (ix + 0.5) * CELL, (iz + 0.5) * CELL); break; }
          if (w.blocksSight(ix, iz)) { this.audio.sfx('impact', { x: p.x + fx * d, z: p.z + fz * d, gain: 0.25 }); break; }
        }
      }
      if (this.swingT >= 0.45) this.swingT = -1;
    }

    this.director.step(h);
  }

  _fillFrame(dt, playing) {
    const fr = this.frame, cam = fr.cam, vm = fr.viewmodel, fx = fr.fx, p = this.player, e = this.enemy, s = this.settings;
    const a = playing ? Math.min(1, this.acc / SIM_DT) : 1;
    const x = p.prevX + (p.x - p.prevX) * a;
    const z = p.prevZ + (p.z - p.prevZ) * a;

    // look behind: critically damped spring toward 0/1 (a 180 that eases in and out, and reverses mid-turn
    // without a jolt). never touches the movement yaw.
    if (playing) {
      const want = this.inp.lookBehind ? 1 : 0;
      const w = PLAYER.lookBehindOmega;
      const h = Math.min(dt, 0.05);
      this.lbLin += (w * w * (want - this.lb) - 2 * w * this.lbLin) * h;
      this.lb += this.lbLin * h;
      if (Math.abs(want - this.lb) < 1e-4 && Math.abs(this.lbLin) < 1e-3) { this.lb = want; this.lbLin = 0; }
    }

    const k = 1 - Math.exp(-dt * 8);
    const spd = playing ? p.speed : 0;
    this.bobAmt += (Math.min(1, spd / PLAYER.sprint) - this.bobAmt) * k;
    this.sprintAmt += (Math.min(1, Math.max(0, (spd - 3.4) / 3.0)) - this.sprintAmt) * (1 - Math.exp(-dt * 5));
    const hb = s.get('headBob') ?? 0.6;
    const ph = this.bobPhase;
    const bobV = (Math.abs(Math.sin(ph)) - 0.64) * PLAYER.bobV * hb * this.bobAmt;
    const bobH = Math.sin(ph) * PLAYER.bobH * hb * this.bobAmt;

    // impact and proximity shake, deterministic noise, scaled by settings.shake
    if (this.impactT > 0) this.impactT = Math.max(0, this.impactT - dt / 0.55);
    let near = 0;
    const d = this.director;
    if (e.active && d.los && d.state === 'CHASING') near = Math.max(0, 1 - d.straight / 6) * 0.25;
    const shake = Math.min(1, this.impactT * this.impactT + near) * (s.get('shake') ?? 0.6);
    this.shakeT += dt;
    const t = this.shakeT;
    const sn = (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3)) * 0.5;
    const sn2 = (Math.sin(t * 31.3 + 2.1) + Math.sin(t * 19.9)) * 0.5;

    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    cam.x = x + cy * bobH;
    cam.z = z - sy * bobH;
    cam.y = EYE_H + bobV;
    this.camYaw = p.yaw + PI * this.lb;
    cam.yaw = this.camYaw + sn * 0.012 * shake;
    cam.pitch = p.pitch + sn2 * 0.014 * shake;
    cam.roll = Math.sin(ph) * 0.0035 * hb * this.bobAmt + sn * 0.01 * shake;
    cam.fov = (s.get('fov') || 74) + PLAYER.fovKick * this.sprintAmt;

    vm.bobX = bobH * 1.4;
    vm.bobY = bobV * 1.4;
    vm.swayX = this.sway.x;
    vm.swayY = this.sway.y;
    vm.sprint = this.sprintAmt;
    vm.swing = this.swingT >= 0 ? Math.min(1, this.swingT / 0.45) : 0;
    vm.visible = this.state !== 'dead' || this.deathT < 0.4;

    const fe = fr.enemy;
    fe.active = e.active;
    if (e.active) {
      fe.charId = e.charId;
      fe.x = e.prevX + (e.x - e.prevX) * a;
      fe.z = e.prevZ + (e.z - e.prevZ) * a;
      fe.y = 0.05;
      fe.alpha = e.alpha;
      fe.facingYaw = Math.atan2(-(cam.x - fe.x), -(cam.z - fe.z)) + e.spin;
    }

    fx.impact = this.impactT;
    fx.shake = shake;
    fx.chase = d.chase;
    if (this.deathT >= 0) { this.deathT += dt; fx.death = Math.min(1, this.deathT / 0.9); } else fx.death = 0;
    fx.protect = Math.max(p.protect > 0 ? Math.min(1, p.protect / 1.0) : 0, this.protectedT > 0 ? 0.5 : 0);
    fx.lookBehind = this.lb;
    fr.paused = this.state === 'paused';

    vm.item = this.useKind;
    vm.useT = this.useKind ? Math.min(1, this.useT) : 0;
    const hl = fr.highlight, it = this.interact;
    hl.active = playing && it.kind !== null && it.kind !== 'recovery';
    if (hl.active) {
      hl.x = it.hx; hl.y = it.hy; hl.z = it.hz; hl.r = it.hr; hl.kind = it.kind;
      const ta = this.tasks.active;
      hl.progress = ta && it.feature && ta.f.id === it.feature.id ? ta.run.t : 0;
    } else { hl.kind = null; hl.progress = 0; }
    this.objectives.fillCompass(fr.compass, x, z);
    this.party.fill(fr.party);
  }

  // ---- debug ----
  debugText() {
    const d = this.director, p = this.player, e = this.enemy, r = this.renderer?.stats?.() || {}, ws = this.world.stats(), n = this.nav.stats;
    const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
    return [
      `state ${this.state}  director ${d.state} ${d.stateT.toFixed(1)}s  char ${d.charId || '-'}  enc ${d.encounters}  esc ${d.escapes}`,
      `path ${f1(d.pathDist)}m  straight ${f1(d.straight)}m  los ${d.los ? 'yes' : 'no'}  noLos ${d.noLos.toFixed(1)}s  mode ${e.active ? e.mode : '-'}`,
      `next ${d.nextT.toFixed(1)}s  slow ${d.slowT.toFixed(1)}s  recovery ${Math.max(0, d.recoveryT).toFixed(1)}s  protect ${p.protect.toFixed(1)}s  hp ${p.hp}/${D.maxHp}  held ${this.protectedT > 0 ? 'yes' : 'no'}`,
      `speed ${p.speed.toFixed(2)} m/s  dist ${p.distance.toFixed(0)}m  pos ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  yaw ${p.yaw.toFixed(2)}`,
      `fps ${f1(r.fps)}  frame ${f1(r.frameMs)}ms  p99 ${f1(r.p99Ms)}ms  calls ${r.calls ?? '-'}  meshed ${r.chunksMeshed ?? '-'}  pending ${r.pendingBuilds ?? '-'}`,
      this.objectives.debugLine(),
      `chunks cached ${ws.cached} active ${ws.active} pinned ${ws.pinned} gen ${ws.generatedTotal}  nav ${n.lastMs.toFixed(2)}ms (max ${n.maxMs.toFixed(2)}) builds ${n.builds}`,
    ].join('\n');
  }

  _debugHooks() {
    if (typeof window === 'undefined') return;
    const root = (window.__br = window.__br || { ready: false });
    root.director = this.director;
    root.input = this.input;
    root.teleport = (x, z, yaw) => {
      const p = this.player;
      p.x = p.prevX = x; p.z = p.prevZ = z; p.vx = p.vz = 0;
      if (Number.isFinite(yaw)) p.yaw = yaw;
      untrap(this.world, p, PLAYER.radius);
      return { x: p.x, z: p.z };
    };
    root.look = (yaw, pitch = 0) => { this.player.yaw = yaw; this.player.pitch = pitch; };
    root.forceEncounter = (charId) => this.director.forceEncounter(charId);
    root.objectives = this.objectives;
    root.party = this.party;
    root.tuning = { PLAYER, DIRECTOR: D, ITEMS }; // the live objects (tests tweak them in place)
  }
}
