// v3 objective chain ("todo list"), pickups and inventory.
// phone near spawn -> 6 M.E.G. work orders (tasks in rooms and hallways; the first 5 send a VHS log)
// -> 3 breaker panels (wires tasks, loud) -> powered EXIT -> win.
// planRun / Checklist / Inventory are pure and node-testable; Objectives binds them to the game and world.
import { CHUNK, chunkKey } from '../world/constants.js';
import { hash32, makeRng } from '../core/rng.js';
import { ITEMS, OBJ, DIRECTOR as D } from './tuning.js';
import { BRIEFING, TAPES, NOTES, LINES, TASK_TEXT } from './lore.js';
import { TASK_KINDS } from './Tasks.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- pure: run plan
// deterministic placement plan from the world seed: directions, distances and chunks for every target.
// landmark chunks (breakers, exit) are spread apart and far from the spawn's active window.
export function planRun(seed, sx = 0, sz = 0) {
  const rng = makeRng(hash32(seed >>> 0, 0x0b1e7));
  const scx = Math.floor(sx / CHUNK), scz = Math.floor(sz / CHUNK);
  const used = [];
  const at = (ang, d) => {
    const x = sx + Math.cos(ang) * d, z = sz + Math.sin(ang) * d;
    return { ang: Math.atan2(Math.sin(ang), Math.cos(ang)), d, x, z, cx: Math.floor(x / CHUNK), cz: Math.floor(z / CHUNK) };
  };
  const cheb = (p, cx, cz) => Math.max(Math.abs(p.cx - cx), Math.abs(p.cz - cz));
  const clear = (p, gap, spawnGap) => {
    if (cheb(p, scx, scz) < spawnGap) return false;
    // landmarks keep 3 chunks between each other; everything else just needs its own chunk
    for (const u of used) if (cheb(p, u.cx, u.cz) < Math.min(gap, u.gap)) return false;
    return true;
  };
  // retries jitter the direction by up to `spread` rad (growing), and the distance within [lo, hi]
  const place = (ang, lo, hi, gap, spawnGap, spread = Math.PI) => {
    let p = null;
    for (let k = 0; k < 64; k++) {
      const j = k ? spread * Math.min(1, k / 24) : 0;
      p = at(ang + rng.range(-j, j), rng.range(lo, hi));
      if (clear(p, gap, spawnGap)) break;
      p = null;
    }
    if (!p) p = at(ang, (lo + hi) / 2);
    used.push({ cx: p.cx, cz: p.cz, gap });
    return p;
  };

  // landmarks first: they need the most room
  const bBase = rng.next() * TAU;
  const breakers = [];
  for (let k = 0; k < OBJ.breakers; k++) breakers.push(place(bBase + (k * TAU) / OBJ.breakers + rng.range(-0.35, 0.35), OBJ.breakerRange[0] + 8, OBJ.breakerRange[1] - 8, 3, 5, 0.3));
  const exit = place(rng.next() * TAU, OBJ.exitRange[0] + 12, OBJ.exitRange[1] - 12, 3, 5);
  // one airhorn close by so the mechanic gets found early, one deeper in
  const airhorns = [place(rng.next() * TAU, 16, 30, 1, 0), place(rng.next() * TAU, 105, 150, 1, 0)];
  const almonds = [[25, 45], [45, 70], [70, 110], [110, 150], [150, 190]].map((b) => place(rng.next() * TAU, b[0], b[1], 1, 0));
  const notes = [[20, 40], [50, 85], [90, 130], [135, 180]].map((b) => place(rng.next() * TAU, b[0], b[1], 1, 0));
  return { seed: seed >>> 0, sx, sz, breakers, exit, airhorns, almonds, notes };
}

// ---------------------------------------------------------------- pure: checklist state machine
export const STEP_IDS = ['phone', 'tasks', 'breakers', 'exit'];
const STEP_TEXT = {
  phone: 'Answer the ringing phone',
  tasks: 'Finish M.E.G. work orders',
  breakers: 'Restore power at the breaker panels',
  exit: 'Walk through the EXIT',
};

export class Checklist {
  constructor(nTasks = OBJ.tasks, nBreakers = OBJ.breakers) {
    this.nTasks = nTasks;
    this.nBreakers = nBreakers;
    this.reset();
  }

  reset() {
    this.phone = false;
    this.tasks = 0;
    this.breakers = 0;
    this.exitOpen = false;
    this.won = false;
  }

