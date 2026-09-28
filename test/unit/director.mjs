// character selection rules and distributions (pure logic, many seeds). exits non-zero on failure.
import { createSelector, selectionWeights, CHAR_IDS } from '../../src/game/characters.js';
import { hash32 } from '../../src/core/rng.js';
import { World } from '../../src/world/World.js';
import { Game } from '../../src/game/Game.js';
import { Nav, F_SCRATCH, INF, CLOSED_BLOCK, CLOSED_ENEMY } from '../../src/game/Nav.js';
import { events } from '../../src/core/events.js';
import { DIRECTOR as DT } from '../../src/game/tuning.js';

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};
const near = (v, want, tol) => Math.abs(v - want) <= tol;
const pct = (n, d) => (d ? n / d : 0);

const SEEDS = 20000;
const LEN = 30;
const runs = [];
for (let s = 0; s < SEEDS; s++) {
  const sel = createSelector(hash32(s, 77));
  for (let i = 0; i < LEN; i++) sel.commit();
  runs.push(sel.history);
}

// encounter 1 always kanye
check(runs.every((h) => h[0] === 'kanye'), 'encounter 1 is always kanye');

// user rules (2026-09-27): never the same villain twice in a row; a villain from two encounters ago returns
// only with a small chance; unseen / long-absent villains are strongly favoured.
let immediate = 0;
for (const h of runs) for (let i = 1; i < h.length; i++) if (h[i] === h[i - 1]) immediate++;
check(immediate === 0, `never the same villain twice in a row (found ${immediate})`);

// encounter 2: kanye excluded, epstein/trump 50/50
const e2 = { kanye: 0, epstein: 0, trump: 0 };
for (const h of runs) e2[h[1]]++;
check(e2.kanye === 0 && near(pct(e2.epstein, SEEDS), 0.5, 0.02), `encounter 2 split epstein ${pct(e2.epstein, SEEDS).toFixed(3)} trump ${pct(e2.trump, SEEDS).toFixed(3)} (want .50/.50, never kanye)`);

// encounter 3 strongly favours the villain not seen yet (~90%), the two-ago one is a small chance
const unseen3 = runs.filter((h) => h[2] !== h[0] && h[2] !== h[1]).length;
check(near(pct(unseen3, SEEDS), 0.9, 0.02), `encounter 3 picks the unseen villain ${pct(unseen3, SEEDS).toFixed(3)} (want ~.90)`);

// later: a villain from two encounters ago (A B A) is a minority pick, the longer-absent one is favoured
let later = 0, twoAgo = 0;
const totals = { kanye: 0, epstein: 0, trump: 0 };
for (const h of runs) {
  for (let i = 3; i < h.length; i++) {
    later++;
    if (h[i] === h[i - 2]) twoAgo++;
    totals[h[i]]++;
  }
}
check(pct(twoAgo, later) > 0.05 && pct(twoAgo, later) < 0.3, `villain from two encounters ago returns ${(100 * pct(twoAgo, later)).toFixed(1)}% of the time (small but possible)`);
const share = CHAR_IDS.map((c) => pct(totals[c], later));
check(share.every((x) => near(x, 1 / 3, 0.04)), `long-run share ${share.map((x) => x.toFixed(3)).join('/')} (each ~.333)`);

// determinism: same seed, same sequence; forced picks count as committed history
const a = createSelector(99), b = createSelector(99);
for (let i = 0; i < 12; i++) { a.commit(); b.commit(); }
check(a.history.join() === b.history.join(), 'same encounter seed gives the same sequence');
const f = createSelector(5);
f.commit('trump');
f.commit();
check(f.history[0] === 'trump' && f.count === 2, 'forced encounters are recorded as committed');

// weights never produce a zero total
let zero = 0;
for (const h of runs.slice(0, 2000)) for (let i = 0; i < h.length; i++) { const w = selectionWeights(h.slice(0, i)); if (w[0] + w[1] + w[2] <= 0) zero++; }
check(zero === 0, 'selection weights always have a positive total');


