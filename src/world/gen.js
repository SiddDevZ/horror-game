// deterministic chunk generator. pure function of (seed, cx, cz); no shared mutable output.
import { CELL, CELL_TYPE, ZONE, chunkKey } from './constants.js';
import { hash32, makeRng } from '../core/rng.js';
import { ARCH, ARCH_NAME, LOW, HIGH, SPAWN_LANE, isSpawnChunk, zoneOf, archOf, edgeV, edgeH } from './layout.js';

const N = 32, NN = 1024, F = 31, FF = F * F;
const EMPTY = CELL_TYPE.EMPTY, WALL = CELL_TYPE.WALL, COLUMN = CELL_TYPE.COLUMN, DOOR = CELL_TYPE.DOOR;
const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
const TILE = 0.6;
const HALF_PI = Math.PI / 2;

// scratch (generation is synchronous, so module-level buffers are safe)
const lock = new Uint8Array(NN); // open-edge approaches: always EMPTY
const reserve = new Uint8Array(NN); // no props here
const roomOf = new Uint8Array(NN);
const cover = new Uint8Array(NN);
const fok = new Uint8Array(FF);
const comp = new Int16Array(FF);
const compSize = new Int16Array(FF + 1);
const q = new Int16Array(4096);
const dist = new Int16Array(FF);
const par = new Int16Array(FF);

const idx = (x, z) => (z << 5) | x;
const clampI = (v) => (v < 1 ? 1 : v > 30 ? 30 : v);
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const yawFacing = (fx, fz) => (fx === 0 && fz === 0 ? 0 : fx === 0 ? (fz < 0 ? 0 : Math.PI) : fx < 0 ? HALF_PI : -HALF_PI);
// wall in direction d (from a floor cell) -> yaw facing away from that wall
const yawAwayFrom = (d) => yawFacing(-DX[d], -DZ[d]);

// ---------- cell edits ----------
function carveRect(g, x0, z0, x1, z1) {
  const c = g.cells;
  const ax = clampI(Math.min(x0, x1)), bx = clampI(Math.max(x0, x1));
  const az = clampI(Math.min(z0, z1)), bz = clampI(Math.max(z0, z1));
  for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
    const i = idx(x, z);
    if (c[i] === WALL || c[i] === COLUMN) c[i] = EMPTY;
  }
}

function wallRect(g, x0, z0, x1, z1, type = WALL, room = 0) {
  const c = g.cells;
  const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(31, Math.max(x0, x1));
  const az = Math.max(0, Math.min(z0, z1)), bz = Math.min(31, Math.max(z0, z1));
  for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
    const i = idx(x, z);
    if (!lock[i] && !reserve[i] && c[i] !== DOOR && roomOf[i] === room) c[i] = type;
  }
}

function allType(g, x0, z0, x1, z1, type) {
  if (x0 < 0 || z0 < 0 || x1 > 31 || z1 > 31) return false;
  const c = g.cells;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (c[idx(x, z)] !== type) return false;
  return true;
}

// room >= 0 also requires every cell to belong to that room (0 = open plan outside rooms/fields)
function allFree(g, x0, z0, x1, z1, room = -1) {
  if (x0 < 0 || z0 < 0 || x1 > 31 || z1 > 31) return false;
  const c = g.cells;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, z);
    if (c[i] !== EMPTY || lock[i] || reserve[i]) return false;
    if (room >= 0 && roomOf[i] !== room) return false;
  }
  return true;
}

// ---------- fat-agent (1 m) connectivity ----------
function computeFok(cells, prop) {
  for (let z = 0; z < F; z++) for (let x = 0; x < F; x++) {
    const i = idx(x, z);
    const a = cells[i], b = cells[i + 1], c = cells[i + 32], d = cells[i + 33];
    fok[z * F + x] = (a === EMPTY || a === DOOR) && (b === EMPTY || b === DOOR) && (c === EMPTY || c === DOOR) && (d === EMPTY || d === DOOR) &&
      !prop[i] && !prop[i + 1] && !prop[i + 32] && !prop[i + 33] ? 1 : 0;
  }
}

function label(g) {
  computeFok(g.cells, g.prop);
  comp.fill(-1);
  let n = 0;
  for (let f = 0; f < FF; f++) {
    if (comp[f] !== -1 || !fok[f]) continue;
    let head = 0, tail = 0, size = 0;
    q[tail++] = f;
    comp[f] = n;
    while (head < tail) {
      const c = q[head++];
      size++;
      const x = c % F;
      if (x > 0 && comp[c - 1] === -1 && fok[c - 1]) { comp[c - 1] = n; q[tail++] = c - 1; }
      if (x < F - 1 && comp[c + 1] === -1 && fok[c + 1]) { comp[c + 1] = n; q[tail++] = c + 1; }
      if (c >= F && comp[c - F] === -1 && fok[c - F]) { comp[c - F] = n; q[tail++] = c - F; }
      if (c < FF - F && comp[c + F] === -1 && fok[c + F]) { comp[c + F] = n; q[tail++] = c + F; }
    }
    compSize[n++] = size;
  }
  return n;
}

function markCover(main) {
  cover.fill(0);
  for (let f = 0; f < FF; f++) {
    if (comp[f] !== main) continue;
    const x = f % F, z = (f / F) | 0, i = idx(x, z);
    cover[i] = cover[i + 1] = cover[i + 32] = cover[i + 33] = 1;
  }
}

const passable = (cells, prop, i) => (cells[i] === EMPTY || cells[i] === DOOR) && !prop[i];

// every opening in one 1 m-agent component, and every walkable cell inside it
function checkValid(g) {
  label(g);
  const main = comp[g.openFat[0]];
  if (main < 0) return false;
  for (let k = 1; k < g.openFat.length; k++) if (comp[g.openFat[k]] !== main) return false;
  markCover(main);
  const { cells, prop } = g;
  for (let i = 0; i < NN; i++) if (!cover[i] && passable(cells, prop, i)) return false;
  return true;
}

// 0-1 bfs over fat cells from component `from` to `main`, carving walls along the way
function connectComp(g, from, main) {
  dist.fill(0x7fff);
  const QM = 4095;
  let head = 2048, tail = 2048;
  for (let f = 0; f < FF; f++) if (comp[f] === from) { dist[f] = 0; par[f] = -1; q[tail++ & QM] = f; }
  const cells = g.cells;
  let hit = -1;
  while (head !== tail) {
    const f = q[head & QM];
    head++;
    if (comp[f] === main) { hit = f; break; }
    const x = f % F, z = (f / F) | 0, df = dist[f];
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], nz = z + DZ[k];
      if (nx < 0 || nz < 0 || nx >= F || nz >= F) continue;
      const nf = nz * F + nx;
      let w = 0;
      if (!fok[nf]) {
        if (nx < 1 || nz < 1 || nx > 29 || nz > 29) continue;
        const i = idx(nx, nz);
        if (cells[i] === DOOR || cells[i + 1] === DOOR || cells[i + 32] === DOOR || cells[i + 33] === DOOR) continue;
        w = 1;
      }
      const nd = df + w;
      if (nd < dist[nf]) {
        dist[nf] = nd;
        par[nf] = f;
        if (w === 0) { head--; q[head & QM] = nf; } else q[tail++ & QM] = nf;
      }
    }
  }
  if (hit < 0) return false;
  for (let f = hit; f !== -1; f = par[f]) {
    if (fok[f]) continue;
    const x = f % F, z = (f / F) | 0;
    carveRect(g, x, z, x + 2, z + 2);
  }
  return true;
}

function removeDoor(g, d) {
  d.dead = true;
  const c = g.cells;
  c[idx(d.lx, d.lz)] = WALL;
  if (d.axis === 'x') c[idx(d.lx + 1, d.lz)] = WALL;
  else c[idx(d.lx, d.lz + 1)] = WALL;
}

function doorCovering(g, i) {
  const x = i & 31, z = i >> 5;
  for (const d of g.doors) {
    if (d.dead) continue;
    if (d.lx === x && d.lz === z) return d;
    if (d.axis === 'x' ? d.lx + 1 === x && d.lz === z : d.lx === x && d.lz + 1 === z) return d;
  }
  return null;
}

function repair(g) {
  const { cells, prop } = g;
  for (let iter = 0; iter < 24; iter++) {
    label(g);
    const main = comp[g.openFat[0]];
    let changed = false;
    for (let k = 1; k < g.openFat.length; k++) {
      const c = comp[g.openFat[k]];
      if (c !== main) { connectComp(g, c, main); changed = true; break; }
    }
    if (changed) continue;
    markCover(main);
    // big stranded pockets get connected, small ones filled
    let big = -1;
    for (let f = 0; f < FF && big < 0; f++) {
      const c = comp[f];
      if (c >= 0 && c !== main && compSize[c] >= 10) big = c;
    }
    if (big >= 0 && connectComp(g, big, main)) continue;
    for (let i = 0; i < NN; i++) {
      if (cover[i] || !passable(cells, prop, i)) continue;
      if (cells[i] === DOOR) {
        const d = doorCovering(g, i);
        if (d) removeDoor(g, d);
        else cells[i] = WALL;
      } else if (lock[i]) {
        g.bad = true;
        continue;
      } else cells[i] = WALL;
      changed = true;
    }
    if (!changed) return true;
  }
  g.bad = true;
  return false;
}

// tiny free-standing wall stubs (<= 1 m^2) left between partition gaps read as clutter: clear them
const seenS = new Uint8Array(NN);
function sweepStubs(g) {
  const c = g.cells;
  seenS.fill(0);
  for (let s = 0; s < NN; s++) {
    if (seenS[s] || c[s] !== WALL) continue;
    let head = 0, tail = 0, keep = false;
    q[tail++] = s;
    seenS[s] = 1;
    while (head < tail) {
      const i = q[head++], x = i & 31, z = i >> 5;
      if (x === 0 || z === 0 || x === 31 || z === 31) keep = true;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx > 31 || nz > 31) continue;
        const j = idx(nx, nz);
        if (c[j] === DOOR || c[j] === COLUMN) keep = true;
        else if (c[j] === WALL && !seenS[j]) { seenS[j] = 1; q[tail++] = j; }
      }
    }
    if (keep || tail > 4) continue;
    for (let k = 0; k < tail; k++) c[q[k]] = EMPTY;
  }
}

// ---------- borders ----------
function initBorder(g, base) {
  const { cells, eN, eS, eW, eE } = g;
  cells.fill(base);
  lock.fill(0);
  reserve.fill(0);
  roomOf.fill(0);
  for (let i = 0; i < 32; i++) {
    if (!eN.open[i] && eN.own[i] === HIGH) cells[idx(i, 0)] = WALL;
    if (!eS.open[i] && eS.own[i] === LOW) cells[idx(i, 31)] = WALL;
    if (!eW.open[i] && eW.own[i] === HIGH) cells[idx(0, i)] = WALL;
    if (!eE.open[i] && eE.own[i] === LOW) cells[idx(31, i)] = WALL;
  }
  const setOpen = (x, z) => { const i = idx(x, z); cells[i] = EMPTY; lock[i] = 1; };
  for (let i = 0; i < 32; i++) {
    for (let d = 0; d < 3; d++) {
      if (eN.open[i]) setOpen(i, d);
      if (eS.open[i]) setOpen(i, 31 - d);
      if (eW.open[i]) setOpen(d, i);
      if (eE.open[i]) setOpen(31 - d, i);
    }
  }
  const of = [];
  for (const [a] of eN.spans) of.push(a);
  for (const [a] of eS.spans) of.push(30 * F + a);
  for (const [a] of eW.spans) of.push(a * F);
  for (const [a] of eE.spans) of.push(a * F + 30);
  g.openFat = of;
}

// ---------- corridor network ----------
function band(rng) {
  const w = rng.chance(0.22) ? rng.int(8, 11) : rng.int(5, 7), a = rng.int(7, 25 - w);
  return [a, a + w - 1];
}

