// streaming hitch test: drag the player in a straight line at sprint speed (6.8 m/s) across many chunk
// borders and record frame intervals and chunk-build cost per frame. headless rAF is timer-pumped, so
// intervals measure main-thread cost, not a real gpu benchmark.
export default async function ({ evalJs, delay, args }) {
  const secs = Number(args.secs) || 14;
  await delay(2000);
  await evalJs(`(() => {
    __br.renderer.debugResetBuildStats();
    const sp = __br.world.spawnPoint();
    let x = sp.x, z = sp.z, t0 = performance.now();
    window.__streamIv = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      __br.teleport(sp.x + t * 6.8 * 0.8, sp.z + t * 6.8 * 0.6, -Math.atan2(0.8, 0.6) + Math.PI);
    }, 16);
  })()`);
  const rows = [];
  for (let i = 0; i < secs; i++) {
    await delay(1000);
    const s = await evalJs('__br.renderer.stats()');
    rows.push(s);
    console.log(`t=${i + 1}s fps ${s.fps} frame ${s.frameMs}ms p99 ${s.p99Ms}ms calls ${s.calls} meshed ${s.chunksMeshed} pending ${s.pendingBuilds} built ${s.chunksBuilt} buildAvg ${s.buildAvgMs}ms maxChunk ${s.buildMaxChunkMs}ms maxSlice ${s.buildMaxSliceMs}ms maxFrameBuild ${s.buildMaxFrameMs}ms`);
  }
  await evalJs('clearInterval(window.__streamIv)');
  const w = await evalJs('__br.world.stats()');
  console.log('world', JSON.stringify(w));
  const last = rows[rows.length - 1];
  console.log('STREAM', JSON.stringify({ chunksBuilt: last.chunksBuilt, buildAvgMs: last.buildAvgMs, buildMaxChunkMs: last.buildMaxChunkMs, buildMaxSliceMs: last.buildMaxSliceMs, buildMaxFrameMs: last.buildMaxFrameMs, worstP99: Math.max(...rows.map((r) => r.p99Ms)), maxPending: Math.max(...rows.map((r) => r.pendingBuilds)) }));
}
