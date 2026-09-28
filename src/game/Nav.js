// bounded distance fields over the cell grid in a window around the player.
// dial's algorithm (bucketed dijkstra) with preallocated typed arrays: no per-build allocation.
// costs in 5 cm units: orthogonal 10, diagonal 14 (only when both orthogonals are free), +2 for cells touching
// a blocked cell (keeps routes off corners). door cells are checked live against the world on every build:
// an open door costs +10; a closed one (not passable, world.blocksMove) costs `closed` extra, or blocks when
// closed < 0. villains never open doors: their fields charge CLOSED_ENEMY (20 m) so they route through another
// open entrance when there is one and otherwise descend to the doorstep and wait (Enemy stops at the door).
// the player can push doors open, so player-side fields (spawn search, bots) use the cheap CLOSED_PLAYER.
import { CELL, CHUNK_CELLS, CELL_TYPE } from '../world/constants.js';

export const UNIT = CELL / 10; // metres per field unit (orthogonal step = 10)
export const INF = 0xffff;
const ORTHO = 10, DIAG = 14, EDGE = 2, DOOR_OPEN = 10;
export const CLOSED_PLAYER = 40, CLOSED_ENEMY = 400, CLOSED_BLOCK = -1;
const NB = 512, NBM = 511; // max step cost 10 + 2 + 400 = 412 < NB
const { WALL, COLUMN, DOOR } = CELL_TYPE;

export const F_PLAYER = 0; // distance from the player
export const F_TARGET = 1; // distance from last known position / search point
export const F_SCRATCH = 2; // spawn validation, bots
export const F_SPAWN = 3; // from the player with doors passable (spawn search: the villain may arrive outside a closed door)

export class Nav {
  // enemy: true makes walkable() treat closed doors as walls (the game's nav); bots walk through them
  constructor(world, size = 192, enemy = false) {
    this.world = world;
    this.enemy = enemy;
    this.S = size;
    this.N = size * size;
    this.grid = new Uint8Array(this.N); // 0 blocked, 1 free, 2 door
    this.edge = new Uint8Array(this.N); // 1 = touches a blocked cell (small cost keeps routes off corners)
    this.fields = [new Uint16Array(this.N), new Uint16Array(this.N), new Uint16Array(this.N), new Uint16Array(this.N)];
    this.fieldOk = new Uint8Array(4);
    this.version = new Uint32Array(4);
    this.poolNode = new Int32Array(this.N * 6);
    this.poolNext = new Int32Array(this.N * 6);
    this.heads = new Int32Array(NB);
    this.cand = new Int32Array(this.N);
    this.rowChunks = new Array(Math.ceil(size / CHUNK_CELLS) + 2).fill(null);
    this.ox = 0;
    this.oz = 0;
    this.ready = false;
    this.margin = Math.floor(size / 6);
    this.stats = { grids: 0, builds: 0, lastMs: 0, maxMs: 0, gridMs: 0 };
  }