// a second long corridor parallel to the main band, both joined by two connectors: a ladder with a loop
function parallel(g) {
  const { rng } = g;
  const alongX = rng.chance(0.5);
  const main = alongX ? g.bz : g.bx, cross = alongX ? g.bx : g.bz;
  const w = rng.chance(0.25) ? rng.int(8, 10) : rng.int(5, 7);
  const gap = rng.int(5, 8);
  const upMax = main[0] - gap - w, dnMin = main[1] + gap + 1, dnMax = 30 - w;
  const canUp = upMax >= 2, canDn = dnMin <= dnMax;
  if (!canUp && !canDn) return false;
  const up = canUp && (!canDn || rng.chance(0.5));
  const a = up ? rng.int(2, upMax) : rng.int(dnMin, dnMax), b = a + w - 1;
  const s0 = rng.chance(0.6) ? 1 : rng.int(3, 7), s1 = rng.chance(0.6) ? 30 : rng.int(24, 28);
  const band2 = (u0, u1, v0, v1) => (alongX ? carveRect(g, u0, v0, u1, v1) : carveRect(g, v0, u0, v1, u1));
  band2(s0, s1, a, b);
  band2(s0, s1, main[0], main[1]);
  const v0 = up ? b + 1 : main[1] + 1, v1 = up ? main[0] - 1 : a - 1;
  band2(cross[0], cross[1], v0, v1);
  for (let t = 0; t < 8; t++) {
    const cw = rng.int(4, 6), u = rng.int(s0 + 1, s1 - cw);
    if (u + cw - 1 >= cross[0] - 6 && u <= cross[1] + 6) continue;
    band2(u, u + cw - 1, v0, v1);
    break;
  }
  return true;
}

// side: 0 N (+z), 1 S (-z), 2 W (+x), 3 E (-x); u = along the edge, v = depth into the chunk
function uvIdx(side, u, v) {
  if (side === 0) return idx(u, v);
  if (side === 1) return idx(u, 31 - v);
  if (side === 2) return idx(v, u);
  return idx(31 - v, u);
}

function carveUV(g, side, u0, u1, v0, v1) {
  const c = g.cells;
  for (let v = Math.max(1, v0); v <= Math.min(30, v1); v++) for (let u = Math.max(1, u0); u <= Math.min(30, u1); u++) {
    const i = uvIdx(side, u, v);
    if (c[i] === WALL || c[i] === COLUMN) c[i] = EMPTY;
  }
}

function rowHasFloor(g, side, u0, u1, v) {
  const c = g.cells;
  for (let u = u0; u <= u1; u++) if (c[uvIdx(side, u, v)] === EMPTY) return true;
  return false;
}

function probe(g, side, span) {
  const [a, b] = span;
  // already joined?
  if (rowHasFloor(g, side, a, b, 3)) return;
  const hubV = side < 2 ? (side === 0 ? (g.bz[0] + g.bz[1]) >> 1 : 31 - ((g.bz[0] + g.bz[1]) >> 1)) : side === 2 ? (g.bx[0] + g.bx[1]) >> 1 : 31 - ((g.bx[0] + g.bx[1]) >> 1);
  const hubU = side < 2 ? (g.bx[0] + g.bx[1]) >> 1 : (g.bz[0] + g.bz[1]) >> 1;
  let v = 3;
  for (; v <= 29; v++) {
    const hit = rowHasFloor(g, side, a, b, v);
    carveUV(g, side, a, b, v, v);
    if (hit) return;
    if (v >= hubV) break;
  }
  // turn toward the hub along u
  const lw = Math.min(b - a + 1, 6);
  const v0 = Math.max(1, v - lw + 1);
  const dir = hubU >= (a + b) / 2 ? 1 : -1;
  for (let u = dir > 0 ? b + 1 : a - 1; u >= 1 && u <= 30; u += dir) {
    let hit = false;
    for (let vv = v0; vv <= v; vv++) if (g.cells[uvIdx(side, u, vv)] === EMPTY) hit = true;
    carveUV(g, side, u, u, v0, v);
    if (hit) return;
  }
}

function ring(g) {
  const { rng } = g;
  const w = rng.int(6, 10), h = rng.int(6, 10), rw = rng.int(4, 5);
  const x0 = rng.int(1 + rw, 30 - rw - w + 1), z0 = rng.int(1 + rw, 30 - rw - h + 1);
  const x1 = x0 + w - 1, z1 = z0 + h - 1;
  carveRect(g, x0 - rw, z0 - rw, x1 + rw, z0 - 1);
  carveRect(g, x0 - rw, z1 + 1, x1 + rw, z1 + rw);
  carveRect(g, x0 - rw, z0, x0 - 1, z1);
  carveRect(g, x1 + 1, z0, x1 + rw, z1);
}

// ---------- rooms ----------
function roomSpec(kind, rng) {
  if (kind === 'office') return { w: rng.int(6, 11), h: rng.int(6, 9), t: 1, door: rng.chance(0.45) };
  if (kind === 'recovery') return { w: rng.int(4, 6), h: rng.int(4, 5), t: 1, door: true };
  if (kind === 'alcove') return { w: rng.int(4, 8), h: rng.int(2, 4), t: 0, door: false };
  if (kind === 'breakroom') return { w: rng.int(8, 12), h: rng.int(6, 8), t: 1, door: rng.chance(0.4) };
  if (kind === 'cubicles') return { w: rng.int(11, 16), h: rng.int(9, 12), t: 1, door: false };
  if (kind === 'admin') return { w: rng.int(7, 10), h: rng.int(6, 8), t: 1, door: true };
  if (kind === 'copy') return { w: rng.int(5, 7), h: rng.int(4, 6), t: 1, door: rng.chance(0.5) };
  if (kind === 'server') return { w: rng.int(4, 6), h: rng.int(4, 5), t: 1, door: true };
  if (kind === 'restroom') return { w: rng.int(5, 7), h: rng.int(4, 5), t: 1, door: true };
  return { w: rng.int(12, 18), h: rng.int(10, 15), t: rng.chance(0.5) ? 1 : 2, door: false }; // big
}

function addDoor(g, lx, lz, axis, swing) {
  const d = { lx, lz, axis, swing, hinge: g.rng.chance(0.5) ? 1 : -1, open: g.rng.chance(0.4) ? 1 : 0, dead: false };
  g.cells[idx(lx, lz)] = DOOR;
  const ox = axis === 'x' ? 1 : 0, oz = 1 - ox;
  g.cells[idx(lx + ox, lz + oz)] = DOOR;
  // keep the swing and approach clear on both sides
  for (let s = -2; s <= 2; s++) for (let k = 0; k < 2; k++) {
    const x = lx + ox * k + oz * s, z = lz + oz * k + ox * s;
    if (x >= 0 && z >= 0 && x < 32 && z < 32) reserve[idx(x, z)] = 1;
  }
  g.doors.push(d);
  return d;
}

// grow a room into solid wall from a wall face next to walkable floor
const faces = new Int16Array(NN * 4);
function wallFaces(g) {
  const c = g.cells;
  let n = 0;
  for (let z = 1; z < 31; z++) for (let x = 1; x < 31; x++) {
    if (c[idx(x, z)] !== EMPTY) continue;
    for (let d = 0; d < 4; d++) {
      const x3 = x + DX[d] * 3, z3 = z + DZ[d] * 3;
      if (x3 < 0 || z3 < 0 || x3 > 31 || z3 > 31) continue;
      if (c[idx(x + DX[d], z + DZ[d])] === WALL && c[idx(x3, z3)] === WALL) faces[n++] = (idx(x, z) << 2) | d;
    }
  }
  return n;
}

function growRoom(g, kind, tries) {
  const { rng, cells } = g;
  const nf = wallFaces(g);
  if (!nf) return null;
  for (let k = 0; k < tries; k++) {
    const fc = faces[rng.int(0, nf - 1)];
    const x = (fc >> 2) & 31, z = fc >> 7;
    const dir = fc & 3, dx = DX[dir], dz = DZ[dir];
    const s = roomSpec(kind, rng);
    const ax = dz !== 0 ? 1 : 0, az = 1 - ax; // along axis
    const pa = ax ? x : z;
    const off = rng.int(0, s.w - 2);
    const a0 = pa - off, a1 = a0 + s.w - 1;
    // depth steps from the floor cell p: walls 1..t, interior t+1..t+h, back wall t+h+1
    const pv = ax ? z : x, dv = ax ? dz : dx;
    const vi0 = pv + dv * (s.t + 1), vi1 = pv + dv * (s.t + s.h);
    const vw0 = pv + dv, vw1 = pv + dv * (s.t + s.h + 1);
    const rect = (u0, u1, v0, v1) => (ax ? [Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1)] : [Math.min(v0, v1), Math.min(u0, u1), Math.max(v0, v1), Math.max(u0, u1)]);
    const [ix0, iz0, ix1, iz1] = rect(a0, a1, vi0, vi1);
    if (ix0 < 1 || iz0 < 1 || ix1 > 30 || iz1 > 30) continue;
    const [cx0, cz0, cx1, cz1] = rect(a0 - 1, a1 + 1, vw0, vw1);
    if (!allType(g, cx0, cz0, cx1, cz1, WALL)) continue;
    const id = g.rooms.length + 1;
    carveRect(g, ix0, iz0, ix1, iz1);
    for (let zz = iz0; zz <= iz1; zz++) for (let xx = ix0; xx <= ix1; xx++) roomOf[idx(xx, zz)] = id;
    const room = { id, kind, x0: ix0, z0: iz0, x1: ix1, z1: iz1, out: dir ^ 1, door: null };
    const cellUV = (u, v) => idx(ax ? u : v, ax ? v : u);
    let ok = false;
    if (s.t === 0) ok = true;
    else {
      if (s.door) {
        // door cells at depth 1, needs 2-wide floor two deep outside
        for (let t = 0; t < 6 && !ok; t++) {
          const u = t === 0 ? pa : t === 1 ? pa - 1 : rng.int(a0, a1 - 1);
          if (u < a0 || u + 1 > a1) continue;
          let fine = true;
          for (let uu = u; uu <= u + 1 && fine; uu++) {
            if (cells[cellUV(uu, pv)] !== EMPTY || cells[cellUV(uu, pv - dv)] !== EMPTY) fine = false;
            if (cells[cellUV(uu, pv + dv)] !== WALL) fine = false;
          }
          if (!fine) continue;
          const lx = ax ? u : pv + dv, lz = ax ? pv + dv : u;
          room.door = addDoor(g, lx, lz, ax ? 'x' : 'z', ax ? dz : dx);
          ok = true;
        }
      }
      if (!ok) ok = openThrough(g, cellUV, pa, a0, a1, pv, dv, s.t);
    }
    if (!ok) {
      for (let zz = iz0; zz <= iz1; zz++) for (let xx = ix0; xx <= ix1; xx++) roomOf[idx(xx, zz)] = 0;
      wallRect(g, ix0, iz0, ix1, iz1);
      continue;
    }
    g.rooms.push(room);
    return room;
  }
  return null;
}

function openThrough(g, cellUV, pa, a0, a1, pv, dv, t) {
  const { rng, cells } = g;
  for (let tr = 0; tr < 6; tr++) {
    const ow = Math.min(a1 - a0 + 1, rng.int(3, 6));
    const u0 = tr === 0 ? Math.max(a0, Math.min(pa - (ow >> 1), a1 - ow + 1)) : rng.int(a0, a1 - ow + 1);
    let fine = true;
    for (let u = u0; u < u0 + ow && fine; u++) {
      if (cells[cellUV(u, pv)] !== EMPTY) fine = false;
      for (let v = 1; v <= t && fine; v++) {
        const i = cellUV(u, pv + dv * v);
        if (cells[i] !== WALL) fine = false;
        const x = i & 31, z = i >> 5;
        if (x < 1 || z < 1 || x > 30 || z > 30) fine = false;
      }
    }
    if (!fine) continue;
    for (let u = u0; u < u0 + ow; u++) for (let v = 1; v <= t; v++) cells[cellUV(u, pv + dv * v)] = EMPTY;
    return true;
  }
  return false;
}

// punch a second opening from a room through to nearby floor (makes loops and shortcuts)
function extraOpening(g, room) {
  const { rng, cells } = g;
  const sides = [0, 1, 2, 3];
  for (let s = 0; s < 4; s++) {
    const d = sides[(s + rng.int(0, 3)) & 3];
    if (d === room.out) continue;
    const dx = DX[d], dz = DZ[d];
    const along = dz !== 0; // opening spans x when pushing in z
    const lo = along ? room.x0 : room.z0, hi = along ? room.x1 : room.z1;
    const ow = Math.min(hi - lo + 1, rng.int(3, 5));
    const u0 = rng.int(lo, hi - ow + 1);
    const edge = dx > 0 ? room.x1 : dx < 0 ? room.x0 : dz > 0 ? room.z1 : room.z0;
    let depth = -1;
    for (let k = 1; k <= 4; k++) {
      let allFloor = true, allWall = true;
      for (let u = u0; u < u0 + ow; u++) {
        const x = along ? u : edge + dx * k, z = along ? edge + dz * k : u;
        if (x < 1 || z < 1 || x > 30 || z > 30) { allFloor = false; allWall = false; break; }
        const c = cells[idx(x, z)];
        if (c !== EMPTY) allFloor = false;
        if (c !== WALL) allWall = false;
      }
      if (allFloor && k > 1) { depth = k - 1; break; }
      if (!allWall) break;
    }
    if (depth < 1) continue;
    for (let u = u0; u < u0 + ow; u++) for (let k = 1; k <= depth; k++) {
      const x = along ? u : edge + dx * k, z = along ? edge + dz * k : u;
      cells[idx(x, z)] = EMPTY;
    }
    return true;
  }
  return false;
}

