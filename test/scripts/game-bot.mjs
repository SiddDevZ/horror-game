// scripted players for gameplay tests. works in node (game-sim) and in the page (dynamic import).
// runner: a competent human stand-in. reacts ~0.3 s after the reveal, then keeps choosing a goal it
// reaches well before the enemy (breaking sight when it can) and sprints there with string pulling.
import { Nav, F_PLAYER, F_TARGET, F_SCRATCH, INF, UNIT } from '../../src/game/Nav.js';
import { makeRng } from '../../src/core/rng.js';

export class Bot {
  constructor(game, { mode = 'runner', seed = 1, react = 0.3 } = {}) {
    this.g = game;
    this.mode = mode; // runner | idle | walker | wander
    this.nav = new Nav(game.world, 160);
    this.rng = makeRng(seed);
    this.react = react;
    this.replanT = 0;
    this.goal = -1;
    this.goalX = 0; this.goalZ = 0;
    this.wpX = 0; this.wpZ = 0;
    this.fleeing = false;
    this.seenAt = -1;
    this.stuckT = 0;
    this.sideT = 0;
    this.side = 1;
    this.lastX = 0; this.lastZ = 0;
  }

  _pickWander() {
    const nav = this.nav, p = this.g.player;
    nav.ensureWindow(p.x, p.z);
    nav.build(F_PLAYER, p.x, p.z, 60);
    const n = nav.collect(F_PLAYER, 18, 34);
    if (!n) return false;
    const i = nav.cand[this.rng.int(0, n - 1)];
    this._setGoal(i);
    return true;
  }

  _setGoal(i) {
    const nav = this.nav;
    this.goal = i;
    this.goalX = nav.cx(i); this.goalZ = nav.cz(i);
    nav.build(F_SCRATCH, this.goalX, this.goalZ, 70);
  }

  _pickFlee() {
    const nav = this.nav, g = this.g, p = g.player, e = g.enemy, w = g.world;
    nav.ensureWindow(p.x, p.z);
    nav.build(F_PLAYER, p.x, p.z, 60);
    nav.build(F_TARGET, e.x, e.z, 70);
    const n = nav.collect(F_PLAYER, 8, 32);
    if (!n) return false;
    const P = nav.fields[F_PLAYER], E = nav.fields[F_TARGET];
    let best = -1, bs = -1e9;
    for (let s = 0; s < 260; s++) {
      const i = nav.cand[this.rng.int(0, n - 1)];
      const pv = P[i], ev = E[i];
      const lead = ev === INF ? 40 : (ev - pv) * UNIT;
      if (lead < 4) continue;
      let score = Math.min(lead, 30) + pv * UNIT * 0.25;
      if (!w.lineOfSight(e.x, e.z, nav.cx(i), nav.cz(i))) score += 8;
      // keep the current goal unless something is clearly better (humans commit to a route)
      if (i === this.goal) score += 4;
      if (score > bs) { bs = score; best = i; }
    }
    if (best < 0) return false;
    this._setGoal(best);
    return true;
  }

  // casual: no route planning against the enemy's field, just "somewhere nearby that is further away"
  _pickCasual() {
    const nav = this.nav, g = this.g, p = g.player, e = g.enemy;
    nav.ensureWindow(p.x, p.z);
    nav.build(F_PLAYER, p.x, p.z, 40);
    const n = nav.collect(F_PLAYER, 6, 16);
    if (!n) return false;
    let best = -1, bs = -1e9;
    for (let s = 0; s < 40; s++) {
      const i = nav.cand[this.rng.int(0, n - 1)];
      const dx = nav.cx(i) - e.x, dz = nav.cz(i) - e.z;
      const score = Math.sqrt(dx * dx + dz * dz) + this.rng.next() * 4;
      if (score > bs) { bs = score; best = i; }
    }
    this._setGoal(best);
    return true;
  }

  _steer() {
    const nav = this.nav, p = this.g.player;
    const i = nav.idx(p.x, p.z);
    if (i < 0 || !nav.fieldOk[F_SCRATCH]) return false;
    let cur = i, best = -1, fails = 0;
    for (let k = 0; k < 30; k++) {
      const nx = nav.next(F_SCRATCH, cur);
      if (nx < 0) break;
      cur = nx;
      if (nav.walkable(p.x, p.z, nav.cx(nx), nav.cz(nx), 0.3)) { best = nx; fails = 0; } else if (++fails > 3) break;
      if (best < 0 && k === 0) best = nx;
    }
    if (best < 0) return false;
    this.wpX = nav.cx(best); this.wpZ = nav.cz(best);
    return true;
  }

  update(dt) {
    const g = this.g, inp = g.input, d = g.director, p = g.player, e = g.enemy;
    if (g.state !== 'playing') return;
    if (this.mode === 'idle') { inp.set({ fwd: 0, strafe: 0, sprint: false }); return; }
    const threat = e.active && e.mode !== 'retreat' && e.mode !== 'stun' && (d.revealed || d.state === 'CHASING' || d.state === 'SEARCHING');
    if (threat && this.seenAt < 0) this.seenAt = d.t;
    if (!threat) this.seenAt = -1;
    const flee = (this.mode === 'runner' || this.mode === 'casual') && threat && d.t - this.seenAt >= this.react;
    this.replanT -= dt;
    if (flee !== this.fleeing) { this.fleeing = flee; this.replanT = 0; }
    if (this.replanT <= 0) {
      this.replanT = flee ? (this.mode === 'casual' ? 1.0 : 0.4) : 1.2;
      const ok = flee ? (this.mode === 'casual' ? this._pickCasual() : this._pickFlee()) : this._pickWander();
      if (!ok && !flee) this._pickWander();
    }
    // arrived: pick again
    const gx = this.goalX - p.x, gz = this.goalZ - p.z;
    if (gx * gx + gz * gz < 1) this.replanT = 0;
    this._steer();
    const dx = this.wpX - p.x, dz = this.wpZ - p.z;
    const yaw = Math.atan2(-dx, -dz);
    const sprint = this.mode === 'runner' || this.mode === 'wander' || this.mode === 'casual';
    // pinned square against a prop face: sidestep like a person would
    this.stuckT = p.speed < 0.8 ? this.stuckT + dt : 0;
    if (this.stuckT > 0.15) { this.sideT = 0.3; this.side = -this.side || 1; this.stuckT = 0; this.stuckN = (this.stuckN || 0) + 1; }
    if (this.stuckN >= 3) { this.stuckN = 0; this.replanT = 0; this.goal = -1; }
    if (p.speed > 3) this.stuckN = 0;
    if (this.sideT > 0) this.sideT -= dt;
    inp.set({ fwd: 1, strafe: this.sideT > 0 ? this.side : 0, sprint, lookYaw: yaw });
  }
}
