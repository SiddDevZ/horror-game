// v3 render views, in situ from world data: every task / meme kind + counter / fridge / sink (nearest instance),
// before/after feature:state for tasks whose look changes, a long corridor (ends visible) and a task room.
// usage: node test/harness.mjs render-v3 --tag=render-v3 --size=1280x720 --query=nodirector:1 [--only=a,b]
const FIND = `(() => {
  const W = __br.world, C = 0.5, sp = W.spawnPoint();
  const open = (x, z) => { const ix = Math.floor(x / C), iz = Math.floor(z / C); return W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz); };
  const best = {};
  const scx = Math.floor(sp.x / 16), scz = Math.floor(sp.z / 16);
  const key = (f) => (f.type === 'task' || f.type === 'meme' ? f.type + ':' + f.data.kind : f.type);
  const want = (k) => k.startsWith('task:') || k.startsWith('meme:') || k === 'counter' || k === 'fridge' || k === 'sink';
  for (let r = 0; r <= 7; r++) for (let cz = scz - r; cz <= scz + r; cz++) for (let cx = scx - r; cx <= scx + r; cx++) {
    if (Math.max(Math.abs(cx - scx), Math.abs(cz - scz)) !== r) continue;
    for (const f of W.getChunk(cx, cz).features) {
      const k = key(f);
      if (!want(k) || best[k]) continue;
      best[k] = f;
    }
  }
  const SMALL = ['task:cardSwipe', 'meme:grimace', 'meme:stanley', 'meme:fanumTax', 'task:timesheet', 'task:microwave'];
  const BIG = ['task:router', 'task:copier', 'task:vendingStuck', 'meme:prime', 'meme:chillGuy', 'meme:chungus', 'meme:shrek', 'meme:doge', 'meme:ohio', 'task:touchGrass', 'task:fixLight', 'counter', 'fridge'];
  const views = {};
  for (const k in best) {
    const f = best[k], fx = -Math.sin(f.yaw || 0), fz = -Math.cos(f.yaw || 0);
    const dist = SMALL.includes(k) ? 1.2 : BIG.includes(k) ? 2.9 : 1.9;
    let dd = dist; while (dd > 0.7 && !open(f.x + fx * dd, f.z + fz * dd)) dd -= 0.2;
    let y = f.data && f.data.y != null ? f.data.y : 0.7;
    if (k === 'meme:ohio') y = 1.9; if (k === 'task:fixLight') y = 1.6; if (BIG.includes(k) && y === 0.7) y = 1.0;
    if (k === 'task:straighten') { const p = W.getChunk(Math.floor(f.x / 16), Math.floor(f.z / 16)).features.find((q) => q.id === f.data.posterId); if (p) y = p.data.y; }
    views[k] = { x: f.x + fx * dd, z: f.z + fz * dd, yaw: Math.atan2(fx, fz), pitch: Math.atan2(y - 1.68, dd) * 0.85, id: f.id, far: Math.hypot(f.x - sp.x, f.z - sp.z) };
  }
  // longest straight corridor view near spawn
  let lv = null, ln = 0;
  for (let cz = scz - 3; cz <= scz + 3; cz++) for (let cx = scx - 3; cx <= scx + 3; cx++) for (let lz = 1; lz < 31; lz += 3) for (let lx = 1; lx < 31; lx += 3) {
    const ix = cx * 32 + lx, iz = cz * 32 + lz;
    if (!open((ix + 0.5) * C, (iz + 0.5) * C)) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let n = 0; while (n < 200 && W.cell(ix + dx * (n + 1), iz + dz * (n + 1)) === 0) n++;
      // prefer a real corridor: walls on both sides near the start
      const side = W.cell(ix + dz * 3, iz + dx * 3) !== 0 || W.cell(ix - dz * 3, iz - dx * 3) !== 0;
      if (side && n > ln) { ln = n; lv = { x: (ix + 0.5) * C, z: (iz + 0.5) * C, yaw: Math.atan2(-dx, -dz), pitch: 0, len: n * C }; }
    }
  }
  views.corridorLong = lv;
  // task room: the task/meme/furniture prop with the most such props within 5 m, seen from ~4.5 m in front
  let room = null, rn = 0;
  const all = [];
  for (let cz = scz - 4; cz <= scz + 4; cz++) for (let cx = scx - 4; cx <= scx + 4; cx++) for (const f of W.getChunk(cx, cz).features) if (want(key(f))) all.push(f);
  for (const f of all) {
    const n = all.filter((g) => Math.hypot(g.x - f.x, g.z - f.z) < 5).length;
    if (n <= rn) continue;
    const fx = -Math.sin(f.yaw || 0), fz = -Math.cos(f.yaw || 0);
    let dd = 4.8; while (dd > 2 && !open(f.x + fx * dd, f.z + fz * dd)) dd -= 0.2;
    if (dd <= 2) continue;
    rn = n; room = { x: f.x + fx * dd, z: f.z + fz * dd, yaw: Math.atan2(fx, fz), pitch: -0.2, n };
  }
  views.taskRoom = room;
  return views;
})()`;

const AFTER = {
  'task:mop': 'done', 'task:straighten': 'done', 'task:wires': 'done', 'task:router': 'off', 'task:copier': 'done',
  'task:timesheet': 'done', 'task:vendingStuck': 'done', 'task:cardSwipe': 'done', 'task:skibidi': 'done', 'task:fixLight': 'done',
};

export default async function ({ evalJs, shot, delay, args }) {
  const only = args.only ? args.only.split(',') : null;
  const progs = () => evalJs(`__br.renderer.renderer.info.programs.map((p) => p.name)`);
  const p0 = await progs();
  console.log('programs at boot', p0.length, JSON.stringify(p0));
  await delay(2500); // let manifest-driven textures (posters, tv, meme props) land before the first view
  const views = await evalJs(FIND);
  console.log('found', Object.keys(views).length, Object.keys(views).join(' '));
  const go = async (v, ms) => {
    await evalJs(`(() => { __br.teleport(${v.x}, ${v.z}, ${v.yaw}); __br.look(${v.yaw}, ${v.pitch || 0}); })()`);
    await delay(ms ?? (v.far > 60 ? 2600 : 1400));
  };
  const stat = async (name) => {
    await evalJs('__br.renderer.debugResetBuildStats()');
    await delay(1500);
    const s = await evalJs('__br.renderer.stats()');
    console.log(name, JSON.stringify({ calls: s.calls, tris: s.tris, frameMs: s.frameMs, p99: s.p99Ms, pending: s.pendingBuilds, lights: s.fxLights, meshed: s.chunksMeshed, quality: s.quality }));
  };
  const names = Object.keys(views).filter((k) => views[k] && (!only || only.some((o) => k.includes(o))));
  for (const k of names) {
    const v = views[k];
    const tag = k.replace(':', '-');
    await go(v);
    if (k === 'corridorLong') { console.log('corridor length m', v.len); await stat('perf-corridor-long'); }
    if (k === 'taskRoom') { console.log('task room props', v.n); await stat('perf-task-room'); }
    await shot(tag);
    if (AFTER[k]) {
      await evalJs(`__br.events.emit('feature:state', { id: ${JSON.stringify(v.id)}, type: 'task', state: '${AFTER[k]}' })`);
      if (k === 'task:skibidi') { await delay(250); } else await delay(900);
      await shot(tag + '-after');
    }
  }
  const p1 = await progs();
  const left = [...p0];
  const added = p1.filter((n) => { const i = left.indexOf(n); if (i >= 0) { left.splice(i, 1); return false; } return true; });
  console.log('programs at end', p1.length, 'new since boot:', JSON.stringify(added));
}