// ---------- open-plan pieces ----------
function partition(g) {
  const { rng } = g;
  const horiz = rng.chance(0.5);
  const t = rng.chance(0.6) ? 2 : 1;
  const p = rng.int(5, 26 - t);
  const s0 = rng.chance(0.45) ? 0 : rng.int(4, 12);
  const s1 = rng.chance(0.45) ? 31 : rng.int(19, 27);
  if (horiz) wallRect(g, s0, p, s1, p + t - 1);
  else wallRect(g, p, s0, p + t - 1, s1);
  const gaps = s1 - s0 > 14 ? rng.int(1, 2) : rng.int(0, 1);
  for (let k = 0; k < gaps; k++) {
    const gw = rng.int(4, 7), gp = rng.int(s0 + 1, Math.max(s0 + 1, s1 - gw));
    if (horiz) carveRect(g, gp, p, gp + gw - 1, p + t - 1);
    else carveRect(g, p, gp, p + t - 1, gp + gw - 1);
  }
}

// a lane crossing an open hall keeps reading as a corridor: walls along both sides, a few doorways
function laneWalls(g, alongX) {
  const { rng } = g;
  const e0 = alongX ? g.eW : g.eN, e1 = alongX ? g.eE : g.eS;
  const lane = e0.lane || e1.lane;
  if (!lane) return false;
  const s0 = e0.lane ? 0 : rng.int(3, 8), s1 = e1.lane ? 31 : rng.int(23, 28);
  let n = 0;
  for (const v of [lane[0] - 1, lane[1] + 1]) {
    if (v < 4 || v > 27) continue;
    if (alongX) wallRect(g, s0, v, s1, v);
    else wallRect(g, v, s0, v, s1);
    const gaps = rng.int(1, 2);
    for (let k = 0; k < gaps; k++) {
      const gw = rng.int(4, 7), gp = rng.int(Math.max(s0, 3), Math.min(s1, 28) - gw + 1);
      if (alongX) carveRect(g, gp, v, gp + gw - 1, v);
      else carveRect(g, v, gp, v, gp + gw - 1);
    }
    n++;
  }
  return n > 0;
}

function block(g) {
  const { rng } = g;
  const w = rng.int(2, 6), h = rng.int(2, 8);
  const x = rng.int(4, 28 - w), z = rng.int(4, 28 - h);
  if (!allFree(g, x - 2, z - 2, x + w + 1, z + h + 1, 0)) return;
  wallRect(g, x, z, x + w - 1, z + h - 1);
}

function columns(g, x0, z0, x1, z1, pitch, size, skip, room = 0) {
  const { rng } = g;
  const ox = rng.int(0, pitch - 1), oz = rng.int(0, pitch - 1);
  for (let z = z0 + oz; z + size - 1 <= z1; z += pitch) {
    for (let x = x0 + ox; x + size - 1 <= x1; x += pitch) {
      if (rng.chance(skip)) continue;
      if (!allFree(g, x - 2, z - 2, x + size + 1, z + size + 1, room)) continue;
      wallRect(g, x, z, x + size - 1, z + size - 1, COLUMN, room);
    }
  }
}

// a few large (1-1.5 m) columns, each with 1.5 m of open floor around it
function bigColumns(g, x0, z0, x1, z1, max, room = 0) {
  const { rng } = g;
  const size = rng.chance(0.7) ? 3 : 2, pitch = rng.int(8, 11);
  const ox = rng.int(0, pitch - 1), oz = rng.int(0, pitch - 1);
  let n = 0;
  for (let z = z0 + oz; z + size - 1 <= z1; z += pitch) {
    for (let x = x0 + ox; x + size - 1 <= x1; x += pitch) {
      if (n >= max) return n;
      if (rng.chance(0.2)) continue;
      if (!allFree(g, x - 3, z - 3, x + size + 2, z + size + 2, room)) continue;
      wallRect(g, x, z, x + size - 1, z + size - 1, COLUMN, room);
      n++;
    }
  }
  return n;
}

// open-plan desk area (cubicle pocket without partitions), filled by decorate
function deskField(g) {
  const { rng } = g;
  const w = rng.int(10, 14), h = rng.int(9, 12);
  for (let tr = 0; tr < 8; tr++) {
    const x0 = rng.int(2, 30 - w), z0 = rng.int(2, 30 - h);
    if (!allFree(g, x0 - 1, z0 - 1, x0 + w, z0 + h, 0)) continue;
    g.fields.push({ x0, z0, x1: x0 + w - 1, z1: z0 + h - 1 });
    // tag it so dividers and pockets built later leave it alone
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) roomOf[idx(x, z)] = 255;
    return true;
  }
  return false;
}

const BOX_SIZE = {
  recovery: [4, 6, 4, 5], office: [6, 9, 5, 8], breakroom: [8, 11, 6, 8],
  admin: [7, 9, 6, 8], copy: [5, 7, 4, 6], server: [4, 6, 4, 5], restroom: [5, 7, 4, 5],
};
const DOOR_ROOMS = { recovery: 1, admin: 1, server: 1, restroom: 1 };
// most small rooms stay plain offices; a task room every few chunks
const ROOM_KINDS = ['office', 'office', 'office', 'office', 'office', 'office', 'office', 'office', 'office', 'office', 'admin', 'copy', 'server', 'restroom'];
const pickRoom = (rng) => ROOM_KINDS[rng.int(0, ROOM_KINDS.length - 1)];

// free-standing walled pocket (office, recovery, break room) inside open plan
function buildBox(g, kind) {
  const { rng } = g;
  const sz = BOX_SIZE[kind];
  const w = rng.int(sz[0], sz[1]), h = rng.int(sz[2], sz[3]);
  for (let tr = 0; tr < 12; tr++) {
    const x0 = rng.int(4, 27 - w), z0 = rng.int(4, 27 - h);
    const x1 = x0 + w - 1, z1 = z0 + h - 1;
    if (!allFree(g, x0 - 3, z0 - 3, x1 + 3, z1 + 3, 0)) continue;
    wallRect(g, x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    carveRect(g, x0, z0, x1, z1);
    const id = g.rooms.length + 1;
    for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) roomOf[idx(xx, zz)] = id;
    const side = rng.int(0, 3);
    const room = { id, kind, x0, z0, x1, z1, out: side, door: null };
    const useDoor = DOOR_ROOMS[kind] === 1 || rng.chance(kind === 'breakroom' ? 0.4 : 0.5);
    if (side < 2) {
      const lx = side === 0 ? x1 + 1 : x0 - 1;
      const lz = rng.int(z0, z1 - 1);
      if (useDoor) room.door = addDoor(g, lx, lz, 'z', side === 0 ? -1 : 1);
      else carveRect(g, lx, lz, lx, Math.min(z1, lz + rng.int(2, 3)));
    } else {
      const lz = side === 2 ? z1 + 1 : z0 - 1;
      const lx = rng.int(x0, x1 - 1);
      if (useDoor) room.door = addDoor(g, lx, lz, 'x', side === 2 ? -1 : 1);
      else carveRect(g, lx, lz, Math.min(x1, lx + rng.int(2, 3)), lz);
    }
    g.rooms.push(room);
    return room;
  }
  return null;
}

// reserved landmark room, stamped into an empty open-plan chunk first so it always fits
function landmarkRoom(g, kind) {
  const { rng } = g;
  const exit = kind === 'exit';
  const w = exit ? rng.int(12, 14) : rng.int(8, 10), h = exit ? rng.int(8, 10) : rng.int(6, 8);
  const x0 = ((32 - w) >> 1) + rng.int(-2, 2), z0 = ((32 - h) >> 1) + rng.int(-2, 2);
  const x1 = x0 + w - 1, z1 = z0 + h - 1;
  wallRect(g, x0 - 1, z0 - 1, x1 + 1, z1 + 1);
  carveRect(g, x0, z0, x1, z1);
  const id = g.rooms.length + 1;
  for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) roomOf[idx(xx, zz)] = id;
  const side = rng.int(0, 3);
  const room = { id, kind, x0, z0, x1, z1, out: side, door: null };
  const alongZ = side < 2; // the entrance wall runs along z
  const lo = alongZ ? z0 : x0, hi = alongZ ? z1 : x1;
  const wall = side === 0 ? x1 + 1 : side === 1 ? x0 - 1 : side === 2 ? z1 + 1 : z0 - 1;
  const mid = (lo + hi) >> 1;
  if (exit) {
    // wide open doorway, centred
    const ow = rng.int(4, 6), u0 = mid - (ow >> 1);
    if (alongZ) carveRect(g, wall, u0, wall, u0 + ow - 1);
    else carveRect(g, u0, wall, u0 + ow - 1, wall);
  } else {
    const u = mid + rng.int(-1, 0);
    room.door = alongZ ? addDoor(g, wall, u, 'z', side === 0 ? -1 : 1) : addDoor(g, u, wall, 'x', side === 2 ? -1 : 1);
  }
  // keep the approach outside the entrance free of partitions and props
  for (let k = 1; k <= 3; k++) for (let u = mid - 4; u <= mid + 4; u++) {
    const x = alongZ ? wall + DX[side] * k : u, z = alongZ ? u : wall + DZ[side] * k;
    if (x >= 0 && z >= 0 && x < 32 && z < 32) reserve[idx(x, z)] = 1;
  }
  g.rooms.push(room);
  return room;
}

// ---------- archetype layouts ----------
function layoutCorridor(g) {
  const { rng, eN, eS, eW, eE } = g;
  const bz = eW.lane || eE.lane || band(rng);
  const bx = eN.lane || eS.lane || band(rng);
  g.bz = bz;
  g.bx = bx;
  carveRect(g, same(eW.lane, bz) ? 0 : bx[0], bz[0], same(eE.lane, bz) ? 31 : bx[1], bz[1]);
  carveRect(g, bx[0], same(eN.lane, bx) ? 0 : bz[0], bx[1], same(eS.lane, bx) ? 31 : bz[1]);
  const spawn = isSpawnChunk(g.cx, g.cz);
  if (spawn) for (let x = 0; x < 32; x++) for (let z = SPAWN_LANE[0]; z <= SPAWN_LANE[1]; z++) reserve[idx(x, z)] = 1;
  // big rooms first, while there is still solid wall to grow them into
  let grown = false;
  const lm = rng.next();
  if (lm < 0.06) grown = !!growRoom(g, 'breakroom', 30);
  else if (lm < 0.13) grown = !!growRoom(g, 'cubicles', 30);
  if (rng.chance(0.3)) {
    const r = growRoom(g, 'big', 40);
    if (r) {
      grown = true;
      extraOpening(g, r);
      if (rng.chance(0.55)) bigColumns(g, r.x0, r.z0, r.x1, r.z1, rng.int(1, 4), r.id);
    }
  }
  for (const r of g.rooms) if (r.kind !== 'big') extraOpening(g, r);
  if (!spawn && !grown && rng.chance(0.55)) parallel(g);
  if (!spawn && rng.chance(0.3)) ring(g);
  for (const s of eN.spans) probe(g, 0, s);
  for (const s of eS.spans) probe(g, 1, s);
  for (const s of eW.spans) probe(g, 2, s);
  for (const s of eE.spans) probe(g, 3, s);
  const offices = rng.int(1, 3);
  for (let k = 0; k < offices; k++) {
    const r = growRoom(g, pickRoom(rng), 30);
    if (r && rng.chance(0.3)) extraOpening(g, r);
  }
  if (rng.chance(g.zone === ZONE.OFFICE ? 0.4 : 0.3)) growRoom(g, 'recovery', 40);
  const alcoves = rng.chance(0.6) ? rng.int(1, 2) : 0;
  for (let k = 0; k < alcoves; k++) growRoom(g, 'alcove', 20);
}

// open hall: a couple of long dividers, maybe a walled pocket, a few big columns
function layoutHall(g) {
  const { rng } = g;
  let islands = 0;
  // landmark pockets go in before dividers so they fit
  const lm = rng.next();
  if (lm < 0.07) { if (buildBox(g, 'breakroom')) islands++; } else if (lm < 0.17) deskField(g);
  const walled = rng.chance(0.65) && laneWalls(g, rng.chance(0.5)) ? 1 : 0;
  const parts = walled ? rng.int(0, 1) : rng.int(0, 2);
  for (let k = 0; k < parts; k++) partition(g);
  if (rng.chance(0.1)) block(g);
  if (rng.chance(0.4) && buildBox(g, pickRoom(rng))) islands++;
  if (rng.chance(0.22) && buildBox(g, 'recovery')) islands++;
  // something to circle around keeps the chase loops
  if (rng.chance(0.5) || !islands) bigColumns(g, 2, 2, 29, 29, rng.int(2, 5));
}

