// functional render checks: fixture off relights (numeric), far-coordinate rebase, fx/vhs pass, quality tiers.
export default async function ({ evalJs, shot, delay }) {
  await delay(2000);
  const out = {};
  // 1. switch off the fixture nearest the spawn and confirm the floor under it darkens after relight
  out.fixture = await evalJs(`(async () => {
    const W = __br.world, R = __br.renderer, sp = W.spawnPoint();
    let best = null, bd = 1e9;
    for (const k of W.active) { const c = W.getChunk(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
      for (const f of c.fixtures) { const d = Math.hypot(f.x - sp.x, f.z - sp.z); if (f.on && d < bd) { bd = d; best = f; } } }
    const before = R.debugLightAt(best.x, best.z).floor;
    W.setFixture(best, false);
    await new Promise((r) => setTimeout(r, 1500));
    const after = R.debugLightAt(best.x, best.z).floor;
    W.setFixture(best, true);
    await new Promise((r) => setTimeout(r, 1500));
    const restored = R.debugLightAt(best.x, best.z).floor;
    return { id: best.id, before, after, restored };
  })()`);
  console.log('fixture', JSON.stringify(out.fixture));
  // 2. far coordinates: teleport ~5 km out, check rebase happened and shoot
  await evalJs(`__br.teleport(5003.25, -4101.75, 0.6)`);
  await delay(3500);
  out.far = await evalJs(`({ origin: __br.renderer.origin, stats: __br.renderer.stats(), player: [__br.game.player.x, __br.game.player.z] })`);
  console.log('far', JSON.stringify({ origin: out.far.origin, meshed: out.far.stats.chunksMeshed, pending: out.far.stats.pendingBuilds, player: out.far.player }));
  await shot('far-5km');
  // 3. fx + vhs
  const sp = await evalJs('__br.world.spawnPoint()');
  await evalJs(`__br.teleport(${sp.x}, ${sp.z}, ${sp.yaw}); __br.settings.set('vhs', 0.8)`);
  await delay(2500);
  await shot('vhs');
  await evalJs(`__br.settings.set('vhs', 0)`);
  // 3b. hatchet mid-chop (test-only override of frame.viewmodel.swing)
  await evalJs(`(() => { const R = __br.renderer; const o = R.render.bind(R); R.render = (dt, f) => { f.viewmodel.swing = window.__swing ?? f.viewmodel.swing; return o(dt, f); }; window.__swing = 0.34; })()`);
  await delay(600);
  await shot('swing');
  await evalJs('window.__swing = undefined');
  // 4. quality tiers live
  for (const q of ['low', 'high', 'medium']) {
    await evalJs(`__br.settings.set('quality', '${q}')`);
    await delay(2500);
    const s = await evalJs('__br.renderer.stats()');
    out[q] = s;
    console.log('quality', q, JSON.stringify({ calls: s.calls, tris: s.tris, geometries: s.geometries, textures: s.textures, programs: s.programs, meshed: s.chunksMeshed, pending: s.pendingBuilds, fps: s.fps, p99: s.p99Ms }));
    await shot(`quality-${q}`);
  }
}
