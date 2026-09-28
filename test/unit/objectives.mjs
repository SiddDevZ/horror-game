// v3 objective chain: placement plan, checklist state machine, inventory rules, the first-encounter schedule
// around the M.E.G. call, and a node run of the whole chain (phone -> 6 work orders -> 3 breaker panels ->
// exit -> win -> restart) against the real World + Game. exits non-zero on failure.
import { planRun, Checklist, Inventory, STEP_IDS } from '../../src/game/Objectives.js';
import { OBJ, ITEMS, DIRECTOR as D } from '../../src/game/tuning.js';
import { TASK_KINDS } from '../../src/game/Tasks.js';
import { World } from '../../src/world/World.js';
import { Game } from '../../src/game/Game.js';
import { events } from '../../src/core/events.js';
import { CELL, CELL_TYPE, EYE_H } from '../../src/world/constants.js';

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};

// ---- plan: deterministic from the seed, ranges, spread ----
{
  const a = planRun(1337, 1.25, 8.25), b = planRun(1337, 1.25, 8.25), c = planRun(1338, 1.25, 8.25);
  check(JSON.stringify(a) === JSON.stringify(b), 'same world seed gives the same plan');
  check(JSON.stringify(a) !== JSON.stringify(c), 'a different seed gives a different plan');
  const bad = [];
  let minLand = Infinity, minSpawn = Infinity;
  for (let s = 0; s < 400; s++) {
    const p = planRun(s * 7919 + 3, 1.25, 8.25);
    for (const t of p.breakers) if (t.d < OBJ.breakerRange[0] || t.d > OBJ.breakerRange[1]) bad.push(`${s}: breaker ${t.d.toFixed(0)}`);
    if (p.exit.d < OBJ.exitRange[0] + 10 || p.exit.d > OBJ.exitRange[1] - 10) bad.push(`${s}: exit ${p.exit.d.toFixed(0)}`);
    const land = [...p.breakers, p.exit];
    for (let i = 0; i < land.length; i++) {
      minSpawn = Math.min(minSpawn, Math.max(Math.abs(land[i].cx), Math.abs(land[i].cz)));
      for (let j = i + 1; j < land.length; j++) minLand = Math.min(minLand, Math.max(Math.abs(land[i].cx - land[j].cx), Math.abs(land[i].cz - land[j].cz)));
    }
    const all = [...land, ...p.airhorns, ...p.almonds, ...p.notes];
    if (new Set(all.map((q) => `${q.cx},${q.cz}`)).size !== all.length) bad.push(`${s}: shared chunk`);
  }
  check(bad.length === 0, `400 seeds: landmark distances in range, one target per chunk (${bad.slice(0, 4).join('; ') || 'none bad'})`);
  check(minLand >= 3 && minSpawn >= 5, `landmark chunks spread (min gap ${minLand} chunks) and outside the spawn window (min ${minSpawn} chunks)`);
}

// ---- checklist state machine ----
{
  const k = new Checklist(6, 3);
  check(k.activeId === 'phone' && !k.canBreaker && !k.powered, 'starts on the phone step');
  check(k.addTask() === 1 && k.activeId === 'phone', 'a task done before the phone still counts, list stays in order');
  check(k.addBreaker() === 0, 'breakers refuse before the work orders are done');
  check(k.answerPhone() && !k.answerPhone() && k.activeId === 'tasks', 'phone answers once, then work orders are active');
  for (let i = 0; i < 8; i++) k.addTask();
  check(k.tasks === 6 && k.canBreaker && k.activeId === 'breakers' && k.addTask() === 0, 'work orders cap at 6 and unlock the breakers');
  check(!k.openExit() && !k.win(), 'exit stays shut without power');
  const p0 = k.progress01;
  k.addBreaker(); k.addBreaker();
  check(k.progress01 > p0 && !k.powered, 'progress rises per breaker');
  k.addBreaker();
  check(k.powered && k.addBreaker() === 0 && k.activeId === 'exit', 'three breakers power the exit');
  check(!k.win() && k.openExit() && k.win() && !k.win() && k.activeId === null && k.progress01 === 1, 'exit opens, then walking through wins exactly once');
  const l = k.list();
  check(l.length === 4 && l.map((x) => x.id).join() === STEP_IDS.join() && l.every((x) => x.done && typeof x.text === 'string'), 'obj:update list shape { id, text, done, progress, total, active }');
  k.reset();
  const ls = k.list([{ text: 'Mop the puddle (10 m)', done: false }]);
  check(ls[0].active && ls[0].sub?.length === 1 && !ls[1].sub, 'sub items hang under the active step only');
}

