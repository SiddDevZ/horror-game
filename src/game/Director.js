// encounter director: EXPLORING -> WARNING -> CHASING -> SEARCHING -> ESCAPED -> RECOVERY.
// runs inside the fixed simulation step; owns spawn search, escape rules, catches and the enemy track.
import { CELL } from '../world/constants.js';
import { hash32, makeRng } from '../core/rng.js';
import { CHARS, createSelector } from './characters.js';
import { LINES } from './lore.js';
import { DIRECTOR as D, ENEMY, OBJ, PARTY } from './tuning.js';
import { F_PLAYER, F_TARGET, F_SCRATCH, F_SPAWN, INF, UNIT, CLOSED_ENEMY, CLOSED_BLOCK } from './Nav.js';

const LOS_DT = 1 / D.losHz;
const LINES_NO_SUMMON = LINES.partyNoSummon;

export class Director {
  constructor(game) {
    this.g = game;
    this.log = [];
    this.encountersLog = [];
    this.best3 = new Int32Array(3);
    this.best3s = new Float64Array(3);
    this.doorDirty = false;
    this.sealed = false;
    // a door moved: enemy fields depend on which doors are open, rebuild them at the next upkeep
    game.events.on('world:door', () => { this.doorDirty = true; });
    this.reset(game.params.encounterSeed >>> 0);
  }

  reset(seed) {
    this.seed = seed >>> 0;
    // the character rotation persists across restarts in a session, so dying early doesn't replay kanye forever
    if (!this.selector) this.selector = createSelector(this.seed);
    this.rng = makeRng(hash32(this.seed, 0x51ed)); // spawn/search/timers, separate from character picks
    this.state = 'EXPLORING';
    this.stateT = 0;
    this.t = 0;
    this.charId = null;
    this.encounters = 0;
    this.escapes = 0;
    // the first encounter waits for the M.E.G. call (onCall), or comes at ~25 s if the phone is ignored
    this.callPending = true;
    this.nextT = this.rng.range(D.firstNoCall[0], D.firstNoCall[1]);
    this.slowT = 0;
    this.retryT = 0;
    this.fails = 0;
    this.rejected = 0;
    this.forceChar = null;
    this.summonNow = false;
    this.los = false;
    this.losT = 0;
    this.noLos = 0;
    this.lostLongT = 0;
    this.lkpX = 0; this.lkpZ = 0;
    this.tSet = false; this.tX = 0; this.tZ = 0;
    this.pathDist = Infinity;
    this.straight = Infinity;
    this.revealed = false;
    this.revealAt = -1;
    this.commitT = 0;
    this.chaseAt = -1;
    this.chaseT = 0;
    this.recoveryT = 0;
    this.hurt = false;
    this.trackAt = -1;
    this.trackOn = false;
    this.trackStarts = 0;
    this.muffle = 1;
    this.chase = 0;
    this.searchPts = 0;
    this.searchHold = 0;
    this.navT = 0;
    this.navCell = -1;
    this.visT = 0;
    this.visible = false;
    this.cur = null;
    this.log.length = 0;
    this.encountersLog.length = 0;
  }

  _set(state) {
    this.state = state;
    this.stateT = 0;
    this._log(state);
    this.g.events.emit('director:state', { state, charId: this.charId });
  }

  _log(ev, extra) {
    if (this.log.length > 600) this.log.splice(0, 100);
    this.log.push(extra ? { t: +this.t.toFixed(3), ev, charId: this.charId, ...extra } : { t: +this.t.toFixed(3), ev, charId: this.charId });
  }

  // encounter count drives difficulty; objective progress raises the floor gently (behaviour, never speed)
  get difficulty() {
    const enc = Math.min(1, Math.max(0, (this.encounters - 1) / 8));
    const prog = this.g.objectives ? this.g.objectives.progress01 * OBJ.harden : 0;
    return Math.max(enc, prog);
  }

  // loud player actions (breakers, airhorn misses) can pull the next encounter in
  noise(x, z, chance, why) {
    const g = this.g;
    if (this.state !== 'EXPLORING' || g.enemy.active || g.params.noDirector) { this._log('noise', { why, pulled: false }); return false; }
    const pulled = this.rng.next() < chance;
    if (pulled) this.nextT = Math.min(this.nextT, this.rng.range(OBJ.noiseDelay[0], OBJ.noiseDelay[1]));
    this._log('noise', { why, pulled });
    return pulled;
  }

