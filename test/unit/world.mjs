// world data tests: determinism, seams, connectivity, clear width, fixtures, zones, cache, timing.
// run: node test/unit/world.mjs   (or node test/unit/run.mjs)
import assert from 'node:assert/strict';
import { PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { World } from '../../src/world/World.js';
import { generateChunk } from '../../src/world/gen.js';
import { zoneOf as zoneOfFast, SPAWN_LANE } from '../../src/world/layout.js';
import { CELL, CHUNK_CELLS, CHUNK, CELL_TYPE, ZONE, DATA_CACHE_MAX, CEIL_H, chunkKey, cellOf } from '../../src/world/constants.js';

// the zero-gc check needs a clean heap after the allocation-heavy tests, even without --expose-gc
if (!globalThis.gc) { v8.setFlagsFromString('--expose-gc'); globalThis.gc = vm.runInNewContext('gc'); }

const N = CHUNK_CELLS;
const { EMPTY, WALL, COLUMN, DOOR } = CELL_TYPE;
const SEEDS = [1, 2, 7, 1337, 90210, 424242];
const R = 11; // chunks -R..R-1 per axis -> 484 chunks per seed
let failures = 0;
const results = {};

async function test(name, fn) {
  const t0 = performance.now();
  try {
    const info = await fn();
    console.log(`  ok  ${name} (${(performance.now() - t0).toFixed(0)} ms)${info ? '  ' + info : ''}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

const hex = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex');
const ser = (c) => JSON.stringify({ ...c, cells: hex(c.cells), prop: hex(c.prop), zone: hex(c.zone) });
const walk = (c, i) => (c.cells[i] === EMPTY || c.cells[i] === DOOR) && !c.prop[i];
const idx = (x, z) => z * N + x;

// independent checker (does not reuse generator internals)
function chunkProblems(c) {
  const p = [];
  const edges = { n: (u) => idx(u, 0), s: (u) => idx(u, N - 1), w: (u) => idx(0, u), e: (u) => idx(N - 1, u) };
  let sides = 0;
  const starts = [];
  for (const k of ['n', 's', 'e', 'w']) {
    const spans = c.openings[k];
    if (spans.length) sides++;
    for (const [a, b] of spans) {
      if (b - a + 1 < 2) p.push(`${k} span narrower than 1 m`);
      for (let u = a; u <= b; u++) if (!walk(c, edges[k](u))) p.push(`${k} opening cell ${u} blocked`);
      starts.push(edges[k](a));
    }
  }
  if (sides < 2) p.push('fewer than two exit sides');
  // thin-agent connectivity: every walkable cell reachable from every opening
  const seen = new Uint8Array(N * N);
  const q = [starts[0]];
  seen[starts[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % N, z = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const j = idx(nx, nz);
      if (!seen[j] && walk(c, j)) { seen[j] = 1; q.push(j); }
    }
  }
  for (let i = 0; i < N * N; i++) if (walk(c, i) && !seen[i]) { p.push(`cell ${i % N},${(i / N) | 0} unreachable`); break; }
  // 1 m agent (2x2 cells): all openings in one component and every walkable cell inside a reachable 2x2
  const F = N - 1;
  const fat = (f) => { const x = f % F, z = (f / F) | 0; return walk(c, idx(x, z)) && walk(c, idx(x + 1, z)) && walk(c, idx(x, z + 1)) && walk(c, idx(x + 1, z + 1)); };
  const fs = new Uint8Array(F * F);
  const fstart = (k, a) => (k === 'n' ? a : k === 's' ? (F - 1) * F + a : k === 'w' ? a * F : a * F + F - 1);
  const firstK = ['n', 's', 'e', 'w'].find((k) => c.openings[k].length);
  const root = fstart(firstK, c.openings[firstK][0][0]);
  if (!fat(root)) p.push('opening has no 1 m clearance');
  const fq = [root];
  fs[root] = 1;
  while (fq.length) {
    const f = fq.pop(), x = f % F, z = (f / F) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= F || nz >= F) continue;
      const j = nz * F + nx;
      if (!fs[j] && fat(j)) { fs[j] = 1; fq.push(j); }
    }
  }
  for (const k of ['n', 's', 'e', 'w']) for (const [a] of c.openings[k]) if (!fs[fstart(k, a)]) p.push(`opening ${k}@${a} not reachable at 1 m width`);
  const cov = new Uint8Array(N * N);
  for (let f = 0; f < F * F; f++) if (fs[f]) { const x = f % F, z = (f / F) | 0; cov[idx(x, z)] = cov[idx(x + 1, z)] = cov[idx(x, z + 1)] = cov[idx(x + 1, z + 1)] = 1; }
  for (let i = 0; i < N * N; i++) if (walk(c, i) && !cov[i]) { p.push(`cell ${i % N},${(i / N) | 0} below 1 m clear width`); break; }
  // props only on plain floor
  for (let i = 0; i < N * N; i++) if (c.prop[i] && c.cells[i] !== EMPTY) { p.push('prop on non-floor'); break; }
  // doors: 2 cells in a 1-cell wall, never locked (object exists, finite state)
  for (const d of c.doors) {
    const lx = d.ix - c.cx * N, lz = d.iz - c.cz * N;
    const ox = d.axis === 'x' ? 1 : 0, oz = 1 - ox;
    if (c.cells[idx(lx, lz)] !== DOOR || c.cells[idx(lx + ox, lz + oz)] !== DOOR) p.push(`door ${d.id} cells not DOOR`);
    for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
      const x = lx + ox * k + oz * s, z = lz + oz * k + ox * s;
      if (x < 0 || z < 0 || x >= N || z >= N || !walk(c, idx(x, z))) p.push(`door ${d.id} not in a 1-cell wall`);
    }
    if (!(d.openT >= 0 && d.openT <= 1)) p.push('door state');
  }
  let doorCells = 0;
  for (let i = 0; i < N * N; i++) if (c.cells[i] === DOOR) doorCells++;
  if (doorCells !== c.doors.length * 2) p.push('orphan door cells');
  return p;
}

function hasLoop(c) {
  // a solid island (wall/column component not touching the border) means you can run around it
  const seen = new Uint8Array(N * N);
  for (let s = 0; s < N * N; s++) {
    if (seen[s] || c.cells[s] === EMPTY || c.cells[s] === DOOR) continue;
    let border = false;
    const q = [s];
    seen[s] = 1;
    while (q.length) {
      const i = q.pop(), x = i % N, z = (i / N) | 0;
      if (x === 0 || z === 0 || x === N - 1 || z === N - 1) border = true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = idx(nx, nz);
        if (!seen[j] && (c.cells[j] === WALL || c.cells[j] === COLUMN)) { seen[j] = 1; q.push(j); }
      }
    }
    if (!border) return true;
  }
  return false;
}

console.log('world');

await test('determinism across generation orders and fresh worlds', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    const coords = [];
    for (let cz = -6; cz < 6; cz++) for (let cx = -6; cx < 6; cx++) coords.push([cx, cz]);
    const a = new World(seed), b = new World(seed);
    const ref = new Map(coords.map(([cx, cz]) => [chunkKey(cx, cz), ser(a.getChunk(cx, cz))]));
    const shuffled = coords.slice().sort((p, q) => ((p[0] * 7919 + p[1] * 104729) % 97) - ((q[0] * 7919 + q[1] * 104729) % 97));
    for (const [cx, cz] of shuffled.reverse()) assert.equal(ser(b.getChunk(cx, cz)), ref.get(chunkKey(cx, cz)), `seed ${seed} chunk ${cx},${cz}`);
    // direct generator call (no world state at all)
    for (const [cx, cz] of coords.slice(0, 20)) assert.equal(ser(generateChunk(seed, cx, cz)), ref.get(chunkKey(cx, cz)));
  }
  assert.notEqual(ser(generateChunk(1, 3, 3)), ser(generateChunk(2, 3, 3)), 'different seeds differ');
});

await test('eviction + regeneration is byte-identical; pinned and active chunks survive', () => {
  const w = new World(5);
  const c0 = w.getChunk(40, -12);
  const before = ser(c0);
  w.pin(chunkKey(1, 1), 'test');
  const pinned = w.getChunk(1, 1);
  w.update(0, 0);
  const active = w.getChunk(0, 0);
  for (let i = 0; i < DATA_CACHE_MAX + 200; i++) w.getChunk(100 + (i % 30), 100 + ((i / 30) | 0));
  w._evict();
  assert.ok(w.stats().cached <= DATA_CACHE_MAX, `cache bounded (${w.stats().cached})`);
  assert.ok(!w.cache.has(chunkKey(40, -12)), 'old chunk evicted');
  const c1 = w.getChunk(40, -12);
  assert.notEqual(c1, c0, 'regenerated object');
  assert.equal(ser(c1), before);
  assert.equal(w.getChunk(1, 1), pinned, 'pinned survives');
  assert.equal(w.getChunk(0, 0), active, 'active survives');
  // hot-path cache must not serve an evicted object
  w.getChunk(200, 200);
  w.cell(200 * N, 200 * N);
  for (let i = 0; i < DATA_CACHE_MAX + 100; i++) w.getChunk(300 + (i % 30), 300 + ((i / 30) | 0));
  w._evict();
  w.cell(200 * N, 200 * N);
  assert.equal(w._chunk(200, 200), w.cache.get(chunkKey(200, 200)));
});

const all = []; // [seed, chunk]
await test(`generate ${SEEDS.length} seeds x ${(2 * R) ** 2} chunks; timing`, () => {
  let ms = 0, n = 0, worst = 0;
  for (const seed of SEEDS) {
    for (let cz = -R; cz < R; cz++) for (let cx = -R; cx < R; cx++) {
      const t0 = performance.now();
      const c = generateChunk(seed, cx, cz);
      const dt = performance.now() - t0;
      ms += dt; n++; worst = Math.max(worst, dt);
      all.push([seed, c]);
      assert.ok(!c.invalid, `repair failed at seed ${seed} ${cx},${cz}`);
    }
  }
  results.genMs = ms / n;
  assert.ok(ms / n < 1, `avg ${(ms / n).toFixed(3)} ms/chunk`);
  return `avg ${(ms / n).toFixed(3)} ms/chunk, worst ${worst.toFixed(2)} ms over ${n}`;
});

await test('neighbour openings agree exactly and closed seams are sealed', () => {
  const by = new Map(all.map(([s, c]) => [`${s}:${c.cx}:${c.cz}`, c]));
  let seams = 0;
  for (const [s, c] of all) {
    const e = by.get(`${s}:${c.cx + 1}:${c.cz}`), so = by.get(`${s}:${c.cx}:${c.cz + 1}`);
    for (const [nb, mine, theirs, ci, ni] of [[e, 'e', 'w', (u) => idx(N - 1, u), (u) => idx(0, u)], [so, 's', 'n', (u) => idx(u, N - 1), (u) => idx(u, 0)]]) {
      if (!nb) continue;
      seams++;
      assert.deepEqual(c.openings[mine], nb.openings[theirs], `seed ${s} ${c.cx},${c.cz} ${mine}`);
      assert.ok(c.openings[mine].length >= 1, 'edge has an opening');
      const open = new Uint8Array(N);
      for (const [a, b] of c.openings[mine]) for (let u = a; u <= b; u++) open[u] = 1;
      for (let u = 0; u < N; u++) {
        const t1 = c.cells[ci(u)], t2 = nb.cells[ni(u)];
        if (open[u]) assert.ok(t1 === EMPTY && t2 === EMPTY && !c.prop[ci(u)] && !nb.prop[ni(u)], `open seam cell blocked ${c.cx},${c.cz} ${mine}@${u}`);
        else assert.ok(t1 === WALL || t1 === COLUMN || t2 === WALL || t2 === COLUMN, `closed seam leaks ${c.cx},${c.cz} ${mine}@${u}`);
      }
    }
  }
  return `${seams} seams`;
});

await test('connectivity, escape routes, 1 m clear width, doors (every chunk)', () => {
  let bad = 0, first = '';
  for (const [s, c] of all) {
    const p = chunkProblems(c);
    if (p.length) { bad++; if (!first) first = `seed ${s} ${c.cx},${c.cz} (${c.kind}): ${p.slice(0, 3).join('; ')}`; }
  }
  assert.equal(bad, 0, first);
  return `${all.length} chunks`;
});

await test('global 1 m-agent reachability across seams (8x8 chunk region, 3 seeds)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    const w = new World(seed);
    const x0 = -4 * N, z0 = -4 * N, S = 8 * N;
    const pass = (ix, iz) => { const t = w.cell(ix, iz); return (t === EMPTY || t === DOOR) && !(t === EMPTY && w.blocksMove(ix, iz)); };
    const fat = new Uint8Array(S * S);
    for (let z = 0; z < S - 1; z++) for (let x = 0; x < S - 1; x++) fat[z * S + x] = pass(x0 + x, z0 + z) && pass(x0 + x + 1, z0 + z) && pass(x0 + x, z0 + z + 1) && pass(x0 + x + 1, z0 + z + 1) ? 1 : 0;
    const sp = w.spawnPoint();
    const sx = cellOf(sp.x) - x0, sz = cellOf(sp.z) - z0;
    const seen = new Uint8Array(S * S);
    const q = [sz * S + sx];
    assert.ok(fat[q[0]], 'spawn has 1 m clearance');
    seen[q[0]] = 1;
    while (q.length) {
      const f = q.pop(), x = f % S, z = (f / S) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= S - 1 || nz >= S - 1) continue;
        const j = nz * S + nx;
        if (!seen[j] && fat[j]) { seen[j] = 1; q.push(j); }
      }
    }
    let unreached = 0;
    for (let f = 0; f < S * S; f++) if (fat[f] && !seen[f]) unreached++;
    assert.equal(unreached, 0, `seed ${seed}: ${unreached} 1 m positions unreachable from spawn`);
  }
});

await test('loops are common (solid islands to circle around)', () => {
  let loops = 0;
  for (const [, c] of all) if (hasLoop(c)) loops++;
  const frac = loops / all.length;
  results.loopFrac = frac;
  assert.ok(frac >= 0.6, `only ${(frac * 100).toFixed(1)}% chunks have an internal loop`);
  return `${(frac * 100).toFixed(1)}% of chunks have an internal loop (plus 4 exits each)`;
});

await test('fixtures: over walkable cells, 0.3 m from walls, 0.6 m tile aligned, sane values', () => {
  let n = 0, flick = 0, off = 0, officeN = 0, officeFlick = 0;
  const w = new World(SEEDS[0]);
  for (const [s, c] of all) {
    if (s !== SEEDS[0]) continue;
    for (const f of c.fixtures) {
      n++;
      assert.ok((f.sx === 0.6 && f.sz === 1.2) || (f.sx === 1.2 && f.sz === 0.6), 'panel size');
      const ex = (f.x - f.sx / 2) / 0.6, ez = (f.z - f.sz / 2) / 0.6;
      assert.ok(Math.abs(ex - Math.round(ex)) < 1e-6 && Math.abs(ez - Math.round(ez)) < 1e-6, `fixture ${f.id} not on 0.6 m tile grid (${f.x}, ${f.z})`);
      assert.ok(f.intensity >= 0.85 && f.intensity <= 1.1, 'intensity');
      const m = 0.3 - 1e-6;
      for (let z = cellOf(f.z - f.sz / 2 - m); z <= cellOf(f.z + f.sz / 2 + m); z++) {
        for (let x = cellOf(f.x - f.sx / 2 - m); x <= cellOf(f.x + f.sx / 2 + m); x++) {
          assert.equal(w.cell(x, z), EMPTY, `fixture ${f.id} over/near wall`);
        }
      }
      if (f.flicker) flick++;
      if (!f.on) off++;
      if (c.zone[0] === ZONE.OFFICE) { officeN++; if (f.flicker) officeFlick++; }
    }
    assert.ok(c.fixtures.length >= 4, `chunk ${c.cx},${c.cz} has only ${c.fixtures.length} fixtures`);
  }
  results.fixturesPerChunk = n / (2 * R) ** 2;
  assert.ok(officeFlick / officeN < 0.03, 'flicker is rare in office');
  assert.ok(off / n < 0.005, `${((off / n) * 100).toFixed(2)}% of fixtures switched off (v3: well lit)`);
  return `${(n / (2 * R) ** 2).toFixed(1)}/chunk, flicker ${((flick / n) * 100).toFixed(1)}% (office ${((officeFlick / officeN) * 100).toFixed(1)}%), off ${((off / n) * 100).toFixed(1)}%`;
});

await test('fixtures never crowd each other, including across chunk seams', () => {
  const w = new World(SEEDS[1]);
  const fx = [];
  for (let cz = -6; cz < 6; cz++) for (let cx = -6; cx < 6; cx++) for (const f of w.getChunk(cx, cz).fixtures) {
    assert.ok(Math.floor(f.x / CHUNK) === cx && Math.floor(f.z / CHUNK) === cz, 'fixture centre inside its chunk');
    fx.push(f);
  }
  let min = Infinity;
  for (let i = 0; i < fx.length; i++) for (let j = i + 1; j < fx.length; j++) {
    const dx = fx[i].x - fx[j].x, dz = fx[i].z - fx[j].z;
    if (Math.abs(dx) < 3 && Math.abs(dz) < 3) min = Math.min(min, Math.hypot(dx, dz));
  }
  assert.ok(min >= 1.8 - 1e-9, `closest fixtures ${min.toFixed(2)} m apart`);
  return `closest pair ${min.toFixed(2)} m over ${fx.length}`;
});

await test('corridor fixtures keep a regular pitch (spawn lane 2.4-3.6 m)', () => {
  const w = new World(1);
  const sp = w.spawnPoint();
  const xs = [];
  for (let cx = -1; cx <= 2; cx++) for (const f of w.getChunk(cx, 0).fixtures) if (Math.abs(f.z - sp.z) < 1.0 && f.x > sp.x - 1 && f.x < sp.x + 40) xs.push(f.x);
  xs.sort((a, b) => a - b);
  assert.ok(xs.length >= 10, `only ${xs.length} lights down the spawn corridor`);
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    assert.ok(gap >= 2.4 - 1e-6 && gap <= 3.6 + 1e-6, `gap ${gap.toFixed(2)} m`);
  }
  return `${xs.length} lights over 40 m`;
});

await test('zone frequencies', () => {
  const z = [0, 0, 0, 0];
  let n = 0;
  for (const seed of SEEDS) {
    for (let cz = -40; cz < 40; cz++) for (let cx = -40; cx < 40; cx++) {
      n++;
      z[zoneOfFast(seed, cx, cz)]++;
    }
  }
  const f = z.map((v) => v / n);
  results.zones = f;
  assert.ok(f[ZONE.MAINT] > 0.04 && f[ZONE.MAINT] < 0.12, `maintenance at ${(f[ZONE.MAINT] * 100).toFixed(1)}%`);
  assert.equal(f[ZONE.DARK], 0, 'v3: no dark zone');
  assert.equal(f[ZONE.WET], 0, 'v3: no wet zone');
  for (const [, c] of all) assert.ok(c.zone[0] !== ZONE.DARK && c.zone[0] !== ZONE.WET, 'no dark or wet chunks');
  return `office ${(f[0] * 100).toFixed(1)}%, maint ${(f[1] * 100).toFixed(1)}%, wet ${(f[2] * 100).toFixed(1)}%, dark ${(f[3] * 100).toFixed(1)}%`;
});

await test('features: required fields, frequencies, recovery alcoves', () => {
  const counts = {};
  let recovery = 0;
  for (const [, c] of all) {
    const ids = new Set();
    const doorIds = new Set(c.doors.map((d) => d.id));
    for (const f of c.features) {
      counts[f.type] = (counts[f.type] || 0) + 1;
      assert.ok(typeof f.type === 'string' && typeof f.id === 'string' && !ids.has(f.id), 'id/type');
      ids.add(f.id);
      for (const k of ['x', 'z', 'yaw', 'w', 'd']) assert.ok(Number.isFinite(f[k]), `${f.type}.${k}`);
      const lx = Math.floor(f.x / CELL) - c.cx * N, lz = Math.floor(f.z / CELL) - c.cz * N;
      assert.ok(lx >= -1 && lz >= -1 && lx <= N && lz <= N, `${f.type} outside its chunk`);
      if (f.type === 'recovery') {
        recovery++;
        const { x0, z0, x1, z1, doorId } = f.data;
        assert.ok(doorIds.has(doorId), 'recovery door exists');
        assert.ok(x1 - x0 >= 2 && z1 - z0 >= 2, 'recovery size');
        for (let z = cellOf(z0 + 0.01); z <= cellOf(z1 - 0.01); z++) for (let x = cellOf(x0 + 0.01); x <= cellOf(x1 - 0.01); x++) {
          assert.equal(c.cells[idx(x - c.cx * N, z - c.cz * N)], EMPTY, 'recovery interior is floor');
        }
      }
      if (f.type === 'phone') assert.ok(c.features.some((d) => d.type === 'desk' && d.id === f.data.deskId), 'phone sits on a desk');
    }
  }
  const per = recovery / all.length;
  results.features = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / all.length).toFixed(3)]));
  results.doorsPerChunk = all.reduce((s, [, c]) => s + c.doors.length, 0) / all.length;
  assert.ok(per >= 1 / 5 && per <= 1 / 3, `recovery alcoves ${per.toFixed(3)}/chunk (want 1 per 3-5)`);
  for (const t of ['chair', 'chairStack', 'pile', 'desk', 'cooler', 'phone', 'sign', 'vent', 'exitSign', 'stain', 'darkTile', 'shelf', 'boxes', 'pipes', 'poster', 'vending', 'tv', 'radio', 'table', 'task', 'meme', 'counter', 'fridge', 'sink']) assert.ok(counts[t] > 0, `no ${t} anywhere`);
  for (const t of ['breaker', 'exitDoor']) assert.ok(!counts[t], `${t} outside a reserved landmark chunk`);
  assert.ok(!counts.puddle, 'no puddles anywhere (wet floor removed)');
  assert.ok(counts.stain / all.length < 1.2, `stains ${(counts.stain / all.length).toFixed(2)}/chunk`);
  assert.ok(results.doorsPerChunk > 0.3 && results.doorsPerChunk < 2, `doors per chunk ${results.doorsPerChunk}`);
  return `recovery ${per.toFixed(3)}/chunk, doors ${results.doorsPerChunk.toFixed(2)}/chunk`;
});

// ---------- v2 layout / features / landmarks ----------
// v1 generator measured with the same code on the same 2904 chunks (6 seeds x 22x22), before the v2 layout pass
const BEFORE = { pillars: 2.011, stubs: 1.766, forest: 0.109, open: 0.301, longSight: 0.586 };
const solidT = (t) => t === WALL || t === COLUMN;

function islands(c) {
  // free-standing solid pieces (not touching the chunk border) by size in cells
  const seen = new Uint8Array(N * N), out = [];
  for (let s = 0; s < N * N; s++) {
    if (seen[s] || !solidT(c.cells[s])) continue;
    let border = false, size = 0;
    const q = [s];
    seen[s] = 1;
    while (q.length) {
      const i = q.pop(), x = i % N, z = (i / N) | 0;
      size++;
      if (x === 0 || z === 0 || x === N - 1 || z === N - 1) border = true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = idx(nx, nz);
        if (!seen[j] && solidT(c.cells[j])) { seen[j] = 1; q.push(j); }
      }
    }
    if (!border) out.push(size);
  }
  return out;
}

await test('layout: far fewer small pillars, more open floor and long sightlines than v1', () => {
  let pillars = 0, stubs = 0, forest = 0, open = 0, walkN = 0;
  const kinds = {};
  for (const [, c] of all) {
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    let p = 0;
    for (const size of islands(c)) {
      if (size <= 9) { pillars++; p++; } // up to a 1.5 m square
      if (size <= 4) stubs++; // up to a 1 m square
    }
    if (p >= 8) forest++;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      if (!walk(c, idx(x, z))) continue;
      walkN++;
      let ok = true;
      for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3 && ok; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nz >= 0 && nx < N && nz < N && solidT(c.cells[idx(nx, nz)])) ok = false;
      }
      if (ok) open++;
    }
  }
  // share of floor on a straight clear run >= 20 m (world scan across seams)
  let lsWalk = 0, lsLong = 0;
  for (const seed of [1, 7, 1337]) {
    const w = new World(seed), S = 16 * N, x0 = -8 * N, z0 = -8 * N;
    const free = new Uint8Array(S * S), mark = new Uint8Array(S * S);
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) free[z * S + x] = w.blocksSight(x0 + x, z0 + z) ? 0 : 1;
    for (let axis = 0; axis < 2; axis++) for (let a = 0; a < S; a++) {
      let st = -1;
      for (let b = 0; b <= S; b++) {
        const i = axis ? b * S + a : a * S + b;
        const f = b < S && free[i];
        if (f && st < 0) st = b;
        if (!f && st >= 0) { if (b - st >= 40) for (let k = st; k < b; k++) mark[axis ? k * S + a : a * S + k] = 1; st = -1; }
      }
    }
    for (let i = 0; i < S * S; i++) if (free[i]) { lsWalk++; if (mark[i]) lsLong++; }
  }
  const n = all.length;
  const m = { pillars: pillars / n, stubs: stubs / n, forest: forest / n, open: open / walkN, longSight: lsLong / lsWalk };
  results.layout = { before: BEFORE, after: m, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v / n])) };
  assert.ok(m.pillars <= BEFORE.pillars * 0.55, `pillars ${m.pillars.toFixed(3)}/chunk`);
  assert.ok(m.stubs <= BEFORE.stubs * 0.2, `small pillars ${m.stubs.toFixed(3)}/chunk`);
  assert.ok(m.forest <= 0.02, `column-forest chunks ${(m.forest * 100).toFixed(1)}%`);
  assert.ok(m.open >= BEFORE.open + 0.07, `open floor share ${(m.open * 100).toFixed(1)}%`);
  assert.ok(m.longSight >= BEFORE.longSight + 0.04, `long sightline share ${(m.longSight * 100).toFixed(1)}%`);
  assert.ok(kinds.corridor / n >= 0.5, 'corridors stay the majority');
  assert.ok(kinds.atrium / n > 0.02 && kinds.atrium / n < 0.1, `atrium share ${kinds.atrium / n}`);
  assert.ok((kinds.columns || 0) / n < 0.06, 'pillar halls are rare');
  const f = (a, b, d = 3) => `${a.toFixed(d)} (v1 ${b.toFixed(d)})`;
  return `pillars/chunk ${f(m.pillars, BEFORE.pillars)}, <=1 m ${f(m.stubs, BEFORE.stubs)}, forest ${f(m.forest, BEFORE.forest)}, open ${f(m.open, BEFORE.open)}, 20 m sightlines ${f(m.longSight, BEFORE.longSight)}`;
});

// wall-mounted feature checks: x,z on a wall face, wall behind, floor in front
function wallFaceProblem(c, f, needFreeFront) {
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
  const along = Math.abs(fx) > 0.5 ? f.x : f.z;
  if (Math.abs(along / CELL - Math.round(along / CELL)) > 1e-6) return 'not on a cell face';
  const bx = cellOf(f.x - fx * 0.25) - c.cx * N, bz = cellOf(f.z - fz * 0.25) - c.cz * N;
  const ax = cellOf(f.x + fx * 0.25) - c.cx * N, az = cellOf(f.z + fz * 0.25) - c.cz * N;
  if (bx < 0 || bz < 0 || bx >= N || bz >= N || c.cells[idx(bx, bz)] !== WALL) return 'no wall behind';
  if (ax < 0 || az < 0 || ax >= N || az >= N || c.cells[idx(ax, az)] !== EMPTY) return 'no floor in front';
  if (needFreeFront && c.prop[idx(ax, az)]) return 'prop in front';
  for (let z = bz - 2; z <= bz + 2; z++) for (let x = bx - 2; x <= bx + 2; x++) {
    if (x >= 0 && z >= 0 && x < N && z < N && c.cells[idx(x, z)] === DOOR) return 'next to a door';
  }
  return null;
}

await test('v2 features: posters on wall faces clear of doors, furniture footprints valid, sane frequencies', () => {
  const counts = {};
  let maxPosters = 0, minGap = Infinity, withFurniture = 0;
  for (const [s, c] of all) {
    const posters = [];
    let furn = false;
    for (const f of c.features) {
      counts[f.type] = (counts[f.type] || 0) + 1;
      const where = `seed ${s} ${c.cx},${c.cz} ${f.type} ${f.id}`;
      if (f.type === 'poster') {
        posters.push(f);
        const p = wallFaceProblem(c, f, true);
        assert.equal(p, null, `${where}: ${p}`);
        // the 1.5 m of wall centred on it is solid wall (never over a door or a corner)
        const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
        const bx = cellOf(f.x - fx * 0.25) - c.cx * N, bz = cellOf(f.z - fz * 0.25) - c.cz * N;
        for (const o of [-1, 1]) {
          const x = bx + (Math.abs(fx) > 0.5 ? 0 : o), z = bz + (Math.abs(fx) > 0.5 ? o : 0);
          assert.equal(c.cells[idx(x, z)], WALL, `${where}: poster overhangs the wall`);
        }
        const { y, h, v } = f.data;
        assert.ok(Number.isInteger(v) && v >= 0 && h > 0.3 && y - h / 2 > 0.8 && y + h / 2 < CEIL_H - 0.3 && f.w > 0.2 && f.w < 1, `${where}: poster data`);
      } else if (f.type === 'vending' || f.type === 'tv') {
        furn = true;
        // floor prop flush against a wall: footprint under the centre, wall right behind the back face
        const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
        const lx = cellOf(f.x) - c.cx * N, lz = cellOf(f.z) - c.cz * N;
        assert.equal(c.prop[idx(lx, lz)], 1, `${where}: no footprint`);
        const bx = cellOf(f.x - fx * (f.d / 2 + 0.1)) - c.cx * N, bz = cellOf(f.z - fz * (f.d / 2 + 0.1)) - c.cz * N;
        assert.equal(c.cells[idx(bx, bz)], WALL, `${where}: not against a wall`);
        if (f.type === 'tv') assert.ok(Number.isInteger(f.data.v), `${where}: tv data`);
      } else if (f.type === 'table') {
        furn = true;
        assert.equal(c.prop[idx(cellOf(f.x) - c.cx * N, cellOf(f.z) - c.cz * N)], 1, `${where}: no footprint`);
      } else if (f.type === 'radio') {
        assert.ok(Number.isFinite(f.data.y) && f.data.y >= 0 && f.data.y < 1.2, `${where}: radio y`);
      }
    }
    if (furn) {
      withFurniture++;
      assert.deepEqual(chunkProblems(c), [], `seed ${s} ${c.cx},${c.cz}: furniture broke connectivity`);
    }
    maxPosters = Math.max(maxPosters, posters.length);
    for (let i = 0; i < posters.length; i++) for (let j = i + 1; j < posters.length; j++) minGap = Math.min(minGap, Math.hypot(posters[i].x - posters[j].x, posters[i].z - posters[j].z));
  }
  const per = (t) => (counts[t] || 0) / all.length;
  results.v2Features = Object.fromEntries(['poster', 'vending', 'table', 'tv', 'radio'].map((t) => [t, +per(t).toFixed(3)]));
  assert.ok(per('poster') >= 0.5 && per('poster') <= 0.9, `posters ${per('poster')}/chunk (v3.1: sparse)`);
  assert.ok(maxPosters <= 7, `wallpapered chunk (${maxPosters} posters)`);
  assert.ok(minGap >= 2 - 1e-9, `posters ${minGap.toFixed(2)} m apart`);
  assert.ok(per('vending') > 0.06 && per('table') > 0.05 && per('tv') > 0.02 && per('radio') > 0.02, 'v2 furniture too rare');
  return `per chunk: poster ${per('poster').toFixed(2)} (max ${maxPosters}, >= ${minGap.toFixed(1)} m apart), vending ${per('vending').toFixed(3)}, table ${per('table').toFixed(3)}, tv ${per('tv').toFixed(3)}, radio ${per('radio').toFixed(3)}; ${withFurniture} furnished chunks re-validated`;
});

function spotProblem(w, sp, cx, cz) {
  if (Math.floor(sp.x / CHUNK) !== cx || Math.floor(sp.z / CHUNK) !== cz) return 'outside its chunk';
  const ix = cellOf(sp.x), iz = cellOf(sp.z);
  if (w.cell(ix, iz) !== EMPTY || w.blocksMove(ix, iz)) return 'not open floor';
  const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
  if (!solidT(w.cell(cellOf(sp.x - fx * 0.5), cellOf(sp.z - fz * 0.5)))) return 'no wall behind';
  if (w.blocksMove(cellOf(sp.x + fx * 0.5), cellOf(sp.z + fz * 0.5))) return 'blocked in front';
  for (let z = iz - 2; z <= iz + 2; z++) for (let x = ix - 2; x <= ix + 2; x++) if (w.cell(x, z) === DOOR) return 'in a door swing';
  // some 1 m (2x2 cell) agent square containing it is open
  let fat = false;
  for (let oz = -1; oz <= 0 && !fat; oz++) for (let ox = -1; ox <= 0 && !fat; ox++) {
    fat = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => !w.blocksMove(ix + ox + a, iz + oz + b));
  }
  return fat ? null : 'no 1 m clearance';
}

await test('findSpot: deterministic, reachable, beside a wall, clear of doors (3 seeds x 256 chunks x 3 kinds)', () => {
  let n = 0, nulls = 0, same = 0;
  for (const seed of SEEDS.slice(0, 3)) {
    const a = new World(seed), b = new World(seed);
    for (let cz = -8; cz < 8; cz++) for (let cx = -8; cx < 8; cx++) {
      const spots = [];
      for (const kind of ['tape', 'almond', 'note']) {
        n++;
        const sp = a.findSpot(cx, cz, { kind });
        assert.deepEqual(b.findSpot(cx, cz, { kind }), sp, 'deterministic');
        if (!sp) { nulls++; continue; }
        const p = spotProblem(a, sp, cx, cz);
        assert.equal(p, null, `seed ${seed} ${cx},${cz} ${kind}: ${p}`);
        spots.push(`${sp.x},${sp.z}`);
      }
      if (spots.length === 3 && new Set(spots).size < 3) same++;
    }
  }
  // reachable from spawn at 1 m width (8x8 chunk region)
  const w = new World(1), x0 = -4 * N, z0 = -4 * N, S = 8 * N;
  // doors never lock, so they count as passable
  const pass = (ix, iz) => { const t = w.cell(ix, iz); return t === DOOR || (t === EMPTY && !w.blocksMove(ix, iz)); };
  const fat = new Uint8Array(S * S), seen = new Uint8Array(S * S);
  for (let z = 0; z < S - 1; z++) for (let x = 0; x < S - 1; x++) fat[z * S + x] = pass(x0 + x, z0 + z) && pass(x0 + x + 1, z0 + z) && pass(x0 + x, z0 + z + 1) && pass(x0 + x + 1, z0 + z + 1) ? 1 : 0;
  const sp0 = w.spawnPoint();
  const q = [(cellOf(sp0.z) - z0) * S + cellOf(sp0.x) - x0];
  seen[q[0]] = 1;
  while (q.length) {
    const f = q.pop(), x = f % S, z = (f / S) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, j = nz * S + nx;
      if (nx >= 0 && nz >= 0 && nx < S - 1 && nz < S - 1 && !seen[j] && fat[j]) { seen[j] = 1; q.push(j); }
    }
  }
  let reached = 0;
  for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) {
    const sp = w.findSpot(cx, cz, { kind: 'tape' });
    if (!sp) continue;
    const x = cellOf(sp.x) - x0, z = cellOf(sp.z) - z0;
    const ok = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dz]) => x + dx >= 0 && z + dz >= 0 && seen[(z + dz) * S + x + dx]);
    assert.ok(ok, `spot in ${cx},${cz} not reachable from spawn`);
    reached++;
  }
  assert.ok(nulls / n < 0.01, `${nulls}/${n} chunks without a spot`);
  assert.ok(same / (n / 3) < 0.05, 'kinds should usually get different spots');
  return `${n - nulls}/${n} spots valid, ${reached} verified reachable from spawn`;
});

await test('reserveLandmark: rules, determinism, connectivity, seams, lit exit, landmarks()', () => {
  const w = new World(9);
  w.update(0, 0);
  assert.equal(w.reserveLandmark(1, 1, 'breaker'), false, 'active chunk refused');
  assert.equal(w.reserveLandmark(40, 0, 'nope'), false, 'bad type');
  const cached = w.getChunk(12, -7);
  assert.equal(w.reserveLandmark(12, -7, 'breaker'), true);
  assert.equal(w.reserveLandmark(12, -7, 'breaker'), true, 'idempotent');
  assert.equal(w.reserveLandmark(12, -7, 'exit'), false, 'one landmark per chunk');
  const re = w.getChunk(12, -7);
  assert.notEqual(re, cached, 'cached copy regenerated');
  assert.equal(re.features.filter((f) => f.type === 'breaker').length, 1);
  assert.deepEqual(re.openings, cached.openings, 'edges never change');
  assert.equal(w.reserveLandmark(-15, 18, 'exit'), true);
  const lm = w.landmarks();
  assert.equal(lm.length, 2);
  for (const l of lm) {
    const f = w.getChunk(l.cx, l.cz).features.find((t) => t.id === l.id);
    assert.ok(f && f.type === (l.type === 'exit' ? 'exitDoor' : 'breaker') && f.x === l.x && f.z === l.z, 'landmarks() points at the feature');
  }
  let n = 0, ms = 0;
  for (const seed of SEEDS.slice(0, 3)) {
    const a = new World(seed), b = new World(seed);
    for (let k = 0; k < 40; k++) {
      const cx = ((k * 7) % 23) - 11 + (k > 20 ? 30 : 0), cz = ((k * 13) % 19) - 9;
      if (cx >= -1 && cx <= 2 && cz === 0) continue;
      const type = k & 1 ? 'exit' : 'breaker';
      a.reserveLandmark(cx, cz, type);
      b.reserveLandmark(cx, cz, type);
      const t0 = performance.now();
      const c = a.getChunk(cx, cz);
      ms += performance.now() - t0;
      n++;
      assert.equal(ser(c), ser(b.getChunk(cx, cz)), 'deterministic');
      assert.equal(ser(c), ser(generateChunk(seed, cx, cz, type)), 'pure function of (seed, cx, cz, type)');
      assert.ok(!c.invalid && c.landmark === type, 'valid');
      const where = `seed ${seed} ${cx},${cz} ${type}`;
      assert.deepEqual(chunkProblems(c), [], where);
      // seams agree with the (unreserved) neighbours
      for (const [dx, dz, mine, theirs, ci, ni] of [[1, 0, 'e', 'w', (u) => idx(N - 1, u), (u) => idx(0, u)], [-1, 0, 'w', 'e', (u) => idx(0, u), (u) => idx(N - 1, u)], [0, 1, 's', 'n', (u) => idx(u, N - 1), (u) => idx(u, 0)], [0, -1, 'n', 's', (u) => idx(u, 0), (u) => idx(u, N - 1)]]) {
        const nb = a.getChunk(cx + dx, cz + dz);
        assert.deepEqual(c.openings[mine], nb.openings[theirs], `${where} ${mine}`);
        const open = new Uint8Array(N);
        for (const [p, q] of c.openings[mine]) for (let u = p; u <= q; u++) open[u] = 1;
        for (let u = 0; u < N; u++) {
          const t1 = c.cells[ci(u)], t2 = nb.cells[ni(u)];
          if (open[u]) assert.ok(t1 === EMPTY && t2 === EMPTY && !c.prop[ci(u)], `${where} open seam blocked`);
          else assert.ok(solidT(t1) || solidT(t2), `${where} closed seam leaks`);
        }
      }
      const ft = c.features.filter((f) => f.type === (type === 'exit' ? 'exitDoor' : 'breaker'));
      assert.equal(ft.length, 1, `${where}: one landmark feature`);
      const f = ft[0];
      const p = wallFaceProblem(c, f, true);
      assert.equal(p, null, `${where}: ${p}`);
      if (type === 'breaker') {
        assert.equal(f.data.id, `breaker:${cx},${cz}`);
        assert.equal(c.zone[0], ZONE.MAINT, 'breaker chunks are maintenance');
        assert.equal(c.doors.length >= 1, true, 'storage room has a door');
      } else {
        assert.deepEqual(f.data, {});
        const ex = f.x - Math.sin(f.yaw) * 0.3, ez = f.z - Math.cos(f.yaw) * 0.3;
        const near = c.fixtures.filter((x) => Math.hypot(x.x - ex, x.z - ez) < 4.5 && a.lineOfSight(ex, ez, x.x, x.z));
        assert.ok(near.length >= 1 && near.every((x) => x.on && !x.flicker), `${where}: exit room lit`);
        assert.ok(!c.features.some((x) => x.type === 'darkTile' && Math.hypot(x.x - ex, x.z - ez) < 4.5 && a.lineOfSight(ex, ez, x.x, x.z)), 'no dead panels over the exit');
      }
      // the landmark is reachable: floor in front is inside the 1 m agent's space (chunkProblems proves it connects)
      const sp = a.findSpot(cx, cz, { kind: 'tape' });
      if (sp) assert.equal(spotProblem(a, sp, cx, cz), null, `${where}: findSpot in landmark chunk`);
    }
  }
  results.landmarkGenMs = ms / n;
  assert.ok(ms / n < 1, `landmark chunk gen ${(ms / n).toFixed(3)} ms`);
  return `${n} reserved chunks valid, avg gen ${(ms / n).toFixed(3)} ms`;
});

// ---------- v3 tasks and meme props ----------
// 'mop' was removed on user request: the world never generates it
const TASK_KINDS = ['cardSwipe', 'wires', 'touchGrass', 'fixLight', 'straighten', 'router', 'copier', 'microwave', 'vendingStuck', 'timesheet', 'skibidi'];
const MEME_KINDS = ['prime', 'grimace', 'crewmate', 'grassBlock', 'ohio', 'chillGuy', 'shrek', 'chungus', 'doge', 'sus', 'trollface', 'stanley', 'nerd', 'fanumTax', 'skibidi'];
const WALL_TASKS = new Set(['cardSwipe', 'wires', 'straighten']);
const FLOOR_TASKS = new Set(['touchGrass', 'fixLight', 'router', 'copier', 'vendingStuck', 'skibidi']);
const WALL_MEMES = new Set(['nerd', 'sus', 'trollface']);
const SURFACE = new Set(['grimace', 'stanley']);
// hallway task stations (plus any meme prop out in the open) for the sprint-density check
const HALL_TASKS = new Set(['cardSwipe', 'wires', 'fixLight', 'straighten', 'touchGrass']);

// wall behind, floor in front (card readers may sit beside doors)
function mountProblem(c, f) {
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
  const along = Math.abs(fx) > 0.5 ? f.x : f.z;
  if (Math.abs(along / CELL - Math.round(along / CELL)) > 1e-6) return 'not on a cell face';
  const b = idx(cellOf(f.x - fx * 0.25) - c.cx * N, cellOf(f.z - fz * 0.25) - c.cz * N);
  const a = idx(cellOf(f.x + fx * 0.25) - c.cx * N, cellOf(f.z + fz * 0.25) - c.cz * N);
  if (c.cells[b] !== WALL) return 'no wall behind';
  if (c.cells[a] !== EMPTY) return 'no floor in front';
  return null;
}

await test('v3 tasks + memes: valid kinds, placement, links, footprints', () => {
  const tk = {}, mk = {};
  for (const [s, c] of all) {
    const byId = new Map(c.features.map((f) => [f.id, f]));
    const fixById = new Map(c.fixtures.map((f) => [f.id, f]));
    const onProp = (f) => c.prop[idx(cellOf(f.x) - c.cx * N, cellOf(f.z) - c.cz * N)] === 1;
    for (const f of c.features) {
      const where = `seed ${s} ${c.cx},${c.cz} ${f.type}/${f.data && f.data.kind} ${f.id}`;
      if (f.type === 'task') {
        const k = f.data.kind;
        tk[k] = (tk[k] || 0) + 1;
        assert.ok(TASK_KINDS.includes(k), `${where}: unknown task kind`);
        if (WALL_TASKS.has(k)) {
          const p = mountProblem(c, f);
          assert.equal(p, null, `${where}: ${p}`);
          assert.ok(f.data.y > 0.8 && f.data.y < 2, `${where}: mount height`);
        }
        if (FLOOR_TASKS.has(k)) assert.ok(onProp(f), `${where}: floor task without a footprint`);
        if (k === 'cardSwipe' && f.data.doorId) {
          const d = c.doors.find((x) => x.id === f.data.doorId);
          assert.ok(d, `${where}: reader door missing`);
          assert.ok(Math.hypot((d.ix + 1) * CELL - f.x, (d.iz + 1) * CELL - f.z) < 2, `${where}: reader not beside its door`);
        }
        if (k === 'fixLight') {
          const fx = fixById.get(f.data.fixtureId);
          assert.ok(fx && fx.on && fx.flicker, `${where}: fixLight fixture must exist, be on and flicker`);
          assert.ok(Math.abs(fx.x - f.x) < 0.8 && Math.abs(fx.z - f.z) < 0.8, `${where}: ladder not under its light`);
        }
        if (k === 'straighten') {
          const p = byId.get(f.data.posterId);
          assert.ok(p && p.type === 'poster' && p.data.crooked && p.x === f.x && p.z === f.z, `${where}: straighten needs a crooked poster`);
        }
        if (k === 'microwave') assert.equal(byId.get(f.data.counterId)?.type, 'counter', `${where}: microwave on a counter`);
        if (k === 'timesheet') assert.equal(byId.get(f.data.deskId)?.type, 'desk', `${where}: timesheet on a desk`);
      } else if (f.type === 'meme') {
        const k = f.data.kind;
        mk[k] = (mk[k] || 0) + 1;
        assert.ok(MEME_KINDS.includes(k), `${where}: unknown meme kind`);
        if (WALL_MEMES.has(k)) assert.equal(mountProblem(c, f), null, where);
        else if (SURFACE.has(k)) assert.equal(f.data.y, 0.75, `${where}: surface height`);
        else if (k === 'fanumTax') assert.equal(byId.get(f.data.fridgeId)?.type, 'fridge', `${where}: note on a fridge`);
        else assert.ok(onProp(f), `${where}: floor meme without a footprint`);
      } else if (f.type === 'breaker') assert.equal(f.data.task, 'wires');
      else if (f.type === 'counter' || f.type === 'fridge' || f.type === 'sink') assert.ok(onProp(f), `${f.type} footprint`);
    }
  }
  for (const k of TASK_KINDS) assert.ok(tk[k] > 0, `no ${k} task anywhere`);
  for (const k of MEME_KINDS) assert.ok(mk[k] > 0, `no ${k} meme anywhere`);
  const per = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / all.length).toFixed(3)]));
  results.tasks = per(tk);
  results.memes = per(mk);
  return `${TASK_KINDS.length} task kinds, ${MEME_KINDS.length} meme kinds, all links valid`;
});

await test('v3 density (sparse): occasional discoveries, 6+ tasks within 120 m of spawn in every direction', () => {
  let tasks = 0, memes = 0, hall = 0, withAny = 0, maxMemes = 0;
  const kinds = {}, mkinds = {};
  for (const [, c] of all) {
    let any = 0, m = 0;
    for (const f of c.features) {
      if (f.type === 'task') { tasks++; any++; kinds[f.data.kind] = (kinds[f.data.kind] || 0) + 1; if (HALL_TASKS.has(f.data.kind)) hall++; }
      if (f.type === 'meme') { memes++; any++; m++; mkinds[f.data.kind] = (mkinds[f.data.kind] || 0) + 1; }
    }
    if (any) withAny++;
    maxMemes = Math.max(maxMemes, m);
  }
  const n = all.length;
  results.taskDensity = { tasks: tasks / n, memes: memes / n, hallTasks: hall / n, chunksWithStation: withAny / n };
  assert.ok(tasks / n >= 0.45 && tasks / n <= 0.7, `tasks ${(tasks / n).toFixed(2)}/chunk (want ~0.5-0.6)`);
  assert.ok(hall / n >= 0.18 && hall / n <= 0.35, `hallway tasks ${(hall / n).toFixed(2)}/chunk (want ~0.25)`);
  assert.ok(!kinds.mop, 'no mop tasks anywhere (removed on user request)');
  assert.ok(memes / n >= 0.2 && memes / n <= 0.4 && maxMemes <= 2, `memes ${(memes / n).toFixed(2)}/chunk, max ${maxMemes}`);
  for (const [k, v] of Object.entries(mkinds)) assert.ok(v / memes <= 0.2, `meme ${k} dominates (${((v / memes) * 100).toFixed(0)}%)`);
  let worst = Infinity, worst45 = Infinity;
  for (let seed = 1; seed <= 10; seed++) {
    const w = new World(seed);
    const sp = w.spawnPoint();
    const near = w.tasksNear(sp.x, sp.z, 120);
    for (let i = 1; i < near.length; i++) assert.ok(Math.hypot(near[i].x - sp.x, near[i].z - sp.z) >= Math.hypot(near[i - 1].x - sp.x, near[i - 1].z - sp.z) - 1e-9, 'sorted');
    const sectors = new Array(8).fill(0);
    for (const f of near) sectors[Math.floor(((Math.atan2(f.z - sp.z, f.x - sp.x) + Math.PI) / (2 * Math.PI)) * 8) & 7]++;
    const quads = [0, 2, 4, 6].map((i) => sectors[i] + sectors[i + 1]);
    worst = Math.min(worst, ...quads);
    worst45 = Math.min(worst45, ...sectors);
    assert.ok(Math.min(...quads) >= 6, `seed ${seed}: 90 degree quadrants ${quads.join(',')}`);
    // the first work order is easy to find: tasks within 40 m, one of them on the spawn lane wall in view
    const first = w.tasksNear(sp.x, sp.z, 40);
    assert.ok(first.length >= 1, `seed ${seed}: no task within 40 m`);
    assert.deepEqual(new World(seed).tasksNear(sp.x, sp.z, 40).map((f) => f.id), w.tasksNear(sp.x, sp.z, 40).map((f) => f.id), 'deterministic');
    const t = w.tasksNear(sp.x, sp.z, 120, 'copier')[0];
    if (t) assert.equal(w.findTask(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK), 'copier').data.kind, 'copier');
  }
  return `tasks ${(tasks / n).toFixed(2)}/chunk (hallway ${(hall / n).toFixed(2)}, no mop), memes ${(memes / n).toFixed(2)}/chunk (max ${maxMemes}), ${((withAny / n) * 100).toFixed(1)}% of chunks have one; within 120 m of spawn min ${worst} per quadrant, ${worst45} per 45 deg`;
});

await test('spawn: long readable corridor looking down its length', () => {
  for (const seed of SEEDS) {
    const w = new World(seed);
    const sp = w.spawnPoint();
    const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
    assert.equal(w.getChunk(Math.floor(sp.x / CHUNK), Math.floor(sp.z / CHUNK)).zone[0], ZONE.OFFICE);
    assert.ok(!w.blocksMove(cellOf(sp.x), cellOf(sp.z)), 'spawn walkable');
    assert.ok(w.lineOfSight(sp.x, sp.z, sp.x + fx * 35, sp.z + fz * 35), `35 m ahead visible (seed ${seed})`);
    // corridor 3-4 m wide at spawn with walls both sides
    let l = 0, r = 0;
    while (!w.blocksSight(cellOf(sp.x), cellOf(sp.z - (l + 1) * CELL))) l++;
    while (!w.blocksSight(cellOf(sp.x), cellOf(sp.z + (r + 1) * CELL))) r++;
    const width = (l + r + 1) * CELL;
    assert.ok(width >= 3 && width <= 4, `spawn corridor width ${width}`);
  }
});

await test('spawn phone: desk + ringing phone 10-30 m ahead, visible, off the hero sightline (400 seeds)', () => {
  let dmin = Infinity, dmax = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const w = new World(seed);
    const sp = w.spawnPoint();
    const phones = [];
    for (let cx = -2; cx <= 3; cx++) for (let cz = -1; cz <= 1; cz++) for (const f of w.getChunk(cx, cz).features) if (f.type === 'phone' && f.data.spawn) phones.push([w.getChunk(cx, cz), f]);
    assert.equal(phones.length, 1, `seed ${seed}: ${phones.length} spawn phones`);
    const [c, ph] = phones[0];
    assert.equal(ph.data.ringing, true);
    const desk = c.features.find((f) => f.id === ph.data.deskId);
    assert.ok(desk && desk.type === 'desk', `seed ${seed}: phone not on a desk`);
    const d = Math.hypot(ph.x - sp.x, ph.z - sp.z);
    dmin = Math.min(dmin, d);
    dmax = Math.max(dmax, d);
    assert.ok(d >= 10 && d <= 30, `seed ${seed}: phone ${d.toFixed(1)} m from spawn`);
    assert.ok(ph.x - sp.x >= 6, `seed ${seed}: phone inside the first 6 m of the lane`);
    assert.ok(w.lineOfSight(sp.x, sp.z, ph.x, ph.z), `seed ${seed}: phone not visible from spawn`);
    // desk flush on a lane side wall, footprint real, wall behind it
    const fx = -Math.sin(desk.yaw), fz = -Math.cos(desk.yaw);
    assert.ok(w.blocksMove(cellOf(desk.x), cellOf(desk.z)), 'desk footprint');
    assert.equal(w.cell(cellOf(desk.x - fx * (desk.d / 2 + 0.1)), cellOf(desk.z - fz * (desk.d / 2 + 0.1))), WALL, `seed ${seed}: desk not against a wall`);
    // the middle 1.5 m of the lane stays clear from spawn to past the desk
    for (let x = sp.x; x < ph.x + 3; x += CELL) for (let z = SPAWN_LANE[0] + 2; z <= SPAWN_LANE[1] - 2; z++) {
      assert.ok(!w.blocksMove(cellOf(x), z), `seed ${seed}: hero sightline blocked at ${x}`);
    }
    // deterministic
    const again = new World(seed).getChunk(c.cx, c.cz).features.find((f) => f.type === 'phone' && f.data.spawn);
    assert.deepEqual(again, ph);
    // first work order: a wiring panel on the lane wall, in view, within 40 m
    const st = c.features.filter((f) => f.type === 'task' && f.data.spawn);
    assert.equal(st.length, 1, `seed ${seed}: spawn task`);
    const t = st[0];
    assert.equal(mountProblem(c, t), null, `seed ${seed}: spawn task mount`);
    const td = Math.hypot(t.x - sp.x, t.z - sp.z);
    assert.ok(td <= 40 && t.x - sp.x >= 6, `seed ${seed}: spawn task ${td.toFixed(1)} m`);
    assert.ok(w.lineOfSight(sp.x, sp.z, t.x - Math.sin(t.yaw) * 0.3, t.z - Math.cos(t.yaw) * 0.3), `seed ${seed}: spawn task not in view`);
  }
  for (const [, c] of all) for (const f of c.features) if (f.type === 'phone' && f.data.spawn) assert.ok(c.cx === 1 && c.cz === 0, 'spawn phone only in the spawn lane');
  return `400/400 seeds, phone ${dmin.toFixed(1)}-${dmax.toFixed(1)} m from spawn, phone + first task in view`;
});

await test('spawn jukebox: once per seed, 8-15 m ahead, visible, on a lane wall, clear of desk/task and the hero strip (500 seeds)', () => {
  let dmin = Infinity, dmax = 0, inNext = 0;
  const box = (f) => { const c = Math.abs(Math.cos(f.yaw)), s = Math.abs(Math.sin(f.yaw)); const hx = (f.w * c + f.d * s) / 2, hz = (f.w * s + f.d * c) / 2; return [f.x - hx, f.z - hz, f.x + hx, f.z + hz]; };
  const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  for (let seed = 1; seed <= 500; seed++) {
    const w = new World(seed);
    const sp = w.spawnPoint();
    const found = [];
    for (let cx = -2; cx <= 3; cx++) for (let cz = -1; cz <= 1; cz++) for (const f of w.getChunk(cx, cz).features) if (f.type === 'jukebox') found.push([w.getChunk(cx, cz), f]);
    assert.equal(found.length, 1, `seed ${seed}: ${found.length} jukeboxes`);
    const [c, j] = found[0];
    const where = `seed ${seed} jukebox ${j.id}`;
    assert.ok(c.cz === 0 && (c.cx === 0 || c.cx === 1), `${where}: outside the spawn lane chunks`);
    if (c.cx === 1) inNext++;
    assert.equal(j.data.spawn, true);
    assert.ok(Math.abs(j.w - 1) < 0.15 && Math.abs(j.d - 0.6) < 0.15, `${where}: size ${j.w} x ${j.d}`);
    const d = Math.hypot(j.x - sp.x, j.z - sp.z);
    dmin = Math.min(dmin, d);
    dmax = Math.max(dmax, d);
    assert.ok(d >= 8 && d <= 15, `${where}: ${d.toFixed(1)} m from spawn`);
    assert.ok(j.x > sp.x, `${where}: behind the spawn`);
    assert.ok(w.lineOfSight(sp.x, sp.z, j.x, j.z), `${where}: not visible from spawn`);
    // floor prop flush on a lane side wall, facing into the lane
    const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw);
    assert.ok(Math.abs(fx) < 1e-9 && Math.sign(fz) === Math.sign(sp.z - j.z), `${where}: not facing the lane`);
    assert.equal(c.prop[idx(cellOf(j.x) - c.cx * N, cellOf(j.z) - c.cz * N)], 1, `${where}: no footprint`);
    assert.equal(w.cell(cellOf(j.x - fx * (j.d / 2 + 0.1)), cellOf(j.z - fz * (j.d / 2 + 0.1))), WALL, `${where}: not against a wall`);
    assert.deepEqual(chunkProblems(c), [], `${where}: footprint broke connectivity/clear width`);
    // the middle 1.5 m of the lane stays clear past it
    for (let x = sp.x; x < j.x + 3; x += CELL) for (let z = SPAWN_LANE[0] + 2; z <= SPAWN_LANE[1] - 2; z++) {
      assert.ok(!w.blocksMove(cellOf(x), z), `${where}: hero strip blocked at ${x}`);
    }
    // clear of the spawn desk/phone and the first wires panel
    const lane = w.getChunk(1, 0).features;
    const ph = lane.find((f) => f.type === 'phone' && f.data.spawn);
    const desk = lane.find((f) => f.id === ph.data.deskId);
    assert.ok(!overlap(box(j), box(desk)), `${where}: overlaps the spawn desk`);
    assert.ok(Math.hypot(j.x - ph.x, j.z - ph.z) >= 1.2, `${where}: on top of the spawn phone`);
    const st = lane.find((f) => f.type === 'task' && f.data.spawn);
    assert.ok(Math.hypot(j.x - st.x, j.z - st.z) >= 1.2, `${where}: under the spawn wires panel`);
    // deterministic, also when the next chunk is generated first
    const w2 = new World(seed);
    w2.getChunk(1, 0);
    assert.deepEqual(w2.getChunk(c.cx, c.cz).features.find((f) => f.type === 'jukebox'), j, `${where}: not deterministic`);
  }
  let total = 0;
  for (const [, c] of all) for (const f of c.features) if (f.type === 'jukebox') {
    total++;
    assert.ok(c.cz === 0 && (c.cx === 0 || c.cx === 1), 'jukebox only in the spawn lane');
  }
  assert.equal(total, SEEDS.length, 'one jukebox per seed');
  return `500/500 seeds, jukebox ${dmin.toFixed(1)}-${dmax.toFixed(1)} m from spawn (${inNext} in chunk 1,0), in view`;
});

await test('far coordinates (cx = 20000) generate and query correctly', () => {
  const w = new World(3);
  for (const [cx, cz] of [[20000, 0], [-20000, 19999], [32000, -32000]]) {
    const c = w.getChunk(cx, cz);
    assert.equal(c.cx, cx);
    assert.deepEqual(chunkProblems(c), []);
    const ix = cx * N + 5, iz = cz * N + 7;
    assert.equal(w.cell(ix, iz), c.cells[idx(5, 7)]);
    for (const f of c.fixtures) assert.ok(Math.floor(f.x / CHUNK) === cx && Math.floor(f.z / CHUNK) === cz, 'fixture in chunk');
    const [a] = c.openings.n[0];
    const x = (cx * N + a + 1) * CELL, z = cz * CHUNK + 0.25;
    assert.ok(w.lineOfSight(x, z, x, z - 0.5), 'los across seam in opening');
    w.update(cx * CHUNK + 8, cz * CHUNK + 8);
    assert.ok(w.active.has(chunkKey(cx, cz)));
  }
});

await test('doors animate and gate movement/sight', () => {
  const w = new World(1);
  let door = null;
  for (let cz = -4; cz < 4 && !door; cz++) for (let cx = -4; cx < 4 && !door; cx++) door = w.getChunk(cx, cz).doors[0] || null;
  assert.ok(door, 'found a door');
  const ox = door.axis === 'x' ? 1 : 0, oz = 1 - ox;
  assert.equal(w.doorAt(door.ix, door.iz), door);
  assert.equal(w.doorAt(door.ix + ox, door.iz + oz), door);
  assert.equal(w.doorAt(door.ix - ox, door.iz - oz), null);
  w.update(door.ix * CELL, door.iz * CELL);
  w.setDoorTarget(door, 0);
  for (let i = 0; i < 100; i++) w.tickDoors(1 / 60);
  assert.equal(door.openT, 0);
  assert.ok(w.blocksMove(door.ix, door.iz) && w.blocksSight(door.ix, door.iz));
  w.setDoorTarget(door, 1);
  for (let i = 0; i < 100; i++) w.tickDoors(1 / 60);
  assert.equal(door.openT, 1);
  assert.ok(!w.blocksMove(door.ix, door.iz) && !w.blocksSight(door.ix, door.iz));
});

await test('hot-path queries are fast and allocation free', async () => {
  const w = new World(1);
  w.update(8, 8);
  const pts = new Float64Array(4096);
  for (let i = 0; i < pts.length; i++) pts[i] = ((i * 2654435761) % 1000) / 1000 * 80 - 40;
  // warm up (jit + chunk generation)
  let acc = 0;
  const run = (iters) => {
    for (let i = 0; i < iters; i++) {
      const a = pts[i & 4095], b = pts[(i * 7 + 3) & 4095];
      const ix = cellOf(a), iz = cellOf(b);
      if (w.blocksMove(ix, iz)) acc++;
      if (w.blocksSight(ix + 1, iz)) acc++;
      acc += w.cell(ix, iz - 1);
      if (w.doorAt(ix, iz) !== null) acc++;
    }
  };
  const los = (iters) => { for (let i = 0; i < iters; i++) if (w.lineOfSight(pts[i & 4095] * 0.5, pts[(i + 9) & 4095] * 0.5, pts[(i + 17) & 4095] * 0.5, pts[(i + 33) & 4095] * 0.5)) acc++; };
  run(200000);
  los(20000);
  globalThis.gc?.();
  let gcs = 0;
  const obs = new PerformanceObserver((list) => { gcs += list.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  const t0 = performance.now();
  run(2000000);
  const t1 = performance.now();
  los(100000);
  const t2 = performance.now();
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  const nsPer = ((t1 - t0) * 1e6) / 8e6;
  const losUs = ((t2 - t1) * 1e3) / 1e5;
  assert.ok(gcs === 0, `${gcs} gc cycles during hot loop (allocation suspected)`);
  assert.ok(nsPer < 60, `${nsPer.toFixed(1)} ns per query`);
  return `${nsPer.toFixed(1)} ns/query, ${losUs.toFixed(2)} us/lineOfSight (~20 m), 0 gc`;
});

console.log('\n  summary', JSON.stringify(results, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v)));
if (failures) {
  console.log(`\n  ${failures} world test(s) failed`);
  process.exit(1);
}