// ---- inventory rules ----
{
  const inv = new Inventory();
  check(inv.drink(10, 16) === 'none', 'drinking with no almond water is refused');
  for (let i = 0; i < 5; i++) inv.addAlmond();
  check(inv.almond === ITEMS.almondMax && !inv.addAlmond(), `almond water caps at ${ITEMS.almondMax}`);
  check(inv.drink(16, 16) === 'full' && inv.almond === 3, 'drinking at full hearts is refused and keeps the bottle');
  check(inv.drink(10, 16) === 'ok' && inv.almond === 2, 'drinking hurt consumes one');
  check(inv.addAirhornCharge() && inv.airhorn === 1, 'a task reward adds one airhorn charge');
  check(inv.addAirhorn() === 'refill' && inv.airhorn === ITEMS.airhornMax && !inv.addAirhornCharge() && inv.addAirhorn() === 'full', 'airhorn pickup fills to max, charges cap');
}

// ---- world-backed runs ----
const settings = { get: (k) => ({ sensitivity: 1, fov: 74, headBob: 0.6, shake: 0.6, sprintMode: 'hold' })[k], on() {} };
function makeGame(seed, noDirector = true, eseed = 9) {
  const world = new World(seed);
  const sp = world.spawnPoint();
  world.update(sp.x, sp.z);
  const game = new Game({ world, settings, events, params: { encounterSeed: eseed, seed, autostart: true, noDirector }, spawn: sp });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.update(1 / 60); world.update(game.player.x, game.player.z); } };
  return { world, game, sp, tick };
}
const rec = [];
for (const n of ['obj:update', 'inv:update', 'toast', 'lore:open', 'lore:close', 'game:win', 'item:spawn', 'item:remove', 'feature:state', 'task:open', 'task:result', 'task:close']) events.on(n, (p) => rec.push([n, p]));
const count = (n) => rec.filter((r) => r[0] === n).length;

// finish whatever task panel is open through the real TaskBoard mechanics
function solve(game, f, breaker = false) {
  const b = game.tasks;
  if (!b.open(f, breaker)) return false;
  const r = b.active.run;
  const step = (held) => game.tasks.update(1 / 60, held);
  if (r.ui === 'press') { for (let i = 0; i < 6 && !r.done; i++) { b.down(); for (let k = 0; k < 30; k++) step(false); } }
  else if (r.ui === 'hold') { for (let i = 0; i < 600 && !r.done; i++) step(true); }
  else if (r.ui === 'swipe') { b.down(); const [a, c] = r.spec.window; while (r.t < (a + c) / 2) step(true); b.up(); }
  else if (r.ui === 'wires') { for (let i = 0; i < 4; i++) b.key(r.expectKey()); }
  for (let i = 0; i < 60; i++) step(false);
  return r.done;
}

// ---- first encounter waits for the call ----
{
  const A = makeGame(1337, false, 21);
  A.game.start();
  const warnAt = (ctx, max) => { for (let i = 0; i < max * 60; i++) { ctx.tick(1); if (ctx.game.director.state === 'WARNING') return ctx.game.director.t; } return null; };
  const ignored = warnAt(A, 40);
  check(ignored >= D.firstNoCall[0] && ignored <= D.firstNoCall[1] + 1.5, `phone ignored: first warning at ${ignored?.toFixed(2)} s (~${D.firstNoCall.join('-')})`);
  const B = makeGame(1337, false, 22);
  B.game.start();
  B.tick(60);
  const o = B.game.objectives;
  o.useFeature(o.phoneFeature());
  check(B.game.reading === 'lore' && o.check.phone, 'director on: answering the spawn phone opens the briefing');
  B.tick(60);
  const closeAt = B.game.director.t;
  B.game.closeLore();
  const w = warnAt(B, 20);
  check(w !== null && w - closeAt >= D.firstAfterCall[0] - 0.05 && w - closeAt <= D.firstAfterCall[1] + 1.5 && B.game.director.charId === 'kanye', `kanye crashes the call: warning ${(w - closeAt).toFixed(2)} s after the briefing closes (${D.firstAfterCall.join('-')})`);
  // answering during an encounter still completes the step; the briefing waits for calm
  const C = makeGame(1337, false, 23);
  C.game.start();
  C.game.director.forceEncounter('kanye');
  C.tick(90);
  const oc = C.game.objectives;
  const answered = C.game.enemy.active && oc.useFeature(oc.phoneFeature());
  check(answered && oc.check.phone && !C.game.reading && oc.loreQueue[0]?.title?.includes('LANDLINE'), 'answering mid-encounter completes the phone step, briefing queued for calm');
}

