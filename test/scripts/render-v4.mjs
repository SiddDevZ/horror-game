// v4 render: sigma boy jukebox idle near spawn, party mode (spawn corridor, close-up, a room), villain blast spin,
// perf normal vs party at the same view, program count boot vs party, and exact revert when the party ends.
// usage: node test/harness.mjs render-v4 --tag=render-v4 --size=1280x720 --query=nodirector:1
const FIND = `(() => {
  const W = __br.world, C = 0.5, sp = W.spawnPoint();
  const open = (x, z) => { const ix = Math.floor(x / C), iz = Math.floor(z / C); return W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz); };
  const scx = Math.floor(sp.x / 16), scz = Math.floor(sp.z / 16);
  let juke = null, bd = 1e9;
  for (let cz = scz - 2; cz <= scz + 2; cz++) for (let cx = scx - 2; cx <= scx + 2; cx++) for (const f of W.getChunk(cx, cz).features) {
    if (f.type !== 'jukebox') continue;
    const d = Math.hypot(f.x - sp.x, f.z - sp.z) - (f.data && f.data.spawn ? 100 : 0);
    if (d < bd) { bd = d; juke = f; }
  }
  if (!juke) return { sp, juke: null };
  const fx = -Math.sin(juke.yaw), fz = -Math.cos(juke.yaw);
  // close-up: 2.6 m in front, a little to the side
  const lx = Math.cos(juke.yaw), lz = -Math.sin(juke.yaw);
  let dd = 2.6; while (dd > 1.2 && !open(juke.x + fx * dd + lx * 0.5, juke.z + fz * dd + lz * 0.5)) dd -= 0.2;
  const cxp = juke.x + fx * dd + lx * 0.5, czp = juke.z + fz * dd + lz * 0.5;
  const close = { x: cxp, z: czp, yaw: Math.atan2(-(juke.x - cxp), -(juke.z - czp)), pitch: 0.02 };
  // beyond the jukebox along the corridor, looking back toward spawn
  const bx = 2 * juke.x - sp.x + fx * 1.4, bz = 2 * juke.z - sp.z + fz * 1.4;
  let back = null;
  for (let t = 1; t >= 0.2 && !back; t -= 0.1) {
    const x = juke.x + fx * 1.4 + (bx - juke.x - fx * 1.4) * t, z = juke.z + fz * 1.4 + (bz - juke.z - fz * 1.4) * t;
    if (open(x, z)) back = { x, z, yaw: Math.atan2(-(sp.x - x), -(sp.z - z)), pitch: 0.05 };
  }
  // a room: the most open 5 x 5 m patch within 35 m of the jukebox that the ball can see, viewed from its edge
  let room = null, rs = 0;
  for (let z = juke.z - 30; z <= juke.z + 30; z += 1) for (let x = juke.x - 30; x <= juke.x + 30; x += 1) {
    let n = 0;
    for (let dz = -3; dz <= 3; dz += 0.5) for (let dx = -3; dx <= 3; dx += 0.5) if (open(x + dx, z + dz)) n++;
    const dj = Math.hypot(x - juke.x, z - juke.z);
    if (n > rs && dj > 6 && W.lineOfSight(x, z, juke.x + fx * 0.6, juke.z + fz * 0.6)) { rs = n; room = { cx: x, cz: z }; }
  }
  if (room) {
    const ang = Math.atan2(room.cz - juke.z, room.cx - juke.x);
    let x = room.cx + Math.cos(ang) * 3.5, z = room.cz + Math.sin(ang) * 3.5;
    if (!open(x, z)) { x = room.cx; z = room.cz; }
    room = { x, z, yaw: Math.atan2(-(juke.x - x), -(juke.z - z)), pitch: 0.12, open: rs };
  }
  return { sp: { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0 }, juke: { id: juke.id, x: juke.x, z: juke.z, yaw: juke.yaw, far: Math.hypot(juke.x - sp.x, juke.z - sp.z) }, close, back, room };
})()`;