// the rare pillar hall: big columns on a wide grid
function layoutColumns(g) {
  const { rng } = g;
  if (rng.chance(0.2)) buildBox(g, 'recovery');
  if (rng.chance(0.35)) partition(g);
  columns(g, 2, 2, 29, 29, rng.int(8, 10), rng.chance(0.6) ? 3 : 2, 0.15);
}

function layoutStorage(g) {
  const { rng } = g;
  const parts = rng.int(0, 2);
  for (let k = 0; k < parts; k++) partition(g);
  if (rng.chance(0.2)) buildBox(g, 'recovery');
  if (rng.chance(0.25)) bigColumns(g, 2, 2, 29, 29, rng.int(1, 3));
}

// one quarter of a 2x2-chunk atrium: open floor, 1.5 m columns on a regular 8 m world grid
function layoutAtrium(g) {
  const { rng } = g;
  // seam corners are always closed; wall all four so a seam crossing is one clean 1 m column, not a random stub
  for (const i of [0, 31, 992, 1023]) g.cells[i] = WALL;
  for (const z of [6, 22]) for (const x of [6, 22]) {
    if (hash32(g.seed, g.ox + x, g.oz + z, 97) % 100 < 15) continue;
    if (allFree(g, x - 2, z - 2, x + 4, z + 4, 0)) wallRect(g, x, z, x + 2, z + 2, COLUMN);
  }
  if (rng.chance(0.18)) buildBox(g, 'recovery');
  if (rng.chance(0.15)) deskField(g);
}

function layoutLandmark(g) {
  const { rng } = g;
  const room = landmarkRoom(g, g.landmark);
  // the exit room and its approach are always lit, even in dark zones
  if (g.landmark === 'exit') g.lit = [room.x0 - 3, room.z0 - 3, room.x1 + 3, room.z1 + 3];
  bigColumns(g, 2, 2, 29, 29, rng.int(1, 3));
}

// ---------- props & features ----------
function localOk(g, x0, z0, x1, z1) {
  const { cells, prop } = g;
  const pass = (x, z) => x >= 0 && z >= 0 && x < 32 && z < 32 && passable(cells, prop, idx(x, z));
  for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    if (x < 0 || z < 0 || x > 31 || z > 31 || !pass(x, z)) continue;
    let ok = false;
    for (let oz = -1; oz <= 0 && !ok; oz++) for (let ox = -1; ox <= 0 && !ok; ox++) {
      if (pass(x + ox, z + oz) && pass(x + ox + 1, z + oz) && pass(x + ox, z + oz + 1) && pass(x + ox + 1, z + oz + 1)) ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

function tryFootprint(g, x0, z0, fw, fd) {
  const x1 = x0 + fw - 1, z1 = z0 + fd - 1;
  if (x0 < 1 || z0 < 1 || x1 > 30 || z1 > 30) return false;
  if (!allFree(g, x0, z0, x1, z1)) return false;
  const p = g.prop;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (p[idx(x, z)]) return false;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) p[idx(x, z)] = 1;
  if (localOk(g, x0, z0, x1, z1) && checkValid(g)) return true;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) p[idx(x, z)] = 0;
  return false;
}

// which side of the footprint is flush against wall (whole side), or -1
function wallSide(g, x0, z0, fw, fd, start) {
  const c = g.cells;
  for (let s = 0; s < 4; s++) {
    const d = (start + s) & 3;
    let ok = true;
    if (d < 2) {
      const x = d === 0 ? x0 + fw : x0 - 1;
      if (x < 0 || x > 31) { ok = false; } else for (let z = z0; z < z0 + fd && ok; z++) if (c[idx(x, z)] !== WALL) ok = false;
    } else {
      const z = d === 2 ? z0 + fd : z0 - 1;
      if (z < 0 || z > 31) { ok = false; } else for (let x = x0; x < x0 + fw && ok; x++) if (c[idx(x, z)] !== WALL) ok = false;
    }
    if (ok) return d;
  }
  return -1;
}

const MEME_MAX = 2; // per chunk: occasional discoveries, not clutter
const canMeme = (g) => g.memes < MEME_MAX;

function feature(g, type, lxm, lzm, yaw, w, d, data = null) {
  if (type === 'meme') g.memes++;
  const f = { id: '', type, x: (g.ox + lxm) * CELL, z: (g.oz + lzm) * CELL, yaw, w, d, data };
  g.features.push(f);
  return f;
}

// place a prop against a wall: `along` cells along the wall, `depth` cells deep
function placeWallProp(g, type, along, depth, w, d, region, tries, data) {
  const { rng } = g;
  for (let t = 0; t < tries; t++) {
    const dir = rng.int(0, 3);
    const fw = dir < 2 ? depth : along, fd = dir < 2 ? along : depth;
    const x0 = region ? rng.int(region.x0, region.x1 - fw + 1) : rng.int(1, 31 - fw);
    const z0 = region ? rng.int(region.z0, region.z1 - fd + 1) : rng.int(1, 31 - fd);
    if (region && (x0 < region.x0 || z0 < region.z0)) continue;
    if (!region && roomOf[idx(x0, z0)]) continue;
    if (wallSide(g, x0, z0, fw, fd, dir) !== dir) continue;
    if (!tryFootprint(g, x0, z0, fw, fd)) continue;
    // centre sits flush to the wall
    const cxm = x0 + fw / 2, czm = z0 + fd / 2;
    const push = (depth * 0.5 - d) / 2 / CELL;
    return feature(g, type, cxm + DX[dir] * push, czm + DZ[dir] * push, yawAwayFrom(dir), w, d, data);
  }
  return null;
}

function placeFreeProp(g, type, fw, fd, w, d, region, tries, yawMode, data) {
  const { rng } = g;
  for (let t = 0; t < tries; t++) {
    const rot = fw !== fd && rng.chance(0.5);
    const aw = rot ? fd : fw, ad = rot ? fw : fd;
    const x0 = region ? rng.int(region.x0, Math.max(region.x0, region.x1 - aw + 1)) : rng.int(1, 31 - aw);
    const z0 = region ? rng.int(region.z0, Math.max(region.z0, region.z1 - ad + 1)) : rng.int(1, 31 - ad);
    if (!region && roomOf[idx(x0, z0)]) continue;
    if (!tryFootprint(g, x0, z0, aw, ad)) continue;
    g.fp = [x0, z0, aw, ad];
    const yaw = yawMode === 'any' ? rng.range(-Math.PI, Math.PI) : (rot ? HALF_PI : 0) + (rng.chance(0.5) ? Math.PI : 0);
    return feature(g, type, x0 + aw / 2, z0 + ad / 2, yaw, w, d, data);
  }
  return null;
}

// longest run of open ceiling (cell and both side neighbours free) along a row, >= 6 cells
function longestRun(g, alongX, at) {
  const c = g.cells;
  const free = (u) => {
    for (let o = -1; o <= 1; o++) {
      const v = at + o;
      if (v < 0 || v > 31) return false;
      if (c[alongX ? idx(u, v) : idx(v, u)] !== EMPTY) return false;
    }
    return true;
  };
  let best = null, start = -1;
  for (let u = 0; u <= 32; u++) {
    if (u < 32 && free(u)) { if (start < 0) start = u; continue; }
    if (start >= 0 && (!best || u - 1 - start > best[1] - best[0])) best = [start, u - 1];
    start = -1;
  }
  return best && best[1] - best[0] + 1 >= 6 ? best : null;
}

// wall-mounted decoration (no footprint): face of a wall next to walkable floor
function wallFace(g, tries, needRoom = -1) {
  const { rng, cells } = g;
  for (let t = 0; t < tries; t++) {
    const x = rng.int(1, 30), z = rng.int(1, 30), i = idx(x, z);
    if (cells[i] !== EMPTY || g.prop[i]) continue;
    if (needRoom >= 0 && roomOf[i] !== needRoom) continue;
    const dir = rng.int(0, 3);
    if (cells[idx(x + DX[dir], z + DZ[dir])] !== WALL) continue;
    if (nearMount(g, x, z, 4)) continue;
    g.mounts.push([x, z]);
    return { x: x + 0.5 + DX[dir] * 0.5, z: z + 0.5 + DZ[dir] * 0.5, yaw: yawAwayFrom(dir), dir };
  }
  return null;
}

function floorSpot(g, tries, pad) {
  const { rng, cells } = g;
  for (let t = 0; t < tries; t++) {
    const x = rng.int(1 + pad, 30 - pad), z = rng.int(1 + pad, 30 - pad);
    let ok = true;
    for (let zz = z - pad; zz <= z + pad && ok; zz++) for (let xx = x - pad; xx <= x + pad && ok; xx++) if (cells[idx(xx, zz)] !== EMPTY) ok = false;
    if (ok) return { x: x + 0.5, z: z + 0.5 };
  }
  return null;
}

// ---------- v2 furniture ----------
const r3 = (v) => Math.round(v * 1000) / 1000;

// table with chairs tucked round its long sides, each facing the table
function placeTable(g, region, tries) {
  const { rng } = g;
  const t = placeFreeProp(g, 'table', 3, 2, 1.2, 0.75, region, tries, 'axis', null);
  if (!t) return null;
  g.hosts.push(t);
  const [x0, z0, aw, ad] = g.fp;
  const alongX = aw > ad;
  const n = rng.int(1, 4);
  for (let k = 0; k < n; k++) {
    const side = k & 1 ? 1 : -1, off = rng.int(0, 1) * 2;
    const x = alongX ? x0 + off : side < 0 ? x0 - 1 : x0 + aw;
    const z = alongX ? (side < 0 ? z0 - 1 : z0 + ad) : z0 + off;
    if (!tryFootprint(g, x, z, 1, 1)) continue;
    feature(g, 'chair', x + 0.5, z + 0.5, yawFacing(alongX ? 0 : -side, alongX ? -side : 0) + rng.range(-0.35, 0.35), 0.45, 0.45, null);
  }
  return t;
}

// small radio on a desk/table top (surface at y)
function radioOn(g, host, off) {
  const c = Math.cos(host.yaw), s = Math.sin(host.yaw);
  const f = feature(g, 'radio', 0, 0, host.yaw, 0.3, 0.14, { y: 0.75 });
  f.x = host.x + c * off;
  f.z = host.z - s * off;
  return f;
}

// rows of desks with a chair each: cubicle floor without partitions
function deskRows(g, r) {
  const { rng } = g;
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const u0 = alongX ? r.x0 : r.z0, u1 = alongX ? r.x1 : r.z1, v0 = alongX ? r.z0 : r.x0, v1 = alongX ? r.z1 : r.x1;
  let desks = 0;
  // every row faces the same way: desk, chair, 1 m aisle, next desk
  const facing = rng.chance(0.5) ? 1 : -1;
  for (let v = v0 + 1; v + 2 <= v1; v += 5) {
    for (let u = u0 + 1; u + 2 <= u1; u += 4) {
      if (rng.chance(0.15)) continue;
      const x = alongX ? u : v, z = alongX ? v : u, fw = alongX ? 3 : 2, fd = alongX ? 2 : 3;
      if (!tryFootprint(g, x, z, fw, fd)) continue;
      const fx = alongX ? 0 : facing, fz = alongX ? facing : 0;
      const d = feature(g, 'desk', x + fw / 2, z + fd / 2, yawFacing(fx, fz), 1.4, 0.7, null);
      g.hosts.push(d);
      desks++;
      // chair on the forward side
      const cx = alongX ? u + 1 : facing > 0 ? x + fw : x - 1, cz = alongX ? (facing > 0 ? z + fd : z - 1) : u + 1;
      if (rng.chance(0.8) && tryFootprint(g, cx, cz, 1, 1)) feature(g, 'chair', cx + 0.5, cz + 0.5, yawFacing(-fx, -fz) + rng.range(-0.6, 0.6), 0.45, 0.45, null);
      const p = rng.next();
      if (p < 0.08) {
        const ph = feature(g, 'phone', 0, 0, d.yaw, 0.22, 0.2, { ringing: true, deskIndex: g.features.indexOf(d) });
        ph.x = d.x;
        ph.z = d.z;
      } else if (p < 0.14) { radioOn(g, d, -0.4); g.busy.add(d); } else if (p < 0.17) onTop(g, 'task', d, 0.15, 0.3, 0.22, { kind: 'timesheet', y: 0.75, deskIndex: g.features.indexOf(d) });
    }
  }
  return desks;
}

