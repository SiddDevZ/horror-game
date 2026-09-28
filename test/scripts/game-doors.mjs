// villains never open doors (user rule, 2026-09-27). real page, E through CDP.
// (1) lure an echo to a closed alcove door: it camps outside and never crosses for 8 s
// (2) open the door: it comes in
// (3) director ON while the player hides in the closed alcove: encounters keep spawning outside and resolve
// run: node test/harness.mjs game-doors --tag=game-doors --size=960x540 --query=nodirector:1
export default async function ({ br, evalJs, shot, delay, send }) {
  let failed = 0;
  const expect = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; return c; };
  const pressE = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 }); await delay(40); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 }); };
  const waitFor = async (expr, maxMs, stepMs = 50) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await br(expr)) return true; await delay(stepMs); } return false; };

  // a one-door recovery alcove near spawn; stand inside facing the door
  const room = await evalJs(`(() => {
    const B = window.__br, w = B.world, sp = B.game.spawn;
    const pcx = Math.floor(sp.x / 16), pcz = Math.floor(sp.z / 16);
    for (let r = 0; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const c = w.getChunk(pcx + dx, pcz + dz);
      for (const f of c.features) {
        if (f.type !== 'recovery' || !f.data || !f.data.doorId) continue;
        const d = c.doors.find((q) => q.id === f.data.doorId);
        if (!d) continue;
        const q = f.data, x0 = Math.min(q.x0, q.x1), x1 = Math.max(q.x0, q.x1), z0 = Math.min(q.z0, q.z1), z1 = Math.max(q.z0, q.z1);
        const dcx = (d.ix + (d.axis === 'x' ? 1 : 0.5)) * 0.5, dcz = (d.iz + (d.axis === 'x' ? 0.5 : 1)) * 0.5;
        return { id: f.id, door: d.id, ix: d.ix, iz: d.iz, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, dcx, dcz };
      }
    }
    return null;
  })()`);
  if (!expect(!!room, `one-door alcove ${room?.id} (door ${room?.door})`)) return false;
  console.log('room:', JSON.stringify(room));
  const R = JSON.stringify(room);
  await evalJs(`(() => {
    const B = window.__br, r = ${R};
    window.__inside = (x, z, m = 0.1) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
    window.__door = () => B.world.doorAt(r.ix, r.iz);
    window.__stand = () => { B.teleport(r.cx, r.cz); B.look(Math.atan2(-(r.dcx - r.cx), -(r.dcz - r.cz)), -0.15); };
    // sample every 50 ms: enemy inside the room? distance to the door? waiting at it?
    window.__watch = (ms) => new Promise((res) => {
      const out = { inside: 0, samples: 0, nearDoor: 0, waitSpeed: 0, flips: 0, minDoor: 1e9 }; let last = 0; const t0 = performance.now();
      const id = setInterval(() => {
        const e = B.game.enemy;
        if (e.active) {
          out.samples++;
          if (window.__inside(e.x, e.z)) out.inside++;
          const dd = Math.hypot(e.x - r.dcx, e.z - r.dcz); out.minDoor = Math.min(out.minDoor, dd);
          if (dd < 2.5) { out.nearDoor++; if (e.doorWait) out.waitSpeed = Math.max(out.waitSpeed, e.spd); const s = Math.sign(Math.round(e.vx * 10)); if (s && last && s !== last && e.doorWait) out.flips++; if (s) last = s; }
        }
        if (performance.now() - t0 >= ms) { clearInterval(id); res(out); }
      }, 50);
    });
    return true;
  })()`);

  // ---- (1) lure: door open, echo chases in, the player shuts the door with E ----
  await br(`(window.__stand(), B.input.set({ fwd: 0, strafe: 0 }), true)`);
  const T = await evalJs(`(() => { const D = window.__br.tuning.DIRECTOR; window.__T = D; window.__saved = { minChase: D.minChase, slowChaseMax: D.slowChaseMax }; return window.__saved; })()`);
  console.log('tuning', JSON.stringify(T));
  // keep the encounter alive past its 10-15 s budget so the camp can be watched (restored below)
  await br(`(window.__T.minChase = 1e9, window.__T.slowChaseMax = 1e9, B.director.chaseCap = 1e9, true)`);
  const d0 = await br('window.__door().openT');
  if (d0 < 0.5) { await pressE(); await waitFor('window.__door().openT >= 0.99', 2000); }
  await br(`(B.forceEncounter('kanye'), true)`);
  const close = await waitFor(`B.director.state === 'CHASING' && (B.director.chaseCap = 1e9) && B.game.enemy.active && Math.hypot(B.game.enemy.x - ${room.dcx}, B.game.enemy.z - ${room.dcz}) < 9`, 20000, 25);
  await br('(window.__stand(), true)');
  await delay(120);
  const prompt = await br('B.game.interact.promptText');
  await pressE();
  const shut = await waitFor('window.__door().openT === 0', 2000);
  const e0 = await br(`({ d: Math.hypot(B.game.enemy.x - ${room.dcx}, B.game.enemy.z - ${room.dcz}), inside: window.__inside(B.game.enemy.x, B.game.enemy.z) })`);
  expect(close && shut && !e0.inside && /Close door/.test(prompt || ''), `echo chased to ${e0.d.toFixed(1)} m from the door, E (prompt "${prompt}") shut it`);
  const w1 = await br('window.__watch(8000)');
  const st1 = await br(`({ state: B.director.state, active: B.game.enemy.active, wait: B.game.enemy.doorWait, hp: B.game.player.hp, d: Math.hypot(B.game.enemy.x - ${room.dcx}, B.game.enemy.z - ${room.dcz}), log: B.director.log.slice(-8).map((x) => x.ev + (x.why ? ':' + x.why : '')), mc: window.__T.minChase })`);
  console.log('camp:', JSON.stringify({ w1, st1 }));
  expect(w1.samples > 100 && w1.inside === 0 && w1.nearDoor / w1.samples > 0.6 && w1.flips <= 2 && st1.active && st1.hp === 16, `8 s at the closed door: never inside (${w1.inside}/${w1.samples}), camped within 2.5 m ${((100 * w1.nearDoor) / w1.samples).toFixed(0)}% of the time (closest ${w1.minDoor.toFixed(2)} m), ${w1.flips} heading flips, waiting ${st1.wait}, hp ${st1.hp}`);

  // ---- (2) open the door: pursuit resumes and it comes in ----
  await br('(window.__stand(), true)');
  await delay(120);
  const t2 = Date.now();
  await pressE();
  await delay(250);
  await shot('door-opened-camper');
  const act2 = await br('B.game.enemy.active');
  const inside = await waitFor(`B.game.player.hp < 16 || (B.game.enemy.active && window.__inside(B.game.enemy.x, B.game.enemy.z))`, 6000, 25);
  const st2 = await br(`({ state: B.director.state, hp: B.game.player.hp, active: B.game.enemy.active })`);
  expect(act2 && inside, `door opened: echo came in after ${((Date.now() - t2) / 1000).toFixed(2)} s (director ${st2.state}, hp ${st2.hp})`);
  await br(`(Object.assign(window.__T, window.__saved), true)`);

  // ---- (3) hiding with the director on: encounters still come and resolve, none get in ----
  await br(`(B.game.restart(), true)`);
  await delay(200);
  await br(`(() => { const o = B.objectives; o.useFeature(o.phoneFeature()); B.game.closeLore(); B.game.params.noDirector = false; window.__stand(); return true; })()`);
  await delay(450); // closing the briefing guards E for 0.25 s
  if ((await br('window.__door().openT')) > 0.5) { await pressE(); await waitFor('window.__door().openT === 0', 2000); }
  expect((await br('window.__door().openT')) === 0, 'hiding: door shut with E');
  const w3 = await br('window.__watch(45000)');
  const st3 = await br(`({ t: B.director.t, enc: B.director.encounters, log: B.director.encountersLog.map((c) => [c.charId, c.result, c.escapeDur]), rejected: B.director.rejected, sealed: B.director.sealed, hp: B.game.player.hp, state: B.director.state })`);
  const resolved = st3.log.filter((c) => c[1]).length;
  expect(st3.enc >= 2 && resolved >= st3.enc - 1 && w3.inside === 0 && st3.hp === 16 && st3.sealed, `hiding 45 s behind the closed door: ${st3.enc} encounters (${JSON.stringify(st3.log)}), ${resolved} resolved, never inside, hp ${st3.hp}, spawn rejects ${st3.rejected}, sealed ${st3.sealed}`);
  await br(`(B.game.params.noDirector = true, B.game.restart(), true)`);
  console.log(failed ? `${failed} failed` : 'all ok');
  return failed === 0;
}