  get canBreaker() { return this.tasks >= this.nTasks; }
  get powered() { return this.breakers >= this.nBreakers; }

  // the first unfinished step; work orders may be done before the phone, but the list stays in order
  get activeId() {
    if (!this.phone) return 'phone';
    if (this.tasks < this.nTasks) return 'tasks';
    if (this.breakers < this.nBreakers) return 'breakers';
    if (!this.won) return 'exit';
    return null;
  }

  // 0..1, drives the gentle difficulty rise
  get progress01() {
    const done = (this.phone ? 1 : 0) + this.tasks + 1.5 * this.breakers + (this.won ? 1 : 0);
    return Math.min(1, done / (1 + this.nTasks + 1.5 * this.nBreakers + 1));
  }

  answerPhone() {
    if (this.phone) return false;
    this.phone = true;
    return true;
  }

  // a finished task counts as a work order until there are enough; returns the order number or 0
  addTask() {
    if (this.tasks >= this.nTasks) return 0;
    return ++this.tasks;
  }

  // breakers only take once the work orders are done
  addBreaker() {
    if (!this.canBreaker || this.powered) return 0;
    return ++this.breakers;
  }

  openExit() {
    if (!this.powered) return false;
    this.exitOpen = true;
    return true;
  }

  win() {
    if (!this.exitOpen || this.won) return false;
    this.won = true;
    return true;
  }

  // sub: [{ text, done }] shown under the active step (nearby task names)
  list(sub = null) {
    const a = this.activeId;
    const done = { phone: this.phone, tasks: this.tasks >= this.nTasks, breakers: this.powered, exit: this.won };
    const prog = { phone: [this.phone ? 1 : 0, 1], tasks: [this.tasks, this.nTasks], breakers: [this.breakers, this.nBreakers], exit: [this.won ? 1 : 0, 1] };
    return STEP_IDS.map((id) => {
      const it = { id, text: STEP_TEXT[id], done: done[id], progress: prog[id][0], total: prog[id][1], active: id === a };
      if (id === a && sub && sub.length) it.sub = sub;
      return it;
    });
  }
}

// ---------------------------------------------------------------- pure: inventory
export class Inventory {
  constructor() { this.reset(); }

  reset() {
    this.almond = 0;
    this.airhorn = 0;
  }

  addAlmond() {
    if (this.almond >= ITEMS.almondMax) return false;
    this.almond++;
    return true;
  }

  // 'ok' consumes one; 'none' / 'full' leave the inventory alone
  drink(hp, maxHp) {
    if (this.almond <= 0) return 'none';
    if (hp >= maxHp) return 'full';
    this.almond--;
    return 'ok';
  }

  // an airhorn pickup fills the charges; 'full' means the pickup stays on the floor
  addAirhorn() {
    if (this.airhorn >= ITEMS.airhornMax) return 'full';
    const was = this.airhorn;
    this.airhorn = ITEMS.airhornMax;
    return was > 0 ? 'refill' : 'new';
  }

  // task rewards: one charge at a time
  addAirhornCharge() {
    if (this.airhorn >= ITEMS.airhornMax) return false;
    this.airhorn++;
    return true;
  }

  useAirhorn() {
    if (this.airhorn <= 0) return false;
    this.airhorn--;
    return true;
  }

  snapshot() {
    return { almond: this.almond, almondMax: ITEMS.almondMax, airhorn: this.airhorn, airhornMax: ITEMS.airhornMax };
  }
}

// ---------------------------------------------------------------- game-bound controller
export class Objectives {
  constructor(game) {
    this.g = game;
    this.world = game.world;
    this.plan = planRun(this.world.seed >>> 0, game.spawn.x, game.spawn.z);
    this.check = new Checklist();
    this.inv = new Inventory();
    this.items = [];
    this.breakers = [];
    this.breakerIds = new Set();
    this.exit = null;
    this.phone = null;
    this.virtual = []; // stand-in features (phone / landmarks) if the world has none
    this.stock = new Map();
    this.near = []; // nearest incomplete tasks [{ f, id, kind, x, z, dist }]
    this.scanT = 0;
    this.subKey = '';
    this.beacons = new Set();
    this.beaconT = 0;
    this.loreQueue = [];
    this.calmT = 0;
    this.ambT = 0;
    this.rng = makeRng(hash32(game.params.encounterSeed >>> 0, 0xa1b));
    this.reserved = this._reserve();
    this._resolve();
    this.reset(false);
    // the renderer rebuilds chunks as they stream back in: replay the state of finished props
    this._onChunk = (c) => this._replayChunk(c);
    game.events.on('world:chunkActive', this._onChunk);
  }

