// real keyboard input through CDP: walk/sprint speeds, diagonal clamp, decel, look-behind, flashlight,
// F3 overlay, Esc pause, wall sliding, door interaction.
// run: node test/harness.mjs game-input --tag=game-input --size=960x540 --query=nodirector:1
import { PLAYER } from '../../src/game/tuning.js';

const KEYS = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e', KeyF: 'f', ShiftLeft: 'Shift', Escape: 'Escape', F3: 'F3' };
const VK = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyQ: 81, KeyE: 69, KeyF: 70, ShiftLeft: 16, Escape: 27, F3: 114 };

export default async function ({ br, evalJs, delay, send }) {
  let failed = 0;
  const expect = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
  const down = (code) => send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: KEYS[code], windowsVirtualKeyCode: VK[code] });
  const up = (code) => send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: KEYS[code], windowsVirtualKeyCode: VK[code] });
  const P = () => br('({ x: B.game.player.x, z: B.game.player.z, vx: B.game.player.vx, vz: B.game.player.vz, speed: B.game.player.speed, yaw: B.game.player.yaw, camYaw: B.game.frame.cam.yaw, fov: B.game.frame.cam.fov, t: B.director.t })');

  await br('(B.input.clear(), true)');
  // find the longest clear heading from the spawn so movement tests are not cut short by walls
  const head = await evalJs(`(() => { const B = window.__br, p = B.game.player, w = B.world; let best = 0, by = 0;
    for (let k = 0; k < 32; k++) { const y = k * Math.PI / 16; let d = 0; while (d < 30 && !w.blocksMove(Math.floor((p.x - Math.sin(y) * d) / 0.5), Math.floor((p.z - Math.cos(y) * d) / 0.5))) d += 0.25; if (d > best) { best = d; by = y; } }
    p.yaw = by; return { yaw: by, clear: best }; })()`);
  console.log('clear heading', JSON.stringify(head));

  // walk
  await down('KeyW'); await delay(700);
  const w1 = await P(); await delay(300); const w2 = await P();
  const walk = Math.hypot(w2.x - w1.x, w2.z - w1.z) / (w2.t - w1.t);
  expect(walk > 2.7 && walk < 3.2, `walk speed ${walk.toFixed(2)} m/s (~3)`);
  // sprint
  await down('ShiftLeft'); await delay(350);
  const s1 = await P(); await delay(300); const s2 = await P();
  const sprint = Math.hypot(s2.x - s1.x, s2.z - s1.z) / (s2.t - s1.t);
  expect(Math.abs(sprint - PLAYER.sprint) < 0.25, `sprint speed ${sprint.toFixed(2)} m/s (~${PLAYER.sprint}), fov ${s2.fov.toFixed(1)}`);
  // look behind while sprinting: a critically damped spring (~0.3 s to 90%, no overshoot); camera flips,
  // movement direction does not
  const lbTrace = (ms) => evalJs(`(async () => { const g = window.__br.game, out = [], t0 = performance.now();
    while (performance.now() - t0 < ${ms}) { out.push([performance.now() - t0, g.frame.fx.lookBehind]); await new Promise((r) => setTimeout(r, 8)); }
    return out; })()`);
  const cross = (tr, f) => { const k = tr.findIndex(f); return k < 0 ? Infinity : tr[k][0]; };
  const [trIn] = await Promise.all([lbTrace(700), down('KeyQ')]);
  const q = await P();
  const flip = Math.abs(((q.camYaw - q.yaw) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
  const dirKeep = Math.abs(Math.atan2(q.vx, q.vz) - Math.atan2(s2.vx, s2.vz));
  const t90 = cross(trIn, ([, v]) => v >= 0.9), maxIn = Math.max(...trIn.map(([, v]) => v));
  expect(t90 > 0.2e3 && t90 < 0.45e3 && maxIn <= 1.001 && flip < 0.08 && dirKeep < 0.05, `look-behind 90% at ${t90.toFixed(0)} ms (~320), peak ${maxIn.toFixed(3)} (no overshoot), camera offset ${(Math.PI - flip).toFixed(2)} rad, movement heading change ${dirKeep.toFixed(3)} rad`);
  const [trOut] = await Promise.all([lbTrace(700), up('KeyQ')]);
  const q2 = await P();
  const r90 = cross(trOut, ([, v]) => v <= 0.1), minOut = Math.min(...trOut.map(([, v]) => v));
  expect(Math.abs(q2.camYaw - q2.yaw) < 0.05 && r90 < 0.45e3 && minOut >= -0.001, `look-behind returns forward on release (90% back at ${r90.toFixed(0)} ms, min ${minOut.toFixed(3)})`);
  await up('ShiftLeft'); await up('KeyW');
  await delay(60);
  const d1 = await P(); await delay(250); const d2 = await P();
  expect(d2.speed < 0.1, `stops within ~0.3 s of release (speed ${d2.speed.toFixed(2)})`);
  void d1;

  // diagonal is clamped
  await br('(B.teleport(B.game.spawn.x, B.game.spawn.z, ' + head.yaw + '), true)');
  await down('KeyW'); await down('KeyD'); await down('ShiftLeft'); await delay(400);
  const g1 = await P(); await delay(200); const g2 = await P();
  const diag = Math.hypot(g2.x - g1.x, g2.z - g1.z) / (g2.t - g1.t);
  expect(diag <= PLAYER.sprint + 0.05, `diagonal sprint ${diag.toFixed(2)} m/s (not faster than straight)`);
  await up('ShiftLeft'); await up('KeyD'); await up('KeyW');

  // flashlight + F3
  const f0 = await br('B.game.frame.flashlight');
  await down('KeyF'); await up('KeyF'); await delay(50);
  expect((await br('B.game.frame.flashlight')) === !f0, 'F toggles the flashlight');
  await down('F3'); await up('F3'); await delay(300);
  const dbg = await evalJs(`(() => { const el = document.getElementById('br-debug'); return el && !el.hidden ? el.textContent : null; })()`);
  console.log(dbg);
  expect(!!dbg && dbg.includes('director') && dbg.includes('path'), 'F3 shows the debug overlay');
  await down('F3'); await up('F3');

  // wall slide: find a straight wall run (10 m of wall with 2 m of clear floor beside it) via world queries,
  // start 0.75 m off it and sprint into it at 40 degrees. ideal slide = sprint * sin(40 deg).
  const slide = await evalJs(`(async () => {
    const B = window.__br, p = B.game.player, w = B.world;
    const C = 0.5, DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1], RUN = 20, CLEAR = 4;
    const free = (ix, iz) => w.cell(ix, iz) === 0 && !w.blocksMove(ix, iz);
    const wall = (ix, iz) => w.cell(ix, iz) === 1;
    const cx = Math.floor(p.x / C), cz = Math.floor(p.z / C);
    let s = null;
    for (let r = 0; r <= 60 && !s; r++) for (let oz = -r; oz <= r && !s; oz++) for (let ox = -r; ox <= r && !s; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
      const ix = cx + ox, iz = cz + oz;
      for (let d = 0; d < 4 && !s; d++) {
        if (!wall(ix + DX[d], iz + DZ[d])) continue;
        for (const sg of [1, -1]) {
          const tx = DZ[d] * sg, tz = DX[d] * sg;
          let ok = true;
          for (let k = 0; k < RUN && ok; k++) {
            const ax = ix + tx * k, az = iz + tz * k;
            if (!wall(ax + DX[d], az + DZ[d])) ok = false;
            for (let c = 0; c < CLEAR && ok; c++) if (!free(ax - DX[d] * c, az - DZ[d] * c)) ok = false;
          }
          if (!ok) continue;
          const a = 0.7, vx = Math.cos(a) * DX[d] + Math.sin(a) * tx, vz = Math.cos(a) * DZ[d] + Math.sin(a) * tz;
          s = { x: (ix + 0.5 - DX[d] * 1.5) * C, z: (iz + 0.5 - DZ[d] * 1.5) * C, yaw: Math.atan2(-vx, -vz), tx, tz };
          break;
        }
      }
    }
    if (!s) return null;
    B.teleport(s.x, s.z, s.yaw);
    const by = s.yaw - 0.7;
    B.input.set({ fwd: 1, strafe: 0, sprint: true, lookYaw: by + 0.7 });
    let inside = 0;
    const sp = [];
    await new Promise((r) => setTimeout(r, 300));
    const x0 = p.x, z0 = p.z, t0 = B.director.t;
    for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 25)); if (w.blocksMove(Math.floor(p.x / 0.5), Math.floor(p.z / 0.5))) inside++; sp.push(+p.speed.toFixed(2)); }
    const dist = Math.hypot(p.x - x0, p.z - z0), dt = B.director.t - t0;
    B.input.set({ fwd: 0, sprint: false, lookYaw: null });
    // ideal slide speed = wish speed projected on the actual slide direction
    const wy = by + 0.7, wx = -Math.sin(wy), wz = -Math.cos(wy);
    const mx = (p.x - x0) / dist, mz = (p.z - z0) / dist;
    return { at: [s.x, s.z], dist, dt, avg: dist / dt, inside, along: (p.x - x0) / dist * s.tx + (p.z - z0) / dist * s.tz, expect: ${PLAYER.sprint} * Math.abs(wx * mx + wz * mz), sp: sp.slice(-5) };
  })()`);
  console.log('slide', JSON.stringify(slide));
  if (!slide) expect(false, 'no straight wall run found near the player for the slide check');
  else expect(slide.inside === 0 && slide.along > 0.98 && slide.avg > 0.95 * slide.expect, `wall slide ${slide.avg.toFixed(2)} m/s vs ${slide.expect.toFixed(2)} ideal tangential (${(slide.along * 100).toFixed(0)}% along the wall), never inside a wall`);
  await br('(B.input.clear(), true)');

  // door: find one nearby, stand in front, press E twice
  const door = await evalJs(`(() => {
    const B = window.__br, w = B.world, p = B.game.player;
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    for (let r = 0; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const d of w.getChunk(pcx + dx, pcz + dz).doors) {
        // try both sides of the door
        for (const s of [-1, 1]) {
          const cx = (d.ix + (d.axis === 'x' ? 1 : 0.5)) * 0.5, cz = (d.iz + (d.axis === 'x' ? 0.5 : 1)) * 0.5;
          const ox = d.axis === 'x' ? 0 : s * 1.1, oz = d.axis === 'x' ? s * 1.1 : 0;
          const x = cx + ox, z = cz + oz;
          if (w.blocksMove(Math.floor(x / 0.5), Math.floor(z / 0.5))) continue;
          B.teleport(x, z, Math.atan2(ox, oz));
          return { id: d.id, ix: d.ix, iz: d.iz, axis: d.axis, target: d.target, x, z };
        }
      }
    }
    return null;
  })()`);
  if (!door) console.log('no door within 3 chunks; skipped door check');
  else {
    await delay(300);
    const prompt = await br('B.game.interact.promptText');
    const before = await br(`B.world.doorAt(${door.ix}, ${door.iz}).target`);
    await down('KeyE'); await up('KeyE'); await delay(700);
    const mid = await br(`({ target: B.world.doorAt(${door.ix}, ${door.iz}).target, openT: B.world.doorAt(${door.ix}, ${door.iz}).openT })`);
    console.log('door', JSON.stringify({ door, prompt, before, mid }));
    expect(!!prompt && prompt.includes('door') && mid.target !== before, `E toggles door (${before} -> ${mid.target}, openT ${mid.openT.toFixed(2)}), prompt "${prompt}"`);
  }

  // Esc pauses when the pointer is not locked (headless), and emits game:state
  await evalJs(`(() => { window.__st = []; window.__br.events.on('game:state', (p) => window.__st.push(p.state)); })()`);
  await down('Escape'); await up('Escape'); await delay(100);
  const st = await br('({ s: B.game.state, ev: window.__st, paused: B.game.frame.paused })');
  expect(st.s === 'paused' && st.ev.includes('paused') && st.paused, `Esc pauses (${JSON.stringify(st)})`);
  await br('(B.game.resume(), true)');
  console.log(failed ? `${failed} failed` : 'all ok');
  return failed === 0;
}
