// streamed, deterministic backrooms world data. no three.js.
import { CELL, CHUNK, CELL_TYPE, ACTIVE_RADIUS, DATA_CACHE_MAX, chunkKey, cellOf } from './constants.js';
import { events } from '../core/events.js';
import { hash32 } from '../core/rng.js';
import { generateChunk } from './gen.js';
import { SPAWN_LANE, isSpawnChunk } from './layout.js';

const SLOTS = 64; // direct-mapped hot cache, 8x8 chunks
const DOOR_MOVE_OPEN = 0.6;
const DOOR_SIGHT_OPEN = 0.3;
const DOOR_SPEED = 2.2;
const { EMPTY, WALL, COLUMN, DOOR } = CELL_TYPE;
const SPOT_DX = [1, -1, 0, 0], SPOT_DZ = [0, 0, 1, -1];
// yaw facing away from a wall in direction d (0 +x, 1 -x, 2 +z, 3 -z)
const SPOT_YAW = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];
const LANDMARK_FEATURE = { breaker: 'breaker', exit: 'exitDoor' };

function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export class World {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.cache = new Map();
    this.active = new Set();
    this.pins = new Map();
    this.generatedTotal = 0;
    this.genMs = 0;
    this._pcx = null;
    this._pcz = null;
    this.activeRadius = ACTIVE_RADIUS;
    this._slots = new Array(SLOTS).fill(null);
    this._moving = [];
    this.reserved = new Map(); // chunk key -> 'breaker' | 'exit'
  }

  getChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.cache.get(key);
    if (c) {
      this.cache.delete(key);
      this.cache.set(key, c);
      return c;
    }
    const t0 = performance.now();
    c = generateChunk(this.seed, cx, cz, this.reserved.get(key) || null);
    this.genMs += performance.now() - t0;
    this.generatedTotal++;
    this.cache.set(key, c);
    if (this.cache.size > DATA_CACHE_MAX + 64) this._evict();
    return c;
  }

  // hot path: direct-mapped slot, falls back to the lru map
  _chunk(cx, cz) {
    const s = ((cx & 7) << 3) | (cz & 7);
    const c = this._slots[s];
    if (c !== null && c.cx === cx && c.cz === cz) return c;
    const n = this.getChunk(cx, cz);
    this._slots[s] = n;
    return n;
  }

  cell(ix, iz) {
    const c = this._chunk(ix >> 5, iz >> 5);
    return c.cells[((iz & 31) << 5) | (ix & 31)];
  }

  blocksMove(ix, iz) {
    const c = this._chunk(ix >> 5, iz >> 5);
    const i = ((iz & 31) << 5) | (ix & 31);
    const t = c.cells[i];
    if (t === WALL || t === COLUMN || c.prop[i] === 1) return true;
    if (t === DOOR) return c.doors[c.doorGrid[i] - 1].openT < DOOR_MOVE_OPEN;
    return false;
  }

  blocksSight(ix, iz) {
    const c = this._chunk(ix >> 5, iz >> 5);
    const i = ((iz & 31) << 5) | (ix & 31);
    const t = c.cells[i];
    if (t === WALL || t === COLUMN) return true;
    if (t === DOOR) return c.doors[c.doorGrid[i] - 1].openT < DOOR_SIGHT_OPEN;
    return false;
  }

  lineOfSight(x0, z0, x1, z1) {
    // grid dda in cell units; doubles stay local so the optimiser keeps them unboxed
    const ax = x0 / CELL, az = z0 / CELL, bx = x1 / CELL, bz = z1 / CELL;
    let ix = Math.floor(ax), iz = Math.floor(az);
    const ex = Math.floor(bx), ez = Math.floor(bz);
    const dx = bx - ax, dz = bz - az;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const adx = dx > 0 ? dx : -dx, adz = dz > 0 ? dz : -dz;
    const tdx = adx > 1e-12 ? 1 / adx : 1e30;
    const tdz = adz > 1e-12 ? 1 / adz : 1e30;
    let tmx = adx > 1e-12 ? (sx > 0 ? ix + 1 - ax : ax - ix) * tdx : 1e30;
    let tmz = adz > 1e-12 ? (sz > 0 ? iz + 1 - az : az - iz) * tdz : 1e30;
    const steps = (ex > ix ? ex - ix : ix - ex) + (ez > iz ? ez - iz : iz - ez);
    for (let n = 0; n <= steps && n < 8192; n++) {
      if (this.blocksSight(ix, iz)) return false;
      if (tmx < tmz) {
        tmx += tdx;
        ix += sx;
      } else {
        tmz += tdz;
        iz += sz;
      }
    }
    return true;
  }

  // in the long spawn lane (chunks -1..2 of row 0), looking east (+x) down its length.
  // picks the first spot with walls on both sides and a long clear view ahead.
  spawnPoint() {
    if (this._spawn) return { ...this._spawn };
    const z = ((SPAWN_LANE[0] + SPAWN_LANE[1] + 1) / 2) * CELL;
    const iz = cellOf(z);
    let best = null;
    // prefer chunk 0 so the corridor end (chunk 2) is inside even a radius-2 active set
    for (let k = 0; k < 52; k++) {
      const ix = k < 24 ? k + 2 : 25 - k;
      if (this.blocksMove(ix, iz)) continue;
      if (!this.blocksSight(ix, SPAWN_LANE[0] - 1) || !this.blocksSight(ix, SPAWN_LANE[1] + 1)) continue;
      let run = 0;
      while (run < 90 && !this.blocksSight(ix + run, iz)) run++;
      if (run >= 70) { best = ix; break; }
      if (best === null) best = ix;
    }
    const x = best === null ? 1.25 : (best + 0.5) * CELL;
    this._spawn = { x, z, yaw: -Math.PI / 2 };
    return { ...this._spawn };
  }

  doorAt(ix, iz) {
    const c = this._chunk(ix >> 5, iz >> 5);
    const k = c.doorGrid[((iz & 31) << 5) | (ix & 31)];
    return k === 0 ? null : c.doors[k - 1];
  }

  setDoorTarget(door, open01) {
    const t = open01 < 0 ? 0 : open01 > 1 ? 1 : open01;
    if (door.target === t) return;
    door.target = t;
    if (door.openT !== t && this._moving.indexOf(door) < 0) this._moving.push(door);
  }

  tickDoors(dt) {
    const m = this._moving;
    const step = dt * DOOR_SPEED;
    for (let k = m.length - 1; k >= 0; k--) {
      const d = m[k];
      d.openT = d.openT < d.target ? Math.min(d.target, d.openT + step) : Math.max(d.target, d.openT - step);
      events.emit('world:door', d);
      if (d.openT === d.target) {
        m[k] = m[m.length - 1];
        m.pop();
      }
    }
  }

  setFixture(fixture, on) {
    if (fixture.on === on) return;
    fixture.on = on;
    events.emit('world:fixture', fixture);
  }

  // deterministic item spot: floor cell against a wall, reachable, clear of door swings and
  // landmark fixtures. yaw faces away from the wall. same (seed, chunk, kind, reservations) => same spot.
  findSpot(cx, cz, opts) {
    const kind = (opts && opts.kind) || 'item';
    const c = this.getChunk(cx, cz);
    const { cells, prop } = c;
    const h = hash32(this.seed, cx, cz, strHash(String(kind)), 919);
    const start = h & 1023, d0 = (h >>> 10) & 3;
    const ox = cx * 32, oz = cz * 32;
    for (let k = 0; k < 1024; k++) {
      const i = (start + k * 373) & 1023; // odd stride visits every cell once
      const lx = i & 31, lz = i >> 5;
      if (lx < 1 || lz < 1 || lx > 30 || lz > 30) continue;
      if (cells[i] !== EMPTY || prop[i]) continue;
      let dir = -1;
      for (let s = 0; s < 4; s++) {
        const d = (d0 + s) & 3;
        const t = cells[i + SPOT_DX[d] + SPOT_DZ[d] * 32];
        if (t === WALL || t === COLUMN) { dir = d; break; }
      }
      if (dir < 0) continue;
      // not wedged: open floor on both sides along the wall, 1 m agent fits here, no door within 1 m
      const ax = SPOT_DZ[dir] !== 0 ? 1 : 0, az = 1 - ax;
      const a = i - ax - az * 32, b = i + ax + az * 32;
      if (cells[a] !== EMPTY || prop[a] || cells[b] !== EMPTY || prop[b]) continue;
      const fx = lx - SPOT_DX[dir], fz = lz - SPOT_DZ[dir];
      if (fx < 0 || fz < 0 || fx > 31 || fz > 31 || cells[(fz << 5) | fx] !== EMPTY || prop[(fz << 5) | fx]) continue;
      let door = false;
      for (let zz = lz - 2; zz <= lz + 2 && !door; zz++) for (let xx = lx - 2; xx <= lx + 2; xx++) if (this.cell(ox + xx, oz + zz) === DOOR) { door = true; break; }
      if (door) continue;
      const x = (ox + lx + 0.5) * CELL, z = (oz + lz + 0.5) * CELL;
      let clash = false;
      for (const ft of c.features) {
        if (ft.type !== 'breaker' && ft.type !== 'exitDoor' && ft.type !== 'vending' && ft.type !== 'tv') continue;
        if ((ft.x - x) ** 2 + (ft.z - z) ** 2 < 2.25) { clash = true; break; }
      }
      if (clash) continue;
      return { x, z, yaw: SPOT_YAW[dir] };
    }
    return null;
  }

  // reserve a landmark ('breaker' | 'exit') in a chunk before it is generated. a cached but
  // inactive copy is dropped and regenerated on demand; active chunks can't change (false).
  reserveLandmark(cx, cz, type) {
    if (!LANDMARK_FEATURE[type]) return false;
    const key = chunkKey(cx, cz);
    const cur = this.reserved.get(key);
    if (cur === type) return true;
    if (cur || isSpawnChunk(cx, cz) || this.active.has(key)) return false;
    this.reserved.set(key, type);
    const c = this.cache.get(key);
    if (c) this._drop(key, c);
    return true;
  }

  // [{ type, cx, cz, key, id, x, z, yaw }] with the landmark feature (breaker / exitDoor)
  landmarks() {
    const out = [];
    for (const [key, type] of this.reserved) {
      const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
      const c = this.getChunk(cx, cz);
      const f = c.features.find((t) => t.type === LANDMARK_FEATURE[type]) || null;
      out.push({ type, cx, cz, key, id: f ? f.id : null, x: f ? f.x : (cx + 0.5) * CHUNK, z: f ? f.z : (cz + 0.5) * CHUNK, yaw: f ? f.yaw : 0 });
    }
    return out;
  }

  // task features (type 'task') within r metres of (x, z), nearest first; optional data.kind filter.
  // generates the chunks it looks at (fine at game start, not per frame for big r)
  tasksNear(x, z, r, kind) {
    const out = [];
    const c0 = Math.floor((x - r) / CHUNK), c1 = Math.floor((x + r) / CHUNK);
    const d0 = Math.floor((z - r) / CHUNK), d1 = Math.floor((z + r) / CHUNK);
    for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
      for (const f of this.getChunk(cx, cz).features) {
        if (f.type !== 'task' || (kind && f.data.kind !== kind)) continue;
        const d = Math.hypot(f.x - x, f.z - z);
        if (d <= r) out.push({ feature: f, d });
      }
    }
    out.sort((a, b) => a.d - b.d || (a.feature.id < b.feature.id ? -1 : 1));
    return out.map((e) => e.feature);
  }

  // first task in a chunk (optionally of a kind), or null
  findTask(cx, cz, kind) {
    for (const f of this.getChunk(cx, cz).features) if (f.type === 'task' && (!kind || f.data.kind === kind)) return f;
    return null;
  }

  pin(key, owner) {
    let s = this.pins.get(key);
    if (!s) this.pins.set(key, (s = new Set()));
    s.add(owner);
  }

  unpin(key, owner) {
    const s = this.pins.get(key);
    if (!s) return;
    s.delete(owner);
    if (!s.size) this.pins.delete(key);
  }

  update(px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    if (pcx === this._pcx && pcz === this._pcz) return;
    this._pcx = pcx;
    this._pcz = pcz;
    const R = this.activeRadius;
    const next = new Set();
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) next.add(chunkKey(pcx + dx, pcz + dz));
    for (const key of this.active) {
      if (!next.has(key)) events.emit('world:chunkInactive', this.cache.get(key));
    }
    const added = [];
    // nearest first so consumers can build in a sensible order
    for (let r = 0; r <= R; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const key = chunkKey(pcx + dx, pcz + dz);
          const c = this.getChunk(pcx + dx, pcz + dz);
          if (!this.active.has(key)) added.push(c);
        }
      }
    }
    this.active = next;
    for (const c of added) events.emit('world:chunkActive', c);
    this._evict();
  }

  _evict() {
    if (this.cache.size <= DATA_CACHE_MAX) return;
    for (const [key, c] of this.cache) {
      if (this.cache.size <= DATA_CACHE_MAX) break;
      if (this.active.has(key) || this.pins.has(key)) continue;
      this._drop(key, c);
    }
  }

  _drop(key, c) {
    this.cache.delete(key);
    const s = ((c.cx & 7) << 3) | (c.cz & 7);
    if (this._slots[s] === c) this._slots[s] = null;
    if (this._moving.length) {
      const m = this._moving;
      for (let k = m.length - 1; k >= 0; k--) if (c.doors.indexOf(m[k]) >= 0) { m[k] = m[m.length - 1]; m.pop(); }
    }
  }

  stats() {
    return { cached: this.cache.size, active: this.active.size, pinned: this.pins.size, generatedTotal: this.generatedTotal, genMsAvg: this.generatedTotal ? this.genMs / this.generatedTotal : 0 };
  }
}