function nearMount(g, x, z, r) {
  for (const m of g.mounts) if ((m[0] - x) ** 2 + (m[1] - z) ** 2 < r * r) return true;
  return false;
}

// wall face for a poster: 1.5 m of continuous wall with open floor in front, no door within 1 m
function posterSpot(g, tries, needRoom = -1) {
  const { rng, cells, prop } = g;
  for (let t = 0; t < tries; t++) {
    const x = rng.int(2, 29), z = rng.int(2, 29), i = idx(x, z);
    if (cells[i] !== EMPTY || prop[i]) continue;
    if (needRoom >= 0 && roomOf[i] !== needRoom) continue;
    const d = rng.int(0, 3);
    const wx = x + DX[d], wz = z + DZ[d];
    if (cells[idx(wx, wz)] !== WALL) continue;
    const ax = DZ[d] !== 0 ? 1 : 0, az = 1 - ax;
    let ok = true;
    for (let s = -1; s <= 1 && ok; s++) {
      if (cells[idx(wx + ax * s, wz + az * s)] !== WALL) ok = false;
      const fi = idx(x + ax * s, z + az * s);
      if (cells[fi] !== EMPTY || prop[fi]) ok = false;
    }
    for (let zz = wz - 2; zz <= wz + 2 && ok; zz++) for (let xx = wx - 2; xx <= wx + 2 && ok; xx++) {
      if (xx >= 0 && zz >= 0 && xx < 32 && zz < 32 && cells[idx(xx, zz)] === DOOR) ok = false;
    }
    if (!ok || nearMount(g, x, z, 5)) continue;
    g.mounts.push([x, z]);
    return { x: x + 0.5 + DX[d] * 0.5, z: z + 0.5 + DZ[d] * 0.5, yaw: yawAwayFrom(d) };
  }
  return null;
}

function poster(g, s) {
  const { rng } = g;
  const h = r3(rng.range(0.55, 0.8));
  return feature(g, 'poster', s.x, s.z, s.yaw, r3(h * rng.range(0.68, 0.8)), 0.01, { y: r3(rng.range(1.42, 1.58)), h, v: rng.int(0, 255) });
}

// interior floor cell against the room's back wall (opposite the entrance), t in 0..1 along it
function backWall(room, t) {
  const d = room.out ^ 1;
  const alongX = d >= 2;
  const lo = alongX ? room.x0 : room.z0, hi = alongX ? room.x1 : room.z1;
  const u = Math.round(lo + (hi - lo) * t);
  const v = d === 0 ? room.x1 : d === 1 ? room.x0 : d === 2 ? room.z1 : room.z0;
  const lx = alongX ? u : v, lz = alongX ? v : u;
  return { lx, lz, d, x: lx + 0.5 + DX[d] * 0.5, z: lz + 0.5 + DZ[d] * 0.5, yaw: yawAwayFrom(d) };
}

// no props in a patch in front of a wall spot (depth cells deep, +-half along the wall)
function reserveFront(s, depth, half) {
  const ax = s.d >= 2 ? 1 : 0, az = 1 - ax;
  for (let k = 0; k < depth; k++) for (let u = -half; u <= half; u++) {
    const x = s.lx - DX[s.d] * k + ax * u, z = s.lz - DZ[s.d] * k + az * u;
    if (x >= 0 && z >= 0 && x < 32 && z < 32) reserve[idx(x, z)] = 1;
  }
}

// objective 1: a desk with the ringing phone against the spawn lane wall, ~10-30 m ahead of the spawn.
// it sits flush on the side wall, so the centre of the hero corridor stays clear (2.5 m strip left)
function spawnPhone(g) {
  const { rng } = g;
  const first = rng.chance(0.5) ? 0 : 1, a0 = rng.int(0, 15);
  // preferred window (lane x 21.75-29 m), then a wider one, then close part of a side opening
  for (let pass = 0; pass < 3; pass++) {
    const lo = pass ? 4 : 10, n = pass ? 25 : 16;
    for (let t = 0; t < n * 2; t++) {
      const a = lo + ((a0 + (t >> 1)) % n);
      if (spawnDeskAt(g, (first + (t & 1)) & 1, a, pass === 2)) return true;
    }
  }
  return false;
}

function spawnDeskAt(g, side, a, force) {
  const { cells, prop } = g;
  const wz = side === 0 ? SPAWN_LANE[0] - 1 : SPAWN_LANE[1] + 1; // 0 north wall (-z), 1 south wall (+z)
  const z0 = side === 0 ? SPAWN_LANE[0] : SPAWN_LANE[1] - 1;
  for (let z = z0; z <= z0 + 1; z++) for (let x = a; x <= a + 2; x++) if (cells[idx(x, z)] !== EMPTY || prop[idx(x, z)]) return false;
  const was = [cells[idx(a, wz)], cells[idx(a + 1, wz)], cells[idx(a + 2, wz)]];
  for (let k = 0; k < 3; k++) {
    if (was[k] === WALL) continue;
    if (!force || was[k] !== EMPTY || lock[idx(a + k, wz)] || roomOf[idx(a + k, wz)]) return false;
  }
  for (let k = 0; k < 3; k++) cells[idx(a + k, wz)] = WALL;
  // the lane is reserved for props, so place directly and validate like tryFootprint
  for (let z = z0; z <= z0 + 1; z++) for (let x = a; x <= a + 2; x++) prop[idx(x, z)] = 1;
  if (!localOk(g, a, z0, a + 2, z0 + 1) || !checkValid(g)) {
    for (let z = z0; z <= z0 + 1; z++) for (let x = a; x <= a + 2; x++) prop[idx(x, z)] = 0;
    for (let k = 0; k < 3; k++) cells[idx(a + k, wz)] = was[k];
    return false;
  }
  const dir = side === 0 ? 3 : 2; // wall direction from the desk
  const push = (1 - 0.7) / 2 / CELL;
  const desk = feature(g, 'desk', a + 1.5 + DX[dir] * push, z0 + 1 + DZ[dir] * push, yawAwayFrom(dir), 1.4, 0.7, null);
  const ph = feature(g, 'phone', 0, 0, desk.yaw, 0.22, 0.2, { ringing: true, deskIndex: g.features.indexOf(desk), spawn: true });
  ph.x = desk.x;
  ph.z = desk.z;
  // keep posters/signs off the wall right above it
  g.mounts.push([a + 1, side === 0 ? SPAWN_LANE[0] : SPAWN_LANE[1]]);
  return true;
}

// ---------- v3: task rooms, hallway tasks, meme props ----------
function task(g, kind, lxm, lzm, yaw, w, d, extra) {
  return feature(g, 'task', lxm, lzm, yaw, w, d, extra ? { kind, ...extra } : { kind });
}

// small thing on a desk/table top, offset along the host's width
function onTop(g, type, host, off, w, d, data) {
  const f = feature(g, type, 0, 0, host.yaw, w, d, data);
  f.x = host.x + Math.cos(host.yaw) * off;
  f.z = host.z - Math.sin(host.yaw) * off;
  return f;
}

// card reader on the wall right beside a room's door, outside
function doorReader(g, room) {
  const d = room.door;
  if (!d || d.dead) return null;
  const ox = d.axis === 'x' ? 1 : 0, oz = 1 - ox, out = room.out, dir = out ^ 1;
  for (const k of g.rng.chance(0.5) ? [2, -1] : [-1, 2]) {
    const wx = d.lx + ox * k, wz = d.lz + oz * k, fx = wx + DX[out], fz = wz + DZ[out];
    if (fx < 1 || fz < 1 || fx > 30 || fz > 30 || wx < 0 || wz < 0 || wx > 31 || wz > 31) continue;
    if (g.cells[idx(wx, wz)] !== WALL || g.cells[idx(fx, fz)] !== EMPTY || g.prop[idx(fx, fz)]) continue;
    g.mounts.push([fx, fz]);
    return task(g, 'cardSwipe', fx + 0.5 + DX[dir] * 0.5, fz + 0.5 + DZ[dir] * 0.5, yawAwayFrom(dir), 0.12, 0.04, { y: 1.15, doorIndex: g.doors.indexOf(d) });
  }
  return null;
}

function surfaceMeme(g, host) {
  if (g.busy.has(host) || !canMeme(g)) return null;
  g.busy.add(host);
  const kind = g.rng.chance(0.55) ? 'grimace' : 'stanley';
  return onTop(g, 'meme', host, g.rng.chance(0.5) ? 0.45 : -0.45, 0.12, 0.12, { kind, y: 0.75 });
}

function officeDesk(g, room, timesheet) {
  const { rng } = g;
  const desk = placeWallProp(g, 'desk', 3, 2, 1.4, 0.7, room, 20, null);
  if (!desk) return null;
  g.hosts.push(desk);
  if (rng.chance(0.8)) placeFreeProp(g, 'chair', 1, 1, 0.45, 0.45, room, 6, 'any', null);
  if (!timesheet && rng.chance(0.18)) {
    const ph = feature(g, 'phone', 0, 0, desk.yaw, 0.22, 0.2, { ringing: true, deskIndex: g.features.indexOf(desk) });
    ph.x = desk.x;
    ph.z = desk.z;
  } else if (timesheet) {
    onTop(g, 'task', desk, 0.15, 0.3, 0.22, { kind: 'timesheet', y: 0.75, deskIndex: g.features.indexOf(desk) });
  } else if (rng.chance(0.1)) {
    radioOn(g, desk, -0.4);
    g.busy.add(desk);
  }
  return desk;
}

// first work order: a wiring panel on the spawn lane wall in chunk 1 (~15-30 m ahead, in view)
function spawnTask(g) {
  const { cells, prop } = g;
  for (let a = 29; a >= 3; a--) for (const side of [1, 0]) {
    const wz = side === 0 ? SPAWN_LANE[0] - 1 : SPAWN_LANE[1] + 1, fz = side === 0 ? SPAWN_LANE[0] : SPAWN_LANE[1];
    let ok = true;
    for (let x = a - 1; x <= a + 1 && ok; x++) if (cells[idx(x, wz)] !== WALL || cells[idx(x, fz)] !== EMPTY || prop[idx(x, fz)]) ok = false;
    for (let z = wz - 2; z <= wz + 2 && ok; z++) for (let x = a - 2; x <= a + 2; x++) if (cells[idx(x, z)] === DOOR) { ok = false; break; }
    if (!ok || nearMount(g, a, fz, 5)) continue;
    g.mounts.push([a, fz]);
    const dir = side === 0 ? 3 : 2;
    return task(g, 'wires', a + 0.5, fz + 0.5 + DZ[dir] * 0.5, yawAwayFrom(dir), 0.5, 0.12, { y: 1.35, spawn: true });
  }
  return null;
}

// v4: sigma boy jukebox on a spawn lane side wall, ~8-15 m ahead of spawnPoint(). chunk (0,0) places it
// when the spawn leaves room there, else chunk (1,0) does (it regenerates (0,0) once per seed to find out).
let spawnMemo = null; // { seed, sx: spawn x in world cells (null: behind chunk 0), placed }
const JUKE_W = 1.0, JUKE_D = 0.6;

const sightCell = (g, x, z) => {
  const t = g.cells[idx(x, z)];
  if (t === WALL || t === COLUMN) return true;
  if (t !== DOOR) return false;
  const d = doorCovering(g, idx(x, z));
  return !!d && d.open < 0.3;
};

const LANE_ZC = (SPAWN_LANE[0] + SPAWN_LANE[1] + 1) >> 1;

// clear cells along the lane centre row of a generated chunk (the lane ends inside chunk 2)
function laneRun(c) {
  let n = 0;
  for (; n < N; n++) {
    const i = idx(n, LANE_ZC), t = c.cells[i];
    if (t === WALL || t === COLUMN || (t === DOOR && c.doors[c.doorGrid[i] - 1].openT < 0.3)) break;
  }
  return n;
}

// mirrors World.spawnPoint() within chunk 0: first lane cell (x 2..25, then 1, 0) with sight-blocking walls
// on both sides and 35 m of clear view ahead (chunk 1's lane centre is always open). null: spawn is behind
function spawnCellX(g, lane2) {
  let run = 0;
  const ahead = new Int16Array(N);
  for (let x = N - 1; x >= 0; x--) {
    run = sightCell(g, x, LANE_ZC) ? 0 : x === N - 1 ? 1 + N + lane2 : run + 1;
    ahead[x] = run;
  }
  for (let k = 0; k < 26; k++) {
    const x = k < 24 ? k + 2 : 25 - k;
    const c = g.cells[idx(x, LANE_ZC)];
    if ((c !== EMPTY && c !== DOOR) || g.prop[idx(x, LANE_ZC)]) continue;
    if (sightCell(g, x, SPAWN_LANE[0] - 1) && sightCell(g, x, SPAWN_LANE[1] + 1) && ahead[x] >= 70) return x;
  }
  return null;
}