for (const seed of [1337, 7, 90210]) {
  rec.length = 0;
  const { world, game, sp, tick } = makeGame(seed);
  const o = game.objectives, p = game.player;
  check(o.phone.spawn && !o.phone.virtual && o.phone.dist >= 8 && o.phone.dist <= 32, `seed ${seed}: M.E.G. phone is the world's spawn desk phone ${o.phone.id} at ${o.phone.dist.toFixed(1)} m`);
  check(o.items.every((i) => world.cell(Math.floor(i.x / CELL), Math.floor(i.z / CELL)) === CELL_TYPE.EMPTY && !world.blocksMove(Math.floor(i.x / CELL), Math.floor(i.z / CELL))), `seed ${seed}: all ${o.items.length} pickups sit on open floor`);
  check(o.breakers.every((b) => !b.virtual) && !o.exit.virtual && o.exit.dist >= OBJ.exitRange[0] && o.exit.dist <= OBJ.exitRange[1], `seed ${seed}: breakers ${o.breakers.map((b) => b.dist.toFixed(0)).join('/')} m + exit ${o.exit.dist.toFixed(0)} m are real reserved landmarks`);

  game.start();
  tick(1);
  check(o.near.length === 3 && o.near.every((t) => TASK_KINDS[t.kind]), `seed ${seed}: nearby tasks ${o.near.map((t) => `${t.kind}@${t.dist.toFixed(0)}`).join(', ')}`);

  // any ringing phone answers the call (not just the spawn one)
  const other = (() => { for (let r = 0; r <= 4; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) for (const f of world.getChunk(Math.floor(sp.x / 16) + dx, Math.floor(sp.z / 16) + dz).features) if (f.type === 'phone' && f.id !== o.phone.id) return f; return null; })();
  const ph = other || o.phoneFeature();
  o.useFeature(ph);
  check(o.check.phone && game.reading === 'lore', `seed ${seed}: answering ${other ? 'a different ringing phone' : 'the spawn phone'} completes the phone step`);
  game.closeLore();
  tick(2);
  const obj = rec.filter((r) => r[0] === 'obj:update').slice(-1)[0][1];
  check(obj.activeId === 'tasks' && obj.list[1].sub?.length === 3 && game.frame.compass.id === 'tasks' && Math.abs(game.frame.compass.dist - o.near[0].dist) < 1, `seed ${seed}: checklist names nearby tasks (${obj.list[1].sub.map((s) => s.text).join('; ')}), compass -> nearest ${game.frame.compass.dist.toFixed(1)} m`);

  // look-at cone picks the nearest task prop from in front of it
  const t0 = o.near[0].f;
  p.x = p.prevX = t0.x - Math.sin(t0.yaw) * 1.3; p.z = p.prevZ = t0.z - Math.cos(t0.yaw) * 1.3;
  const ty = t0.data && Number.isFinite(t0.data.y) ? t0.data.y : 1.0;
  p.yaw = Math.atan2(-(t0.x - p.x), -(t0.z - p.z)); p.pitch = Math.atan2(ty - EYE_H, Math.hypot(t0.x - p.x, t0.z - p.z));
  game.interact._scan();
  check(game.interact.kind === 'task' && game.interact.feature?.id === t0.id, `seed ${seed}: look-at targets the ${t0.data.kind} task (${game.interact._label()})`);

  // breakers stay locked before the work orders
  const b0 = o.breakers[0], bf = { ...world.getChunk(Math.floor(b0.x / 16), Math.floor(b0.z / 16)).features.find((f) => f.id === b0.id) };
  o.useFeature(bf);
  check(!game.tasks.active, `seed ${seed}: breaker panel refuses before the work orders`);

  // six work orders: nearest first; the first five send tape logs
  const kinds = [];
  for (let i = 0; i < 6; i++) {
    o._scanTasks();
    const t = o.near[0];
    p.x = p.prevX = t.x; p.z = p.prevZ = t.z;
    kinds.push(t.kind);
    solve(game, t.f);
    tick(80);
    if (game.reading) game.closeLore();
  }
  check(o.check.tasks === 6 && o.check.activeId === 'breakers' && count('lore:open') === 6, `seed ${seed}: 6 work orders (${kinds.join(', ')}), 5 tape logs read (${count('lore:open') - 1})`);
  const doneStates = new Set(rec.filter((r) => r[0] === 'feature:state' && r[1].type === 'task' && r[1].state === 'done').map((r) => r[1].id)).size;
  check(doneStates === 6 && count('task:result') >= 6, `seed ${seed}: feature:state task done x${doneStates}`);

  // breaker panels are wires tasks
  for (const b of o.breakers) {
    const f = world.getChunk(Math.floor(b.x / 16), Math.floor(b.z / 16)).features.find((q) => q.id === b.id);
    p.x = p.prevX = b.x; p.z = p.prevZ = b.z;
    o.useFeature(f);
    const opened = game.tasks.active && game.tasks.active.kind === 'wires' && game.tasks.active.breaker;
    const r = game.tasks.active.run;
    for (let k = 0; k < 4; k++) game.tasks.key(r.expectKey());
    tick(60);
    if (!opened) check(false, `seed ${seed}: breaker ${b.id} did not open as wires`);
  }
  // unique ids: finished props are replayed when their chunk streams back in
  const on = new Set(rec.filter((r) => r[0] === 'feature:state' && r[1].type === 'breaker' && r[1].state === 'on').map((r) => r[1].id)).size;
  check(o.breakers.every((b) => b.on) && on === 3 && o.exit.state === 'powered', `seed ${seed}: three breaker wiring panels power the exit`);
  check(game.director.difficulty >= 0.5, `seed ${seed}: director difficulty ${game.director.difficulty.toFixed(2)} at progress ${o.progress01.toFixed(2)}`);

  // exit: walk up to it -> opens -> win
  const ex = o.exit;
  p.x = p.prevX = ex.x - Math.sin(ex.yaw) * 3.5; p.z = p.prevZ = ex.z - Math.cos(ex.yaw) * 3.5;
  tick(2);
  p.x = p.prevX = ex.x - Math.sin(ex.yaw) * 0.6; p.z = p.prevZ = ex.z - Math.cos(ex.yaw) * 0.6;
  tick(2);
  const win = rec.find((r) => r[0] === 'game:win');
  check(game.state === 'won' && !!win && win[1].tasks === 6 && win[1].tapes === 5 && win[1].time > 0, `seed ${seed}: game:win ${JSON.stringify(win && win[1])}`);

  // restart resets everything
  const spawnsBefore = count('item:spawn');
  game.restart();
  check(o.check.activeId === 'phone' && o.check.tasks === 0 && o.breakers.every((b) => !b.on) && o.exit.state === 'locked' && game.tasks.done.size === 0 && o.inv.almond === 0 && o.items.every((i) => !i.taken), `seed ${seed}: restart resets checklist, tasks, breakers, exit, inventory`);
  check(count('item:spawn') - spawnsBefore === o.items.length && game.state === 'playing' && !game.reading && o.phoneFeature().answered === false, `seed ${seed}: restart re-publishes pickups, spawn phone rings again`);
}

