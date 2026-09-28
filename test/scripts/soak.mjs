// long-session soak: runner bot plays through encounters (auto-restart on death) while we sample
// renderer/world/heap stats. usage: node test/harness.mjs soak --tag=soak --size=1280x720 [--secs=180]
export default async function ({ evalJs, delay, shot, args }) {
  const secs = Number(args.secs) || 180;
  await evalJs(`(async () => {
    const { Bot } = await import('/test/scripts/game-bot.mjs');
    const B = window.__br;
    window.__bot = new Bot(B.game, { mode: 'runner', seed: 5, react: 0.4 });
    let last = performance.now();
    window.__deaths = 0;
    window.__botTimer = setInterval(() => {
      const n = performance.now();
      if (B.game.state === 'dead') { window.__deaths++; B.game.restart(); }
      window.__bot.update(Math.min(0.1, (n - last) / 1000)); last = n;
    }, 16);
    return true;
  })()`);
  const samples = [];
  const t0 = Date.now();
  let i = 0;
  while ((Date.now() - t0) / 1000 < secs) {
    await delay(10000);
    const s = await evalJs(`(() => { const B = window.__br, r = B.renderer.stats(), w = B.world.stats();
      return { t: Math.round((Date.now() - ${t0}) / 1000), fps: +r.fps.toFixed(0), frameMs: +r.frameMs.toFixed(2), p99: +r.p99Ms.toFixed(1), calls: r.calls, tris: r.tris, geo: r.geometries, tex: r.textures, prog: r.programs, meshed: r.chunksMeshed, pending: r.pendingBuilds,
        cached: w.cached, pinned: w.pinned, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        dir: B.game.director.state, enc: B.game.director.encounters ?? null, deaths: window.__deaths, dist: Math.round(Math.hypot(B.game.player.x, B.game.player.z)) }; })()`);
    samples.push(s);
    console.log(JSON.stringify(s));
    if (++i === 6) await shot('mid');
  }
  const late = samples.slice(2);
  const max = (k) => Math.max(...late.map((s) => s[k]));
  const min = (k) => Math.min(...late.map((s) => s[k]));
  console.log('summary', JSON.stringify({ p99Max: max('p99'), frameMsMax: max('frameMs'), callsMax: max('calls'), geo: [min('geo'), max('geo')], tex: [min('tex'), max('tex')], prog: [min('prog'), max('prog')], cachedMax: max('cached'), heap: [min('heapMB'), max('heapMB')] }));
  await shot('end');
}