  // the briefing card closed: kanye crashes the call a few seconds later
  onCall() {
    if (!this.callPending) return false;
    this.callPending = false;
    if (this.encounters > 0 || this.state !== 'EXPLORING' || this.g.enemy.active) return false;
    this.nextT = Math.min(this.nextT, this.rng.range(D.firstAfterCall[0], D.firstAfterCall[1]));
    this._log('call', { next: +this.nextT.toFixed(2) });
    return true;
  }

  onAirhorn(dist) {
    if (this.cur) this.cur.airhorns = (this.cur.airhorns || 0) + 1;
    this._log('airhorn', { dist: +dist.toFixed(1) });
    // blasting an unseen-but-in-sight cutout reveals it on the spot
    if (this.state === 'WARNING' && !this.revealed) this._reveal(false);
  }

  // ---- visibility helpers ----
  _enemySees() {
    const e = this.g.enemy, p = this.g.player;
    const dx = p.x - e.x, dz = p.z - e.z;
    if (dx * dx + dz * dz > D.losRange * D.losRange) return false;
    return this.g.world.lineOfSight(e.x, e.z, p.x, p.z);
  }

  // could the player see a cutout centred at (x, z)? the image is ~1.9 m wide, so test its flanks too.
  // facing=true also treats anything well outside the camera's horizontal view as unseen.
  playerCanSee(x, z, facing) {
    const g = this.g, p = g.player, w = g.world;
    const dx = x - p.x, dz = z - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.5) return true;
    if (facing) {
      const yaw = g.camYaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      if ((dx * fx + dz * fz) / d < g.viewCos) return false;
    }
    const ox = (-dz / d) * 0.85, oz = (dx / d) * 0.85;
    return w.lineOfSight(p.x, p.z, x, z) || w.lineOfSight(p.x, p.z, x + ox, z + oz) || w.lineOfSight(p.x, p.z, x - ox, z - oz);
  }

  // ---- nav upkeep: player field rebuilt when the player changes cell, at a limited rate ----
  _navUpkeep(h, force) {
    const g = this.g, nav = g.nav, p = g.player;
    this.navT -= h;
    const moved = nav.ensureWindow(p.x, p.z);
    const pc = Math.floor(p.x / CELL) * 65536 + Math.floor(p.z / CELL);
    const doors = this.doorDirty && this.navT <= 0;
    if (moved || force || doors || (this.navT <= 0 && pc !== this.navCell)) {
      // enemy fields: a closed door costs 20 m (another open entrance wins; otherwise the route ends at it)
      nav.build(F_PLAYER, p.x, p.z, D.navField, CLOSED_ENEMY);
      this.navCell = pc;
      this.navT = g.enemy.active ? 0.15 : 0.6;
    }
    if ((moved || doors) && this.tSet) nav.build(F_TARGET, this.tX, this.tZ, D.navField, CLOSED_ENEMY);
    if (doors) this.doorDirty = false;
  }

  _setTarget(x, z) {
    this.tSet = true;
    this.tX = x; this.tZ = z;
    this.g.nav.build(F_TARGET, x, z, D.navField, CLOSED_ENEMY);
  }

  // ---- spawn search ----
  _revealDist(i) {
    const nav = this.g.nav, p = this.g.player, w = this.g.world, f = nav.fields[F_SPAWN];
    let cur = i;
    for (let k = 0; k < 30; k++) {
      cur = nav.next(F_SPAWN, cur);
      if (cur < 0) return -1;
      if ((k & 1) === 0 && w.lineOfSight(p.x, p.z, nav.cx(cur), nav.cz(cur))) return (f[i] - f[cur]) * UNIT;
    }
    return -1;
  }

  _fairEscape(i) {
    const nav = this.g.nav;
    // the villain's travel (closed doors cost it 20 m) against the player's (who can push doors open)
    nav.build(F_SCRATCH, nav.cx(i), nav.cz(i), D.navField + 10, CLOSED_ENEMY);
    const P = nav.fields[F_SPAWN], E = nav.fields[F_SCRATCH], g = nav.grid;
    const far = D.fairFar / UNIT, lead = D.fairLead / UNIT;
    for (let c = 0; c < nav.N; c++) {
      const pv = P[c];
      if (pv === INF || pv < far || g[c] !== 1) continue;
      const ev = E[c];
      if (ev === INF || ev - pv >= lead) return true;
    }
    return false;
  }

  _trySpawn() {
    const g = this.g, nav = g.nav, p = g.player, rng = this.rng;
    this._navUpkeep(0, true);
    const relax = this.fails >= 4 ? 1 : 0;
    const lo = D.spawnMin - 2 * relax, hi = D.spawnMax + 6 * relax;
    // spawn search runs on a field where doors are passable, so a player hiding behind a closed door still gets
    // a villain: it arrives outside and camps at the door. the player's own sealed room is excluded.
    nav.build(F_SPAWN, p.x, p.z, D.navField);
    nav.build(F_SCRATCH, p.x, p.z, D.sealedRange + 2, CLOSED_BLOCK);
    const S = nav.fields[F_SCRATCH], sealedLim = D.sealedRange / UNIT;
    let sealed = true;
    for (let c = 0; c < nav.N && sealed; c++) if (S[c] !== INF && S[c] >= sealedLim) sealed = false;
    this.sealed = sealed;
    const n = nav.collect(F_SPAWN, lo, hi);
    if (!n) return this._reject('no-candidates');
    const first = this.encounters === 0;
    const fx = -Math.sin(g.camYaw), fz = -Math.cos(g.camYaw);
    const b = this.best3, bs = this.best3s;
    b.fill(-1); bs.fill(-1e9);
    for (let s = 0; s < 24; s++) {
      const i = nav.cand[rng.int(0, n - 1)];
      const x = nav.cx(i), z = nav.cz(i);
      if (sealed && S[i] !== INF) continue; // never inside the player's closed room
      if (this.playerCanSee(x, z, false)) continue;
      const dx = x - p.x, dz = z - p.z, d = Math.sqrt(dx * dx + dz * dz);
      let score = rng.next() * 0.6 + (first ? 2 : 0.7) * ((dx * fx + dz * fz) / d);
      const rd = this._revealDist(i);
      if (rd < 0) score -= 1.5;
      else if (rd <= 7) score += 1;
      else score += 0.3;
      for (let k = 0; k < 3; k++) {
        if (score > bs[k]) {
          for (let m = 2; m > k; m--) { bs[m] = bs[m - 1]; b[m] = b[m - 1]; }
          bs[k] = score; b[k] = i;
          break;
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      const i = b[k];
      if (i < 0) break;
      // a sealed player cannot be reached at all (villains never open doors), so any outside spot is fair
      if (!sealed && !this._fairEscape(i)) continue;
      this._commit(nav.cx(i), nav.cz(i), nav.dist(F_SPAWN, nav.cx(i), nav.cz(i)));
      return true;
    }
    return this._reject(b[0] < 0 ? 'all-visible' : 'unfair');
  }

  _reject(why) {
    this.fails++;
    this.rejected++;
    this.retryT = 0.35;
    if (this.fails <= 3 || this.fails % 10 === 0) this._log('spawn-reject', { why });
    return false;
  }

  _commit(x, z, pathDist) {
    const g = this.g, p = g.player;
    const charId = this.selector.commit(this.forceChar);
    this.forceChar = null;
    this.summonNow = false;
    this.encounters++;
    this.charId = charId;
    g.enemy.spawn(charId, x, z, p.x, p.z);
    this.revealed = false;
    this.revealAt = -1;
    this.chaseAt = -1;
    this.chaseCap = this.rng.range(D.chaseCap[0], D.chaseCap[1]);
    this.chaseT = 0;
    this.los = false;
    this.losT = 0;
    this.noLos = 0;
    this.tSet = false;
    this.hurt = false;
    this.fails = 0;
    this.slowT = 0;
    this.muffle = 1;
    this.cur = { n: this.encounters, charId, spawnT: +this.t.toFixed(3), spawnPath: +pathDist.toFixed(1), revealT: null, chaseT: null, endT: null, result: null, escapeDur: null, forcedReveal: false, reacquires: 0 };
    this.encountersLog.push(this.cur);
    this._set('WARNING');
    // audible warning from the enemy's direction before anything is visible
    g.audio.sfx('distantDoor', { x, z, gain: 0.9 });
  }

  // party mode: blast the active villain away (no catch, no escape), hold everything. returns true if it blasted
  partyStart() {
    const g = this.g, e = g.enemy, p = g.player;
    let blasted = false;
    if (e.active) {
      if (this.cur && !this.cur.result) {
        this.cur.result = 'party';
        this.cur.endT = +this.t.toFixed(3);
        if (this.cur.chaseT != null) this.cur.escapeDur = +(this.t - this.cur.chaseT).toFixed(2);
      }
      this._stopTrack(0.3);
      if (e.mode !== 'blast') {
        let ax = e.x - p.x, az = e.z - p.z;
        const l = Math.sqrt(ax * ax + az * az) || 1;
        e.blast(ax / l, az / l);
      }
      blasted = true;
    }
    this._log('party', { blasted });
    this.tSet = false;
    this.forceChar = null;
    this.summonNow = false;
    this.fails = 0;
    this.retryT = 0;
    this.hurt = false;
    this.slowT = 0;
    if (this.state !== 'EXPLORING') this._set('EXPLORING');
    return blasted;
  }

  // the party and its grace are over: normal play, the next villain a few seconds later
  partyEnd() {
    this.slowT = 0;
    this.stateT = 0;
    const next = this.rng.range(PARTY.after[0], PARTY.after[1]);
    this.nextT = next;
    this.retryT = 0;
    // the party's over: the next villain is summoned straight away (normal rotation)
    if (!this.g.enemy.active) this.summonNow = true;
    this._log('party-end', { next: +this.nextT.toFixed(2) });
  }

  // key 9: call the next villain now, picked by the normal rotation rules
  summon() {
    const g = this.g;
    if (g.party && g.party.holds) { g.toast(LINES_NO_SUMMON, 'info', 2000); return false; }
    if (g.enemy.active || this.summonNow) return false;
    this.summonNow = true;
    this.state = 'EXPLORING';
    this.stateT = 0;
    this.retryT = 0;
    this.nextT = 0;
    return true;
  }

  forceEncounter(charId) {
    const g = this.g;
    if (!CHARS[charId]) return false;
    if (g.party && g.party.holds) { g.toast(LINES_NO_SUMMON, 'info', 2000); return false; }
    if (g.enemy.active) this._endEncounter('forced', false);
    this.forceChar = charId;
    this.state = 'EXPLORING';
    this.stateT = 0;
    this.retryT = 0;
    this.nextT = 0;
    return true;
  }

  // ---- encounter flow ----
  _reveal(forced) {
    const g = this.g, e = g.enemy;
    this.revealed = true;
    this.revealAt = this.t;
    e.setModeSoft('commit');
    this.commitT = Math.max(0.6, CHARS[this.charId].commit - 0.12 * this.difficulty);
    g.audio.sfx('sting', { x: e.x, z: e.z, gain: 1 });
    g.meme('reveal', e, 0.8);
    // track starts at the reveal; AudioSystem applies the manifest entranceDelay (0.25 s for kanye) itself
    this.trackAt = this.t;
    this.cur.revealT = +this.t.toFixed(3);
    this.cur.forcedReveal = forced;
    this._log('reveal', { forced, dist: +this.pathDist.toFixed(1) });
  }

  _startChase() {
    this.chaseAt = this.t;
    // escape clocks only run once pursuit has started
    this.noLos = 0;
    this.cur.chaseT = +this.t.toFixed(3);
    this.g.enemy.setModeSoft('pursue');
    this._set('CHASING');
  }

  _startSearch() {
    this.searchPts = 0;
    this.searchHold = 0;
    this.g.enemy.setModeSoft('search');
    this._set('SEARCHING');
    this._nextSearchPoint();
  }

  // pick a nearby branch around the current target that the target itself cannot see
  _nextSearchPoint() {
    const g = this.g, nav = g.nav, w = g.world, rng = this.rng;
    const n = nav.collect(F_TARGET, 4, 14);
    this.searchPts++;
    if (!n) return false;
    let pick = -1;
    for (let s = 0; s < 12; s++) {
      const i = nav.cand[rng.int(0, n - 1)];
      pick = i;
      if (!w.lineOfSight(this.tX, this.tZ, nav.cx(i), nav.cz(i))) break;
    }
    this._setTarget(nav.cx(pick), nav.cz(pick));
    return true;
  }

  _stopTrack(fade) {
    if (this.trackOn || this.trackAt >= 0) this.g.audio.enemyStop(fade);
    this.trackOn = false;
    this.trackAt = -1;
  }

  _endEncounter(result, retreat) {
    const e = this.g.enemy;
    if (this.cur && !this.cur.result) {
      this.cur.result = result;
      this.cur.endT = +this.t.toFixed(3);
      if (this.cur.chaseT != null) this.cur.escapeDur = +(this.t - this.cur.chaseT).toFixed(2);
    }
    this._stopTrack(result === 'escape' ? 1.6 : result === 'death' ? 0.25 : 1.0);
    this.tSet = false;
    if (retreat && e.active) {
      e.setModeSoft('retreat');
    } else {
      e.despawn();
    }
  }

  _escape(why) {
    const g = this.g, p = g.player;
    this.escapes++;
    this._log('escape', { why, dur: this.chaseAt >= 0 ? +(this.t - this.chaseAt).toFixed(2) : null, path: +this.pathDist.toFixed(1) });
    const intense = this.chaseAt >= 0 && this.t - this.chaseAt > D.intenseChase;
    this._endEncounter('escape', true);
    g.meme('escape', p, 0.8);
    if (p.hp < D.maxHp) {
      p.hp = Math.min(D.maxHp, p.hp + D.escapeHeal);
      g.audio.sfx('recover', { gain: 0.8 });
      g.events.emit('game:recover', { source: 'escape' });
      g.events.emit('game:hearts', { hp: p.hp, max: D.maxHp, delta: D.escapeHeal });
    }
    this.recoveryT = this.hurt ? D.recoveryHurt : intense ? D.recoveryIntense : D.recovery;
    const prog = g.objectives ? g.objectives.progress01 : 0;
    this.nextT = this.rng.range(D.sprintEncounter[0], D.sprintEncounter[1]) * (1 - OBJ.escapeSooner * prog);
    this.slowT = 0;
    this._set('ESCAPED');
  }

  _catch() {
    const g = this.g, p = g.player, e = g.enemy;
    if (p.protect > 0) return;
    if (p.hp <= D.catchDmg) {
      p.hp = 0;
      g.events.emit('game:hearts', { hp: 0, max: D.maxHp, delta: -D.catchDmg });
      // the cutout stays in your face for the death beat; restart clears it
      this._log('death');
      if (this.cur && !this.cur.result) { this.cur.result = 'death'; this.cur.endT = +this.t.toFixed(3); }
      this._stopTrack(0.25);
      e.setMode('hold');
      g._die(this.charId);
      return;
    }
    p.hp -= D.catchDmg;
    g.events.emit('game:hearts', { hp: p.hp, max: D.maxHp, delta: -D.catchDmg });
    p.protect = D.protect;
    this.hurt = true;
    let ax = p.x - e.x, az = p.z - e.z;
    const al = Math.sqrt(ax * ax + az * az) || 1;
    ax /= al; az /= al;
    g._hit(ax, az, this.charId);
    g.meme('hit', p, 1);
    e.stun(-ax, -az);
    this._log('hit');
    this._endEncounter('hit', true);
    this.recoveryT = D.recoveryHurt;
    this.nextT = this.rng.range(14, 20);
    this.slowT = 0;
    this._set('RECOVERY');
  }

  // ---- main step (fixed 1/120) ----
  step(h) {
    const g = this.g, p = g.player, e = g.enemy;
    this.t += h;
    this.stateT += h;
    // party: nothing hunts, nothing counts down; a blasted villain finishes flying off
    if (g.party && g.party.holds) {
      if (e.active) e.step(h);
      this.los = false; this.noLos = 0; this.straight = this.pathDist = Infinity;
      if (this.trackOn || this.trackAt >= 0) this._stopTrack(0.3);
      return;
    }
    const prot = g.protectedT > 0;
    if (!prot) {
      if (p.speed < D.slowSpeed) this.slowT += h;
      else this.slowT = 0;
    }
    if (p.protect > 0) p.protect = Math.max(0, p.protect - h);
    this._navUpkeep(h, false);

    if (e.active) {
      this.losT -= h;
      if (this.losT <= 0) {
        this.losT = LOS_DT;
        const was = this.los;
        this.los = this._enemySees();
        if (this.los && !was && this.lostLongT > 1.5 && e.cfg.reacquireFreeze > 0 && (this.state === 'CHASING' || this.state === 'SEARCHING')) e.freezeT = e.cfg.reacquireFreeze;
      }
      if (this.los) { this.noLos = 0; this.lostLongT = 0; } else { this.noLos += h; this.lostLongT += h; }
      const dx = p.x - e.x, dz = p.z - e.z;
      this.straight = Math.sqrt(dx * dx + dz * dz);
      this.pathDist = g.nav.dist(F_PLAYER, e.x, e.z);
    } else {
      this.los = false;
      this.noLos = 0;
      this.straight = this.pathDist = Infinity;
    }

    switch (this.state) {
      case 'EXPLORING': this._exploring(h, prot); break;
      case 'WARNING': this._warning(h); break;
      case 'CHASING': this._chasing(h); break;
      case 'SEARCHING': this._searching(h); break;
      case 'ESCAPED':
      case 'RECOVERY': this._recovering(h, prot); break;
    }

    if (e.active) e.step(h);

    if (this.trackAt >= 0 && this.t >= this.trackAt && e.active) {
      g.audio.enemyStart(this.charId, e.x, ENEMY.earY, e.z);
      this.trackAt = -1;
      this.trackOn = true;
      this.trackStarts++;
      this._log('track');
    }

    if (e.active && (this.state === 'CHASING' || this.state === 'SEARCHING') && e.mode !== 'stun' && e.mode !== 'retreat') {
      const dx = p.x - e.x, dz = p.z - e.z;
      if (dx * dx + dz * dz < D.catchDist * D.catchDist) this._catch();
    }
    if (this.state === 'CHASING') this.chaseT += h;
  }

  _exploring(h, prot) {
    const g = this.g;
    if (!prot) this.nextT -= h;
    const auto = !g.params.noDirector && !prot && (this.nextT <= 0 || (this.encounters > 0 && this.slowT >= D.slowTrigger));
    if ((auto || this.forceChar || this.summonNow) && !g.enemy.active) {
      this.retryT -= h;
      if (this.retryT <= 0) this._trySpawn();
    }
  }

  _warning(h) {
    const g = this.g, e = g.enemy, p = g.player;
    e.follow = 0; e.tx = p.x; e.tz = p.z; e.direct = this.los;
    if (!this.revealed) {
      if (this.los) this._reveal(false);
      else if (this.stateT >= D.warnMax) this._reveal(true);
      // lurk just out of sight instead of walking into a player who cannot see it yet
      else if (this.pathDist < D.lurkDist) e.freezeT = Math.max(e.freezeT, 0.05);
      return;
    }
    this.commitT -= h;
    if (this.commitT <= 0) this._startChase();
  }

  _chasing(h) {
    const g = this.g, e = g.enemy, p = g.player;
    if (this.los || this.noLos < D.losGrace + 0.12 * this.difficulty) {
      // in sight (or just lost it): track the player directly on the player field
      e.follow = 0; e.tx = p.x; e.tz = p.z; e.direct = this.los;
      this.lkpX = p.x; this.lkpZ = p.z;
      this.tSet = false;
    } else {
      // no tracking through walls: go to the last known position
      if (!this.tSet) { this._setTarget(this.lkpX, this.lkpZ); this._log('lost', { path: +this.pathDist.toFixed(1) }); }
      e.follow = 1; e.tx = this.lkpX; e.tz = this.lkpZ; e.direct = false;
      const dx = e.x - this.lkpX, dz = e.z - this.lkpZ;
      if (dx * dx + dz * dz < 1.0 || g.nav.dist(F_TARGET, e.x, e.z) < 0.8) this._startSearch();
    }
    this._checkEscape();
  }

  _searching(h) {
    const g = this.g, e = g.enemy, p = g.player;
    if (this.los && this.straight <= D.reacquireRange) {
      this.cur.reacquires++;
      this._log('reacquire');
      e.setModeSoft('pursue');
      this.tSet = false;
      this._set('CHASING');
      e.follow = 0; e.tx = p.x; e.tz = p.z; e.direct = true;
      return;
    }
    e.follow = 1; e.tx = this.tX; e.tz = this.tZ; e.direct = false;
    if (this.searchHold > 0) {
      this.searchHold -= h;
      e.freezeT = Math.max(e.freezeT, h * 2);
      if (this.searchHold <= 0) this._nextSearchPoint();
    } else {
      const dx = e.x - this.tX, dz = e.z - this.tZ;
      if (dx * dx + dz * dz < 0.8 || (e.stuckT >= 1.5)) this.searchHold = 0.45;
    }
    if (this._checkEscape()) return;
    const maxT = D.searchMax + 2 * this.difficulty;
    if (this.stateT >= maxT && this.noLos >= D.escapeNoLos) this._escape('hidden');
  }

  _checkEscape() {
    const e = this.g.enemy, p = this.g.player;
    const chased = this.t - this.chaseAt;
    // pursuit budget: a player who keeps moving is let go after 10-15 s; a slow one can be chased longer
    // camping at a closed door counts as a moving player: it waits out the 10-15 s budget, then retreats
    const camping = e.camping;
    const moving = camping || p.speed >= D.slowSpeed || this.slowT < 1.5;
    if ((moving && chased >= this.chaseCap) || chased >= D.slowChaseMax) { this._escape(camping ? 'camped' : 'gave-up'); return true; }
    if (this.los || chased < D.minChase) return false;
    // the closed door's path cost is not real separation: no early escape while it waits at the doorstep
    if (!camping && this.noLos >= D.escapeNoLos && this.pathDist >= D.escapeSep) { this._escape('separation'); return true; }
    if (e.stuckT >= 4 && this.noLos >= D.escapeNoLos) { this._escape('stuck'); return true; }
    return false;
  }

  _recovering(h, prot) {
    const g = this.g, e = g.enemy;
    this.nextT -= h;
    if (!prot) this.recoveryT -= h;
    if (e.active) {
      e.follow = -1; e.direct = false;
      // resolve the retreat out of sight; if the player keeps watching, fade the cutout out
      this.visT -= h;
      if (this.visT <= 0) {
        this.visT = LOS_DT;
        this.visible = this.playerCanSee(e.x, e.z, true);
        if (!this.visible && e.mode !== 'stun') { e.despawn(); this._log('despawn'); }
      }
      if (e.active && e.mode === 'retreat' && e.modeT > 1.6) {
        e.fading = true;
        e.alpha = Math.max(0, e.alpha - h / 0.6);
        if (e.alpha <= 0) { e.despawn(); this._log('despawn', { faded: true }); }
      }
    }
    if (this.state === 'ESCAPED' && !e.active && this.stateT >= 0.8) this._set('RECOVERY');
    else if (this.state === 'RECOVERY' && !e.active && this.recoveryT <= 0) this._set('EXPLORING');
  }

  onDeath() {
    if (this.cur && !this.cur.result) {
      this.cur.result = 'death';
      this.cur.endT = +this.t.toFixed(3);
    }
    this._stopTrack(0.25);
  }

  // ---- per render frame: audio muffling and chase intensity ----
  frame(dt, ex, ez) {
    const g = this.g, a = g.audio;
    if (this.trackOn) {
      let target = 0;
      if (!this.los) {
        const ratio = this.straight > 0.5 && Number.isFinite(this.pathDist) ? this.pathDist / this.straight : 3;
        target = 0.45 + 0.55 * Math.min(1, Math.max(0, (ratio - 1.05) / 0.6));
      }
      this.muffle += (target - this.muffle) * (1 - Math.exp(-dt / 0.3));
      a.enemyUpdate(ex, ENEMY.earY, ez, this.muffle, dt);
    }
    let c = 0;
    if (this.state === 'CHASING') c = this.los ? 1 : 0.8;
    else if (this.state === 'SEARCHING') c = 0.55;
    else if (this.state === 'WARNING') c = this.revealed ? 0.6 : 0.15;
    this.chase += (c - this.chase) * (1 - Math.exp(-dt / (c > this.chase ? 0.25 : 1.2)));
    a.setChase(this.chase);
  }
}
