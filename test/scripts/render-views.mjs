// repeatable render views: corridor (spawn), corner, column room, door, enemy, maint, wet, dark+flashlight.
// views are found from world data (seeded), so they survive generator changes.
// usage: node test/harness.mjs render-views --tag=render --size=1280x720 --query=nodirector:1[,quality:medium]
//        --only=corridor,enemy  (optional subset)
const FINDER = `(() => {
  const W = __br.world, C = 0.5, EMPTY = 0, WALL = 1, COLUMN = 2, DOOR = 3;
  const sp = W.spawnPoint();
  const open = (ix, iz) => W.cell(ix, iz) === EMPTY && !W.blocksMove(ix, iz);
  const cellOf = (m) => Math.floor(m / C);
  const run = (ix, iz, dx, dz, max) => { let n = 0; while (n < max && open(ix + dx * (n + 1), iz + dz * (n + 1))) n++; return n; };
  const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
  const views = { corridor: { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0 } };
  const scx = Math.floor(sp.x / 16), scz = Math.floor(sp.z / 16);
  const cand = { corner: null, column: null, door: null, maint: null, wet: null, dark: null, props: null };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let r = 0; r <= 7; r++) for (let cz = scz - r; cz <= scz + r; cz++) for (let cx = scx - r; cx <= scx + r; cx++) {
    if (Math.max(Math.abs(cx - scx), Math.abs(cz - scz)) !== r) continue;
    const ch = W.getChunk(cx, cz);
    for (let lz = 2; lz < 30; lz++) for (let lx = 2; lx < 30; lx++) {
      const ix = cx * 32 + lx, iz = cz * 32 + lz, t = ch.cells[lz * 32 + lx], zone = ch.zone[lz * 32 + lx];
      if (t === COLUMN && !cand.column) {
        for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          let n = 1; while (n < 14 && open(ix + dx * n, iz + dz * n)) n++;
          if (n >= 10) { const px = (ix + dx * 9 + 0.5) * C, pz = (iz + dz * 9 + 0.5) * C; cand.column = { x: px, z: pz, yaw: yawOf(-dx, -dz) + 0.35, pitch: -0.02 }; break; }
        }
      }
      if (t === DOOR && !cand.door) {
        const d = W.doorAt(ix, iz);
        if (d) for (const [dx, dz] of (d.axis === 'x' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]])) {
          if (run(ix, iz, dx, dz, 8) >= 7) { const px = (ix + dx * 6 + 0.5) * C + (d.axis === 'x' ? 0.8 : 0), pz = (iz + dz * 6 + 0.5) * C + (d.axis === 'x' ? 0 : 0.8); cand.door = { x: px, z: pz, yaw: yawOf(-dx, -dz) - 0.25, pitch: -0.03 }; break; }
        }
      }
      if (!open(ix, iz)) continue;
      if (zone === 1 && !cand.maint) for (const [dx, dz] of dirs) if (run(ix, iz, dx, dz, 14) >= 12) { cand.maint = { x: (ix + 0.5) * C, z: (iz + 0.5) * C, yaw: yawOf(dx, dz) + 0.3, pitch: -0.05 }; break; }
      if (zone === 2 && !cand.wet) for (const [dx, dz] of dirs) if (run(ix, iz, dx, dz, 14) >= 10) { cand.wet = { x: (ix + 0.5) * C, z: (iz + 0.5) * C, yaw: yawOf(dx, dz) + 0.2, pitch: -0.18 }; break; }
      if (zone === 3 && !cand.dark) for (const [dx, dz] of dirs) if (run(ix, iz, dx, dz, 14) >= 10) { cand.dark = { x: (ix + 0.5) * C, z: (iz + 0.5) * C, yaw: yawOf(dx, dz), pitch: -0.05, flash: true }; break; }
      if (!cand.corner) for (const [dx, dz] of dirs) {
        const n = run(ix, iz, dx, dz, 20);
        if (n < 8 || n > 14) continue;
        const ex = ix + dx * n, ez = iz + dz * n;
        for (const s of [1, -1]) {
          const sx = -dz * s, sz = dx * s;
          if (run(ex, ez, sx, sz, 8) >= 6 && run(ex, ez, -sx, -sz, 3) <= 2 && run(ix, iz, sx, sz, 8) <= 4) {
            cand.corner = { x: (ix + 0.5) * C, z: (iz + 0.5) * C, yaw: yawOf(dx, dz) + (s === -1 ? 0.3 : -0.3), pitch: 0, turn: s };
            break;
          }
        }
        if (cand.corner) break;
      }
    }
  }
  for (const k in cand) if (cand[k]) cand[k].far = Math.hypot(cand[k].x - sp.x, cand[k].z - sp.z) > 40;
  // props: nearest chair pile / stack / chair to spawn, seen from ~2.6 m
  let pf = null, pd = 1e9;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (const f of W.getChunk(scx + dx, scz + dz).features) {
    if (!['pile', 'chairStack', 'chair', 'desk'].includes(f.type)) continue;
    const score = Math.hypot(f.x - sp.x, f.z - sp.z) - (f.type === 'pile' || f.type === 'chairStack' ? 30 : 0);
    if (score < pd) { pd = score; pf = f; }
  }
  if (pf) for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2, px = pf.x + Math.cos(ang) * 2.8, pz = pf.z + Math.sin(ang) * 2.8;
    if (open(cellOf(px), cellOf(pz)) && W.lineOfSight(px, pz, pf.x, pf.z)) { cand.props = { x: px, z: pz, yaw: yawOf(pf.x - px, pf.z - pz), pitch: -0.3, type: pf.type }; break; }
  }
  Object.assign(views, cand);
  // enemy: ~7 m down the spawn corridor
  const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
  let d = 2; while (d < 9 && open(cellOf(sp.x + fx * d), cellOf(sp.z + fz * d))) d += 0.5;
  views.enemy = { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0, enemy: { x: sp.x + fx * (d - 1), z: sp.z + fz * (d - 1) } };
  views.enemyNear = { x: sp.x, z: sp.z, yaw: sp.yaw + 0.25, pitch: 0.12, enemy: { x: sp.x + fx * 2.2, z: sp.z + fz * 2.2 } };
  return views;
})()`;

