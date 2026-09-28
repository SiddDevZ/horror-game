// node-only headless gameplay simulation (no browser, no chrome lock). runs the real Game + World
// with recording audio/settings mocks and scripted bots, and prints measured timings.
// usage: node test/scripts/game-sim.mjs [escape|idle|slow|walk|chars|long|all] [--seeds=12] [--world=1337]
import { World } from '../../src/world/World.js';
import { Game } from '../../src/game/Game.js';
import { events } from '../../src/core/events.js';
import { Bot } from './game-bot.mjs';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const which = argv.find((a) => !a.startsWith('--')) || 'all';
const SEEDS = +(opt.seeds || 12);
const WORLD_SEED = +(opt.world || 1337);
const FRAME = 1 / 60;

const DEFAULTS = { sensitivity: 1, invertY: false, sprintMode: 'hold', fov: 74, headBob: 0.6, shake: 0.6 };
const settings = { get: (k) => DEFAULTS[k], on() {} };

function makeAudio() {
  const calls = { enemyStart: [], enemyStop: 0, sfx: {}, enemyUpdate: 0, setListener: 0 };
  return {
    calls,
    setListener() { calls.setListener++; },
    enemyStart(id) { calls.enemyStart.push(id); },
    enemyUpdate(x, y, z, m) { calls.enemyUpdate++; calls.lastMuffle = m; },
    enemyStop() { calls.enemyStop++; },
    sfx(name) { calls.sfx[name] = (calls.sfx[name] || 0) + 1; },
    setChase() {}, pauseAll() {}, resumeAll() {}, stopAll() {},
  };
}

function makeGame(eseed, wseed = WORLD_SEED) {
  const world = new World(wseed);
  const spawn = world.spawnPoint();
  world.update(spawn.x, spawn.z);
  const audio = makeAudio();
  const game = new Game({ world, renderer: null, audio, settings, events, params: { encounterSeed: eseed, seed: wseed }, spawn });
  game.start();
  game.closeLore(); // dismiss the v2 intro card like a player would
  // v3: answer the M.E.G. call and dismiss the briefing, so the first encounter lands 3-5 s later
  game.objectives.useFeature(game.objectives.phoneFeature());
  game.closeLore();
  return { world, game, audio };
}

function tick(ctx, bot) {
  bot?.update(FRAME);
  ctx.game.update(FRAME);
  ctx.world.update(ctx.game.player.x, ctx.game.player.z);
}

const stat = (a) => {
  if (!a.length) return 'n=0';
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return `n=${a.length} min=${s[0].toFixed(1)} p25=${q(0.25).toFixed(1)} med=${q(0.5).toFixed(1)} mean=${mean.toFixed(1)} p75=${q(0.75).toFixed(1)} max=${s[s.length - 1].toFixed(1)}`;
};

