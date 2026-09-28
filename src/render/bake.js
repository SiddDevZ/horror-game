// baked per-chunk lighting, computed on the cpu from world data.
// output per chunk: two 64x64 rgba half-float tiles (0.25 m texels) copied into toroidal atlases.
//   A: r floor direct, g wall direct @2.1 m, b wall direct @0.7 m, a bounce (blurred direct, walkable-only)
//   B: r contact ao, g flicker fraction of direct, b wet/stain mask, a maint mask
// light never leaks: direct uses grid line of sight over walls/columns/closed doors, bounce diffuses only
// through walkable cells, and texels inside solids copy from their own side (dilation), never across.
import { DataUtils } from 'three';
import { CELL, CHUNK, CHUNK_CELLS, CEIL_H, CELL_TYPE, ZONE } from '../config.js';

export const TPC = 64;
export const TEX = CHUNK / TPC;
const N = CHUNK_CELLS;
const PAD = 28;
const G = N + PAD * 2;
export const LIGHT_RANGE = 7;
const LR2 = LIGHT_RANGE * LIGHT_RANGE;
const BM = 12;
const BG = N + BM * 2;
const FH = CEIL_H - 0.02;
const K = FH * FH;
const Y_HI = 2.1;
const Y_LO = 0.7;
// how far a fixture change can reach into neighbouring chunks (direct range + bounce margin)
export const RELIGHT_REACH = LIGHT_RANGE + BM * CELL + 0.5;

const solid = new Uint8Array(G * G);
const propG = new Uint8Array(G * G);
const zoneG = new Uint8Array(G * G);
const MAXF = 1024;
const F = new Float32Array(MAXF * 6);
let nf = 0;
const E = TPC + 2;
const tSolid = new Uint8Array(E * E);
const tA = new Float32Array(E * E * 4);
const tB = new Float32Array(E * E * 4);
const bWalk = new Uint8Array(BG * BG);
const bCur = new Float32Array(BG * BG);
const bNext = new Float32Array(BG * BG);
const texFl = new Int16Array(MAXF);
const bFl = new Int16Array(MAXF);
const nbr = new Array(9);

const DIRS = [1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071];
const DIRW = [0.2, 0.2, 0.2, 0.2, 0.11, 0.11, 0.11, 0.11];