// ---- rewards, drinking and the airhorn in the sim ----
{
  const { game, tick: tick0 } = makeGame(1337);
  const o = game.objectives, p = game.player;
  // these tasks count as work orders too, so tape cards open: dismiss them like a player would
  const tick = (n) => { for (let i = 0; i < n; i++) { tick0(1); if (game.reading) game.closeLore(); } };
  game.start();
  tick(1);
  const find = (kind) => game.world.tasksNear ? game.world.tasksNear(p.x, p.z, 120, kind)[0] : null;
  const mw = find('microwave'), rt = find('router');
  if (mw) { p.x = p.prevX = mw.x; p.z = p.prevZ = mw.z; solve(game, mw); }
  if (rt) { p.x = p.prevX = rt.x; p.z = p.prevZ = rt.z; solve(game, rt); }
  check(!mw || o.inv.almond === 1, `microwave pays almond water (${o.inv.almond})`);
  check(!rt || o.inv.airhorn === 1, `router pays an airhorn charge (${o.inv.airhorn})`);
  p.hp = 10;
  check(game.drink(), 'drink starts');
  tick(2);
  check(game.frame.viewmodel.item === 'almond' && game.frame.viewmodel.useT > 0, 'viewmodel shows the bottle while drinking');
  tick(Math.ceil(ITEMS.drinkTime * 60) + 2);
  check(p.hp === 10 + ITEMS.almondHeal && !game.useKind, `almond water heals +1 heart after ${ITEMS.drinkTime}s (hp ${p.hp})`);
  o.inv.addAirhorn();
  game.director.forceEncounter('trump');
  let blasted = false, stunStart = -1, stunEnd = -1, knock = 0, e0 = null;
  for (let i = 0; i < 60 * 20 && stunEnd < 0; i++) {
    tick(1);
    const e = game.enemy, d = game.director;
    if (!blasted && e.active && d.los && d.straight < ITEMS.airhornRange - 1) { e0 = { d: d.straight }; blasted = game.airhorn(); stunStart = d.t; }
    if (blasted && stunEnd < 0 && e.mode !== 'stun') { stunEnd = d.t; knock = Math.hypot(e.x - p.x, e.z - p.z) - e0.d; }
  }
  check(blasted && Math.abs(stunEnd - stunStart - ITEMS.airhornStun) < 0.1 && knock > 1, `airhorn stuns ${(stunEnd - stunStart).toFixed(2)}s at ${e0 && e0.d.toFixed(1)} m, knocked back ${knock.toFixed(1)} m`);
}

console.log(failed ? `\n${failed} objective check(s) failed` : '\nobjectives: all checks passed');
if (failed) process.exitCode = 1;
