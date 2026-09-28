// v2 render views. stages fabricated features (posters, vending, tv, radio, breaker, exit door, table) on real
// walls near spawn when the world does not provide them yet, drives feature:state / item:spawn events, highlight
// and viewmodel items, and reports programs before/after plus draw calls and frame p99 per view.
// usage: node test/harness.mjs render-v2 --tag=render-v2 --size=1280x720 --query=nodirector:1 [--only=a,b] [--insitu=1]
const STAGE = `(() => {
  const W = __br.world, R = __br.renderer, C = 0.5;
  const open = (ix, iz) => W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz);
  const solid = (ix, iz) => { const t = W.cell(ix, iz); return t === 1 || t === 2; };
  const h01 = (id, salt) => { const s = id + ':' + salt; let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
  const sp = W.spawnPoint();
  const scx = Math.floor(sp.x / 16), scz = Math.floor(sp.z / 16);
  const spots = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let r = 0; r <= 2; r++) for (let cz = scz - r; cz <= scz + r; cz++) for (let cx = scx - r; cx <= scx + r; cx++) {
    if (Math.max(Math.abs(cx - scx), Math.abs(cz - scz)) !== r) continue;
    const ch = W.getChunk(cx, cz);
    for (let lz = 3; lz < 29; lz++) for (let lx = 3; lx < 29; lx++) {
      const ix = cx * 32 + lx, iz = cz * 32 + lz;
      if (!open(ix, iz) || ch.zone[lz * 32 + lx] !== 0) continue;
      for (const [dx, dz] of dirs) {
        if (!solid(ix + dx, iz + dz)) continue;
        const px = -dz, pz = dx;
        let ok = true;
        for (let k = -4; k <= 4 && ok; k++) ok = open(ix + px * k, iz + pz * k) && solid(ix + px * k + dx, iz + pz * k + dz);
        for (let d = 1; d <= 8 && ok; d++) for (let k = -3; k <= 3 && ok; k++) ok = open(ix - dx * d + px * k, iz - dz * d + pz * k);
        if (!ok) continue;
        const x = (ix + 0.5) * C + dx * C / 2, z = (iz + 0.5) * C + dz * C / 2;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 7)) continue;
        spots.push({ x, z, yaw: Math.atan2(dx, dz), dx, dz });
      }
    }
  }
  const feats = [];
  const add = (f) => { const ch = W.getChunk(Math.floor(f.x / 16), Math.floor(f.z / 16)); ch.features.push(f); feats.push(f); return f; };
  // local (along, out) offsets from a wall spot: along = local +x = (cos yaw, -sin yaw), out = forward (-sin, -cos)
  const P = (s, along, out) => ({ x: s.x + Math.cos(s.yaw) * along - Math.sin(s.yaw) * out, z: s.z - Math.sin(s.yaw) * along - Math.cos(s.yaw) * out });
  const view = (s, along, out, pitch = -0.05, dyaw = 0, h = null) => { const p = P(s, along, out); return { x: p.x, z: p.z, yaw: s.yaw + Math.PI + dyaw, pitch }; };
  const pick = (want, salt, prefix) => { for (let i = 0; i < 400; i++) { const id = prefix + i; if ((h01(id, salt) < 0.24) === want) return id; } return prefix; };
  const views = {};
  const S = spots;
  if (S.length < 7) return { error: 'not enough wall spots: ' + S.length };
  // posters: taped (curl), framed, taped; different atlas cells
  { const s = S[0];
    add({ id: pick(false, 3, 'posterA'), type: 'poster', ...P(s, -0.85, 0), yaw: s.yaw, w: 0.5, d: 0.02, data: { y: 1.5, h: 0.72, v: 0 } });
    add({ id: pick(true, 3, 'posterB'), type: 'poster', ...P(s, 0, 0), yaw: s.yaw, w: 0.46, d: 0.03, data: { y: 1.52, h: 0.66, v: 3 } });
    add({ id: pick(false, 3, 'posterC'), type: 'poster', ...P(s, 0.85, 0), yaw: s.yaw, w: 0.52, d: 0.02, data: { y: 1.46, h: 0.76, v: 6 } });
    views.posters = view(s, 0.15, 2.3, 0.02);
    views.posterClose = view(s, -0.55, 0.95, 0.02, 0.35); }
  { const s = S[1];
    add({ id: 'vend1', type: 'vending', ...P(s, 0, 0.4), yaw: s.yaw, w: 0.95, d: 0.8, data: {} });
    add({ id: pick(false, 3, 'posterD'), type: 'poster', ...P(s, 1.2, 0), yaw: s.yaw, w: 0.44, d: 0.02, data: { y: 1.55, h: 0.62, v: 5 } });
    views.vending = view(s, 0.9, 2.9, -0.06, -0.3); }
  { const s = S[2];
    add({ id: 'brk1', type: 'breaker', ...P(s, 0, 0), yaw: s.yaw, w: 0.5, d: 0.2, data: { id: 1 } });
    views.breaker = view(s, -0.5, 1.7, -0.05, 0.2); views.breakerHL = views.breaker; }
  { const s = S[3];
    add({ id: 'exit1', type: 'exitDoor', ...P(s, 0, 0), yaw: s.yaw, w: 2.0, d: 0.3, data: {} });
    views.exit = view(s, 0.6, 4.6, 0.04, -0.12); }
  { const s = S[4];
    // break room vignette: tv on a cart, table with a radio, chairs, a poster
    add({ id: 'tv1', type: 'tv', ...P(s, -0.9, 0.7), yaw: s.yaw, w: 0.7, d: 0.5, data: { v: 0 } });
    add({ id: 'tbl1', type: 'table', ...P(s, 0.9, 1.6), yaw: s.yaw, w: 1.2, d: 0.75, data: {} });
    add({ id: 'rad1', type: 'radio', ...P(s, 1.2, 1.55), yaw: s.yaw + 0.3, w: 0.34, d: 0.14, data: { y: 0.75 } });
    add({ id: 'chA', type: 'chair', ...P(s, 0.5, 2.2), yaw: s.yaw + Math.PI + 0.2, w: 0.5, d: 0.5, data: {} });
    add({ id: 'chB', type: 'chair', ...P(s, 1.4, 1.0), yaw: s.yaw - 0.3, w: 0.5, d: 0.5, data: {} });
    add({ id: pick(false, 3, 'posterE'), type: 'poster', ...P(s, 0.5, 0), yaw: s.yaw, w: 0.5, d: 0.02, data: { y: 1.6, h: 0.7, v: 1 } });
    views.breakroom = view(s, 0.1, 4.2, -0.12, 0);
    views.tv = view(s, -0.6, 1.9, -0.12, 0.1); }
  { const s = S[5];
    add({ id: 'tvw', type: 'tv', ...P(s, 0, 0), yaw: s.yaw, w: 0.6, d: 0.6, data: { mount: 'wall', y: 1.8, v: 3 } });
    add({ id: 'vend2', type: 'vending', ...P(s, 1.3, 0.4), yaw: s.yaw, w: 0.95, d: 0.8, data: {} });
    views.tvWall = view(s, 0.4, 2.6, 0.1, -0.1); }
  { const s = S[6];
    views.items = view(s, 0, 2.6, -0.28);
    views.itemsHL = views.items;
    views.items.spawn = [['tape', -1.05], ['almond', -0.35], ['airhorn', 0.35], ['note', 1.05]].map(([t, a], i) => ({ id: 'it' + i, type: t, ...P(s, a, 0.45), y: 0, yaw: s.yaw }));
  }
  // far pickup: 15 m down the spawn corridor
  const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
  let d = 2; while (d < 22 && open(Math.floor((sp.x + fx * d) / C), Math.floor((sp.z + fz * d) / C))) d += 0.5;
  const fd = Math.min(15, d - 1.5);
  views.itemFar = { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: -0.04, far: { id: 'farItem', type: 'almond', x: sp.x + fx * fd, y: 0, z: sp.z + fz * fd, yaw: 0 }, dist: fd };
  views.vmAirhorn = { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0, vm: { item: 'airhorn', useT: 0.35 } };
  views.vmAlmond = { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0, vm: { item: 'almond', useT: 0.5 } };
  window.__v2 = { feats, spots: S.length };
  R.debugRebuild();
  return views;
})()`;