// competent runner for a long session per seed: escape durations, catches, per-character numbers
function escapeRun(seconds = 150, mode = 'runner', react = 0.3) {
  const byChar = { kanye: [], epstein: [], trump: [] };
  const all = [], reveals = [], commits = [], firsts = [], spawnPaths = [];
  const why = {};
  let hits = 0, deaths = 0, encounters = 0, searched = 0, trackMismatch = 0, forced = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const ctx = makeGame(1000 + s);
    const bot = new Bot(ctx.game, { mode, seed: s, react });
    const steps = seconds / FRAME;
    for (let i = 0; i < steps && ctx.game.state === 'playing'; i++) tick(ctx, bot);
    const d = ctx.game.director;
    for (const r of d.encountersLog) {
      encounters++;
      if (r.revealT != null) commits.push(r.chaseT != null ? r.chaseT - r.revealT : NaN);
      if (r.n === 1 && r.revealT != null) firsts.push(r.revealT);
      spawnPaths.push(r.spawnPath);
      if (r.forcedReveal) forced++;
      if (r.result === 'escape') { all.push(r.escapeDur); byChar[r.charId].push(r.escapeDur); }
      if (r.result === 'hit') hits++;
      if (r.result === 'death') deaths++;
      if (r.reacquires) searched++;
    }
    for (const x of d.log) if (x.ev === 'escape') why[x.why] = (why[x.why] || 0) + 1;
    const committedWithReveal = d.encountersLog.filter((r) => r.revealT != null && r.endT != null && r.endT - r.revealT > 0.3).length;
    if (ctx.audio.calls.enemyStart.length > d.encountersLog.length) trackMismatch++;
    console.log(`seed ${s}: enc ${d.encountersLog.length} esc ${d.escapes} ${ctx.game.state} chars ${d.selector.history.join(',')} starts ${ctx.audio.calls.enemyStart.length} stops ${ctx.audio.calls.enemyStop} rejected ${d.rejected} dist ${ctx.game.player.distance.toFixed(0)}m nav ${ctx.game.nav.stats.maxMs.toFixed(1)}ms max`);
    void committedWithReveal;
  }
  console.log(`\n== ${mode} bot (reacts ${react} s after reveal, sprints) ==`);
  console.log('first reveal time (s):', stat(firsts));
  console.log('reveal -> pursuit (s):', stat(commits.filter(Number.isFinite)));
  console.log('spawn path distance (m):', stat(spawnPaths));
  console.log('escape duration from pursuit start (s):', stat(all));
  for (const k of Object.keys(byChar)) console.log(`  ${k}:`, stat(byChar[k]));
  console.log(`encounters ${encounters}, escapes ${all.length}, hits ${hits}, deaths ${deaths}, forced reveals ${forced}, runs with reacquire ${searched}, runs with more track starts than encounters ${trackMismatch}`);
  const in815 = all.filter((x) => x >= 8 && x <= 15).length;
  console.log('escape reasons', JSON.stringify(why));
  console.log(`escapes within 8-15 s: ${in815}/${all.length}`);
  return { all, byChar };
}

// stand still from the start: first reveal, then catch -> second chance -> death
function idleRun() {
  console.log('\n== idle player (never moves) ==');
  const firsts = [], hitT = [], deathT = [], protects = [];
  for (let s = 1; s <= SEEDS; s++) {
    const ctx = makeGame(2000 + s);
    const bot = new Bot(ctx.game, { mode: 'idle' });
    let death = null;
    const off = events.on('game:death', (p) => (death = p));
    for (let i = 0; i < 120 / FRAME && ctx.game.state === 'playing'; i++) tick(ctx, bot);
    off();
    const d = ctx.game.director;
    const L = d.log;
    const rev = L.find((x) => x.ev === 'reveal');
    const hit = L.find((x) => x.ev === 'hit');
    const dth = L.find((x) => x.ev === 'death');
    if (rev) firsts.push(rev.t);
    if (hit) hitT.push(hit.t);
    if (dth) deathT.push(dth.t);
    if (hit && dth) protects.push(dth.t - hit.t);
    console.log(`seed ${s}: reveal ${rev?.t} hit ${hit?.t} death ${dth?.t} state ${ctx.game.state} line "${death?.line}" states ${L.filter((x) => /^[A-Z]/.test(x.ev)).map((x) => x.ev[0] + x.ev.slice(1, 3).toLowerCase()).join('>')}`);
  }
  console.log('first reveal (s):', stat(firsts));
  console.log('first catch (s):', stat(hitT));
  console.log('death (s):', stat(deathT));
  console.log('hit -> death gap (s):', stat(protects));
}

