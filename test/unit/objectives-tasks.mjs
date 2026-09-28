// v3 task mechanics (pure TaskRun) and the TaskBoard event contract with a stub game. exits non-zero on failure.
import { TaskRun, TaskBoard, TASK_KINDS, KIND_SOUND, WIRE_COLORS } from '../../src/game/Tasks.js';
import { TASK_TEXT } from '../../src/game/lore.js';

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};
const run = (r, sec, held, dt = 1 / 120) => { let res = null; for (let t = 0; t < sec - 1e-9 && !res; t += dt) res = r.update(dt, held); return res; };

check(Object.keys(TASK_KINDS).length === 12 && Object.keys(TASK_KINDS).every((k) => TASK_TEXT[k]?.title && TASK_TEXT[k]?.hint && TASK_TEXT[k]?.ok), 'all 12 task kinds have a title, hint and success line');

// ---- card swipe: hold E, release inside the window ----
{
  const s = TASK_KINDS.cardSwipe, [a, b] = s.window;
  const r = new TaskRun('cardSwipe', 1);
  r.down(); run(r, a * s.swipe * 0.5, true);
  const fast = r.up();
  check(fast && !fast.ok && fast.msg === 'Too fast. Try again.' && r.t === 0 && !r.done, `release at ${(a * 0.5 * s.swipe).toFixed(2)}s: "${fast?.msg}"`);
  r.down(); run(r, ((a + b) / 2) * s.swipe, true);
  const tMid = r.t;
  const ok = r.up();
  check(ok && ok.ok && r.done, `release at t ${tMid.toFixed(2)} inside [${a}, ${b}] (${(a * s.swipe).toFixed(2)}-${(b * s.swipe).toFixed(2)} s held) accepts`);
  const r2 = new TaskRun('cardSwipe', 2);
  r2.down(); run(r2, ((b + 1) / 2) * s.swipe, true);
  const slow = r2.up();
  check(slow && !slow.ok && slow.msg === 'Too slow. Try again.', `release late: "${slow?.msg}"`);
  r2.down();
  const timeout = run(r2, s.swipe + 0.1, true);
  check(timeout && !timeout.ok && timeout.msg === 'Too slow. Try again.' && !r2.swiping, 'holding past the end fails on its own');
  check(r2.up() === null, 'a release after the timeout does nothing');
}

// ---- wires: keys 1-4 match the next left wire ----
{
  const r = new TaskRun('wires', 42), r2 = new TaskRun('wires', 42), r3 = new TaskRun('wires', 43);
  const perm = (a) => a.length === 4 && WIRE_COLORS.every((c) => a.includes(c));
  check(perm(r.left) && perm(r.right) && r.left.join() === r2.left.join() && r.right.join() === r2.right.join(), `wire layout is a colour permutation, deterministic per seed (${r.left.join('/')} -> keys ${r.right.join('/')})`);
  check(r.left.join() + r.right.join() !== r3.left.join() + r3.right.join(), 'different panels get different layouts');
  const good = r.expectKey(), bad = good === 1 ? 2 : 1;
  r.key(good);
  const wrong = r.key(bad);
  check(wrong && !wrong.ok && r.step === 0 && r.wrong && wrong.msg === TASK_TEXT.wrongWire, `wrong wire resets the panel: "${wrong?.msg}"`);
  let res = null;
  for (let i = 0; i < 4; i++) res = r.key(r.expectKey());
  check(res && res.ok && r.done && r.step === 4, 'four correct wires finish it');
  check(r.key(1) === null, 'a finished panel ignores keys');
}

// ---- hold kinds keep progress when released ----
for (const k of ['touchGrass', 'fixLight', 'mop', 'copier', 'microwave']) {
  const r = new TaskRun(k, 1), T = TASK_KINDS[k].time;
  run(r, T * 0.5, true);
  const half = r.t;
  run(r, 1, false);
  r.abort();
  const kept = r.t;
  const res = run(r, T * 0.5 + 0.05, true);
  check(Math.abs(half - 0.5) < 0.02 && kept === half && res && res.ok, `${k}: hold ${T}s, let go at ${(half * 100).toFixed(0)}% keeps it, finishes on the rest`);
}

// ---- press kinds ----
{
  for (const k of ['straighten', 'timesheet', 'skibidi']) { const r = new TaskRun(k); const res = r.down(); check(res && res.ok, `${k}: one press`); }
  const v = new TaskRun('vendingStuck');
  check(v.down() === null && v.down() === null && v.down()?.ok, 'vendingStuck: three hits');
  const rt = new TaskRun('router');
  rt.down();
  const early = rt.down();
  rt.update(TASK_KINDS.router.gap, false);
  const on = rt.down();
  check(early === null && rt.step === 2 && on && on.ok, `router: E off, E on (a second press within ${TASK_KINDS.router.gap}s is ignored)`);
}

