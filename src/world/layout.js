// macro layout: zones, chunk archetypes, lanes and shared edge descriptors.
// everything here is a pure function of (seed, coords) so neighbours always agree.
import { hash32, hashFloat, makeRng } from '../core/rng.js';
import { ZONE } from './constants.js';

export const ARCH = { CORRIDOR: 0, HALL: 1, COLUMNS: 2, STORAGE: 3, ATRIUM: 4 };
export const ARCH_NAME = ['corridor', 'hall', 'columns', 'storage', 'atrium'];
// closed edge cells are walled by exactly one side: LOW = chunk with the smaller coordinate
export const LOW = 0;
export const HIGH = 1;
export const SPAWN_LANE = [13, 19];

// the opening view: row cz = 0, chunks -1..2 share one straight lane that ends inside chunk 2
export const isSpawnChunk = (cx, cz) => cz === 0 && cx >= -1 && cx <= 2;

export function zoneOf(seed, cx, cz) {
  if (cx >= -3 && cx <= 4 && cz >= -2 && cz <= 2) return ZONE.OFFICE;
  const rx = Math.floor(cx / 2), rz = Math.floor(cz / 2);
  // v3: no dark and no wet zones (their share went back to office); grey maintenance pockets remain
  if (hashFloat(seed, 301, rx, rz) >= 0.22) return ZONE.OFFICE;
  if (hashFloat(seed, 302, cx, cz) >= 0.75) return ZONE.OFFICE;
  return hash32(seed, 303, rx, rz) & 1 ? ZONE.OFFICE : ZONE.MAINT;
}

// big atriums: 2x2 chunk groups of open office floor, kept away from the opening view
export function isAtrium(seed, cx, cz) {
  if (cx >= -3 && cx <= 4 && cz >= -2 && cz <= 2) return false;
  if (hashFloat(seed, 411, Math.floor(cx / 2), Math.floor(cz / 2)) >= 0.075) return false;
  return zoneOf(seed, cx, cz) === ZONE.OFFICE;
}

export function archOf(seed, cx, cz) {
  if (isSpawnChunk(cx, cz)) return ARCH.CORRIDOR;
  if (isAtrium(seed, cx, cz)) return ARCH.ATRIUM;
  const z = zoneOf(seed, cx, cz);
  const r = hashFloat(seed, 401, cx, cz);
  if (z === ZONE.MAINT) return r < 0.55 ? ARCH.STORAGE : r < 0.85 ? ARCH.CORRIDOR : ARCH.HALL;
  // the pillar forest survives only as a rare look
  return r < 0.63 ? ARCH.CORRIDOR : r < 0.96 ? ARCH.HALL : ARCH.COLUMNS;
}

// lanes are long corridors: every edge in a segment of 2-5 chunks shares the same band,
// so consecutive corridor chunks line up into 30-80 m straight runs. about a fifth are wide (4.5-6 m).
function laneSpan(seed, salt, row, b) {
  const segLen = 2 + (hash32(seed, salt, row, 1) % 4);
  const off = hash32(seed, salt, row, 2) % segLen;
  const seg = Math.floor((b + off) / segLen);
  const h = hash32(seed, salt, row, 3, seg);
  const w = (h >>> 16) % 100 < 22 ? 9 + ((h >>> 24) % 4) : 6 + (h % 3);
  const a = 3 + ((h >>> 4) % (29 - w - 3 + 1));
  return [a, a + w - 1];
}

// east-west lane crossing the vertical edge at chunk boundary X in row cz
export function laneEW(seed, cz, X) {
  if (cz === 0 && X >= -1 && X <= 2) return SPAWN_LANE;
  if (cz === 0 && X === 3) return null;
  if (hashFloat(seed, 111, X, cz) >= 0.75) return null;
  return laneSpan(seed, 110, cz, X);
}

// north-south lane crossing the horizontal edge at chunk boundary Z in column cx
export function laneNS(seed, cx, Z) {
  if (hashFloat(seed, 121, cx, Z) >= 0.75) return null;
  return laneSpan(seed, 120, cx, Z);
}

function closeShortRuns(open, lane) {
  let i = 0;
  while (i < 32) {
    if (!open[i]) { i++; continue; }
    let j = i;
    while (j + 1 < 32 && open[j + 1]) j++;
    if (j - i + 1 < 4 && !(lane && i <= lane[1] && j >= lane[0])) for (let k = i; k <= j; k++) open[k] = 0;
    i = j + 1;
  }
}

function buildEdge(seed, kind, a, b, lane, lowArch, highArch) {
  const rng = makeRng(hash32(seed, 200 + kind, a, b));
  const open = new Uint8Array(32);
  const own = new Uint8Array(32);
  if (lane) for (let i = lane[0]; i <= lane[1]; i++) open[i] = 1;
  const lowOpen = lowArch !== ARCH.CORRIDOR, highOpen = highArch !== ARCH.CORRIDOR;
  if (lowArch === ARCH.ATRIUM && highArch === ARCH.ATRIUM) {
    // atrium chunks merge into one big hall
    for (let i = 1; i <= 30; i++) open[i] = 1;
  } else if (lowOpen && highOpen && rng.chance(0.35)) {
    // two open-plan chunks: mostly open seam with a couple of wall stubs
    for (let i = 1; i <= 30; i++) open[i] = 1;
    const cuts = rng.int(0, 2);
    for (let k = 0; k < cuts; k++) {
      const len = rng.int(2, 6), p = rng.int(3, 28 - len);
      if (lane && p <= lane[1] && p + len - 1 >= lane[0]) continue;
      for (let i = p; i < p + len; i++) open[i] = 0;
    }
  } else {
    const r = rng.next();
    const extras = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
    for (let k = 0; k < extras; k++) {
      for (let t = 0; t < 4; t++) {
        const w = rng.int(4, 8), p = rng.int(1, 31 - w);
        let ok = true;
        for (let i = Math.max(0, p - 2); i <= Math.min(31, p + w + 1); i++) if (open[i]) { ok = false; break; }
        if (!ok) continue;
        for (let i = p; i < p + w; i++) open[i] = 1;
        break;
      }
    }
  }
  closeShortRuns(open, lane);
  let any = false;
  for (let i = 0; i < 32; i++) if (open[i]) { any = true; break; }
  if (!any) {
    const w = rng.int(5, 8), p = rng.int(2, 30 - w);
    for (let i = p; i < p + w; i++) open[i] = 1;
  }
  open[0] = 0;
  open[31] = 0;
  const spans = [];
  let i = 0;
  while (i < 32) {
    let j = i;
    while (j + 1 < 32 && open[j + 1] === open[i]) j++;
    if (open[i]) spans.push([i, j]);
    else {
      // the corridor-like side owns the wall so open plans stay open
      const owner = lowOpen !== highOpen ? (lowOpen ? HIGH : LOW) : rng.chance(0.5) ? HIGH : LOW;
      for (let k = i; k <= j; k++) own[k] = owner;
    }
    i = j + 1;
  }
  return { open, own, spans, lane: lane && open[lane[0]] ? lane : null };
}

// vertical edge at x-boundary X: low = (X-1, cz), high = (X, cz)
export const edgeV = (seed, X, cz) => buildEdge(seed, 1, X, cz, laneEW(seed, cz, X), archOf(seed, X - 1, cz), archOf(seed, X, cz));
// horizontal edge at z-boundary Z: low = (cx, Z-1), high = (cx, Z)
export const edgeH = (seed, cx, Z) => buildEdge(seed, 2, cx, Z, laneNS(seed, cx, Z), archOf(seed, cx, Z - 1), archOf(seed, cx, Z));
