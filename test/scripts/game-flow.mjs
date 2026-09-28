// in-page end-to-end director flow with the real renderer/audio/world.
// idle intro -> reveal -> runner escape -> stop (slowdown warning) -> catches cost hearts -> death -> restart.
// all times are director sim seconds (pauses excluded). run: node test/harness.mjs game-flow --tag=game-flow --size=960x540
export default async function ({ br, evalJs, shot, delay }) {
  const ok = [];
  const fail = [];
  const expect = (cond, msg) => { (cond ? ok : fail).push(msg); console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

  // instrument audio calls and game events in the page
  await evalJs(`(() => {
    const B = window.__br, a = B.audio;
    const rec = (window.__rec = { calls: {}, events: [] });
    for (const k of ['enemyStart', 'enemyStop', 'sfx', 'setListener', 'enemyUpdate', 'setChase', 'pauseAll', 'resumeAll']) {
      const f = a[k].bind(a);
      a[k] = (...args) => { rec.calls[k] = (rec.calls[k] || 0) + 1; if (k === 'enemyStart') (rec.starts ||= []).push([args[0], +B.director.t.toFixed(3)]); if (k === 'sfx') (rec.sfx ||= {})[args[0]] = ((rec.sfx ||= {})[args[0]] || 0) + 1; return f(...args); };
    }
    for (const ev of ['game:state', 'game:death', 'game:hit', 'director:state', 'game:prompt']) B.events.on(ev, (p) => rec.events.push([ev, +B.director.t.toFixed(3), p && (p.state || p.text || p.line || p.charId) || null]));
    B.input.set({ fwd: 0, strafe: 0, sprint: false });
    return true;
  })()`);

  const log = () => br(`B.director.log.map((x) => [x.t, x.ev, x.charId, x.why, x.dur].filter((v) => v != null).join(':'))`);
  const waitFor = async (expr, maxMs, stepMs = 100) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await br(expr)) return true; await delay(stepMs); } return false; };

  // 1. the M.E.G. call: answer the spawn phone, dismiss the briefing; kanye crashes the call 3-5 s later
  await delay(500);
  const call = await br(`(() => { const o = B.objectives; const ok = o.useFeature(o.phoneFeature()); const reading = B.game.reading; B.game.closeLore(); return { ok, reading, t: B.director.t }; })()`);
  const revealed = await waitFor(`B.director.log.some((x) => x.ev === 'reveal')`, 20000);
  const L1 = await br('B.director.log');
  const warn1 = L1.find((x) => x.ev === 'WARNING'), rev1 = L1.find((x) => x.ev === 'reveal');
  console.log('intro:', JSON.stringify({ call, warning: warn1?.t, reveal: rev1?.t, char: rev1?.charId }));
  expect(call.ok && call.reading === 'lore' && warn1 && warn1.t - call.t >= 2.95 && warn1.t - call.t <= 5.1, `call answered at ${call.t.toFixed(2)}s, first warning ${(warn1?.t - call.t).toFixed(2)}s after the briefing closes (3-5)`);
  expect(revealed && rev1.t - call.t <= 7.5, `first reveal ${(rev1?.t - call.t).toFixed(2)}s after the call`);
  expect(rev1?.charId === 'kanye', 'first encounter is kanye');
  await delay(150);
  const vis = await br('({ active: B.game.frame.enemy.active, x: B.game.frame.enemy.x, z: B.game.frame.enemy.z, cam: B.game.frame.cam, los: B.director.los })');
  console.log('at reveal:', JSON.stringify(vis));
  // face the enemy for a readable reveal screenshot
  await evalJs(`(() => { const B = window.__br, e = B.game.frame.enemy, p = B.game.player; B.input.set({ lookYaw: Math.atan2(-(e.x - p.x), -(e.z - p.z)) }); })()`);
  await delay(250);
  await shot('reveal');
  const chased = await waitFor(`B.director.state === 'CHASING'`, 3000, 50);
  const L2 = await br('B.director.log');
  const ch1 = L2.find((x) => x.ev === 'CHASING');
  expect(chased && ch1.t - rev1.t >= 0.6 && ch1.t - rev1.t <= 1.0, `reveal -> pursuit ${(ch1?.t - rev1?.t).toFixed(2)}s (0.6-1.0)`);

  // 2. pause freezes the director clock
  const tA = await br('B.director.t');
  await br('(B.game.pause(), true)');
  await delay(800);
  const tB = await br('B.director.t');
  const st = await br('B.game.state');
  await br('(B.game.resume(), true)');
  expect(st === 'paused' && Math.abs(tB - tA) < 0.05, `pause freezes timers (${tA.toFixed(2)} -> ${tB.toFixed(2)}, state ${st})`);

  // 3. competent runner escapes
  await evalJs(`(async () => {
    const { Bot } = await import('/test/scripts/game-bot.mjs');
    const B = window.__br;
    window.__bot = new Bot(B.game, { mode: 'runner', seed: 11, react: 0 });
    let last = performance.now();
    window.__botTimer = setInterval(() => { const n = performance.now(); window.__bot.update(Math.min(0.1, (n - last) / 1000)); last = n; }, 16);
    return true;
  })()`);
  const escaped = await waitFor(`B.director.state === 'ESCAPED' || B.game.state === 'dead'`, 45000);
  const L3 = await br('B.director.log');
  const esc = L3.find((x) => x.ev === 'escape');
  console.log('escape:', JSON.stringify(esc));
  expect(escaped && !!esc, `runner escaped in ${esc?.dur}s of pursuit (${esc?.why}, path ${esc?.path} m)`);

  // 4. stop dead after the escape: warning ~4 s, reveal ~5 s
  await evalJs(`(() => { window.__bot.mode = 'idle'; return true; })()`);
  const escT = esc?.t ?? 0;
  await waitFor(`B.director.log.some((x) => x.t > ${escT} && x.ev === 'reveal')`, 15000);
  const L4 = await br('B.director.log');
  const w2 = L4.find((x) => x.t > escT && x.ev === 'WARNING'), r2 = L4.find((x) => x.t > escT && x.ev === 'reveal');
  const rec = L4.find((x) => x.t > escT && x.ev === 'RECOVERY'), exp = L4.find((x) => x.t > escT && x.ev === 'EXPLORING');
  console.log('after escape:', JSON.stringify({ recovery: rec?.t, exploring: exp?.t, warning: w2?.t, reveal: r2?.t }));
  expect(exp && exp.t - escT >= 2.9, `recovery held ${(exp?.t - escT).toFixed(2)}s after escape (>= 3)`);
  expect(w2 && w2.t - escT >= 3.8 && w2.t - escT <= 5.0, `stopped after escape -> warning ${(w2?.t - escT).toFixed(2)}s (4-5)`);
  expect(r2 && r2.t - escT <= 6.5, `stopped after escape -> reveal ${(r2?.t - escT).toFixed(2)}s`);

  // 5. stay idle: each catch costs 3 of 8 hearts; the third one kills
  const hitOk = await waitFor(`B.director.log.some((x) => x.t > ${escT} && x.ev === 'hit')`, 12000, 50);
  const hitFx = await br('({ impact: B.game.frame.fx.impact, protect: B.game.frame.fx.protect, hp: B.game.player.hp, prot: B.game.player.protect, state: B.director.state, hud: !!document.querySelector("#hud canvas.hearts") })');
  console.log('hit:', JSON.stringify(hitFx));
  await shot('hit');
  expect(hitOk && hitFx.hp === 10 && hitFx.prot > 3 && hitFx.hud, `first catch costs 3 hearts (hp ${hitFx.hp}/16, protect ${hitFx.prot?.toFixed(2)}s, director ${hitFx.state}, hud ${hitFx.hud})`);
  const died = await waitFor(`B.game.state === 'dead'`, 100000);
  const death = await br(`window.__rec.events.find((e) => e[0] === 'game:death')`);
  const info = await br('B.game.deathInfo');
  console.log('death:', JSON.stringify(info));
  await delay(900);
  await shot('death');
  expect(died && info && typeof info.line === 'string' && info.distance >= 0, `third catch ends the run: "${info?.line}"`);
  const saved = await evalJs(`localStorage.getItem('br.save.v1')`);
  expect(!!saved && JSON.parse(saved).runs >= 1, `run saved locally ${saved}`);

  // 6. restart is clean
  await evalJs(`(() => { clearInterval(window.__botTimer); window.__br.input.set({ fwd: 0, strafe: 0, sprint: false }); window.__br.game.restart(); return true; })()`);
  await delay(300);
  const after = await br('({ state: B.game.state, dir: B.director.state, enc: B.director.encounters, enemy: B.game.enemy.active, t: B.director.t, hp: B.game.player.hp, history: B.director.selector.history.slice(), pinned: B.world.stats().pinned, dist: B.game.player.distance })');
  console.log('restart:', JSON.stringify(after));
  expect(after.state === 'playing' && after.dir === 'EXPLORING' && after.enc === 0 && !after.enemy && after.hp === 16 && after.history.length >= 3 && after.t < 1, `restart resets run, director, enemy and hearts; character history kept (${after.history.join(',')})`);

  const r = await br('window.__rec');
  console.log('audio calls:', JSON.stringify(r.calls), 'sfx:', JSON.stringify(r.sfx), 'starts:', JSON.stringify(r.starts));
  const encs = await br('B.director.encountersLog.length');
  console.log('director log:', (await log()).join(' | '));
  console.log(`\n${ok.length} ok, ${fail.length} failed`);
  return fail.length === 0;
}
