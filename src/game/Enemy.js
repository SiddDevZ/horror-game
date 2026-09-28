// the single active enemy: a stiff gliding cutout that follows distance fields with string pulling.
import { CELL, CHUNK, chunkKey } from '../world/constants.js';
import { collide, untrap } from './collision.js';
import { CHARS } from './characters.js';
import { ENEMY, PARTY } from './tuning.js';
import { INF } from './Nav.js';

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

export class Enemy {
  constructor(game) {
    this.g = game;
    this.world = game.world;
    this.nav = game.nav;
    this.active = false;
    this.charId = 'kanye';
    this.cfg = CHARS.kanye;
    this.x = 0; this.z = 0; this.prevX = 0; this.prevZ = 0;
    this.vx = 0; this.vz = 0;
    this.heading = 0;
    this.spd = 0;
    this.mode = 'idle';
    this.modeT = 0;
    this.stunTime = ENEMY.stunTime;
    this.stunNext = 'retreat'; // mode to resume once a stun ends
    // steering request, written by the director every step
    this.follow = 0; // 0 player field, 1 target field, -1 retreat (ascend player field)
    this.tx = 0; this.tz = 0;
    this.direct = false;
    this.wpX = 0; this.wpZ = 0;
    this.planT = 0;
    this.planVer = -1;
    this.alpha = 1;
    this.fading = false;
    this.spin = 0; // extra facing yaw while blasted by the party
    this.pinKey = -1;
    this.goT = 0;
    this.freezeT = 0;
    this.kvx = 0; this.kvz = 0;
    this.chkT = 0; this.chkX = 0; this.chkZ = 0; this.stuckT = 0; this.unstickT = 0;
    this.info = { hit: false, door: false, doorIx: 0, doorIz: 0 };
    this.moved = 0;
    this.doorWait = false; // the route is cut by a closed door: stop at the doorstep and wait
    this.camping = false; // at that doorstep now
  }

  spawn(charId, x, z, faceX, faceZ) {
    this.active = true;
    this.charId = charId;
    this.cfg = CHARS[charId];
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.vx = this.vz = 0;
    this.spd = 0;
    this.heading = Math.atan2(faceZ - z, faceX - x);
    this.alpha = 1;
    this.fading = false;
    this.spin = 0;
    this.freezeT = 0;
    this.goT = 0;
    this.stuckT = 0;
    this.unstickT = 0;
    this.chkT = 0.5; this.chkX = x; this.chkZ = z;
    this.planT = 0;
    this.moved = 0;
    this.doorWait = this.camping = false;
    this.setMode('approach');
    this._pin();
  }

  despawn() {
    if (!this.active) return;
    this.active = false;
    this.mode = 'idle';
    if (this.pinKey >= 0) this.world.unpin(this.pinKey, 'enemy');
    this.pinKey = -1;
  }

  setMode(m) {
    this.mode = m;
    this.modeT = 0;
    this.planT = 0;
    if (m === 'pursue') this.goT = 0;
  }

  // a stun knocks the cutout back and freezes it; afterwards it resumes stunNext (the mode it was in, or
  // whatever the director asked for meanwhile via setModeSoft). catches pass the defaults and then retreat.
  stun(awayX, awayZ, time = ENEMY.stunTime, speed = ENEMY.knockSpeed) {
    if (this.mode !== 'stun') this.stunNext = this.mode === 'idle' ? 'retreat' : this.mode;
    this.setMode('stun');
    this.stunTime = time;
    this.kvx = awayX * speed;
    this.kvz = awayZ * speed;
    this.spd = 0;
  }

  // party: flung away from the player, spinning and fading, then gone. no damage, cannot be interrupted.
  blast(awayX, awayZ) {
    this.setMode('blast');
    this.kvx = awayX * PARTY.blastSpeed;
    this.kvz = awayZ * PARTY.blastSpeed;
    this.spd = 0;
    this.fading = true;
  }

  // mode change that waits for a running stun to finish
  setModeSoft(m) {
    if (this.mode === 'blast') return;
    if (this.mode === 'stun') this.stunNext = m;
    else this.setMode(m);
  }