// ---- doors: villains never open them; a closed door is a wall for them (user rule, 2026-09-27) ----
{
  const settings = { get: (k) => ({ sensitivity: 1, fov: 74, headBob: 0.6, shake: 0.6, sprintMode: 'hold' })[k], on() {} };
  const world = new World(1337);
  const sp = world.spawnPoint();
  world.update(sp.x, sp.z);
  const game = new Game({ world, settings, events, params: { encounterSeed: 31, seed: 1337, autostart: true, noDirector: true }, spawn: sp });
  game.start();
  const p = game.player, e = game.enemy, d = game.director;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.update(1 / 60); world.update(p.x, p.z); } };
  // a one-door recovery alcove near spawn (a sealable room)
  let alc = null, door = null;
  for (let cz = -2; cz <= 2 && !alc; cz++) for (let cx = -2; cx <= 2 && !alc; cx++) {
    const c = world.getChunk(cx, cz);
    for (const f of c.features) if (f.type === 'recovery' && f.data && f.data.doorId) { const dr = c.doors.find((q) => q.id === f.data.doorId); if (dr) { alc = f; door = dr; break; } }
  }
  check(!!alc, `found a one-door alcove ${alc?.id} (door ${door?.id})`);
  const r = alc.data, x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), z0 = Math.min(r.z0, r.z1), z1 = Math.max(r.z0, r.z1);
  const inside = (x, z, m = 0) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
  const dcx = (door.ix + (door.axis === 'x' ? 1 : 0.5)) * 0.5, dcz = (door.iz + (door.axis === 'x' ? 0.5 : 1)) * 0.5;
  const setDoor = (open) => { world.setDoorTarget(door, open ? 1 : 0); for (let i = 0; i < 60 && door.openT !== door.target; i++) tick(1); };
  p.x = p.prevX = (x0 + x1) / 2; p.z = p.prevZ = (z0 + z1) / 2;
  setDoor(false);
  tick(30);

  // nav: closed door blocks the enemy's fields and walkable(); bots (the player) still walk through
  const nav = game.nav;
  nav.build(F_SCRATCH, p.x, p.z, 40, CLOSED_BLOCK);
  const outX = dcx + (door.axis === 'x' ? 0 : dcx > p.x ? 1.5 : -1.5), outZ = dcz + (door.axis === 'x' ? (dcz > p.z ? 1.5 : -1.5) : 0);
  // straight through the doorway on its centre line
  const inX = dcx - (door.axis === 'x' ? 0 : dcx > p.x ? 0.9 : -0.9), inZ = dcz - (door.axis === 'x' ? (dcz > p.z ? 0.9 : -0.9) : 0);
  const blockedOut = nav.dist(F_SCRATCH, outX, outZ);
  nav.build(F_SCRATCH, p.x, p.z, 40, CLOSED_ENEMY);
  const costOut = nav.dist(F_SCRATCH, outX, outZ);
  const botNav = new Nav(world, 96);
  botNav.ensureWindow(p.x, p.z);
  check(blockedOut === Infinity && costOut > 20 && !nav.walkable(inX, inZ, outX, outZ, 0.3) && botNav.walkable(inX, inZ, outX, outZ, 0.3), `closed door: blocked field, enemy route +${costOut.toFixed(1)} m, enemy walkable() false, player-side walkable() true`);

  // hiding: the encounter spawns outside the sealed room, camps at the door, never enters, and resolves
  d.forceEncounter('kanye');
  tick(2);
  const spawnIn = e.active && inside(e.x, e.z, 0.2);
  let crossed = 0, nearDoor = 0, t0 = d.t, ended = null, maxSpeedAtDoor = 0;
  for (let i = 0; i < 60 * 45 && ended === null; i++) {
    tick(1);
    if (e.active && inside(e.x, e.z, 0.1)) crossed++;
    if (e.active && Math.hypot(e.x - dcx, e.z - dcz) < 2.5) { nearDoor++; if (e.doorWait) maxSpeedAtDoor = Math.max(maxSpeedAtDoor, e.spd); }
    if (d.cur && d.cur.result) ended = d.t - t0;
  }
  const res = d.encountersLog[0];
  const why = d.log.find((x) => x.ev === 'escape')?.why;
  check(d.sealed && !spawnIn && crossed === 0 && ended !== null && why === 'camped', `sealed in: spawned outside (sealed ${d.sealed}), camped ${(nearDoor / 60).toFixed(1)} s within 2.5 m of the door, never inside, then gave up ("${why}") ${ended?.toFixed(1)} s after the spawn`);
  tick(60 * 8);
  check(!e.active && (d.state === 'RECOVERY' || d.state === 'EXPLORING'), `the camper leaves (${d.state}, enemy ${e.active ? 'active' : 'gone'})`);

  // long camp (escape held off), then the player opens the door: pursuit resumes and it comes in
  const saved = { minChase: DT.minChase, slowChaseMax: DT.slowChaseMax };
  DT.minChase = 1e9; DT.slowChaseMax = 1e9;
  d.recoveryT = 0;
  d.forceEncounter('trump');
  let campT = 0, crossed2 = 0, waitSpeed = 0, flips = 0, lastSign = 0;
  for (let i = 0; i < 60 * 20; i++) {
    tick(1);
    if (!e.active) continue;
    d.chaseCap = 1e9; // this check holds the camp open past its 10-15 s budget
    if (inside(e.x, e.z, 0.1)) crossed2++;
    if (e.doorWait && Math.hypot(e.x - dcx, e.z - dcz) < 2.5) {
      campT += 1 / 60;
      waitSpeed = Math.max(waitSpeed, e.spd);
      const sgn = Math.sign(Math.round(e.vx * 10)) || 0;
      if (sgn && lastSign && sgn !== lastSign) flips++;
      if (sgn) lastSign = sgn;
    }
  }
  check(e.active && crossed2 === 0 && campT > 8 && flips <= 2, `camps ${campT.toFixed(1)} s at the closed door without crossing, no oscillation (${flips} heading flips, peak speed ${waitSpeed.toFixed(2)} m/s)`);
  setDoor(true);
  let inAt = -1;
  for (let i = 0; i < 60 * 8 && inAt < 0; i++) { tick(1); if (e.active && inside(e.x, e.z, 0.1)) inAt = i / 60; if (d.cur && d.cur.result === 'hit') inAt = i / 60; }
  check(inAt >= 0, `door opened: the villain comes in ${inAt.toFixed(2)} s later`);
  Object.assign(DT, saved);

  // closing a door on an enemy in the doorway: E refuses; a forced close pushes it to the nearer side
  game.restart();
  tick(2);
  d.forceEncounter('epstein');
  tick(2);
  p.x = p.prevX = (x0 + x1) / 2; p.z = p.prevZ = (z0 + z1) / 2;
  setDoor(true);
  const nx = door.axis === 'x' ? 0 : 1, nz = door.axis === 'x' ? 1 : 0;
  e.x = e.prevX = dcx + nx * 0.12; e.z = e.prevZ = dcz + nz * 0.12;
  const refused = !game.interact.setDoor(door, false, dcx, dcz);
  world.setDoorTarget(door, 0);
  for (let i = 0; i < 60; i++) tick(1);
  const side = (e.x - dcx) * nx + (e.z - dcz) * nz;
  check(refused && !world.blocksMove(Math.floor(e.x / 0.5), Math.floor(e.z / 0.5)) && side > 0.2, `door closed on a villain mid-doorway: E refused ${refused}, forced close pushed it out to the nearer side (${side.toFixed(2)} m)`);
}

console.log(failed ? `\n${failed} director check(s) failed` : '\ndirector: all checks passed');
if (failed) process.exitCode = 1;
