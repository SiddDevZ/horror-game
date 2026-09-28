// v4 party mode in the real page, keys through CDP: key 8 summons kanye, E on the spawn jukebox starts the party,
// the villain is gone within 1.5 s, no encounters (summons refused) while it runs, frame.party beat advances,
// E again ends it, and normal encounters resume after the grace.
// run: node test/harness.mjs game-party --tag=game-party --size=960x540
const KEYS = { KeyE: ['e', 69], Digit8: ['8', 56], Digit9: ['9', 57] };

export default async function ({ br, evalJs, shot, delay, send }) {
  let failed = 0;
  const expect = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; return c; };
  const press = async (code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] }); await delay(40); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] }); };
  const waitFor = async (expr, maxMs, stepMs = 25) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await br(expr)) return true; await delay(stepMs); } return false; };

  await evalJs(`(() => {
    const B = window.__br, a = B.audio;
    const rec = (window.__pt = { ev: [], audio: { start: 0, stop: 0, beat: 0 } });
    for (const n of ['party:start', 'party:end', 'toast', 'director:state']) B.events.on(n, (p) => rec.ev.push([n, p ? JSON.parse(JSON.stringify(p)) : null, +B.director.t.toFixed(2)]));
    for (const k of ['partyStart', 'partyStop']) { const f = typeof a[k] === 'function' ? a[k].bind(a) : null; a[k] = (...x) => { rec.audio[k === 'partyStart' ? 'start' : 'stop']++; return f ? f(...x) : undefined; }; }
    // answer the call so scheduling is normal, and hold the director until the test says so
    const o = B.objectives; o.useFeature(o.phoneFeature()); B.game.closeLore();
    B.game.params.noDirector = true;
    B.input.set({ fwd: 0, strafe: 0, sprint: false });
    return { partyBeat: typeof a.partyBeat === 'function', manifestParty: !!(B.manifest && B.manifest.party) };
  })()`).then((r) => console.log('audio/manifest:', JSON.stringify(r)));

  const jb = await br(`(() => { const j = B.party.jukebox, w = B.world; let f = null; for (let dz = -2; dz <= 2 && !f; dz++) for (let dx = -2; dx <= 2 && !f; dx++) f = w.getChunk(Math.floor(j.x / 16) + dx, Math.floor(j.z / 16) + dz).features.find((q) => q.id === j.id) || null; const sp = B.game.spawn; return f && { id: f.id, x: f.x, z: f.z, yaw: f.yaw, d: Math.hypot(f.x - sp.x, f.z - sp.z) }; })()`);
  if (!expect(!!jb, `spawn jukebox ${jb?.id} ${jb?.d.toFixed(1)} m from spawn`)) return false;
  const aim = () => br(`(() => { const j = ${JSON.stringify(jb)}, w = B.world;
    for (const d of [1.4, 1.8, 1.1]) for (let k = 0; k < 16; k++) { const a = j.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8, px = j.x - Math.sin(a) * d, pz = j.z - Math.cos(a) * d;
      if (w.blocksMove(Math.floor(px / 0.5), Math.floor(pz / 0.5)) || !w.lineOfSight(px, pz, j.x - Math.sin(j.yaw) * 0.3, j.z - Math.cos(j.yaw) * 0.3)) continue;
      B.teleport(px, pz); B.look(Math.atan2(-(j.x - px), -(j.z - pz)), Math.atan2(1.0 - 1.68, Math.hypot(j.x - px, j.z - pz))); return d; }
    return null; })()`);

  // ---- key 8 summons kanye; let him close in ----
  await aim();
  await press('Digit8');
  const chasing = await waitFor(`B.game.enemy.active && B.director.revealed`, 15000);
  await delay(600);
  const pre = await br(`({ char: B.director.charId, state: B.director.state, d: B.director.straight, hp: B.game.player.hp, enc: B.director.encounters })`);
  expect(chasing && pre.char === 'kanye', `key 8: kanye summoned (${pre.state}, ${pre.d.toFixed(1)} m away)`);

  // ---- E on the jukebox ----
  await aim();
  await delay(150);
  const prompt = await br('B.game.interact.promptText');
  await press('KeyE');
  const tE = Date.now();
  const gone = await waitFor(`!B.game.enemy.active`, 3000, 20);
  const goneMs = Date.now() - tE;
  const st = await br(`({ party: B.party.state, start: window.__pt.ev.find((e) => e[0] === 'party:start'), result: B.director.encountersLog.slice(-1)[0].result, hp: B.game.player.hp, fp: { ...B.game.frame.party }, prompt: B.game.interact.promptText, audio: window.__pt.audio })`);
  expect(/Press the button/.test(prompt || ''), `prompt "${prompt}"`);
  expect(st.party === 'active' && st.start && gone && goneMs <= 1500 && st.result === 'party' && st.hp === pre.hp, `E starts PARTY MODE (${JSON.stringify(st.start[1])}); kanye blasted away in ${goneMs} ms, encounter "${st.result}", hp ${st.hp}`);
  expect(st.audio.start === 1 && /Stop the party/.test(st.prompt || ''), `audio.partyStart called ${st.audio.start}x, prompt now "${st.prompt}"`);
  await delay(900);
  await shot('party');

  // ---- no encounters while it runs; summons refused; beat advancing ----
  await br(`(B.game.params.noDirector = false, B.director.nextT = 0, true)`);
  await press('Digit9');
  const b1 = await br(`({ beat: B.game.frame.party.beat, t: B.game.frame.party.t, i: B.game.frame.party.intensity })`);
  let spawned = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) { if (await br('B.game.enemy.active')) spawned++; await delay(100); }
  const b2 = await br(`({ beat: B.game.frame.party.beat, t: B.game.frame.party.t, i: B.game.frame.party.intensity, bpm: B.game.frame.party.bpm, enc: B.director.encounters, state: B.director.state })`);
  const refused = await br(`window.__pt.ev.some((e) => e[0] === 'toast' && /summoned during the party/.test(e[1].text))`);
  const bps = (b2.beat - b1.beat) / (b2.t - b1.t);
  expect(spawned === 0 && b2.enc === pre.enc && refused, `4 s of party (10 s total), director on with nextT 0: no encounters (${b2.enc} total, ${b2.state}), key 9 refused`);
  expect(b2.beat > b1.beat && Math.abs(bps - b2.bpm / 60) < 0.15 && b2.i === 1, `frame.party beat ${b1.beat.toFixed(2)} -> ${b2.beat.toFixed(2)} (${bps.toFixed(2)} beats/s at ${b2.bpm} bpm), intensity ${b2.i}`);

  // ---- E again ends it; grace, then normal encounters ----
  await aim();
  await delay(150);
  await press('KeyE');
  await delay(100);
  const end = await br(`({ state: B.party.state, end: window.__pt.ev.find((e) => e[0] === 'party:end'), stop: window.__pt.audio.stop, prompt: B.game.interact.promptText })`);
  expect((end.state === 'grace' || end.state === 'idle') && end.end && end.end[1].early && end.stop === 1, `E again ends it early at ${end.end?.[1].t} s (audio.partyStop ${end.stop}x), prompt "${end.prompt}"`);
  const fadeOk = await waitFor(`!B.game.frame.party.active && B.game.frame.party.intensity === 0`, 1500);
  const tEnd = Date.now();
  const back = await waitFor(`B.game.enemy.active`, 25000, 50);
  const resumed = await br(`({ log: B.director.log.filter((x) => /party|WARNING/.test(x.ev)).slice(-3).map((x) => x.ev + '@' + x.t), char: B.director.charId })`);
  expect(fadeOk && back, `visuals faded out; encounters resumed ${((Date.now() - tEnd) / 1000).toFixed(1)} s after the party (${resumed.char}; ${resumed.log.join(', ')})`);

  // ---- restart during a party is clean ----
  await br(`(B.game.restart(), B.party.cooldownT = 0, true)`);
  await br(`(B.party.use(null), true)`);
  await br(`(B.game.restart(), true)`);
  const rs = await br(`({ state: B.party.state, fp: B.game.frame.party.active, cd: B.party.cooldownT, stops: window.__pt.audio.stop })`);
  expect(rs.state === 'idle' && !rs.fp && rs.cd === 0 && rs.stops >= 2, // audio.stopAll() on restart also calls partyStop
    `restart mid-party ends it cleanly ${JSON.stringify(rs)}`);
  // ---- the real clip: beat sync, a lore card mid-party, natural end from the audio clock ----
  const meta = await br(`({ m: B.manifest && B.manifest.party ? { duration: B.manifest.party.duration, bpm: B.manifest.party.bpm, firstBeat: B.manifest.party.firstBeat } : null, beat: typeof B.audio.partyBeat === 'function' })`);
  console.log('manifest.party:', JSON.stringify(meta));
  if (meta.m && meta.beat) {
    await br(`(B.party.cooldownT = 0, B.party.use(null), true)`);
    const ready = await waitFor(`Number.isFinite(B.audio.partyBeat()) && B.audio.partyBeat() > 0.5`, 5000);
    const st0 = await br('B.audio.partyState()');
    const sync = [];
    for (let i = 0; i < 12; i++) {
      await delay(250);
      sync.push(await br(`(() => { const fb = B.game.frame.party.beat, ab = B.audio.partyBeat(); return [+fb.toFixed(3), ab == null ? null : +ab.toFixed(3), +B.party.t.toFixed(2)]; })()`));
    }
    const errs = sync.filter((x) => x[1] != null).map((x) => Math.abs(x[0] - x[1]));
    // frame.party.beat is sampled at the last render frame; allow one frame (~16 ms) of drift in beats
    const frameBeats = (meta.m.bpm / 60) * 0.02;
    const maxErr = Math.max(...errs);
    const rate = (sync[sync.length - 1][1] - sync[0][1]) / (sync[sync.length - 1][2] - sync[0][2]);
    expect(ready && st0.playing && errs.length === sync.length && maxErr <= frameBeats + 0.02 && Math.abs(rate - meta.m.bpm / 60) < 0.12, `real clip ${meta.m.duration} s at ${meta.m.bpm} bpm playing (decoded ${st0.decoded}); frame.party.beat vs audio.partyBeat() max diff ${maxErr.toFixed(3)} beats over ${sync.length} samples, audio beat rate ${rate.toFixed(3)}/s vs party clock (${(meta.m.bpm / 60).toFixed(3)} expected)`);
    console.log('sync [frameBeat, audioBeat, partyT]:', JSON.stringify(sync.slice(0, 4)), '...');
    // a lore card mid-party: the song and the party clock keep going
    const l0 = await br(`({ t: B.party.t, d: B.director.t })`);
    await br(`(B.game.openLore({ title: 'TEST CARD', body: 'party test' }), true)`);
    await delay(3000);
    const l1 = await br(`({ t: B.party.t, d: B.director.t, reading: B.game.reading, pos: B.audio.partyState().pos })`);
    await br('(B.game.closeLore(), true)');
    expect(l1.reading === 'lore' && l1.t - l0.t > 2.7 && Math.abs(l1.d - l0.d) < 0.01 && Math.abs(l1.pos - (meta.m.firstBeat + (sync[0][1] + (l1.t - sync[0][2]) * meta.m.bpm / 60) * 60 / meta.m.bpm)) < 0.25, `lore card open 3 s: party clock ${l0.t.toFixed(2)} -> ${l1.t.toFixed(2)}, song at ${l1.pos.toFixed(2)} s, director held (${l0.d.toFixed(2)} -> ${l1.d.toFixed(2)})`);
    // natural end
    const ended = await waitFor(`B.party.state !== 'active'`, (meta.m.duration + 5) * 1000, 100);
    const fin = await br(`({ t: B.party.t, end: window.__pt.ev.filter((e) => e[0] === 'party:end').slice(-1)[0][1], audio: B.audio.partyState() })`);
    expect(ended && !fin.end.early && Math.abs(fin.end.t - Math.min(meta.m.duration, 10)) < 0.5, `party ended on its own at party t ${fin.end.t} s (capped at 10 s, clip ${meta.m.duration} s), audio active ${fin.audio.active}`);
  } else console.log('manifest.party / audio.partyBeat not available: real-clip checks skipped');

  await br(`(B.game.params.noDirector = true, true)`);
  console.log(failed ? `${failed} failed` : 'all ok');
  return failed === 0;
}