// ---- TaskBoard events with a stub game ----
{
  const ev = [], memes = [], toasts = [], done = [];
  const g = {
    world: { seed: 7 },
    player: { x: 0, z: 0 },
    events: { emit: (n, p) => ev.push([n, p]) },
    meme: (c) => memes.push(c),
    toast: (t) => toasts.push(t),
    objectives: { onTaskDone: (f, kind, breaker) => done.push([f.id, kind, breaker]) },
  };
  const b = new TaskBoard(g);
  const of = (n) => ev.filter((e) => e[0] === n).map((e) => e[1]);
  const sw = { id: 'a', type: 'task', x: 1, z: 0, data: { kind: 'cardSwipe' } };
  b.open(sw);
  const o = of('task:open')[0];
  check(o && o.id === 'a' && o.kind === 'cardSwipe' && o.title && o.hint && o.data.ui === 'swipe' && o.data.window.length === 2 && memes.includes('taskStart'), `task:open ${JSON.stringify(o)}`);
  b.down(); b.update(0.2, true); b.up();
  const r1 = of('task:result')[0];
  check(r1 && !r1.ok && r1.msg === 'Too fast. Try again.' && memes.includes('taskFail') && toasts.includes('Too fast. Try again.'), 'failed swipe: task:result ok false + taskFail sound + toast');
  b.down(); for (let i = 0; i < 70; i++) b.update(1 / 60, true);
  const prog = of('task:progress');
  check(prog.length > 5 && prog.every((p) => p.t >= 0 && p.t <= 1) && prog.slice(-1)[0].window, `task:progress while swiping (${prog.length}, last t ${prog.slice(-1)[0].t})`);
  b.up();
  const r2 = of('task:result')[1];
  const fs = of('feature:state').find((f) => f.id === 'a');
  check(r2 && r2.ok && fs && fs.type === 'task' && fs.state === 'done' && memes.includes('task:cardSwipe') && done[0][0] === 'a', 'good swipe: result ok, feature:state done, task:cardSwipe sound, objectives notified');
  b.update(0.8, false);
  check(of('task:close').length === 1 && !b.active && b.isDone(sw), 'panel closes after a beat; task stays done');
  check(!b.open(sw), 'a done task does not reopen');

  const wi = { id: 'w', type: 'task', x: 1, z: 0, data: { kind: 'wires' } };
  b.open(wi);
  const ow = of('task:open')[1];
  check(ow.data.ui === 'wires' && ow.data.left.length === 4 && ow.data.right.length === 4, `wires task:open data { left, right } ${JSON.stringify(ow.data)}`);
  const bad = b.active.run.expectKey() === 1 ? 2 : 1;
  b.key(bad);
  check(of('task:progress').slice(-1)[0].wrong === true && of('task:progress').slice(-1)[0].total === 4, 'wrong wire flashes (task:progress wrong: true, step/total)');
  g.player.x = 5;
  b.update(0.1, false);
  check(!b.active && of('task:close').length === 2 && b.run(wi).step === 0, 'walking off closes the panel and resets a half-done wiring');

  const mw = { id: 'm', type: 'task', x: 0, z: 0, data: { kind: 'microwave' } };
  g.player.x = 0;
  b.open(mw);
  for (let i = 0; i < 200; i++) b.update(1 / 60, true);
  check(memes.includes('task:microwave') && b.isDone(mw), 'microwave: hold 3 s, task:microwave sound');
  const st = { id: 's', type: 'task', x: 0, z: 0, data: { kind: 'straighten' } };
  b.update(1, false);
  b.open(st); b.down();
  check(memes.includes('taskOk') && !KIND_SOUND.has('straighten'), 'kinds without their own sound use taskOk');
  const br = { id: 'B', type: 'breaker', x: 0, z: 0, data: {} };
  b.update(1, false);
  b.open(br, true);
  check(of('task:open').slice(-1)[0].data.breaker === true && b.active.kind === 'wires', 'a breaker box opens as a wires panel');
  b.reset();
  check(!b.active && b.done.size === 0 && b.runs.size === 0, 'reset clears the board');
}

console.log(failed ? `\n${failed} task check(s) failed` : '\ntasks: all checks passed');
if (failed) process.exitCode = 1;
