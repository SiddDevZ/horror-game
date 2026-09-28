// in-situ v2 check: finds the world's own posters / vending / tv / radio / table / breaker / exit features
// (landmarks included), stands in front of each and screenshots; reports draw calls and p99 per view.
// usage: node test/harness.mjs render-v2-insitu --tag=render-v2 --size=1280x720 --query=nodirector:1
const FIND = `(() => {
  const W = __br.world, C = 0.5, sp = W.spawnPoint();
  const open = (x, z) => { const ix = Math.floor(x / C), iz = Math.floor(z / C); return W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz); };
  const want = ['poster', 'vending', 'tv', 'radio', 'table', 'breaker', 'exitDoor'];
  const best = {};
  const scx = Math.floor(sp.x / 16), scz = Math.floor(sp.z / 16);
  const consider = (f) => {
    if (!want.includes(f.type)) return;
    const d = Math.hypot(f.x - sp.x, f.z - sp.z);
    if (!best[f.type] || d < best[f.type].d) best[f.type] = { f, d };
  };
  for (let cz = scz - 6; cz <= scz + 6; cz++) for (let cx = scx - 6; cx <= scx + 6; cx++) for (const f of W.getChunk(cx, cz).features) consider(f);
  for (const L of (W.landmarks ? W.landmarks() : [])) { const ch = W.getChunk(L.cx, L.cz); for (const f of ch.features) if (f.type === 'breaker' || f.type === 'exitDoor') consider(f); }
  const views = {};
  for (const t in best) {
    const f = best[t].f, fx = -Math.sin(f.yaw || 0), fz = -Math.cos(f.yaw || 0);
    const dist = t === 'exitDoor' ? 4.2 : t === 'table' || t === 'vending' ? 2.8 : t === 'poster' ? 1.4 : 2.0;
    let dd = dist; while (dd > 0.8 && !open(f.x + fx * dd, f.z + fz * dd)) dd -= 0.25;
    const y = t === 'poster' ? (f.data?.y || 1.5) : t === 'breaker' ? 1.35 : t === 'exitDoor' ? 1.6 : 0.8;
    views[t] = { x: f.x + fx * dd, z: f.z + fz * dd, yaw: Math.atan2(fx, fz), pitch: Math.atan2(y - 1.68, dd) * 0.8, id: f.id, dist: +best[t].d.toFixed(1), fp: [f.x, f.z, f.yaw, f.w, f.d, JSON.stringify(f.data)] };
  }
  return views;
})()`;
export default async function ({ evalJs, delay, shot }) {
  const views = await evalJs(FIND);
  for (const [t, v] of Object.entries(views)) {
    await evalJs(`(() => { __br.teleport(${v.x}, ${v.z}, ${v.yaw}); __br.look(${v.yaw}, ${v.pitch}); })()`);
    await delay(v.dist > 60 ? 3500 : 1500);
    await evalJs('__br.renderer.debugResetBuildStats()');
    await delay(1200);
    const s = await evalJs('__br.renderer.stats()');
    console.log(t, JSON.stringify({ id: v.id, dist: v.dist, feature: v.fp, calls: s.calls, tris: s.tris, p99: s.p99Ms, pending: s.pendingBuilds, lights: s.fxLights }));
    await shot(`insitu-${t}`);
  }
}
