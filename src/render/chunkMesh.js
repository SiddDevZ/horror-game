// per-chunk merged static geometry: exposed wall faces (greedy merged), floor, ceiling, door lintels and
// casings, fixture panels, props. positions are chunk-local (origin at cx*CHUNK, cz*CHUNK).
import { CELL, CHUNK, CHUNK_CELLS, CEIL_H, CELL_TYPE, ZONE } from '../config.js';
import { MAT, FLAG } from './materials-ids.js';
import { buildFeature } from './props.js';
import { fixtureVariation, doorSpan } from './bake.js';

const N = CHUNK_CELLS;
export const DOOR_H = 2.1;
const PANEL_DROP = 0.012;

const nb = new Array(9);
function cellAt(lx, lz) {
  const ox = lx < 0 ? -1 : lx >= N ? 1 : 0;
  const oz = lz < 0 ? -1 : lz >= N ? 1 : 0;
  const c = nb[(oz + 1) * 3 + ox + 1];
  return c.cells[(lz - oz * N) * N + (lx - ox * N)];
}
function zoneAt(lx, lz) {
  const ox = lx < 0 ? -1 : lx >= N ? 1 : 0;
  const oz = lz < 0 ? -1 : lz >= N ? 1 : 0;
  const c = nb[(oz + 1) * 3 + ox + 1];
  return c.zone[(lz - oz * N) * N + (lx - ox * N)];
}
const isSolid = (t) => t === CELL_TYPE.WALL || t === CELL_TYPE.COLUMN;
function wallMat(lx, lz) {
  const t = cellAt(lx, lz);
  if (t === CELL_TYPE.DOOR) return MAT.TRIM;
  const z = zoneAt(lx, lz);
  if (z === ZONE.MAINT) return MAT.BLOCK;
  return z === ZONE.WET ? MAT.WALLPAPER + FLAG.WET : MAT.WALLPAPER;
}

const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
const AO1 = [1, 1, 1, 1];
const UV = new Float32Array(8);

// vertical quad with outward normal (nx, 0, nz) spanning along a = (nz, 0, -nx) from s to e, y0..y1
function vquad(b, sx, sz, ex, ez, y0, y1, nx, nz, m, len) {
  A[0] = sx; A[1] = y0; A[2] = sz;
  B[0] = ex; B[1] = y0; B[2] = ez;
  C[0] = ex; C[1] = y1; C[2] = ez;
  D[0] = sx; D[1] = y1; D[2] = sz;
  UV[0] = 0; UV[1] = len; UV[2] = len; UV[3] = len; UV[4] = len; UV[5] = len; UV[6] = 0; UV[7] = len;
  b.quad(A, B, C, D, nx, 0, nz, m, AO1, UV);
}

// horizontal quad (y) from (x0,z0) to (x1,z1); up=true faces +y
function hquad(b, x0, z0, x1, z1, y, up, m, ao = 1) {
  AO1[0] = AO1[1] = AO1[2] = AO1[3] = ao;
  UV[0] = 0; UV[1] = 0; UV[2] = 1; UV[3] = 0; UV[4] = 1; UV[5] = 1; UV[6] = 0; UV[7] = 1;
  if (up) {
    A[0] = x0; A[1] = y; A[2] = z1; B[0] = x1; B[1] = y; B[2] = z1; C[0] = x1; C[1] = y; C[2] = z0; D[0] = x0; D[1] = y; D[2] = z0;
    UV[1] = 1; UV[3] = 1; UV[5] = 0; UV[7] = 0;
    b.quad(A, B, C, D, 0, 1, 0, m, AO1, UV);
  } else {
    A[0] = x0; A[1] = y; A[2] = z0; B[0] = x1; B[1] = y; B[2] = z0; C[0] = x1; C[1] = y; C[2] = z1; D[0] = x0; D[1] = y; D[2] = z1;
    b.quad(A, B, C, D, 0, -1, 0, m, AO1, UV);
  }
  AO1[0] = AO1[1] = AO1[2] = AO1[3] = 1;
}