  // recentres the window when the player drifts off centre; returns true when fields were invalidated
  ensureWindow(x, z) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    const h = this.S >> 1;
    if (this.ready && Math.abs(ix - (this.ox + h)) < this.margin && Math.abs(iz - (this.oz + h)) < this.margin) return false;
    this.ox = ix - h;
    this.oz = iz - h;
    this._buildGrid();
    this.fieldOk.fill(0);
    this.ready = true;
    return true;
  }

  _buildGrid() {
    const t0 = performance.now();
    const S = this.S, g = this.grid, world = this.world;
    const cx0 = Math.floor(this.ox / CHUNK_CELLS);
    const row = this.rowChunks;
    let rowCz = 0x7fffffff;
    for (let wz = 0; wz < S; wz++) {
      const iz = this.oz + wz;
      const cz = Math.floor(iz / CHUNK_CELLS);
      const lz = iz - cz * CHUNK_CELLS;
      // one chunk lookup per chunk, not per cell row
      if (cz !== rowCz) {
        rowCz = cz;
        for (let k = 0; k < row.length; k++) row[k] = null;
      }
      for (let wx = 0; wx < S; wx++) {
        const i = wz * S + wx;
        if (wx === 0 || wz === 0 || wx === S - 1 || wz === S - 1) { g[i] = 0; continue; }
        const ix = this.ox + wx;
        const cx = Math.floor(ix / CHUNK_CELLS);
        let chunk = row[cx - cx0];
        if (chunk === null) chunk = row[cx - cx0] = world.getChunk(cx, cz);
        const li = lz * CHUNK_CELLS + (ix - cx * CHUNK_CELLS);
        const t = chunk.cells[li];
        g[i] = t === WALL || t === COLUMN || chunk.prop[li] ? 0 : t === DOOR ? 2 : 1;
      }
    }
    // bodies need ~0.6 m: keep only cells that belong to at least one fully open 1 m square (2x2 cells).
    // this drops single-cell slots, diagonal squeezes and prop pockets the world's 1 m clearance never uses.
    for (let wz = 1; wz < S - 1; wz++) {
      for (let wx = 1; wx < S - 1; wx++) {
        const i = wz * S + wx;
        if (g[i] === 0) continue;
        const ok =
          (g[i - 1] !== 0 && g[i - S] !== 0 && g[i - S - 1] !== 0) ||
          (g[i + 1] !== 0 && g[i - S] !== 0 && g[i - S + 1] !== 0) ||
          (g[i - 1] !== 0 && g[i + S] !== 0 && g[i + S - 1] !== 0) ||
          (g[i + 1] !== 0 && g[i + S] !== 0 && g[i + S + 1] !== 0);
        if (!ok) g[i] |= 4;
      }
    }
    for (let i = 0; i < this.N; i++) if (g[i] & 4) g[i] = 0;
    const edge = this.edge;
    edge.fill(0);
    for (let wz = 1; wz < S - 1; wz++) {
      for (let wx = 1; wx < S - 1; wx++) {
        const i = wz * S + wx;
        if (g[i] === 0) continue;
        if (g[i - 1] === 0 || g[i + 1] === 0 || g[i - S] === 0 || g[i + S] === 0 || g[i - S - 1] === 0 || g[i - S + 1] === 0 || g[i + S - 1] === 0 || g[i + S + 1] === 0) edge[i] = 1;
      }
    }
    this.stats.grids++;
    this.stats.gridMs = performance.now() - t0;
  }

  idx(x, z) {
    const wx = Math.floor(x / CELL) - this.ox, wz = Math.floor(z / CELL) - this.oz;
    if (wx < 1 || wz < 1 || wx >= this.S - 1 || wz >= this.S - 1) return -1;
    return wz * this.S + wx;
  }

  cx(i) { return (this.ox + (i % this.S) + 0.5) * CELL; }
  cz(i) { return (this.oz + Math.floor(i / this.S) + 0.5) * CELL; }
  cellIx(i) { return this.ox + (i % this.S); }
  cellIz(i) { return this.oz + Math.floor(i / this.S); }

  _nearestFree(i) {
    const S = this.S, g = this.grid;
    const x0 = i % S, z0 = Math.floor(i / S);
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = x0 + dx, z = z0 + dz;
          if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) continue;
          if (g[z * S + x] !== 0) return z * S + x;
        }
      }
    }
    return -1;
  }

  // is this door cell passable right now (door open enough)?
  doorOpen(i) { return !this.world.blocksMove(this.ox + (i % this.S), this.oz + Math.floor(i / this.S)); }

  build(f, x, z, maxMetres, closed = CLOSED_PLAYER) {
    const t0 = performance.now();
    const field = this.fields[f];
    field.fill(INF);
    this.fieldOk[f] = 0;
    this.version[f]++;
    let src = this.idx(x, z);
    if (src < 0) return false;
    const g = this.grid;
    if (g[src] === 0) src = this._nearestFree(src);
    if (src < 0) return false;
    const S = this.S, heads = this.heads, pn = this.poolNode, px = this.poolNext, cap = pn.length, edge = this.edge;
    const maxD = Math.min(INF - 1, Math.ceil(maxMetres / UNIT));
    heads.fill(-1);
    let top = 0, pending = 0;
    field[src] = 0;
    pn[top] = src; px[top] = -1; heads[0] = top++; pending++;
    let d = 0;
    while (pending > 0 && d <= maxD) {
      const b = d & NBM;
      const e = heads[b];
      if (e === -1) { d++; continue; }
      heads[b] = px[e];
      pending--;
      const i = pn[e];
      if (field[i] !== d) continue;
      const gi = g[i];
      // orthogonal
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - S : i + S;
        const gj = g[j];
        if (gj === 0) continue;
        let door = 0;
        if (gj === 2) {
          if (this.doorOpen(j)) door = DOOR_OPEN;
          else if (closed < 0) continue;
          else door = closed;
        }
        const nd = d + ORTHO + (edge[j] ? EDGE : 0) + door;
        if (nd < field[j] && top < cap) {
          field[j] = nd;
          pn[top] = j; px[top] = heads[nd & NBM]; heads[nd & NBM] = top++; pending++;
        }
      }
      // diagonal, only between free cells with both orthogonals free (no corner cutting, no door corners)
      if (gi === 1) {
        for (let k = 0; k < 4; k++) {
          const sx = k & 1 ? 1 : -1, sz = k & 2 ? S : -S;
          if (g[i + sx] !== 1 || g[i + sz] !== 1) continue;
          const j = i + sx + sz;
          if (g[j] !== 1) continue;
          const nd = d + DIAG + (edge[j] ? EDGE : 0);
          if (nd < field[j] && top < cap) {
            field[j] = nd;
            pn[top] = j; px[top] = heads[nd & NBM]; heads[nd & NBM] = top++; pending++;
          }
        }
      }
    }
    this.fieldOk[f] = 1;
    const ms = performance.now() - t0;
    this.stats.builds++;
    this.stats.lastMs = ms;
    if (ms > this.stats.maxMs) this.stats.maxMs = ms;
    return true;
  }

  valueAt(f, i) {
    if (i < 0 || !this.fieldOk[f]) return INF;
    const field = this.fields[f];
    let v = field[i];
    if (v !== INF) return v;
    // body centre can sit in a cell the grid excluded; use the best neighbour
    const S = this.S;
    v = Math.min(field[i - 1], field[i + 1], field[i - S], field[i + S]);
    return v === INF ? INF : v + ORTHO;
  }

  // navigable metres from the field source to (x, z); Infinity when unknown
  dist(f, x, z) {
    const v = this.valueAt(f, this.idx(x, z));
    return v === INF ? Infinity : v * UNIT;
  }

  // steepest-descent neighbour (towards the field source), -1 at a minimum
  next(f, i) {
    const field = this.fields[f], g = this.grid, S = this.S;
    let best = -1, bv = field[i];
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - S : i + S;
      if (g[j] !== 0 && field[j] < bv) { bv = field[j]; best = j; }
    }
    if (g[i] === 1) {
      for (let k = 0; k < 4; k++) {
        const sx = k & 1 ? 1 : -1, sz = k & 2 ? S : -S;
        if (g[i + sx] !== 1 || g[i + sz] !== 1) continue;
        const j = i + sx + sz;
        // diagonal must beat the orthogonal route by its own cost difference to be worth it
        if (g[j] === 1 && field[j] < bv - 0) { bv = field[j]; best = j; }
      }
    }
    return best;
  }

  // steepest-ascent neighbour (away from the field source), -1 if none
  up(f, i) {
    const field = this.fields[f], g = this.grid, S = this.S;
    let best = -1, bv = field[i];
    if (bv === INF) return -1;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - S : i + S;
      if (g[j] !== 0 && field[j] !== INF && field[j] > bv) { bv = field[j]; best = j; }
    }
    return best;
  }

  _free(x, z) {
    const i = this.idx(x, z);
    if (i < 0) return false;
    const g = this.grid[i];
    return g === 1 || (g === 2 && (!this.enemy || this.doorOpen(i)));
  }

  // enemy-side: is this cell a door the enemy cannot pass right now?
  closedDoor(i) { return this.grid[i] === 2 && !this.doorOpen(i); }

  // straight segment clear for a body of radius r (centre plus both flanks sampled every 0.1 m)
  walkable(x0, z0, x1, z1, r) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) return this._free(x0, z0);
    const ux = dx / len, uz = dz / len;
    const ox = -uz * r, oz = ux * r;
    const steps = Math.ceil(len / 0.1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + dx * t, z = z0 + dz * t;
      if (!this._free(x, z) || !this._free(x + ox, z + oz) || !this._free(x - ox, z - oz)) return false;
    }
    return true;
  }

  // cells whose field distance lies in [minM, maxM] with a full 3x3 of free cells; fills this.cand
  collect(f, minM, maxM) {
    if (!this.fieldOk[f]) return 0;
    const field = this.fields[f], g = this.grid, S = this.S, cand = this.cand;
    const lo = Math.floor(minM / UNIT), hi = Math.ceil(maxM / UNIT);
    let n = 0;
    for (let i = S + 1; i < this.N - S - 1; i++) {
      const v = field[i];
      if (v < lo || v > hi || g[i] !== 1) continue;
      if (g[i - 1] !== 1 || g[i + 1] !== 1 || g[i - S] !== 1 || g[i + S] !== 1) continue;
      if (g[i - S - 1] !== 1 || g[i - S + 1] !== 1 || g[i + S - 1] !== 1 || g[i + S + 1] !== 1) continue;
      cand[n++] = i;
    }
    return n;
  }
}