function spawnJukebox(g) {
  if (g.cx === 0) {
    const sx = spawnCellX(g, g.lane2);
    // spawn behind chunk 0: assume it sits right at the seam
    const s = sx === null ? -0.5 : sx + 0.5;
    const placed = jukeboxIn(g, s, sx === null || sx < 2 ? 99 : sx);
    spawnMemo = { seed: g.seed, sx, placed };
    return placed;
  }
  const m = spawnMemo;
  if (!m || m.seed !== g.seed || m.placed || m.sx === null) return false;
  return jukeboxIn(g, m.sx + 0.5 - N, -1);
}

// s: spawn x in local cells; walls may only be forced past cell `lockX` (cannot move the spawn)
function jukeboxIn(g, s, lockX) {
  const rng = makeRng(hash32(g.seed, g.cx, g.cz, 707));
  const first = rng.chance(0.5) ? 0 : 1;
  const lat = 1.45; // metres from the lane centre to the jukebox centre
  const far = (a) => Math.hypot((a + 1 - s) * CELL, lat);
  const as = [];
  for (let a = 1; a <= 29; a++) as.push(a);
  // closest to ~11 m first, ties broken by the seed
  const jitter = rng.range(-0.6, 0.6);
  as.sort((u, v) => Math.abs(far(u) - 11 - jitter) - Math.abs(far(v) - 11 - jitter) || u - v);
  for (let pass = 0; pass < 3; pass++) {
    const lo = pass ? 8.3 : 9, hi = pass ? 14.7 : 13;
    for (const a of as) {
      const d = far(a);
      if (d < lo || d > hi) continue;
      for (let t = 0; t < 2; t++) if (jukeboxAt(g, (first + t) & 1, a, pass === 2 && a > lockX)) return true;
    }
  }
  return false;
}

function jukeboxAt(g, side, a, force) {
  const { cells, prop } = g;
  const wz = side === 0 ? SPAWN_LANE[0] - 1 : SPAWN_LANE[1] + 1;
  const z0 = side === 0 ? SPAWN_LANE[0] : SPAWN_LANE[1] - 1;
  for (let z = z0; z <= z0 + 1; z++) for (let x = a; x <= a + 1; x++) if (cells[idx(x, z)] !== EMPTY || prop[idx(x, z)]) return false;
  // clear of door swings, the spawn desk and the wall panel/posters on this stretch
  for (let z = wz - 3; z <= wz + 3; z++) for (let x = a - 2; x <= a + 3; x++) {
    if (x >= 0 && z >= 0 && x < N && z < N && cells[idx(x, z)] === DOOR) return false;
  }
  for (let z = z0 - 1; z <= z0 + 2; z++) for (let x = a - 1; x <= a + 2; x++) if (x >= 0 && x < N && prop[idx(x, z)]) return false;
  if (nearMount(g, a + 0.5, side === 0 ? SPAWN_LANE[0] : SPAWN_LANE[1], 3)) return false;
  const was = [cells[idx(a, wz)], cells[idx(a + 1, wz)]];
  for (let k = 0; k < 2; k++) {
    if (was[k] === WALL) continue;
    if (!force || was[k] !== EMPTY || lock[idx(a + k, wz)] || roomOf[idx(a + k, wz)]) return false;
  }
  for (let k = 0; k < 2; k++) cells[idx(a + k, wz)] = WALL;
  for (let z = z0; z <= z0 + 1; z++) for (let x = a; x <= a + 1; x++) prop[idx(x, z)] = 1;
  if (!localOk(g, a, z0, a + 1, z0 + 1) || !checkValid(g)) {
    for (let z = z0; z <= z0 + 1; z++) for (let x = a; x <= a + 1; x++) prop[idx(x, z)] = 0;
    for (let k = 0; k < 2; k++) cells[idx(a + k, wz)] = was[k];
    return false;
  }
  const dir = side === 0 ? 3 : 2;
  const push = (1 - JUKE_D) / 2 / CELL;
  feature(g, 'jukebox', a + 1, z0 + 1 + DZ[dir] * push, yawAwayFrom(dir), JUKE_W, JUKE_D, { spawn: true });
  // disco ball and neon above it: keep posters/panels off this wall stretch
  g.mounts.push([a + 0.5, side === 0 ? SPAWN_LANE[0] : SPAWN_LANE[1]]);
  return true;
}

function decorateBreakroom(g, room) {
  const { rng } = g;
  // counter with the microwave, fridge with the FANUM TAX note, vending (one may be stuck)
  const counter = placeWallProp(g, 'counter', 4, 2, 1.8, 0.6, room, 30, null);
  if (counter) onTop(g, 'task', counter, rng.range(-0.5, 0.5), 0.5, 0.36, { kind: 'microwave', y: 0.9, counterIndex: g.features.indexOf(counter) });
  const fridge = placeWallProp(g, 'fridge', 2, 2, 0.8, 0.75, room, 30, null);
  if (fridge && canMeme(g) && rng.chance(0.5)) {
    const n = feature(g, 'meme', 0, 0, fridge.yaw, 0.2, 0.01, { kind: 'fanumTax', y: 1.3, fridgeIndex: g.features.indexOf(fridge) });
    n.x = fridge.x - Math.sin(fridge.yaw) * (fridge.d / 2 + 0.01);
    n.z = fridge.z - Math.cos(fridge.yaw) * (fridge.d / 2 + 0.01);
  }
  const nv = rng.int(1, 2);
  for (let k = 0; k < nv; k++) {
    const stuck = k === 0 && rng.chance(0.45);
    placeWallProp(g, stuck ? 'task' : 'vending', 2, 2, 0.95, 0.8, room, 30, stuck ? { kind: 'vendingStuck' } : null);
  }
  if (canMeme(g) && rng.chance(0.15)) placeWallProp(g, 'meme', 2, 2, 0.95, 0.8, room, 30, { kind: 'prime' });
  if (rng.chance(0.6)) placeWallProp(g, 'tv', 2, 1, 0.8, 0.5, room, 30, { v: rng.int(0, 255) });
  const nt = rng.int(1, 2);
  for (let k = 0; k < nt; k++) {
    const t = placeTable(g, room, 10);
    if (!t) continue;
    if (k === 0 && rng.chance(0.3)) { radioOn(g, t, 0.35); g.busy.add(t); }
    else if (rng.chance(0.25)) surfaceMeme(g, t);
  }
  if (rng.chance(0.3)) placeWallProp(g, 'cooler', 1, 1, 0.35, 0.35, room, 6, null);
  const s = posterSpot(g, 30, room.id);
  if (s) poster(g, s);
}

const GRAFFITI = ['sus', 'trollface'];

// SUS / trollface sprayed on the wall a little way along from a vent
function ventGraffiti(g, v) {
  const { rng, cells } = g;
  const x = Math.floor(v.x + (v.dir < 2 ? -DX[v.dir] * 0.5 : 0)), z = Math.floor(v.z + (v.dir >= 2 ? -DZ[v.dir] * 0.5 : 0));
  const ax = v.dir >= 2 ? 1 : 0, az = 1 - ax;
  for (const o of rng.chance(0.5) ? [2, -2, 3, -3] : [-2, 2, -3, 3]) {
    const fx = x + ax * o, fz = z + az * o;
    if (fx < 1 || fz < 1 || fx > 30 || fz > 30) continue;
    if (cells[idx(fx, fz)] !== EMPTY || cells[idx(fx + DX[v.dir], fz + DZ[v.dir])] !== WALL || nearMount(g, fx, fz, 3)) continue;
    g.mounts.push([fx, fz]);
    return feature(g, 'meme', fx + 0.5 + DX[v.dir] * 0.5, fz + 0.5 + DZ[v.dir] * 0.5, v.yaw, 0.6, 0.01, { kind: GRAFFITI[rng.int(0, 1)], y: rng.range(0.6, 1.4) });
  }
  return null;
}

function decorateTaskRoom(g, room) {
  const { rng } = g;
  if (room.kind === 'admin') {
    officeDesk(g, room, true);
    if (rng.chance(0.5)) officeDesk(g, room, false);
    if (!doorReader(g, room)) {
      const s = posterSpot(g, 30, room.id);
      if (s) task(g, 'cardSwipe', s.x, s.z, s.yaw, 0.12, 0.04, { y: 1.15 });
    }
    if (rng.chance(0.3)) placeWallProp(g, 'boxes', 2, 1, 0.9, 0.5, room, 6, { count: rng.int(2, 5) });
  } else if (room.kind === 'copy') {
    placeWallProp(g, 'task', 2, 2, 0.9, 0.7, room, 30, { kind: 'copier' });
    if (rng.chance(0.5)) placeWallProp(g, 'boxes', 2, 1, 0.9, 0.5, room, 8, { count: rng.int(2, 5) });
    if (rng.chance(0.2)) doorReader(g, room);
    const s = posterSpot(g, 30, room.id);
    if (s) { if (canMeme(g) && rng.chance(0.2)) feature(g, 'meme', s.x, s.z, s.yaw, 0.5, 0.02, { kind: 'nerd', y: 1.6 }); else poster(g, s); }
  } else if (room.kind === 'server') {
    placeWallProp(g, 'task', 2, 2, 0.7, 0.9, room, 30, { kind: 'router' });
    if (rng.chance(0.2)) {
      const s = posterSpot(g, 30, room.id);
      if (s) task(g, 'wires', s.x, s.z, s.yaw, 0.5, 0.12, { y: 1.35 });
    }
    if (rng.chance(0.2)) doorReader(g, room);
  } else if (room.kind === 'restroom') {
    placeWallProp(g, 'task', 1, 2, 0.45, 0.7, room, 30, { kind: 'skibidi' });
    placeWallProp(g, 'sink', 2, 1, 0.6, 0.45, room, 30, null);
    if (canMeme(g) && rng.chance(0.2)) {
      const s = posterSpot(g, 30, room.id);
      if (s) feature(g, 'meme', s.x, s.z, s.yaw, 0.6, 0.01, { kind: GRAFFITI[rng.int(0, 1)], y: rng.range(1.1, 1.6) });
    }
  }
}

// [kind, cells along the wall, cells deep, w, d, placement]
const FLOOR_MEMES = [
  ['crewmate', 1, 1, 0.4, 0.35, 'wall'], ['grassBlock', 1, 1, 0.5, 0.5, 'free'], ['ohio', 1, 1, 0.55, 0.1, 'wall'],
  ['chillGuy', 2, 1, 0.7, 0.12, 'wall'], ['shrek', 2, 1, 0.8, 0.12, 'wall'], ['chungus', 2, 1, 0.9, 0.15, 'wall'],
  ['doge', 2, 2, 0.8, 0.8, 'free'], ['prime', 2, 2, 0.95, 0.8, 'wall'], ['skibidi', 1, 2, 0.45, 0.7, 'wall'],
  ['nerd', 0, 0, 0.5, 0.02, 'mount'],
];

function memeProps(g) {
  const { rng, arch } = g;
  const n = (rng.chance(0.34) ? 1 : 0) + (arch === ARCH.ATRIUM && rng.chance(0.5) ? 1 : 0);
  for (let k = 0; k < n && canMeme(g); k++) {
    const [kind, along, depth, w, d, mode] = FLOOR_MEMES[rng.int(0, FLOOR_MEMES.length - 1)];
    if (mode === 'mount') {
      const s = posterSpot(g, 64);
      if (s) feature(g, 'meme', s.x, s.z, s.yaw, w, d, { kind, y: 1.6 });
    } else if (mode === 'wall') placeWallProp(g, 'meme', along, depth, w, d, null, 40, { kind });
    else placeFreeProp(g, 'meme', along, depth, w, d, null, 12, 'axis', { kind });
  }
  for (const h of g.hosts) if (rng.chance(0.04)) surfaceMeme(g, h);
}

// hallway task stations: wiring panels (card readers, crooked posters and ladders live elsewhere; no mop task)
function hallwayTasks(g) {
  const { rng, zone } = g;
  if (rng.chance(0.08)) {
    const s = posterSpot(g, 64, 0);
    if (s) task(g, 'wires', s.x, s.z, s.yaw, 0.5, 0.12, { y: 1.35 });
  }
}