// runner until the first escape, then stop dead: escape -> warning cue and -> reveal
function slowRun(mode = 'idle') {
  console.log(`\n== slowdown after escape (${mode}) ==`);
  const warn = [], reveal = [];
  for (let s = 1; s <= SEEDS; s++) {
    const ctx = makeGame(3000 + s);
    const runner = new Bot(ctx.game, { mode: 'runner', seed: s });
    const after = new Bot(ctx.game, { mode, seed: s + 99 });
    let escT = -1, slowStart = -1;
    for (let i = 0; i < 200 / FRAME && ctx.game.state === 'playing'; i++) {
      const d = ctx.game.director;
      const bot = escT < 0 ? runner : after;
      tick(ctx, bot);
      if (escT < 0 && d.state === 'ESCAPED') escT = d.t;
      if (escT >= 0 && slowStart < 0 && ctx.game.player.speed < 4.2) slowStart = d.t;
      if (escT >= 0 && d.log.some((x) => x.t > escT && x.ev === 'reveal')) break;
    }
    const d = ctx.game.director;
    const w = d.log.find((x) => x.t > escT && x.ev === 'WARNING');
    const r = d.log.find((x) => x.t > escT && x.ev === 'reveal');
    if (escT >= 0 && w) warn.push(w.t - slowStart);
    if (escT >= 0 && r) reveal.push(r.t - slowStart);
    console.log(`seed ${s}: escape ${escT.toFixed(2)} slow from ${slowStart.toFixed(2)} warning +${w ? (w.t - slowStart).toFixed(2) : '-'} reveal +${r ? (r.t - slowStart).toFixed(2) : '-'}`);
  }
  console.log('slowdown -> WARNING (s):', stat(warn));
  console.log('slowdown -> reveal (s):', stat(reveal));
}

// keep sprinting after an escape: gap to the next encounter
function sprintGap() {
  console.log('\n== keep sprinting after escape: escape -> next WARNING ==');
  const gaps = [];
  for (let s = 1; s <= SEEDS; s++) {
    const ctx = makeGame(4000 + s);
    const bot = new Bot(ctx.game, { mode: 'runner', seed: s });
    for (let i = 0; i < 180 / FRAME && ctx.game.state === 'playing'; i++) tick(ctx, bot);
    const L = ctx.game.director.log;
    for (let i = 0; i < L.length; i++) {
      if (L[i].ev !== 'ESCAPED') continue;
      const nw = L.slice(i).find((x) => x.ev === 'WARNING');
      if (nw) gaps.push(nw.t - L[i].t);
    }
  }
  console.log('escape -> next WARNING while sprinting (s):', stat(gaps));
}

// each character forced: spawn, move, audio start once, despawn
function charsRun() {
  console.log('\n== forced encounters per character ==');
  for (const id of ['kanye', 'epstein', 'trump']) {
    const ctx = makeGame(5000);
    ctx.game.params.noDirector = true;
    const bot = new Bot(ctx.game, { mode: 'runner', seed: 7 });
    for (let i = 0; i < 1 / FRAME; i++) tick(ctx, bot);
    ctx.game.director.forceEncounter(id);
    let moved = 0, despawnAt = null;
    for (let i = 0; i < 60 / FRAME && ctx.game.state === 'playing'; i++) {
      tick(ctx, bot);
      if (ctx.game.enemy.active) moved = ctx.game.enemy.moved;
      if (!ctx.game.enemy.active && ctx.game.director.encounters > 0 && despawnAt == null) despawnAt = ctx.game.director.t;
      if (despawnAt != null && ctx.game.director.state === 'EXPLORING') break;
    }
    const d = ctx.game.director, r = d.encountersLog[0];
    console.log(`${id}: committed ${d.selector.history.join(',')} result ${r?.result} reveal ${r?.revealT} chase ${r?.chaseT} end ${r?.endT} dur ${r?.escapeDur} moved ${moved.toFixed(1)}m despawn ${despawnAt?.toFixed(2)} enemyStart ${JSON.stringify(ctx.audio.calls.enemyStart)} stops ${ctx.audio.calls.enemyStop} sting ${ctx.audio.calls.sfx.sting || 0} pins ${ctx.world.stats().pinned}`);
  }
}