// perf views: spawn corridor, the most open hall chunk nearby, and the staged break room
const PERF = `(() => {
  const W = __br.world, C = 0.5, sp = W.spawnPoint();
  const open = (ix, iz) => W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz);
  const scx = Math.floor(sp.x / 16), scz = Math.floor(sp.z / 16);
  let best = null, bn = -1;
  for (let cz = scz - 4; cz <= scz + 4; cz++) for (let cx = scx - 4; cx <= scx + 4; cx++) {
    const ch = W.getChunk(cx, cz);
    let n = 0; for (let i = 0; i < 1024; i++) if (ch.cells[i] === 0) n++;
    if (n > bn) { bn = n; best = ch; }
  }
  // stand at the most open cell of that chunk looking along its longest clear line
  let v = null, vn = -1;
  for (let lz = 4; lz < 28; lz += 2) for (let lx = 4; lx < 28; lx += 2) {
    const ix = best.cx * 32 + lx, iz = best.cz * 32 + lz;
    if (!open(ix, iz)) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      let n = 0; while (n < 120 && open(ix + dx * (n + 1), iz + dz * (n + 1))) n++;
      if (n > vn) { vn = n; v = { x: (ix + 0.5) * C, z: (iz + 0.5) * C, yaw: Math.atan2(-dx, -dz), pitch: 0, kind: best.kind, clear: n * C * Math.hypot(dx, dz), open: bn }; }
    }
  }
  return { corridor: { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0 }, hall: v };
})()`;