// after fixtures exist: a ladder under one hallway light, which now flickers (fixLight)
function fixLightTask(g, fixtures) {
  const rng = makeRng(hash32(g.seed, g.cx, g.cz, 606));
  if (isSpawnChunk(g.cx, g.cz) || !rng.chance(0.055) || !fixtures.length) return;
  for (let t = 0; t < 6; t++) {
    const f = fixtures[rng.int(0, fixtures.length - 1)];
    if (!f.on || g.lit) continue;
    const lx = Math.floor(f.x / CELL) - g.ox, lz = Math.floor(f.z / CELL) - g.oz;
    if (lx < 1 || lz < 1 || lx > 30 || lz > 30 || roomOf[idx(lx, lz)]) continue;
    if (!tryFootprint(g, lx, lz, 1, 1)) continue;
    f.flicker = true;
    task(g, 'fixLight', lx + 0.5, lz + 0.5, rng.chance(0.5) ? 0 : HALF_PI, 0.5, 0.45, { fixtureId: f.id });
    return;
  }
}

const SIGNS = [
  'PLEASE REMAIN CALM', 'NO RUNNING', 'YOU ARE HERE', 'MANDATORY FUN 3PM', 'THIS IS NOT AN EXIT', 'LEVEL 0',
  'MEETING ROOM B', 'DO NOT FEED THE STAFF', 'EMPLOYEE OF THE MONTH: ???', 'NO LOITERING', 'QUIET PLEASE', 'KEEP DOOR CLOSED',
];

function decorate(g) {
  const { rng, zone, arch } = g;
  const hall = arch !== ARCH.CORRIDOR;
  if (g.cx === 1 && g.cz === 0) {
    spawnPhone(g);
    spawnTask(g);
  }
  if (g.cz === 0 && (g.cx === 0 || g.cx === 1)) spawnJukebox(g);
  for (const room of g.rooms) {
    if (room.kind === 'office') {
      if (rng.chance(0.45)) officeDesk(g, room, rng.chance(0.12));
      if (rng.chance(0.05)) doorReader(g, room);
      if (rng.chance(0.15)) placeFreeProp(g, 'chairStack', 2, 2, 0.9, 0.9, room, 6, 'axis', { count: rng.int(3, 6) });
      if (rng.chance(zone === ZONE.MAINT ? 0.5 : 0.12)) placeWallProp(g, 'boxes', 2, 1, 0.9, 0.5, room, 6, { count: rng.int(2, 5) });
    } else if (room.kind === 'big') {
      const n = rng.int(0, 3);
      for (let k = 0; k < n; k++) placeFreeProp(g, 'chair', 1, 1, 0.45, 0.45, room, 6, 'any', null);
      if (rng.chance(0.35)) placeFreeProp(g, 'chairStack', 2, 2, 0.9, 0.9, room, 8, 'axis', { count: rng.int(3, 7) });
      if (rng.chance(0.2)) placeFreeProp(g, 'pile', 4, 3, 2.0, 1.5, room, 8, 'axis', { seed: hash32(g.seed, g.cx, g.cz, 77) });
      if (rng.chance(0.12)) placeFreeProp(g, 'task', 2, 2, 1.0, 1.0, room, 10, 'axis', { kind: 'touchGrass' });
    } else if (room.kind === 'breakroom') {
      decorateBreakroom(g, room);
    } else if (room.kind === 'admin' || room.kind === 'copy' || room.kind === 'server' || room.kind === 'restroom') {
      decorateTaskRoom(g, room);
    } else if (room.kind === 'cubicles') {
      deskRows(g, room);
      if (rng.chance(0.4)) placeWallProp(g, 'boxes', 2, 1, 0.9, 0.5, room, 6, { count: rng.int(2, 5) });
      const s = posterSpot(g, 30, room.id);
      if (s) poster(g, s);
    } else if (room.kind === 'breaker') {
      const s = backWall(room, rng.range(0.3, 0.7));
      // v3: the breaker is also a `wires` task panel
      feature(g, 'breaker', s.x, s.z, s.yaw, 0.45, 0.15, { id: `breaker:${g.cx},${g.cz}`, task: 'wires' });
      g.mounts.push([s.lx, s.lz]);
      reserveFront(s, 3, 1);
      if (rng.chance(0.6)) placeWallProp(g, 'boxes', 2, 1, 0.9, 0.5, room, 8, { count: rng.int(2, 5) });
      if (rng.chance(0.6)) {
        // workbench with the maintenance radio
        const t = placeWallProp(g, 'table', 3, 2, 1.2, 0.75, room, 10, null);
        if (t && rng.chance(0.7)) radioOn(g, t, 0.3);
      }
    } else if (room.kind === 'exit') {
      const s = backWall(room, 0.5);
      feature(g, 'exitDoor', s.x, s.z, s.yaw, 1.6, 0.12, {});
      g.mounts.push([s.lx, s.lz]);
      reserveFront(s, 4, 3);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) placeFreeProp(g, 'chair', 1, 1, 0.45, 0.45, room, 6, 'any', null);
    } else if (room.kind === 'alcove') {
      const r = rng.next();
      if (r < 0.2) placeWallProp(g, 'cooler', 1, 1, 0.35, 0.35, room, 6, null);
      else if (r < 0.4) placeFreeProp(g, 'chair', 1, 1, 0.45, 0.45, room, 4, 'any', null);
    }
  }
  for (const r of g.fields) deskRows(g, r);
  // v2 furniture out in the open (break-room kit also turns up loose, atriums get the most)
  const atrium = arch === ARCH.ATRIUM;
  if (rng.chance(atrium ? 0.5 : hall ? 0.14 : 0.09)) {
    const n = atrium ? rng.int(1, 2) : 1;
    for (let k = 0; k < n; k++) placeWallProp(g, 'vending', 2, 2, 0.95, 0.8, null, 30, null);
  }
  if (rng.chance(atrium ? 0.5 : hall ? 0.08 : 0)) {
    const n = atrium ? rng.int(1, 2) : 1;
    for (let k = 0; k < n; k++) {
      const t = placeTable(g, null, 10);
      if (t && rng.chance(0.3)) { radioOn(g, t, -0.35); g.busy.add(t); }
    }
  }
  if (rng.chance(atrium ? 0.35 : hall ? 0.02 : 0)) placeFreeProp(g, 'task', 2, 2, 1.0, 1.0, null, 12, 'axis', { kind: 'touchGrass' });
  if (rng.chance(atrium ? 0.3 : hall ? 0.1 : 0.06)) placeWallProp(g, 'tv', 2, 1, 0.8, 0.5, null, 30, { v: rng.int(0, 255) });
  // loose stuff in corridors and halls
  if (rng.chance(0.13)) placeWallProp(g, 'cooler', 1, 1, 0.35, 0.35, null, 12, null);
  const chairs = rng.chance(hall ? 0.45 : 0.25) ? rng.int(1, hall ? 3 : 1) : 0;
  for (let k = 0; k < chairs; k++) placeFreeProp(g, 'chair', 1, 1, 0.45, 0.45, null, 8, 'any', null);
  if (rng.chance(hall ? 0.25 : 0.1)) placeWallProp(g, 'chairStack', 2, 2, 0.9, 0.9, null, 10, { count: rng.int(3, 7) });
  if (rng.chance(hall ? 0.14 : 0.05)) placeFreeProp(g, 'pile', 4, 3, 2.0, 1.5, null, 10, 'axis', { seed: hash32(g.seed, g.cx, g.cz, 78) });
  if (zone === ZONE.MAINT) {
    if (arch === ARCH.STORAGE) {
      // shelf rows with aisles
      const alongX = rng.chance(0.5);
      for (let r = 3 + rng.int(0, 2); r < 28; r += rng.int(4, 5)) {
        for (let s = 2 + rng.int(0, 3); s < 26; s += rng.int(6, 8)) {
          const len = rng.int(3, 5);
          const x0 = alongX ? s : r, z0 = alongX ? r : s;
          const fw = alongX ? len : 1, fd = alongX ? 1 : len;
          if (tryFootprint(g, x0, z0, fw, fd)) feature(g, 'shelf', x0 + fw / 2, z0 + fd / 2, alongX ? 0 : HALF_PI, len * 0.5 - 0.1, 0.45, { levels: 4 });
        }
      }
    } else {
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) placeWallProp(g, 'shelf', 4, 1, 1.9, 0.45, null, 10, { levels: 4 });
    }
    const boxes = rng.int(2, 5);
    for (let k = 0; k < boxes; k++) placeFreeProp(g, 'boxes', 1 + rng.int(0, 1), 1 + rng.int(0, 1), 0.8, 0.8, null, 6, 'axis', { count: rng.int(1, 4) });
    const pipes = rng.int(1, 2);
    for (let k = 0; k < pipes; k++) {
      const alongX = rng.chance(0.5);
      const at = rng.int(2, 29);
      const run = longestRun(g, alongX, at);
      if (!run) continue;
      const mid = (run[0] + run[1] + 1) / 2, len = (run[1] - run[0] + 1) * CELL;
      feature(g, 'pipes', alongX ? mid : at + 0.5, alongX ? at + 0.5 : mid, alongX ? 0 : HALF_PI, len, 0.3, { y: 2.55, count: rng.int(1, 3) });
    }
  }
  hallwayTasks(g);
  memeProps(g);
  // wall decorations
  if (rng.chance(0.16)) {
    const s = wallFace(g, 20);
    if (s) feature(g, 'sign', s.x, s.z, s.yaw, 0.6, 0.03, { text: SIGNS[rng.int(0, SIGNS.length - 1)], y: 1.6 });
  }
  const vents = rng.chance(zone === ZONE.MAINT ? 0.6 : 0.3) ? 1 : 0;
  for (let k = 0; k < vents; k++) {
    const s = wallFace(g, 20);
    if (!s) continue;
    feature(g, 'vent', s.x, s.z, s.yaw, 0.5, 0.04, { mount: 'wall', y: 0.35 });
    if (canMeme(g) && rng.chance(0.12)) ventGraffiti(g, s);
  }
  for (const room of g.rooms) {
    if (!room.door || !rng.chance(0.25)) continue;
    const d = room.door;
    const ox = d.axis === 'x' ? 1 : 0.5, oz = d.axis === 'x' ? 0.5 : 1;
    // outward = away from the room
    const out = room.out;
    feature(g, 'exitSign', d.lx + ox, d.lz + oz, yawFacing(DX[out], DZ[out]), 0.35, 0.1, { mount: 'ceiling', doorIndex: g.doors.indexOf(d) });
  }
  if (rng.chance(0.04)) {
    const s = wallFace(g, 20);
    if (s) feature(g, 'exitSign', s.x, s.z, s.yaw, 0.35, 0.1, { mount: 'wall', y: 2.2 });
  }
  // meme posters: a regular sight, not wallpaper
  const posters = (rng.chance(0.7) ? 1 : 0) + (zone === ZONE.OFFICE && rng.chance(0.35) ? 1 : 0) + (atrium ? 1 : 0);
  for (let k = 0; k < posters; k++) {
    const s = posterSpot(g, 64);
    if (!s) continue;
    const p = poster(g, s);
    // crooked poster: the `straighten` hallway task
    if (rng.chance(0.07)) {
      p.data.crooked = r3((rng.chance(0.5) ? 1 : -1) * rng.range(0.12, 0.3));
      task(g, 'straighten', s.x, s.z, s.yaw, p.w, 0.02, { y: p.data.y, posterIndex: g.features.indexOf(p) });
    }
  }
  // floor decals
  const stains = rng.int(0, 2);
  for (let k = 0; k < stains; k++) {
    const s = floorSpot(g, 10, 0);
    if (s) feature(g, 'stain', s.x, s.z, rng.range(-Math.PI, Math.PI), rng.range(0.4, 1.3), rng.range(0.3, 1.0), { v: rng.int(0, 3) });
  }
  // recovery alcoves
  for (const room of g.rooms) {
    if (room.kind !== 'recovery' || !room.door || room.door.dead) continue;
    const out = room.out;
    const x0 = (g.ox + room.x0) * CELL, z0 = (g.oz + room.z0) * CELL, x1 = (g.ox + room.x1 + 1) * CELL, z1 = (g.oz + room.z1 + 1) * CELL;
    const sideways = out < 2; // facing +-x: local right axis is z
    feature(g, 'recovery', (room.x0 + room.x1 + 1) / 2, (room.z0 + room.z1 + 1) / 2, yawFacing(DX[out], DZ[out]),
      sideways ? z1 - z0 : x1 - x0, sideways ? x1 - x0 : z1 - z0, { x0, z0, x1, z1, doorIndex: g.doors.indexOf(room.door) });
  }
}

// ---------- ceiling fixtures (0.6 m world tile grid) ----------
function lightFree(cells, x, z) {
  return x >= 0 && z >= 0 && x < 32 && z < 32 && cells[idx(x, z)] === EMPTY;
}