export default async function ({ evalJs, shot, delay, args }) {
  const only = args.only ? args.only.split(',') : null;
  const views = await evalJs(FINDER);
  console.log('views', JSON.stringify(views));
  // test-only enemy injection: the game owns frame.enemy, so patch just before rendering
  await evalJs(`(() => {
    const R = __br.renderer; if (R.__patched) return; R.__patched = true;
    const orig = R.render.bind(R);
    window.__enemyOverride = null;
    R.render = (dt, f) => { if (window.__enemyOverride) Object.assign(f.enemy, window.__enemyOverride); if (window.__flashOverride !== undefined) f.flashlight = window.__flashOverride; return orig(dt, f); };
  })()`);
  const names = Object.keys(views).filter((k) => views[k] && (!only || only.includes(k)));
  for (const name of names) {
    const v = views[name];
    await evalJs(`(() => {
      __br.teleport(${v.x}, ${v.z}, ${v.yaw}); __br.look(${v.yaw}, ${v.pitch || 0});
      window.__flashOverride = ${v.flash ? 'true' : 'false'};
      window.__enemyOverride = ${v.enemy ? `{ active: true, charId: 'kanye', x: ${v.enemy.x}, y: 0.05, z: ${v.enemy.z}, alpha: 1, facingYaw: 0 }` : `{ active: false }`};
    })()`);
    await delay(v.far ? 2500 : 1200);
    const s = await evalJs('__br.renderer.stats()');
    console.log(name, JSON.stringify({ calls: s.calls, tris: s.tris, pending: s.pendingBuilds, meshed: s.chunksMeshed, fps: s.fps, p99: s.p99Ms }));
    await shot(name);
  }
  await evalJs(`window.__enemyOverride = null; window.__flashOverride = undefined;`);
}