function wallFaces(b) {
  // four directions: normal (dx, dz)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const alongX = dx === 0; // runs along x when the normal is along z
    for (let line = 0; line < N; line++) {
      let run = -1, key = -1;
      for (let i = 0; i <= N; i++) {
        let k = -1;
        if (i < N) {
          const lx = alongX ? i : line, lz = alongX ? line : i;
          if (isSolid(cellAt(lx, lz)) && !isSolid(cellAt(lx + dx, lz + dz))) k = wallMat(lx + dx, lz + dz);
        }
        if (k !== key) {
          if (key >= 0) emitRun(b, dx, dz, alongX, line, run, i - 1, key);
          key = k; run = i;
        }
      }
    }
  }
}

function emitRun(b, dx, dz, alongX, line, i0, i1, key) {
  // plane position and extent in chunk-local metres
  const plane = (line + (dx > 0 || dz > 0 ? 1 : 0)) * CELL;
  const lo = i0 * CELL, hi = (i1 + 1) * CELL;
  const len = hi - lo;
  // along direction a = (nz, -nx): for +x normal a = -z, for -x a = +z, for +z a = +x, for -z a = -x
  const aPos = alongX ? dz > 0 : dx < 0; // a points toward increasing index
  const cellLo = alongX ? [i0 - 1, line] : [line, i0 - 1];
  const cellHi = alongX ? [i1 + 1, line] : [line, i1 + 1];
  const convexLo = !isSolid(cellAt(cellLo[0], cellLo[1]));
  const convexHi = !isSolid(cellAt(cellHi[0], cellHi[1]));
  const cs = aPos ? convexLo : convexHi, ce = aPos ? convexHi : convexLo;
  const m = key + (cs ? FLAG.CONVEX_START : 0) + (ce ? FLAG.CONVEX_END : 0);
  let sx, sz, ex, ez;
  if (alongX) { sz = ez = plane; sx = aPos ? lo : hi; ex = aPos ? hi : lo; }
  else { sx = ex = plane; sz = aPos ? lo : hi; ez = aPos ? hi : lo; }
  vquad(b, sx, sz, ex, ez, 0, CEIL_H, dx, dz, m, len);
}

function doorGeometry(b, world, chunk, leaves) {
  const ox = chunk.cx * N, oz = chunk.cz * N;
  // lintels over every door cell
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (chunk.cells[lz * N + lx] !== CELL_TYPE.DOOR) continue;
      // passage direction: the axis whose neighbours are open
      const passZ = isSolid(cellAt(lx - 1, lz)) || isSolid(cellAt(lx + 1, lz)) || cellAt(lx - 1, lz) === CELL_TYPE.DOOR || cellAt(lx + 1, lz) === CELL_TYPE.DOOR;
      const x0 = lx * CELL, x1 = x0 + CELL, z0 = lz * CELL, z1 = z0 + CELL;
      if (passZ) {
        vquad(b, x0, z1, x1, z1, DOOR_H, CEIL_H, 0, 1, wallMat(lx, lz + 1), CELL);
        vquad(b, x1, z0, x0, z0, DOOR_H, CEIL_H, 0, -1, wallMat(lx, lz - 1), CELL);
      } else {
        vquad(b, x1, z1, x1, z0, DOOR_H, CEIL_H, 1, 0, wallMat(lx + 1, lz), CELL);
        vquad(b, x0, z0, x0, z1, DOOR_H, CEIL_H, -1, 0, wallMat(lx - 1, lz), CELL);
      }
      hquad(b, x0, z0, x1, z1, DOOR_H, false, MAT.TRIM);
    }
  }
  // casings + leaves from door records
  for (const d of chunk.doors) {
    const span = doorSpan(world, d);
    const lx = d.ix - ox, lz = d.iz - oz;
    const w = span * CELL;
    const T = 0.07, P = 0.012;
    if (d.axis === 'x') {
      const x0 = lx * CELL, x1 = x0 + w, zc = (lz + 0.5) * CELL;
      for (const s of [-1, 1]) {
        const zf = zc + s * (CELL / 2 + P / 2);
        b.box(x0 - T / 2, DOOR_H / 2 + T / 4, zf, T, DOOR_H + T / 2, P, MAT.TRIM, 1);
        b.box(x1 + T / 2, DOOR_H / 2 + T / 4, zf, T, DOOR_H + T / 2, P, MAT.TRIM, 1);
        b.box((x0 + x1) / 2, DOOR_H + T / 2, zf, w + T * 2, T, P, MAT.TRIM);
      }
    } else {
      const z0 = lz * CELL, z1 = z0 + w, xc = (lx + 0.5) * CELL;
      for (const s of [-1, 1]) {
        const xf = xc + s * (CELL / 2 + P / 2);
        b.box(xf, DOOR_H / 2 + T / 4, z0 - T / 2, P, DOOR_H + T / 2, T, MAT.TRIM, 1);
        b.box(xf, DOOR_H / 2 + T / 4, z1 + T / 2, P, DOOR_H + T / 2, T, MAT.TRIM, 1);
        b.box(xf, DOOR_H + T / 2, (z0 + z1) / 2, P, T, w + T * 2, MAT.TRIM);
      }
    }
    leaves.push({ door: d, span, chunkKey: chunk.key });
  }
}