export default async function ({ evalJs, shot, delay, args }) {
  const only = args.only ? args.only.split(',') : null;
  const progs = () => evalJs(`__br.renderer.renderer.info.programs.map((p) => p.name)`);
  const p0 = await progs();
  console.log('programs at boot', p0.length, JSON.stringify(p0));
  await evalJs(`(() => {
    const R = __br.renderer; if (R.__v2) return; R.__v2 = true;
    const orig = R.render.bind(R);
    window.__hl = null; window.__vm = null;
    R.render = (dt, f) => {
      // highlight fields are overridden after game.update so the game's own targeting cannot leak in
      if (!f.highlight) f.highlight = { active: false, x: 0, y: 0, z: 0, r: 0, kind: null, progress: 0 };
      if (window.__hl) Object.assign(f.highlight, window.__hl); else f.highlight.active = false;
      if (window.__vm) Object.assign(f.viewmodel, window.__vm); else { f.viewmodel.item = null; f.viewmodel.useT = 0; }
      return orig(dt, f);
    };
  })()`);
  const views = args.insitu ? {} : await evalJs(STAGE);
  if (views.error) { console.log('STAGE FAILED', views.error); return false; }
  console.log('views', Object.keys(views).join(','));
  const ev = (name, payload) => evalJs(`__br.events.emit(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
  const go = async (v, ms = 1100) => {
    await evalJs(`(() => { __br.teleport(${v.x}, ${v.z}, ${v.yaw}); __br.look(${v.yaw}, ${v.pitch || 0}); })()`);
    await delay(ms);
  };
  const stat = async (name) => {
    await evalJs('__br.renderer.debugResetBuildStats()');
    await delay(1600);
    const s = await evalJs('__br.renderer.stats()');
    console.log(name, JSON.stringify({ calls: s.calls, tris: s.tris, fps: s.fps, frameMs: s.frameMs, p99: s.p99Ms, renderMs: s.renderMs, pending: s.pendingBuilds, fxLights: s.fxLights, fxFeatures: s.fxFeatures, fxItems: s.fxItems }));
  };
  const want = (k) => views[k] && (!only || only.includes(k));

  if (want('posters')) { await go(views.posters); await stat('posters'); await shot('posters'); }
  if (want('posterClose')) { await go(views.posterClose); await shot('poster-close'); }
  if (want('vending')) { await go(views.vending); await stat('vending'); await shot('vending'); }
  if (want('breaker')) {
    await go(views.breaker); await shot('breaker-off');
    const b0 = await evalJs(`(() => { const f = window.__v2.feats.find((f) => f.id === 'brk1'); return { x: f.x, z: f.z }; })()`);
    await evalJs(`window.__hl = { active: true, x: ${b0.x}, y: 1.35, z: ${b0.z}, r: 0.45, kind: 'breaker', progress: 0.6 }`);
    await delay(500); await shot('breaker-hold');
    await evalJs('window.__hl = null');
    await ev('feature:state', { id: 'brk1', type: 'breaker', state: 'on' });
    await delay(900); await shot('breaker-on');
    const b = await evalJs(`(() => { const f = window.__v2.feats.find((f) => f.id === 'brk1'); return { x: f.x - Math.sin(f.yaw) * 0.12, z: f.z - Math.cos(f.yaw) * 0.12 }; })()`);
    await evalJs(`window.__hl = { active: true, x: ${b.x}, y: 1.35, z: ${b.z}, r: 0.45 }`);
    await delay(500); await shot('breaker-highlight');
    console.log('hl', JSON.stringify(await evalJs(`({ f: { ...__br.game.frame.highlight }, u: __br.renderer.U.uHL.value.toArray(), k: __br.renderer.U.uHLk.value, o: __br.renderer.origin })`)));
    await evalJs('window.__hl = null');
  }
  if (want('exit')) {
    await go(views.exit, 1300); await stat('exit'); await shot('exit-locked');
    await ev('feature:state', { id: 'exit1', type: 'exitDoor', state: 'powered' });
    await delay(700); await shot('exit-powered');
    await ev('feature:state', { id: 'exit1', type: 'exitDoor', state: 'open' });
    await delay(2600); await shot('exit-open');
  }
  if (want('breakroom')) { await go(views.breakroom, 1300); await ev('feature:state', { id: 'rad1', type: 'radio', state: 'on' }); await stat('breakroom'); await shot('breakroom'); }
  if (want('tv')) {
    await go(views.tv); await shot('tv');
    await ev('feature:state', { id: 'tv1', type: 'tv', state: 1 });
    await delay(120); await shot('tv-change');
  }
  if (want('tvWall')) { await go(views.tvWall); await shot('tv-wall-vending'); }
  if (want('items')) {
    for (const it of views.items.spawn) await ev('item:spawn', it);
    await go(views.items); await stat('items'); await shot('items');
    const a = views.items.spawn[1];
    await evalJs(`window.__hl = { active: true, x: ${a.x}, y: 0.1, z: ${a.z}, r: 0.35 }`);
    await delay(400); await shot('items-highlight');
    await evalJs('window.__hl = null');
  }
  if (want('itemFar')) {
    await ev('item:spawn', views.itemFar.far);
    await go(views.itemFar, 1500); console.log('far item distance', views.itemFar.dist); await shot('item-far');
  }
  for (const [k, item, ts] of [['vmAirhorn', 'airhorn', [0.07, 0.35]], ['vmAlmond', 'almond', [0.1, 0.5]]]) {
    if (!want(k)) continue;
    await go(views[k], 500);
    for (const t of ts) { await evalJs(`window.__vm = { item: '${item}', useT: ${t} }`); await delay(300); await shot(`vm-${item}-${Math.round(t * 100)}`); }
  }
  await evalJs('window.__vm = null');
  if (!only || only.includes('perf')) {
    const pv = await evalJs(PERF);
    console.log('perf views', JSON.stringify(pv));
    await go(pv.corridor, 1500); await stat('perf-corridor'); await shot('perf-corridor');
    if (pv.hall) { await go(pv.hall, 2500); await stat('perf-hall'); await shot('perf-hall'); }
    if (views.breakroom) { await go(views.breakroom, 1500); await stat('perf-breakroom'); }
  }
  const p1 = await progs();
  const left = [...p0];
  const added = p1.filter((n) => { const i = left.indexOf(n); if (i >= 0) { left.splice(i, 1); return false; } return true; });
  console.log('programs at end', p1.length, 'new since boot:', JSON.stringify(added));
}