  get progress01() { return this.check.progress01; }

  // ---- setup (once per session; positions are a pure function of the world seed) ----
  _reserve() {
    const w = this.world, out = [];
    if (typeof w.reserveLandmark !== 'function') return out;
    for (const b of this.plan.breakers) out.push({ type: 'breaker', cx: b.cx, cz: b.cz, ok: !!w.reserveLandmark(b.cx, b.cz, 'breaker') });
    const e = this.plan.exit;
    out.push({ type: 'exit', cx: e.cx, cz: e.cz, ok: !!w.reserveLandmark(e.cx, e.cz, 'exit') });
    return out;
  }

  _spot(cx, cz, kind) {
    const w = this.world;
    return typeof w.findSpot === 'function' ? w.findSpot(cx, cz, { kind }) : null;
  }

  // spot near a planned point, searching outward chunk rings; optional distance window from spawn
  _near(p, kind, lo = 0, hi = Infinity, avoid = null) {
    const sx = this.g.spawn.x, sz = this.g.spawn.z;
    for (let r = 0; r <= 2; r++) {
      const ring = [];
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = p.cx + dx, cz = p.cz + dz;
        const mx = (cx + 0.5) * CHUNK - p.x, mz = (cz + 0.5) * CHUNK - p.z;
        ring.push({ cx, cz, d: mx * mx + mz * mz });
      }
      ring.sort((a, b) => a.d - b.d);
      for (const c of ring) {
        const key = chunkKey(c.cx, c.cz);
        if (avoid && avoid.has(key)) continue;
        const s = this._spot(c.cx, c.cz, kind);
        if (!s) continue;
        const d = Math.hypot(s.x - sx, s.z - sz);
        if (d < lo || d > hi) continue;
        if (avoid) avoid.add(key);
        return { ...s, cx: c.cx, cz: c.cz, dist: d };
      }
    }
    return null;
  }

  // the landmark feature in a reserved chunk: a breaker box, or a wires task flagged as the breaker
  _landmark(cx, cz, type) {
    const fs = this.world.getChunk(cx, cz).features || [];
    for (const f of fs) if (f.type === type) return f;
    if (type === 'breaker') for (const f of fs) if (f.type === 'task' && f.data && f.data.kind === 'wires' && f.data.breaker) return f;
    return null;
  }

  _virtual(type, id, s, data) {
    const f = { id, type, x: s.x, z: s.z, yaw: s.yaw || 0, w: 0.5, d: 0.2, data, virtual: true };
    this.virtual.push(f);
    return f;
  }

  _resolve() {
    const plan = this.plan, sp = this.g.spawn;
    this.virtual.length = 0;
    const avoid = new Set();
    for (const b of plan.breakers) avoid.add(chunkKey(b.cx, b.cz));
    avoid.add(chunkKey(plan.exit.cx, plan.exit.cz));

    // breakers and exit: the reserved landmark feature if the world placed one, else a stand-in
    this.breakers = plan.breakers.map((b, i) => {
      let src = this._landmark(b.cx, b.cz, 'breaker');
      if (!src) {
        const s = this._near(b, 'breaker') || { x: b.x, z: b.z, yaw: 0 };
        src = this._virtual('breaker', `vbreaker-${i}`, s, { y: 1.35 });
      }
      return { i, id: src.id, x: src.x, z: src.z, yaw: src.yaw, y: src.data?.y ?? 1.35, virtual: !!src.virtual, on: false, dist: Math.hypot(src.x - sp.x, src.z - sp.z) };
    });
    this.breakerIds = new Set(this.breakers.map((b) => b.id));
    {
      const e = plan.exit;
      let src = this._landmark(e.cx, e.cz, 'exitDoor');
      if (!src) {
        const s = this._near(e, 'exit') || { x: e.x, z: e.z, yaw: 0 };
        src = this._virtual('exitDoor', 'vexit', s, { y: 1.1 });
      }
      this.exit = { id: src.id, x: src.x, z: src.z, yaw: src.yaw, virtual: !!src.virtual, state: 'locked', dist: Math.hypot(src.x - sp.x, src.z - sp.z) };
    }

    // the M.E.G. phone: the world's ringing spawn desk phone (data.spawn), else the nearest phone
    const scx = Math.floor(sp.x / CHUNK), scz = Math.floor(sp.z / CHUNK);
    let best = null, bd = Infinity, spawnPhone = null;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const c = this.world.getChunk(scx + dx, scz + dz);
      for (const f of c.features || []) {
        if (f.type !== 'phone') continue;
        if (f.data && f.data.spawn) spawnPhone = f;
        const d = Math.hypot(f.x - sp.x, f.z - sp.z);
        if (d < bd) { bd = d; best = f; }
      }
    }
    const ph = spawnPhone || (bd <= 60 ? best : null);
    if (ph) this.phone = { id: ph.id, x: ph.x, z: ph.z, cx: Math.floor(ph.x / CHUNK), cz: Math.floor(ph.z / CHUNK), virtual: false, spawn: !!spawnPhone, dist: Math.hypot(ph.x - sp.x, ph.z - sp.z) };
    else {
      const s = this._near({ cx: scx + 1, cz: scz, x: sp.x + 16, z: sp.z }, 'phone') || { x: sp.x + 4, z: sp.z, yaw: 0 };
      const f = this._virtual('phone', 'vphone', s, { y: 0.9, ringing: true });
      this.phone = { id: f.id, x: f.x, z: f.z, cx: Math.floor(f.x / CHUNK), cz: Math.floor(f.z / CHUNK), virtual: true, spawn: false, dist: Math.hypot(f.x - sp.x, f.z - sp.z) };
    }

    // pickups
    const items = [];
    const add = (type, p, idx) => {
      const s = this._near(p, type, 0, Infinity, avoid);
      if (!s) return;
      items.push({ id: `${type}-${idx}`, type, idx, x: s.x, y: 0, z: s.z, yaw: s.yaw, taken: false, dist: +s.dist.toFixed(1) });
    };
    plan.airhorns.forEach((p, i) => add('airhorn', p, i));
    plan.almonds.forEach((p, i) => add('almond', p, i));
    plan.notes.forEach((p, i) => add('note', p, i));
    this.items = items;
  }

  // ---- lifecycle ----
  reset(emit = true) {
    const ev = this.g.events;
    if (emit) for (const it of this.items) ev.emit('item:remove', { id: it.id });
    if (emit && this.g.tasks) for (const id of this.g.tasks.done) ev.emit('feature:state', { id, type: 'task', state: 'idle' });
    this.g.tasks?.reset();
    this.check.reset();
    this.inv.reset();
    for (const it of this.items) it.taken = false;
    for (const b of this.breakers) b.on = false;
    this.exit.state = 'locked';
    this.stock.clear();
    this.loreQueue.length = 0;
    this.calmT = 0;
    this.near = [];
    this.scanT = 0;
    this.subKey = '';
    this.ambT = this.rng.range(OBJ.ambientFar[0], OBJ.ambientFar[1]);
    this.stopBeacons();
    const pf = this.phoneFeature();
    if (pf) { pf.answered = false; pf.ringing = true; if (pf.data && typeof pf.data === 'object') pf.data.ringing = true; }
  }

  // full state out to ui / renderer (start and restart)
  publish() {
    const ev = this.g.events;
    for (const it of this.items) if (!it.taken) ev.emit('item:spawn', { id: it.id, type: it.type, x: it.x, y: it.y, z: it.z, yaw: it.yaw });
    for (const b of this.breakers) ev.emit('feature:state', { id: b.id, type: 'breaker', state: b.on ? 'on' : 'off' });
    ev.emit('feature:state', { id: this.exit.id, type: 'exitDoor', state: this.exit.state });
    this._scanTasks();
    this.emitObj();
    this.emitInv();
  }

  _replayChunk(c) {
    if (!c || this.world.cache.get(c.key) !== c) return; // another world (node tests run several games)
    const ev = this.g.events, done = this.g.tasks ? this.g.tasks.done : null;
    for (const f of c.features || []) {
      if (done && done.has(f.id) && !this.breakerIds.has(f.id)) ev.emit('feature:state', { id: f.id, type: 'task', state: 'done' });
      else if (this.breakerIds.has(f.id)) { const b = this.breakerFor(f); ev.emit('feature:state', { id: f.id, type: 'breaker', state: b && b.on ? 'on' : 'off' }); }
      else if (f.id === this.exit.id) ev.emit('feature:state', { id: f.id, type: 'exitDoor', state: this.exit.state });
    }
  }

  // nearby task names (or the breaker panels) under the active checklist step
  _sub() {
    const id = this.check.activeId;
    const r5 = (d) => Math.max(5, Math.round(d / 5) * 5);
    if (id === 'tasks') return this.near.map((t) => ({ text: `${TASK_TEXT[t.kind]?.title || t.kind} (${r5(t.dist)} m)`, done: false }));
    if (id === 'breakers') {
      const p = this.g.player;
      return this.breakers.map((b) => ({ b, d: Math.hypot(b.x - p.x, b.z - p.z) })).sort((a, c) => a.d - c.d)
        .map(({ b, d }) => ({ text: b.on ? 'Breaker panel' : `Breaker panel (${r5(d)} m)`, done: b.on }));
    }
    return null;
  }

  emitObj() {
    const sub = this._sub();
    this.subKey = sub ? sub.map((s) => s.text + s.done).join('|') : '';
    this.g.events.emit('obj:update', { list: this.check.list(sub), activeId: this.check.activeId });
  }

  emitInv() { this.g.events.emit('inv:update', this.inv.snapshot()); }

  phoneFeature() {
    const ph = this.phone;
    if (!ph) return null;
    if (ph.virtual) return this.virtual.find((f) => f.id === ph.id) || null;
    const c = this.world.getChunk(ph.cx, ph.cz);
    return (c.features || []).find((f) => f.id === ph.id) || null;
  }

  breakerFor(f) { return this.breakers.find((b) => b.id === f.id) || null; }
  isBreaker(f) { return this.breakerIds.has(f.id); }
  isExit(f) { return !!this.exit && f.id === this.exit.id; }
  isPhone(f) { return !!this.phone && f.id === this.phone.id; }

  // ---- queued lore: cards open only when nothing is hunting you ----
  _calm() {
    const g = this.g, s = g.director.state;
    return !g.enemy.active && !(g.party && g.party.active) && (s === 'EXPLORING' || s === 'RECOVERY');
  }

  queueLore(card, front = false) {
    if (front) this.loreQueue.unshift(card); else this.loreQueue.push(card);
  }

  // ---- pickups ----
  pick(it, auto) {
    const g = this.g, inv = this.inv;
    if (it.taken) return false;
    const pos = { x: it.x, z: it.z };
    switch (it.type) {
      case 'almond':
        if (!inv.addAlmond()) { if (!auto) g.toast(LINES.almondFull(ITEMS.almondMax), 'info', 2200); return false; }
        g.toast(LINES.almondPick, 'info', 2200);
        g.meme('collect', pos, 0.8);
        break;
      case 'airhorn': {
        const r = inv.addAirhorn();
        if (r === 'full') { if (!auto) g.toast('Airhorn already full. Leave this one for later.', 'info', 2000); return false; }
        g.toast(r === 'new' ? LINES.airhornPick(ITEMS.airhornMax) : LINES.airhornRefill(ITEMS.airhornMax), 'meme', 3000);
        g.meme('collect', pos, 1);
        break;
      }
      case 'note':
        g.audio.sfx('switch', { x: it.x, z: it.z, gain: 0.3 });
        if (!this._calm()) g.toast(LINES.noteQueued, 'info', 2200);
        this.queueLore(NOTES[it.idx % NOTES.length]);
        break;
    }
    it.taken = true;
    g.events.emit('item:remove', { id: it.id });
    if (it.type === 'almond' || it.type === 'airhorn') this.emitInv();
    return true;
  }

  // ---- phone: while the phone step is open, any ringing phone completes it ----
  answerPhone(f) {
    const g = this.g;
    if (this.check.phone || f.type !== 'phone' || f.answered) return false;
    this.check.answerPhone();
    f.answered = true;
    f.ringing = false;
    if (f.data && typeof f.data === 'object') f.data.ringing = false;
    g.events.emit('game:phone', { feature: f, objective: true });
    g.meme('phone', f, 1);
    this.emitObj();
    if (this._calm() && !g.reading) g.openLore(BRIEFING);
    else { this.queueLore(BRIEFING, true); g.toast(LINES.briefingQueued, 'info', 2600); }
    return true;
  }

  // ---- features the objective chain owns: returns true if handled ----
  useFeature(f) {
    const g = this.g;
    if (f.type === 'phone') return this.answerPhone(f);
    if (this.isBreaker(f)) {
      const b = this.breakerFor(f);
      if (b.on) g.toast(LINES.breakerAlready, 'info', 1600);
      else if (!this.check.canBreaker) g.toast(LINES.breakerLocked(this.check.tasks, this.check.nTasks), 'info', 2600);
      else if (g.tasks.open(f, true)) g.director.noise(b.x, b.z, OBJ.noiseHold, 'breaker-open');
      return true;
    }
    if (f.type === 'breaker') { g.toast('A dead breaker. Wrong wing.', 'info', 1800); return true; }
    if (f.type === 'exitDoor') {
      if (!this.isExit(f)) { g.toast('This EXIT is a painting of an EXIT.', 'meme', 2000); return true; }
      if (this.exit.state === 'locked') g.toast(LINES.exitLocked(this.check.breakers, this.check.nBreakers), 'info', 2400);
      else if (this.exit.state === 'powered') this._openExit();
      return true;
    }
    if (f.type === 'vending' || f.type === 'cooler') {
      const vend = f.type === 'vending';
      const left = this.stock.has(f.id) ? this.stock.get(f.id) : vend ? ITEMS.vendingStock : ITEMS.coolerStock;
      if (left <= 0) { g.toast(vend ? LINES.vendingOut : LINES.coolerOut, 'meme', 2000); return true; }
      if (!this.inv.addAlmond()) { g.toast(LINES.almondFull(ITEMS.almondMax), 'info', 2000); return true; }
      this.stock.set(f.id, left - 1);
      g.meme(vend ? 'vending' : 'drink', f, 0.9);
      g.toast(vend ? LINES.vending : LINES.cooler, 'meme', 2200);
      g.events.emit('feature:state', { id: f.id, type: f.type, state: left - 1 });
      this.emitInv();
      return true;
    }
    return false;
  }

  label(f) {
    if (f.type === 'phone' && !this.check.phone) return 'E  Answer the phone';
    if (this.isBreaker(f)) {
      const b = this.breakerFor(f);
      if (b.on) return 'Breaker on';
      if (!this.check.canBreaker) return `Breaker locked (work orders ${this.check.tasks}/${this.check.nTasks})`;
      return 'E  Match the wires (loud)';
    }
    if (f.type === 'breaker') return 'Dead breaker';
    if (f.type === 'exitDoor') {
      if (!this.isExit(f)) return 'EXIT?';
      if (this.exit.state === 'locked') return `EXIT  no power (${this.check.breakers}/${this.check.nBreakers})`;
      return this.exit.state === 'powered' ? 'E  Open the EXIT' : 'Walk through the EXIT';
    }
    if (f.type === 'vending' || f.type === 'cooler') {
      const vend = f.type === 'vending';
      const left = this.stock.has(f.id) ? this.stock.get(f.id) : vend ? ITEMS.vendingStock : ITEMS.coolerStock;
      if (left <= 0) return vend ? 'Sold out' : 'Empty cooler';
      if (this.inv.almond >= ITEMS.almondMax) return `Almond water full (${ITEMS.almondMax}/${ITEMS.almondMax})`;
      return vend ? 'E  Get almond water' : 'E  Fill up (almond water)';
    }
    return null;
  }

  itemLabel(it) {
    switch (it.type) {
      case 'almond': return this.inv.almond >= ITEMS.almondMax ? `Almond water full (${ITEMS.almondMax}/${ITEMS.almondMax})` : 'E  Take almond water';
      case 'airhorn': return this.inv.airhorn >= ITEMS.airhornMax ? 'Airhorn full' : 'E  Take airhorn';
      case 'note': return 'E  Read note';
      default: return null;
    }
  }

  // ---- task results (TaskBoard calls this on success) ----
  onTaskDone(f, kind, breaker, msg) {
    const g = this.g;
    if (breaker) { this._breakerOn(this.breakerFor(f)); return; }
    g.toast(msg, 'meme', 2600);
    const reward = TASK_KINDS[kind]?.reward;
    if (reward === 'almond') {
      if (this.inv.addAlmond()) this.emitInv(); else g.toast(LINES.almondFull(ITEMS.almondMax), 'info', 2000);
    } else if (reward === 'airhorn') {
      if (this.inv.addAirhornCharge()) { this.emitInv(); g.toast(`+1 airhorn charge (${this.inv.airhorn}/${ITEMS.airhornMax}). G to deploy.`, 'info', 2400); }
    }
    const n = this.check.addTask();
    if (n) {
      const title = TASK_TEXT[kind]?.title || kind;
      let line = LINES.orderDone(n, this.check.nTasks, title);
      if (n <= TAPES.length) { this.queueLore(TAPES[n - 1]); line += ` ${LINES.orderTape(n)}`; }
      g.toast(line, 'lore', 3600);
      if (n >= this.check.nTasks) g.toast(LINES.ordersDone, 'lore', 4000);
    }
    this._scanTasks();
    this.emitObj();
  }

  _breakerOn(b) {
    const g = this.g;
    if (!b || b.on) return;
    b.on = true;
    const n = this.check.addBreaker();
    g.events.emit('feature:state', { id: b.id, type: 'breaker', state: 'on' });
    g.meme('breaker', b, 1);
    g.director.noise(b.x, b.z, OBJ.noiseDone, 'breaker-on');
    g.toast(LINES.breakerOn[Math.min(LINES.breakerOn.length - 1, Math.max(0, n - 1))], 'lore', 4200);
    if (this.check.powered) {
      this.exit.state = 'powered';
      g.events.emit('feature:state', { id: this.exit.id, type: 'exitDoor', state: 'powered' });
      g.toast(LINES.exitPowered, 'lore', 4200);
    }
    this.emitObj();
  }

  _openExit() {
    const g = this.g, e = this.exit;
    if (e.state !== 'powered' || !this.check.openExit()) return;
    e.state = 'open';
    g.events.emit('feature:state', { id: e.id, type: 'exitDoor', state: 'open' });
    g.audio.sfx('doorOpen', { x: e.x, z: e.z, gain: 1 });
    g.toast(LINES.exitOpen, 'lore', 2600);
  }

  // ---- items ----
  drink() {
    const g = this.g, p = g.player;
    if (g.useKind) return false;
    const r = this.inv.drink(p.hp, D.maxHp);
    if (r === 'none') { g.toast(LINES.almondNone, 'info', 2200); return false; }
    if (r === 'full') { g.toast(LINES.drinkFull, 'info', 1800); return false; }
    this.emitInv();
    g.meme('drink', p, 0.8);
    g.beginUse('almond', ITEMS.drinkTime);
    return true;
  }

  airhorn() {
    const g = this.g, p = g.player, e = g.enemy;
    if (g.useKind === 'airhorn' || g.airhornCd > 0) return false;
    if (!this.inv.useAirhorn()) { g.toast(LINES.airhornNone, 'info', 2200); return false; }
    this.emitInv();
    g.airhornCd = ITEMS.airhornCooldown;
    g.beginUse('airhorn', ITEMS.airhornTime);
    g.meme('airhorn', p, 1);
    g.impactT = Math.max(g.impactT, 0.3);
    let hit = false;
    if (e.active && e.mode !== 'stun' && !e.fading) {
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d <= ITEMS.airhornRange && this.world.lineOfSight(p.x, p.z, e.x, e.z)) {
        const l = d || 1;
        e.stun(dx / l, dz / l, ITEMS.airhornStun, ITEMS.airhornKnock);
        g.director.onAirhorn(d);
        g.toast(LINES.airhornHit[e.charId] || 'AIRHORNED.', 'meme', 2600);
        hit = true;
      }
    }
    if (!hit) {
      g.toast(LINES.airhornMiss, 'meme', 2000);
      g.director.noise(p.x, p.z, OBJ.noiseAirhorn, 'airhorn');
    }
    g.events.emit('game:airhorn', { hit, charges: this.inv.airhorn });
    return hit;
  }

  // ---- nearby incomplete tasks (checklist sub-items, compass, beacons) ----
  _scanTasks() {
    const g = this.g, p = g.player, board = g.tasks, w = this.world;
    const out = [];
    const consider = (f) => {
      if (f.type !== 'task' || this.breakerIds.has(f.id) || !board.kindOf(f) || board.isDone(f)) return;
      out.push({ f, id: f.id, kind: board.kindOf(f), x: f.x, z: f.z, dist: Math.hypot(f.x - p.x, f.z - p.z) });
    };
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK), R = OBJ.taskScan;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) for (const f of w.getChunk(pcx + dx, pcz + dz).features || []) consider(f);
    for (const f of this.virtual) consider(f);
    out.sort((a, b) => a.dist - b.dist);
    this.near = out.slice(0, 3);
  }

  // ---- per render frame while live ----
  update(dt) {
    const g = this.g, p = g.player;

    // walk-over pickups
    const r2 = ITEMS.autoPick * ITEMS.autoPick;
    for (const it of this.items) {
      if (it.taken) continue;
      const dx = it.x - p.x, dz = it.z - p.z;
      if (dx * dx + dz * dz < r2) this.pick(it, true);
    }

    // powered exit swings open as you approach; reaching it wins
    const ex = this.exit;
    if (ex.state !== 'locked') {
      const d = Math.hypot(ex.x - p.x, ex.z - p.z);
      if (ex.state === 'powered' && d < OBJ.exitOpen) this._openExit();
      if (ex.state === 'open' && d < OBJ.exitWin && g.state === 'playing') {
        if (this.check.win()) { this.emitObj(); g.win(); return; }
      }
    }

    // nearby tasks and the checklist sub-items, once a second
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 1;
      this._scanTasks();
      const sub = this._sub();
      const key = sub ? sub.map((s) => s.text + s.done).join('|') : '';
      if (key !== this.subKey) this.emitObj();
    }

    // lore cards wait for a calm moment
    if (this._calm()) this.calmT += dt; else this.calmT = 0;
    if (this.loreQueue.length && this.calmT >= OBJ.calm && !g.reading) g.openLore(this.loreQueue.shift());

    // distant meme sounds, only while nothing is hunting
    if (g.director.state === 'EXPLORING' && !g.enemy.active && !(g.party && g.party.holds)) {
      this.ambT -= dt;
      if (this.ambT <= 0) {
        this.ambT = this.rng.range(OBJ.ambientFar[0], OBJ.ambientFar[1]);
        const a = this.rng.next() * TAU, d = this.rng.range(24, 40);
        g.meme('ambientFar', { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d }, 0.55);
      }
    }

    this.beaconT -= dt;
    if (this.beaconT <= 0) { this.beaconT = 0.5; this._beacons(); }
  }

  // quiet positional loops on the nearest targets of the active step
  _beacons() {
    const g = this.g, p = g.player, a = g.audio;
    if (typeof a.beacon !== 'function') return;
    const id = this.check.activeId;
    const c = [];
    if (id === 'tasks') for (const t of this.near) c.push(t);
    else if (id === 'breakers') for (const b of this.breakers) if (!b.on) c.push(b);
    else if (id === 'exit') c.push(this.exit);
    const lim = OBJ.beaconRange * OBJ.beaconRange;
    const scored = [];
    for (const t of c) {
      const dx = t.x - p.x, dz = t.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 <= lim) scored.push([d2, t]);
    }
    scored.sort((x, y) => x[0] - y[0]);
    const want = new Set();
    for (let i = 0; i < scored.length && i < OBJ.beaconMax; i++) want.add(scored[i][1].id);
    for (const bid of this.beacons) if (!want.has(bid)) { a.beaconStop?.(bid); this.beacons.delete(bid); }
    for (const [, t] of scored) {
      if (!want.has(t.id) || this.beacons.has(t.id)) continue;
      a.beacon(t.id, t.x, t.z);
      this.beacons.add(t.id);
    }
  }

  stopBeacons() {
    const a = this.g.audio;
    for (const id of this.beacons) a.beaconStop?.(id);
    this.beacons.clear();
  }

  // the active step's nearest target (straight line), or null
  activeTarget(px, pz) {
    const id = this.check.activeId;
    if (id === 'phone') return this.phone;
    if (id === 'exit') return this.exit;
    if (id === 'tasks') return this.near[0] || null;
    let best = null, bd = Infinity;
    if (id === 'breakers') for (const b of this.breakers) { if (b.on) continue; const d = (b.x - px) ** 2 + (b.z - pz) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }

  fillCompass(c, px, pz) {
    const t = this.g.state === 'playing' ? this.activeTarget(px, pz) : null;
    if (!t) { c.active = false; return; }
    const dx = t.x - px, dz = t.z - pz;
    c.active = true;
    c.bearing = Math.atan2(-dx, -dz);
    c.dist = Math.sqrt(dx * dx + dz * dz);
    c.id = this.check.activeId;
  }

  debugLine() {
    const k = this.check;
    return `obj ${k.activeId || 'done'}  phone ${k.phone ? 'y' : 'n'}  orders ${k.tasks}/${k.nTasks}  breakers ${k.breakers}/${k.nBreakers}  exit ${this.exit.state}  near ${this.near.map((t) => t.kind).join(',') || '-'}  almond ${this.inv.almond}  horn ${this.inv.airhorn}  lore q ${this.loreQueue.length}`;
  }
}