function fixtures(b, chunk, ctx) {
  const ox = chunk.cx * CHUNK, oz = chunk.cz * CHUNK;
  const y = CEIL_H - PANEL_DROP;
  for (const f of chunk.fixtures) {
    const hx = (f.sx || 0.6) / 2, hz = (f.sz || 1.2) / 2;
    const x = f.x - ox, z = f.z - oz;
    const I = f.on ? (f.intensity ?? 1) * fixtureVariation(f) : 0;
    const m = MAT.PANEL + (f.flicker && !(ctx && ctx.steady.has(f.id)) ? FLAG.FLICKER : 0);
    AO1[0] = AO1[1] = AO1[2] = AO1[3] = I;
    UV[0] = 0; UV[1] = 0; UV[2] = 1; UV[3] = 0; UV[4] = 1; UV[5] = 1; UV[6] = 0; UV[7] = 1;
    A[0] = x - hx; A[1] = y; A[2] = z - hz; B[0] = x + hx; B[1] = y; B[2] = z - hz;
    C[0] = x + hx; C[1] = y; C[2] = z + hz; D[0] = x - hx; D[1] = y; D[2] = z + hz;
    b.quad(A, B, C, D, 0, -1, 0, m, AO1, UV);
    AO1[0] = AO1[1] = AO1[2] = AO1[3] = 1;
    // thin frame lip around the diffuser
    const t = 0.025, lip = PANEL_DROP;
    b.box(x, CEIL_H - lip / 2, z - hz - t / 2, hx * 2 + t * 2, lip, t, MAT.FRAME, 2);
    b.box(x, CEIL_H - lip / 2, z + hz + t / 2, hx * 2 + t * 2, lip, t, MAT.FRAME, 2);
    b.box(x - hx - t / 2, CEIL_H - lip / 2, z, t, lip, hz * 2, MAT.FRAME, 2);
    b.box(x + hx + t / 2, CEIL_H - lip / 2, z, t, lip, hz * 2, MAT.FRAME, 2);
  }
}

/** builds the chunk's merged geometry into builder b. returns door leaf descriptors. ctx: render-side feature state */
export function buildChunkGeometry(b, world, chunk, ctx = null) {
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) nb[j * 3 + i] = i === 1 && j === 1 ? chunk : world.getChunk(chunk.cx + i - 1, chunk.cz + j - 1);
  b.reset();
  hquad(b, 0, 0, CHUNK, CHUNK, 0, true, MAT.FLOOR);
  hquad(b, 0, 0, CHUNK, CHUNK, CEIL_H, false, MAT.CEIL);
  wallFaces(b);
  const leaves = [];
  doorGeometry(b, world, chunk, leaves);
  fixtures(b, chunk, ctx);
  const ox = chunk.cx * CHUNK, oz = chunk.cz * CHUNK;
  for (const f of chunk.features) buildFeature(b, f, ox, oz, ctx);
  return { geometry: b.finish(), leaves };
}