// long session: timer drift and heap growth
function longRun(minutes = 10) {
  console.log(`\n== long session ${minutes} min (runner) ==`);
  const ctx = makeGame(6001);
  const bot = new Bot(ctx.game, { mode: 'runner', seed: 3 });
  const frames = (minutes * 60) / FRAME;
  global.gc?.();
  const h0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  let worst = 0;
  for (let i = 0; i < frames; i++) {
    const a = performance.now();
    tick(ctx, bot);
    const b = performance.now() - a;
    if (b > worst) worst = b;
    if (ctx.game.state === 'dead') ctx.game.restart();
  }
  const wall = performance.now() - t0;
  global.gc?.();
  const h1 = process.memoryUsage().heapUsed;
  const g = ctx.game;
  console.log(`game frames ${frames} wall ${(wall / 1000).toFixed(1)}s avg ${(wall / frames).toFixed(3)}ms worst ${worst.toFixed(1)}ms (includes bot planning)`);
  console.log(`sim time ${g.director.t.toFixed(2)}s vs frames*dt ${(minutes * 60).toFixed(2)}s (director clock resets on restart; runs ${g.run + 1})`);
  console.log(`heap ${(h0 / 1e6).toFixed(1)}MB -> ${(h1 / 1e6).toFixed(1)}MB, nav builds ${g.nav.stats.builds} max ${g.nav.stats.maxMs.toFixed(2)}ms grids ${g.nav.stats.grids}, world ${JSON.stringify(ctx.world.stats())}`);
}

// allocation probe: no bot (bots allocate), input mutated in place; counts heap growth between gcs
async function allocRun() {
  console.log('\n== per-frame allocation probe (game.update + world.update only) ==');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const ctx = makeGame(7001);
  const v = ctx.game.input.set({ fwd: 1, strafe: 0, sprint: true, lookYaw: 0 });
  let gcs = 0, gcMax = 0, gcSum = 0;
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) { gcs++; gcSum += e.duration; if (e.duration > gcMax) gcMax = e.duration; } });
  obs.observe({ entryTypes: ['gc'] });
  let t = 0, since = 0, drift = 0;
  const frame = () => { t += FRAME; since += FRAME; v.lookYaw = t * 0.35; v.sprint = (t % 20) < 14; ctx.game.update(FRAME); ctx.world.update(ctx.game.player.x, ctx.game.player.z); drift = Math.max(drift, Math.abs(since - ctx.game.director.t - ctx.game.acc)); if (ctx.game.state === 'dead') { ctx.game.restart(); since = 0; } };
  for (let i = 0; i < 3600; i++) frame();
  global.gc?.();
  await new Promise((r) => setTimeout(r, 50));
  gcs = 0; gcMax = 0; gcSum = 0;
  let grew = 0, prev = process.memoryUsage().heapUsed;
  const N = 36000;
  const states = {};
  for (let i = 0; i < N; i++) {
    frame();
    states[ctx.game.director.state] = (states[ctx.game.director.state] || 0) + 1;
    const h = process.memoryUsage().heapUsed;
    if (h > prev) grew += h - prev;
    prev = h;
  }
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  const d = ctx.game.director;
  console.log(`frames ${N} (10 min at 60 fps): heap growth ${(grew / N).toFixed(0)} B/frame, gc events ${gcs} (max ${gcMax.toFixed(2)}ms, total ${gcSum.toFixed(1)}ms), grid rebuild ${ctx.game.nav.stats.gridMs.toFixed(2)}ms, director states ${JSON.stringify(states)}`);
  console.log(`timer drift: max |playing time - (director clock + accumulator)| = ${(drift * 1000).toFixed(4)} ms over the session; runs ${ctx.game.run + 1}; encounters this run ${d.encounters}; nav builds ${ctx.game.nav.stats.builds} max ${ctx.game.nav.stats.maxMs.toFixed(2)}ms`);
}

const t = performance.now();
if (which === 'escape' || which === 'all') escapeRun();
if (which === 'casual' || which === 'all') escapeRun(150, 'casual', 0.5);
if (which === 'idle' || which === 'all') idleRun();
if (which === 'slow' || which === 'all') slowRun('idle');
if (which === 'walk' || which === 'all') slowRun('walker');
if (which === 'gap' || which === 'all') sprintGap();
if (which === 'chars' || which === 'all') charsRun();
if (which === 'long') longRun(+(opt.minutes || 10));
if (which === 'alloc') await allocRun();
console.log(`\ndone in ${((performance.now() - t) / 1000).toFixed(1)}s`);