function strHash(s) {
  s = String(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
// slight per-fixture brightness variation, stable per id
export const fixtureVariation = (f) => 0.94 + 0.08 * strHash(f.id || `${f.x},${f.z}`);

export const doorBlocksLight = (d) => d.openT < 0.3;

export function doorSpan(world, d) {
  const t = d.axis === 'x' ? world.cell(d.ix + 1, d.iz) : world.cell(d.ix, d.iz + 1);
  if (t !== CELL_TYPE.DOOR) return 1;
  const other = d.axis === 'x' ? world.doorAt(d.ix + 1, d.iz) : world.doorAt(d.ix, d.iz + 1);
  return other === d ? 2 : 1;
}

function vis(x0, z0, x1, z1) {
  let ix = Math.floor(x0 * 2), iz = Math.floor(z0 * 2);
  const ex = Math.floor(x1 * 2), ez = Math.floor(z1 * 2);
  const dx = x1 - x0, dz = z1 - z0;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tdx = adx > 1e-9 ? CELL / adx : 1e9;
  const tdz = adz > 1e-9 ? CELL / adz : 1e9;
  let tmx = adx > 1e-9 ? (sx > 0 ? (ix + 1) * CELL - x0 : x0 - ix * CELL) / adx : 1e9;
  let tmz = adz > 1e-9 ? (sz > 0 ? (iz + 1) * CELL - z0 : z0 - iz * CELL) / adz : 1e9;
  for (let n = 0; n < 256; n++) {
    if (ix === ex && iz === ez) return 1;
    const m = tmx < tmz ? tmx : tmz;
    if (m > 1) return 1;
    if (Math.abs(tmx - tmz) < 1e-7) {
      // exact corner crossing: both side cells must be open
      if (solid[iz * G + ix + sx] || solid[(iz + sz) * G + ix]) return 0;
      tmx += tdx; tmz += tdz; ix += sx; iz += sz;
    } else if (tmx < tmz) { tmx += tdx; ix += sx; }
    else { tmz += tdz; iz += sz; }
    if (ix < 0 || iz < 0 || ix >= G || iz >= G) return 1;
    if (solid[iz * G + ix]) return 0;
  }
  return 1;
}

function gather(world, cx, cz, doorState, ctx) {
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) nbr[j * 3 + i] = world.getChunk(cx + i - 1, cz + j - 1);
  const bx = cx * N - PAD, bz = cz * N - PAD;
  for (let gz = 0; gz < G; gz++) {
    const iz = bz + gz;
    const ncz = Math.floor(iz / N);
    const lz = iz - ncz * N;
    for (let gx = 0; gx < G; gx++) {
      const ix = bx + gx;
      const ncx = Math.floor(ix / N);
      const lx = ix - ncx * N;
      const c = nbr[(ncz - cz + 1) * 3 + (ncx - cx + 1)];
      const i = lz * N + lx;
      const t = c.cells[i];
      const g = gz * G + gx;
      solid[g] = t === CELL_TYPE.WALL || t === CELL_TYPE.COLUMN ? 1 : 0;
      propG[g] = c.prop[i];
      zoneG[g] = c.zone[i];
    }
  }
  // closed doors block light
  for (let k = 0; k < 9; k++) {
    for (const d of nbr[k].doors) {
      const blocked = doorBlocksLight(d);
      doorState.set(d.id, blocked);
      if (!blocked) continue;
      const span = doorSpan(world, d);
      for (let s = 0; s < span; s++) {
        const gx = (d.axis === 'x' ? d.ix + s : d.ix) - bx;
        const gz = (d.axis === 'x' ? d.iz : d.iz + s) - bz;
        if (gx >= 0 && gz >= 0 && gx < G && gz < G) solid[gz * G + gx] = 2;
      }
    }
  }
  // fixtures in padded-local metres
  nf = 0;
  const ox = bx * CELL, oz = bz * CELL;
  const lo = PAD * CELL - RELIGHT_REACH, hi = PAD * CELL + CHUNK + RELIGHT_REACH;
  for (let k = 0; k < 9; k++) {
    for (const f of nbr[k].fixtures) {
      if (!f.on || !(f.intensity > 0) || nf >= MAXF) continue;
      const x = f.x - ox, z = f.z - oz;
      if (x < lo || x > hi || z < lo || z > hi) continue;
      const o = nf * 6;
      const sx = f.sx || 0.6, sz = f.sz || 1.2;
      F[o] = x; F[o + 1] = z;
      F[o + 2] = f.intensity * fixtureVariation(f) * (sx * sz) / 0.72;
      // soft shadow samples along the long axis
      if (sx >= sz) { F[o + 3] = sx * 0.3; F[o + 4] = 0; } else { F[o + 3] = 0; F[o + 4] = sz * 0.3; }
      F[o + 5] = f.flicker && !(ctx && ctx.steady.has(f.id)) ? 1 : 0;
      nf++;
    }
  }
}

function blobs(cx, cz, ctx) {
  const ox = cx * CHUNK - TEX, oz = cz * CHUNK - TEX;
  for (let k = 0; k < 9; k++) {
    for (const f of nbr[k].features) {
      if (f.type !== 'puddle' && f.type !== 'stain') continue;
      if (ctx && ctx.hidden.has(f.id)) continue;
      const puddle = f.type === 'puddle';
      const rx = Math.max(0.3, (f.w || (puddle ? 1.4 : 0.8)) * 0.5);
      const rz = Math.max(0.3, (f.d || (puddle ? 1.0 : 0.6)) * 0.5);
      const strength = puddle ? 1 : 0.72;
      const cy = Math.cos(f.yaw || 0), sy = Math.sin(f.yaw || 0);
      const rr = Math.max(rx, rz) * 1.4;
      const x0 = Math.floor((f.x - rr - ox) / TEX), x1 = Math.ceil((f.x + rr - ox) / TEX);
      const z0 = Math.floor((f.z - rr - oz) / TEX), z1 = Math.ceil((f.z + rr - oz) / TEX);
      for (let tz = Math.max(0, z0); tz <= Math.min(E - 1, z1); tz++) {
        for (let tx = Math.max(0, x0); tx <= Math.min(E - 1, x1); tx++) {
          const qx = ox + (tx + 0.5) * TEX - f.x, qz = oz + (tz + 0.5) * TEX - f.z;
          const px = qx * cy - qz * sy, pz = qx * sy + qz * cy;
          const d = Math.sqrt((px * px) / (rx * rx) + (pz * pz) / (rz * rz));
          const v = strength * Math.min(1, Math.max(0, (1.3 - d) / 0.6));
          const e = (tz * E + tx) * 4 + 2;
          if (v > tB[e]) tB[e] = v;
        }
      }
    }
  }
}

/**
 * generator: bakes chunk (cx, cz) into outA/outB (Uint16Array 64*64*4 half floats).
 * yields between slices so the caller can respect a per-frame ms budget.
 */
/** ctx (optional): { steady: Set of fixture ids that no longer flicker, hidden: Set of puddle/stain ids } */
export function* bakeChunk(world, cx, cz, outA, outB, doorState, ctx = null) {
  gather(world, cx, cz, doorState, ctx);
  yield;
  const P0 = PAD * CELL;
  // fixture candidates for texels (chunk +- light range) and bounce cells (+ margin)
  let ntf = 0, nbf = 0;
  for (let f = 0; f < nf; f++) {
    const x = F[f * 6], z = F[f * 6 + 1];
    const tr = LIGHT_RANGE + 0.5;
    if (x > P0 - tr && x < P0 + CHUNK + tr && z > P0 - tr && z < P0 + CHUNK + tr) texFl[ntf++] = f;
    const br = LIGHT_RANGE + BM * CELL + 0.5;
    if (x > P0 - br && x < P0 + CHUNK + br && z > P0 - br && z < P0 + CHUNK + br) bFl[nbf++] = f;
  }

  // direct light, walls bands, ao
  for (let tz = 0; tz < E; tz++) {
    const pz = P0 + (tz - 1 + 0.5) * TEX;
    for (let tx = 0; tx < E; tx++) {
      const px = P0 + (tx - 1 + 0.5) * TEX;
      const e = tz * E + tx;
      const o = e * 4;
      const g = Math.floor(pz * 2) * G + Math.floor(px * 2);
      if (solid[g]) {
        tSolid[e] = 1;
        tA[o] = tA[o + 1] = tA[o + 2] = tA[o + 3] = 0;
        tB[o] = 1; tB[o + 1] = 0; tB[o + 2] = 0; tB[o + 3] = zoneG[g] === ZONE.MAINT ? 1 : 0;
        continue;
      }
      tSolid[e] = 0;
      // wall normal from solid texel neighbours
      let nx = 0, nz = 0;
      if (solid[Math.floor(pz * 2) * G + Math.floor((px - TEX) * 2)]) nx += 1;
      if (solid[Math.floor(pz * 2) * G + Math.floor((px + TEX) * 2)]) nx -= 1;
      if (solid[Math.floor((pz - TEX) * 2) * G + Math.floor(px * 2)]) nz += 1;
      if (solid[Math.floor((pz + TEX) * 2) * G + Math.floor(px * 2)]) nz -= 1;
      const hasWall = nx !== 0 || nz !== 0;
      let wx = 0, wz = 0;
      if (hasWall) {
        const l = Math.hypot(nx, nz);
        nx /= l; nz /= l;
        wx = px - nx * TEX * 0.5;
        wz = pz - nz * TEX * 0.5;
      }
      let sF = 0, sFl = 0, sH = 0, sL = 0;
      for (let k = 0; k < ntf; k++) {
        const f = texFl[k] * 6;
        const fx = F[f], fz = F[f + 1];
        const dx = fx - px, dz = fz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= LR2) continue;
        let v = vis(px, pz, fx + F[f + 3], fz + F[f + 4]) + vis(px, pz, fx - F[f + 3], fz - F[f + 4]);
        if (v === 0) continue;
        v *= 0.5;
        const win = (1 - d2 / LR2) * (1 - d2 / LR2);
        const I = F[f + 2] * v * win;
        const r2 = d2 + FH * FH;
        const ef = (K * I * FH * FH) / (r2 * r2);
        sF += ef;
        if (F[f + 5]) sFl += ef;
        if (hasWall) {
          const lx = fx - wx, lz = fz - wz;
          const h2 = lx * lx + lz * lz;
          const dot = lx * nx + lz * nz;
          if (dot > 0) {
            let ly = FH - Y_HI;
            let rr = Math.max(h2 + ly * ly, 0.3);
            sH += (K * I * dot * ly) / (rr * rr);
            ly = FH - Y_LO;
            rr = h2 + ly * ly;
            sL += (K * I * dot * ly) / (rr * rr);
          }
        }
      }
      tA[o] = sF;
      tA[o + 1] = hasWall ? sH : sF;
      tA[o + 2] = hasWall ? sL : sF;
      tB[o + 1] = sF > 1e-5 ? sFl / sF : 0;
      // contact ao: distance to solids / props along 8 directions
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        const ddx = DIRS[d * 2], ddz = DIRS[d * 2 + 1];
        for (let s = 1; s <= 6; s++) {
          const qx = px + ddx * s * 0.125, qz = pz + ddz * s * 0.125;
          const q = Math.floor(qz * 2) * G + Math.floor(qx * 2);
          const hitS = solid[q], hitP = propG[q];
          if (hitS || hitP) {
            const t = 1 - (s * 0.125) / 0.8;
            occ += DIRW[d] * t * t * (hitS === 1 ? 1 : 0.35);
            break;
          }
        }
      }
      tB[o] = 1 - Math.min(occ, 0.75);
      const z = zoneG[g];
      tB[o + 2] = z === ZONE.WET ? 0.42 : 0;
      tB[o + 3] = z === ZONE.MAINT ? 1 : 0;
    }
    if ((tz & 3) === 3) yield;
  }

  // bounce: direct at cell centres over chunk + margin, blurred through walkable cells only.
  // margin == iterations, so the result inside the chunk is exactly what an infinite grid gives (no seams).
  const bo = PAD - BM;
  for (let bz = 0; bz < BG; bz++) {
    for (let bx = 0; bx < BG; bx++) {
      const g = (bz + bo) * G + bx + bo;
      const b = bz * BG + bx;
      if (solid[g]) { bWalk[b] = 0; bCur[b] = 0; continue; }
      bWalk[b] = 1;
      const px = (bx + bo + 0.5) * CELL, pz = (bz + bo + 0.5) * CELL;
      let s = 0;
      for (let k = 0; k < nbf; k++) {
        const f = bFl[k] * 6;
        const dx = F[f] - px, dz = F[f + 1] - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= LR2) continue;
        if (!vis(px, pz, F[f], F[f + 1])) continue;
        const win = (1 - d2 / LR2) * (1 - d2 / LR2);
        const r2 = d2 + FH * FH;
        s += (K * F[f + 2] * win * FH * FH) / (r2 * r2);
      }
      bCur[b] = s;
    }
    if ((bz & 7) === 7) yield;
  }
  let cur = bCur, nxt = bNext;
  for (let it = 0; it < BM; it++) {
    for (let bz = 0; bz < BG; bz++) {
      for (let bx = 0; bx < BG; bx++) {
        const b = bz * BG + bx;
        if (!bWalk[b]) { nxt[b] = 0; continue; }
        let s = cur[b] * 2, w = 2;
        if (bx > 0 && bWalk[b - 1]) { s += cur[b - 1]; w++; }
        if (bx < BG - 1 && bWalk[b + 1]) { s += cur[b + 1]; w++; }
        if (bz > 0 && bWalk[b - BG]) { s += cur[b - BG]; w++; }
        if (bz < BG - 1 && bWalk[b + BG]) { s += cur[b + BG]; w++; }
        nxt[b] = s / w;
      }
    }
    const t = cur; cur = nxt; nxt = t;
    if ((it & 3) === 3) yield;
  }
  // texel bounce: bilinear over walkable cells only
  for (let tz = 0; tz < E; tz++) {
    const u = (tz - 1 + 0.5) * TEX * 2 - 0.5 + BM;
    const iz = Math.floor(u), fz = u - iz;
    for (let tx = 0; tx < E; tx++) {
      const e = tz * E + tx;
      if (tSolid[e]) continue;
      const v = (tx - 1 + 0.5) * TEX * 2 - 0.5 + BM;
      const ix = Math.floor(v), fx = v - ix;
      let s = 0, w = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const b = (iz + j) * BG + ix + i;
          if (!bWalk[b]) continue;
          const ww = (i ? fx : 1 - fx) * (j ? fz : 1 - fz) + 1e-4;
          s += cur[b] * ww; w += ww;
        }
      }
      tA[e * 4 + 3] = w > 0 ? s / w : 0;
    }
  }
  blobs(cx, cz, ctx);
  yield;

  // dilate: solid texels take the average of their open 4-neighbours (one side of the wall only)
  for (let tz = 1; tz < E - 1; tz++) {
    for (let tx = 1; tx < E - 1; tx++) {
      const e = tz * E + tx;
      if (!tSolid[e]) continue;
      let n = 0;
      const o = e * 4;
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? e - 1 : k === 1 ? e + 1 : k === 2 ? e - E : e + E;
        if (tSolid[q]) continue;
        const p = q * 4;
        a0 += tA[p]; a1 += tA[p + 1]; a2 += tA[p + 2]; a3 += tA[p + 3];
        b0 += tB[p]; b1 += tB[p + 1]; b2 += tB[p + 2];
        n++;
      }
      if (!n) continue;
      tA[o] = a0 / n; tA[o + 1] = a1 / n; tA[o + 2] = a2 / n; tA[o + 3] = a3 / n;
      tB[o] = b0 / n; tB[o + 1] = b1 / n; tB[o + 2] = b2 / n;
    }
  }
  const h = DataUtils.toHalfFloat;
  for (let tz = 0; tz < TPC; tz++) {
    for (let tx = 0; tx < TPC; tx++) {
      const s = ((tz + 1) * E + tx + 1) * 4;
      const d = (tz * TPC + tx) * 4;
      outA[d] = h(tA[s]); outA[d + 1] = h(tA[s + 1]); outA[d + 2] = h(tA[s + 2]); outA[d + 3] = h(tA[s + 3]);
      outB[d] = h(tB[s]); outB[d + 1] = h(tB[s + 1]); outB[d + 2] = h(tB[s + 2]); outB[d + 3] = h(tB[s + 3]);
    }
  }
}