function spanAxis(cells, x, z, ax) {
  // returns [lo, hi, closedLo, closedHi] of free cells along the axis through (x, z)
  let lo = ax ? x : z, hi = lo;
  const at = (v) => (ax ? lightFree(cells, v, z) : lightFree(cells, x, v));
  while (lo - 1 >= 0 && at(lo - 1)) lo--;
  while (hi + 1 <= 31 && at(hi + 1)) hi++;
  return [lo, hi, lo - 1 >= 0, hi + 1 <= 31];
}

function rectFree(g, x, z, sx, sz) {
  const m = 0.3, e = 1e-6;
  const a = Math.floor((x - sx / 2 - m) / CELL + e) - g.ox, b = Math.floor((x + sx / 2 + m) / CELL - e) - g.ox;
  const c = Math.floor((z - sz / 2 - m) / CELL + e) - g.oz, d = Math.floor((z + sz / 2 + m) / CELL - e) - g.oz;
  if (a < -3 || c < -3 || b > 34 || d > 34) return false;
  for (let zz = c; zz <= d; zz++) for (let xx = a; xx <= b; xx++) {
    const inX = xx >= 0 && xx <= 31, inZ = zz >= 0 && zz <= 31;
    if (inX && inZ) { if (g.cells[idx(xx, zz)] !== EMPTY) return false; continue; }
    // the neighbour's first 3 cells behind an open edge span are guaranteed floor
    if (inX === inZ) return false;
    const e = inZ ? (xx < 0 ? g.eW : g.eE) : zz < 0 ? g.eN : g.eS;
    if (!e.open[inZ ? zz : xx]) return false;
  }
  return true;
}

const snapTile = (c, s) => Math.round((c - s / 2) / TILE) * TILE + s / 2;

// narrow walled span through (lx, lz) along an axis; if a side opening breaks it here,
// borrow the span from a nearby row/column so corridor lights stay on the centre line
function narrowSpan(cells, lx, lz, ax) {
  for (let k = 0; k <= 8; k++) {
    const o = (k & 1 ? 1 : -1) * ((k + 1) >> 1);
    const x = ax ? lx : lx + o, z = ax ? lz + o : lz;
    if (!lightFree(cells, x, z)) continue;
    const [lo, hi, cl, ch] = spanAxis(cells, x, z, ax);
    const here = ax ? lx : lz;
    if (cl && ch && hi - lo + 1 <= 10 && here >= lo && here <= hi) return [lo, hi];
  }
  return null;
}

function tryFixture(g, wx, wz, placed) {
  const lx = Math.floor(wx / CELL) - g.ox, lz = Math.floor(wz / CELL) - g.oz;
  if (!lightFree(g.cells, lx, lz)) return null;
  // corridor direction = axis with the longer free run; only the cross axis may borrow a span
  const dx = spanAxis(g.cells, lx, lz, 1), dz = spanAxis(g.cells, lx, lz, 0);
  const narrow = (sp) => (sp[2] && sp[3] && sp[1] - sp[0] + 1 <= 10 ? [sp[0], sp[1]] : null);
  const alongX = dx[1] - dx[0] >= dz[1] - dz[0];
  const sxs = alongX ? narrow(dx) : narrowSpan(g.cells, lx, lz, 1);
  const szs = alongX ? narrowSpan(g.cells, lx, lz, 0) : narrow(dz);
  const snapX = !!sxs, snapZ = !!szs;
  const cxm = snapX ? (g.ox + (sxs[0] + sxs[1] + 1) / 2) * CELL : wx;
  const czm = snapZ ? (g.oz + (szs[0] + szs[1] + 1) / 2) * CELL : wz;
  // long side across the corridor, like the reel
  const sx = snapX && !snapZ ? 1.2 : 0.6, sz = sx === 1.2 ? 0.6 : 1.2;
  const bx = snapTile(cxm, sx), bz = snapTile(czm, sz);
  for (let k = 0; k < 9; k++) {
    const x = bx + TILE * (k % 3 === 1 ? -1 : k % 3 === 2 ? 1 : 0);
    const z = bz + TILE * (k < 3 ? 0 : k < 6 ? -1 : 1);
    if (x < g.lim[0] || x > g.lim[1] || z < g.lim[2] || z > g.lim[3]) continue;
    if (!rectFree(g, x, z, sx, sz)) continue;
    let near = false;
    for (const f of placed) if ((f.x - x) ** 2 + (f.z - z) ** 2 < 2.6 * 2.6) { near = true; break; }
    if (near) continue;
    return { x, z, sx, sz };
  }
  return null;
}

function inLit(g, x, z) {
  if (!g.lit) return false;
  const lx = Math.floor(x / CELL) - g.ox, lz = Math.floor(z / CELL) - g.oz;
  return lx >= g.lit[0] && lx <= g.lit[2] && lz >= g.lit[1] && lz <= g.lit[3];
}

function placeFixtures(g) {
  const rng = makeRng(hash32(g.seed, g.cx, g.cz, 505));
  const out = [];
  const zone = g.zone;
  const x0 = g.ox * CELL, z0 = g.oz * CELL;
  // world lattice every 3.0 m (5 tiles), owned by the chunk containing the lattice point
  const kx0 = Math.ceil((x0 - 1.5) / 3), kz0 = Math.ceil((z0 - 1.5) / 3);
  // stay within 0.6 m of this chunk's own first/last lattice lines: >= 1.8 m to any neighbour's lights
  const kx1 = Math.ceil((x0 + 16 - 1.5) / 3) - 1, kz1 = Math.ceil((z0 + 16 - 1.5) / 3) - 1;
  const e = 1e-6;
  g.lim = [Math.max(x0, kx0 * 3 + 0.9), Math.min(x0 + 16 - e, kx1 * 3 + 2.1), Math.max(z0, kz0 * 3 + 0.9), Math.min(z0 + 16 - e, kz1 * 3 + 2.1)];
  const offs = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]];
  // pass 0: lattice points as-is (keeps the regular pitch); pass 1: nudged fill-ins
  for (let pass = 0; pass < 2; pass++) for (let kz = kz0; kz * 3 + 1.5 < z0 + 16; kz++) {
    for (let kx = kx0; kx * 3 + 1.5 < x0 + 16; kx++) {
      const px = kx * 3 + 1.5, pz = kz * 3 + 1.5;
      for (let o = pass; o < (pass ? offs.length : 1); o++) {
        const [ox, oz] = offs[o];
        const f = tryFixture(g, px + ox, pz + oz, out);
        if (!f) continue;
        const lit = inLit(g, f.x, f.z);
        if (!lit && rng.chance(0.012) && !isSpawnChunk(g.cx, g.cz)) {
          g.features.push({ id: '', type: 'darkTile', x: f.x, z: f.z, yaw: 0, w: f.sx, d: f.sz, data: { hole: true } });
          break;
        }
        // well lit: a dead panel is a rare surprise, flicker stays rare (fixLight tasks add a few)
        const on = !rng.chance(0.002) || lit;
        const flicker = on && rng.chance(zone === ZONE.OFFICE ? 0.01 : 0.03) && !lit;
        out.push({ id: '', x: f.x, z: f.z, sx: f.sx, sz: f.sz, intensity: Math.round(rng.range(0.85, 1.1) * 1000) / 1000, on, flicker });
        break;
      }
    }
  }
  // missing ceiling tiles between fixtures
  const tiles = rng.chance(zone === ZONE.OFFICE ? 0.3 : 0.6) ? rng.int(1, 2) : 0;
  for (let k = 0; k < tiles; k++) {
    const x = snapTile(x0 + rng.range(1, 15), 0.6), z = snapTile(z0 + rng.range(1, 15), 0.6);
    if (x < x0 || z < z0 || x >= x0 + 16 || z >= z0 + 16 || !rectFree(g, x, z, 0.6, 0.6) || inLit(g, x, z)) continue;
    let near = false;
    for (const f of out) if (Math.abs(f.x - x) < 1.0 && Math.abs(f.z - z) < 1.0) near = true;
    if (!near) g.features.push({ id: '', type: 'darkTile', x, z, yaw: 0, w: 0.6, d: 0.6, data: null });
  }
  return out;
}

const HOST_KEYS = ['deskIndex', 'counterIndex', 'fridgeIndex', 'posterIndex'];

// ---------- entry ----------
// landmark: null | 'breaker' | 'exit' (reserved chunks; edges never depend on it)
export function generateChunk(seed, cx, cz, landmark = null) {
  if (landmark !== 'breaker' && landmark !== 'exit') landmark = null;
  // the spawn jukebox in (1,0) depends on where (0,0) put the spawn
  if (cx === 1 && cz === 0 && !(spawnMemo && spawnMemo.seed === seed)) generateChunk(seed, 0, 0);
  const lane2 = cx === 0 && cz === 0 ? laneRun(generateChunk(seed, 2, 0)) : 0;
  // edges come from the plain archetype; the landmark only changes the interior
  const edgeArch = archOf(seed, cx, cz);
  const zone = landmark === 'breaker' ? ZONE.MAINT : zoneOf(seed, cx, cz);
  const arch = landmark === 'breaker' ? ARCH.STORAGE : landmark === 'exit' ? ARCH.HALL : edgeArch;
  const g = {
    seed, cx, cz, zone, arch, ox: cx * N, oz: cz * N,
    cells: new Uint8Array(NN), prop: new Uint8Array(NN),
    rng: makeRng(hash32(seed, cx, cz, landmark === 'breaker' ? 18 : landmark === 'exit' ? 19 : 17)),
    eN: edgeH(seed, cx, cz), eS: edgeH(seed, cx, cz + 1), eW: edgeV(seed, cx, cz), eE: edgeV(seed, cx + 1, cz),
    openFat: null, doors: [], rooms: [], features: [], fields: [], mounts: [], hosts: [], busy: new Set(), memes: 0, bx: null, bz: null, bad: false,
    landmark, lit: null, lane2,
  };
  initBorder(g, arch === ARCH.CORRIDOR && !landmark ? WALL : EMPTY);
  if (landmark) layoutLandmark(g);
  else if (arch === ARCH.CORRIDOR) layoutCorridor(g);
  else if (arch === ARCH.HALL) layoutHall(g);
  else if (arch === ARCH.COLUMNS) layoutColumns(g);
  else if (arch === ARCH.ATRIUM) layoutAtrium(g);
  else layoutStorage(g);
  sweepStubs(g);
  repair(g);
  g.rng = makeRng(hash32(seed, cx, cz, 33));
  decorate(g);
  const fixtures = placeFixtures(g);

  const key = chunkKey(cx, cz);
  const doors = [];
  const doorGrid = new Uint8Array(NN);
  const remap = new Map();
  for (let k = 0; k < g.doors.length; k++) {
    const d = g.doors[k];
    if (d.dead) continue;
    const id = `${cx},${cz},d${doors.length}`;
    remap.set(k, id);
    doors.push({ id, ix: g.ox + d.lx, iz: g.oz + d.lz, axis: d.axis, hinge: d.hinge, swing: d.swing, openT: d.open, target: d.open });
    doorGrid[idx(d.lx, d.lz)] = doors.length;
    doorGrid[d.axis === 'x' ? idx(d.lx + 1, d.lz) : idx(d.lx, d.lz + 1)] = doors.length;
  }
  for (let k = 0; k < fixtures.length; k++) fixtures[k].id = `${cx},${cz},f${k}`;
  fixLightTask(g, fixtures);
  const features = [];
  for (const f of g.features) {
    const data = f.data;
    if (data && 'doorIndex' in data) {
      const id = remap.get(data.doorIndex);
      if (id === undefined) continue;
      delete data.doorIndex;
      data.doorId = id;
    }
    f.id = `${cx},${cz},x${features.length}`;
    features.push(f);
  }
  // links between features: <host>Index (generation order) -> <host>Id
  for (const f of features) {
    const data = f.data;
    if (!data) continue;
    for (const k of HOST_KEYS) {
      if (!(k in data)) continue;
      const host = g.features[data[k]];
      delete data[k];
      data[k.slice(0, -5) + 'Id'] = host.id;
    }
  }

  const zoneArr = new Uint8Array(NN).fill(zone);
  const spans = (e) => e.spans.map((s) => [s[0], s[1]]);
  const chunk = {
    cx, cz, key, kind: ARCH_NAME[arch], landmark,
    cells: g.cells, prop: g.prop, zone: zoneArr,
    fixtures, doors, features,
    openings: { n: spans(g.eN), s: spans(g.eS), e: spans(g.eE), w: spans(g.eW) },
  };
  // hot-path door lookup by local cell index (1-based), hidden from serialisation
  Object.defineProperty(chunk, 'doorGrid', { value: doorGrid, enumerable: false });
  if (g.bad) Object.defineProperty(chunk, 'invalid', { value: true, enumerable: false });
  return chunk;
}