export default async function ({ evalJs, shot, delay }) {
  const progs = () => evalJs(`__br.renderer.renderer.info.programs.map((p) => p.name)`);
  await evalJs(`(() => { const g = __br.game; if (g.closeLore) { g.closeLore(); g.closeLore(); } })()`);
  await delay(2500);
  const p0 = await progs();
  console.log('programs at boot', p0.length, JSON.stringify(p0));
  const V = await evalJs(FIND);
  console.log('views', JSON.stringify(V));
  if (!V.juke) throw new Error('no jukebox near spawn');
  const go = async (v, ms = 1400) => {
    await evalJs(`(() => { __br.teleport(${v.x}, ${v.z}, ${v.yaw}); __br.look(${v.yaw}, ${v.pitch || 0}); })()`);
    await delay(ms);
  };
  const stat = async (name) => {
    await evalJs('__br.renderer.debugResetBuildStats()');
    await delay(2500);
    const s = await evalJs('__br.renderer.stats()');
    console.log(name, JSON.stringify({ calls: s.calls, tris: s.tris, frameMs: s.frameMs, p99: s.p99Ms, renderMs: s.renderMs, lights: s.fxLights, partyK: s.partyK, confetti: s.partyConfetti, lasers: s.partyLasers, programs: s.programs, quality: s.quality }));
    return s;
  };
  const partyState = () => evalJs(`(() => { const R = __br.renderer, U = R.U; return { k: R.party.k, uPK: U.uPK.value.toArray(), post: R.post.mComp.uniforms.uParty.value.toArray(), bloom: R.post.mComp.uniforms.uBloom.value, thr: R.post.mBright.uniforms.uThr.value, conf: R.party.confetti.visible, las: R.party.lasers.visible, dots: R.party.dots.visible, frame: __br.game.frame.party }; })()`);

  // idle
  await go(V.sp, 1800);
  await shot('idle-spawn');
  const sN = await stat('perf-normal-spawn');
  await go(V.close);
  await shot('idle-close');
  if (V.back) { await go(V.back); await shot('idle-back'); }
  const idle0 = await partyState();
  console.log('idle state', JSON.stringify(idle0));

  // villain blast: summon, look at it, start the party, catch the spin
  await go(V.sp, 600);
  await evalJs(`__br.forceEncounter('kanye')`);
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) {
    await delay(300);
    seen = await evalJs(`(() => { const e = __br.game.frame.enemy; return !!(e.active && e.alpha > 0.5); })()`);
  }
  if (seen) {
    // stand 4-7 m from the villain with a clear line of sight, looking at it
    const spot = await evalJs(`(() => { const W = __br.world, e = __br.game.frame.enemy, C = 0.5;
      const open = (x, z) => { const ix = Math.floor(x / C), iz = Math.floor(z / C); return W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz); };
      for (const r of [6, 5, 7, 4]) for (let a = 0; a < 6.283; a += 0.2) { const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
        if (open(x, z) && W.lineOfSight(x, z, e.x, e.z)) return { x, z, yaw: Math.atan2(-(e.x - x), -(e.z - z)) }; }
      return null; })()`);
    if (spot) await evalJs(`(() => { __br.teleport(${spot?.x}, ${spot?.z}, ${spot?.yaw}); __br.look(${spot?.yaw}, 0.05); })()`);
    await delay(400);
    await shot('blast-0-before');
  } else console.log('enemy never became visible; blast shots skipped');
  await evalJs(`__br.game.party.start()`);
  for (let i = 1; i <= 3 && seen; i++) {
    await delay(220);
    const e = await evalJs(`(() => { const e = __br.game.frame.enemy, c = __br.game.frame.cam; return { active: e.active, alpha: e.alpha, x: e.x, z: e.z, facingYaw: e.facingYaw, rotY: __br.renderer.enemy.mesh.rotation.y, vis: __br.renderer.enemy.mesh.visible, look: Math.atan2(-(c.x - e.x), -(c.z - e.z)) }; })()`);
    console.log('blast', i, JSON.stringify(e));
    await shot(`blast-${i}`);
  }

  // party views
  await delay(1500);
  await go(V.sp, 1500);
  await shot('party-spawn');
  await delay(700);
  await shot('party-spawn-b');
  const sP = await stat('perf-party-spawn');
  await go(V.close);
  await shot('party-close');
  if (V.back) { await go(V.back); await shot('party-back'); }
  if (V.room) { await go(V.room); await shot('party-room'); await stat('perf-party-room'); }
  const hall = await evalJs(`(() => { const W = __br.world, sp = W.spawnPoint(), C = 0.5; let best = null, bd = 1e9;
    const open = (x, z) => { const ix = Math.floor(x / C), iz = Math.floor(z / C); return W.cell(ix, iz) === 0 && !W.blocksMove(ix, iz); };
    for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) { const ch = W.getChunk(cx, cz);
      if (ch.kind !== 'hall' && ch.kind !== 'atrium') continue; const d = Math.hypot(cx * 16 + 8 - sp.x, cz * 16 + 8 - sp.z); if (d < bd) { bd = d; best = ch; } }
    if (!best) return null;
    for (let t = 0; t < 40; t++) { const x = best.cx * 16 + 2 + (t % 7) * 2, z = best.cz * 16 + 2 + Math.floor(t / 7) * 2;
      if (open(x, z) && open(x + 1, z + 1) && open(x + 2, z + 2)) return { x, z, yaw: Math.atan2(-1, -1), pitch: 0.1, kind: best.kind, key: best.cx + ',' + best.cz }; }
    return null; })()`);
  console.log('hall view', JSON.stringify(hall));
  if (hall) { await go(hall, 2600); await shot('party-hall'); }
  console.log('party state', JSON.stringify(await partyState()));
  const p1 = await progs();

  // end: everything must return to idle values
  await evalJs(`__br.game.party.stop(true)`);
  await delay(2500);
  const end = await partyState();
  console.log('after end', JSON.stringify(end));
  await go(V.sp, 1500);
  await shot('after-spawn');
  const sA = await stat('perf-normal-spawn-after');
  const ok = end.k === 0 && end.uPK[0] === 0 && end.uPK[3] === 0 && end.post.every((v) => v === 0) && !end.conf && !end.las && !end.dots && end.bloom === idle0.bloom && end.thr === idle0.thr;
  console.log('revert exact:', ok);

  const left = [...p0];
  const added = p1.filter((n) => { const i = left.indexOf(n); if (i >= 0) { left.splice(i, 1); return false; } return true; });
  console.log('programs boot', p0.length, 'party', p1.length, 'new during party:', JSON.stringify(added));
  console.log('SUMMARY', JSON.stringify({ normal: { calls: sN.calls, p99: sN.p99Ms, frameMs: sN.frameMs }, normalAfter: { calls: sA.calls, tris: sA.tris, p99: sA.p99Ms, frameMs: sA.frameMs }, partyTris: sP.tris, party: { calls: sP.calls, p99: sP.p99Ms, frameMs: sP.frameMs }, revert: ok, newPrograms: added.length }));
}