  _pin() {
    const key = chunkKey(Math.floor(this.x / CHUNK), Math.floor(this.z / CHUNK));
    if (key === this.pinKey) return;
    if (this.pinKey >= 0) this.world.unpin(this.pinKey, 'enemy');
    this.world.pin(key, 'enemy');
    this.pinKey = key;
  }

  _plan() {
    const nav = this.nav;
    const r = 0.3;
    const f = this.follow;
    this.doorWait = false;
    if (f >= 0 && this.direct && this.unstickT <= 0 && nav.walkable(this.x, this.z, this.tx, this.tz, r)) {
      this.wpX = this.tx; this.wpZ = this.tz;
      return;
    }
    const i = nav.idx(this.x, this.z);
    if (i < 0 || !nav.fieldOk[f < 0 ? 0 : f]) {
      // outside the nav window: head straight for the target if we can see it, otherwise hold
      if (this.direct) { this.wpX = this.tx; this.wpZ = this.tz; } else { this.wpX = this.x; this.wpZ = this.z; }
      return;
    }
    const field = nav.fields[f < 0 ? 0 : f];
    let cur = i;
    if (field[cur] === INF) {
      // standing in an excluded cell: step to the best neighbour first
      const S = nav.S;
      let bv = INF;
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - S : i + S;
        if (nav.grid[j] !== 0 && field[j] < bv) { bv = field[j]; cur = j; }
      }
      if (bv === INF) { this.wpX = this.x; this.wpZ = this.z; return; }
      this.wpX = nav.cx(cur); this.wpZ = nav.cz(cur);
      return;
    }
    const look = this.unstickT > 0 ? 1 : f < 0 ? 12 : this.cfg.lookahead;
    let best = -1, first = -1, fails = 0, door = false;
    for (let k = 0; k < look; k++) {
      const n = f < 0 ? nav.up(0, cur) : nav.next(f, cur);
      if (n < 0) break;
      // villains never open doors: a closed door on the route ends it at the doorstep
      if (nav.closedDoor(n)) { door = true; break; }
      cur = n;
      if (first < 0) first = n;
      if (nav.walkable(this.x, this.z, nav.cx(n), nav.cz(n), r)) { best = n; fails = 0; } else if (++fails > 3) break;
    }
    if (door) {
      this.doorWait = true;
      if (best < 0) { this.wpX = this.x; this.wpZ = this.z; return; }
      this.wpX = nav.cx(best); this.wpZ = nav.cz(best);
      return;
    }
    if (best < 0) best = first;
    if (best < 0) {
      // at the field minimum: close the last bit directly
      if (f >= 0) { this.wpX = this.tx; this.wpZ = this.tz; } else { this.wpX = this.x; this.wpZ = this.z; }
      return;
    }
    this.wpX = nav.cx(best); this.wpZ = nav.cz(best);
    if (f >= 0 && field[best] === 0 && nav.walkable(this.x, this.z, this.tx, this.tz, r)) { this.wpX = this.tx; this.wpZ = this.tz; }
  }

  step(h) {
    if (!this.active) return;
    this.prevX = this.x;
    this.prevZ = this.z;
    this.modeT += h;
    const cfg = this.cfg;
    const nav = this.nav;

    if (this.mode === 'blast') {
      const k = Math.exp(-h * 1.5);
      this.kvx *= k; this.kvz *= k;
      this.vx = this.kvx; this.vz = this.kvz;
      this.x += this.vx * h; this.z += this.vz * h;
      collide(this.world, this, ENEMY.radius, this.info);
      untrap(this.world, this, ENEMY.radius);
      this.spin += PARTY.blastSpin * h;
      this.alpha = Math.max(0, 1 - this.modeT / PARTY.blastTime);
      if (this.alpha <= 0) { this.despawn(); return; }
      this._pin();
      return;
    }

    if (this.mode === 'stun') {
      this.vx = this.kvx; this.vz = this.kvz;
      const k = Math.exp(-h * 6);
      this.kvx *= k; this.kvz *= k;
      this.x += this.vx * h; this.z += this.vz * h;
      collide(this.world, this, ENEMY.radius, this.info);
      untrap(this.world, this, ENEMY.radius);
      if (this.modeT >= this.stunTime) this.setMode(this.stunNext || 'retreat');
      this._pin();
      return;
    }

    let target = 0;
    switch (this.mode) {
      case 'approach': target = ENEMY.approachSpeed; break;
      case 'commit': target = cfg.commitCreep; break;
      case 'pursue':
        target = cfg.speed;
        if (cfg.stopGo) {
          const cyc = cfg.stopGo[0] + cfg.stopGo[1];
          if (this.goT % cyc >= cfg.stopGo[0]) target = 0;
          this.goT += h;
        }
        break;
      case 'search': target = cfg.speed * ENEMY.searchMul; break;
      case 'retreat': target = ENEMY.retreatSpeed; break;
      default: target = 0;
    }
    if (this.freezeT > 0) { this.freezeT -= h; target = 0; }
    // camping at a closed door: once at the doorstep, hold still (no pushing, no stuck/unstick oscillation)
    this.camping = this.doorWait && (this.wpX - this.x) ** 2 + (this.wpZ - this.z) ** 2 < 0.6 * 0.6;
    if (this.camping) target = 0;

    // replan on a fixed cadence, when the field changed, or when the waypoint is reached
    this.planT -= h;
    const fi = this.follow < 0 ? 0 : this.follow;
    const ver = nav.version[fi] * 4 + fi;
    const wdx = this.wpX - this.x, wdz = this.wpZ - this.z;
    if (this.planT <= 0 || ver !== this.planVer || wdx * wdx + wdz * wdz < 0.35 * 0.35) {
      this._plan();
      this.planT = ENEMY.planInterval;
      this.planVer = ver;
    }

    let dx = this.wpX - this.x, dz = this.wpZ - this.z;
    const dl = Math.sqrt(dx * dx + dz * dz);
    if (dl > 1e-3) {
      const want = Math.atan2(dz, dx);
      const err = wrap(want - this.heading);
      const rate = (this.unstickT > 0 ? 4 : 1) * cfg.turnRate * (this.mode === 'pursue' ? 1 : 1.6);
      const turn = Math.max(-rate * h, Math.min(rate * h, err));
      this.heading = wrap(this.heading + turn);
      // slow into turns that the heading limit cannot follow yet
      const c = Math.cos(err - turn);
      target *= Math.max(cfg.minCornerSpeed, c);
      if (dl < 0.5 && this.follow >= 0 && this.mode !== 'pursue') target *= dl / 0.5;
    } else {
      target = 0;
    }

    const a = target > this.spd ? ENEMY.accel : ENEMY.decel;
    this.spd += Math.max(-a * h, Math.min(a * h, target - this.spd));
    this.vx = Math.cos(this.heading) * this.spd;
    this.vz = Math.sin(this.heading) * this.spd;
    this.x += this.vx * h;
    this.z += this.vz * h;
    collide(this.world, this, ENEMY.radius, this.info);
    untrap(this.world, this, ENEMY.radius);
    const mx = this.x - this.prevX, mz = this.z - this.prevZ;
    this.moved += Math.sqrt(mx * mx + mz * mz);

    // stuck detection: wanted to move, barely did
    if (this.unstickT > 0) this.unstickT -= h;
    this.chkT -= h;
    if (this.chkT <= 0) {
      const ddx = this.x - this.chkX, ddz = this.z - this.chkZ;
      const wantMove = target > 1 && this.freezeT <= 0;
      if (wantMove && ddx * ddx + ddz * ddz < 0.15 * 0.15) this.stuckT += 0.5;
      else if (wantMove || ddx * ddx + ddz * ddz > 0.5) this.stuckT = 0;
      if (this.stuckT >= 1 && this.unstickT <= 0) this.unstickT = 1.2;
      this.chkT = 0.5; this.chkX = this.x; this.chkZ = this.z;
    }
    this._pin();
  }

  // navigable cell world coords of the enemy's cell, for debug
  get cellIx() { return Math.floor(this.x / CELL); }
  get cellIz() { return Math.floor(this.z / CELL); }
}
