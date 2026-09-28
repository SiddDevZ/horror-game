// v4 party track (sigma boy), measured with analysers (chrome runs muted; nothing is ever audible).
// run: node test/harness.mjs audio-party --tag=audio --size=640x360 --query=nodirector:1
export default async function ({ evalJs }) {
  const r = await evalJs(`(async () => {
    const A = window.__br.audio, M = window.__br.manifest, S = window.__br.settings;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    A.unlock();
    await A.preload(M, ['kanye']);
    // party decodes after the meme core set; wait for it
    for (let i = 0; i < 150 && !A.party.buf; i++) await sleep(100);
    const out = { decoded: !!A.party.buf, bufDur: A.party.buf ? +A.party.buf.duration.toFixed(3) : 0, offsetMs: +(A.party.offset * 1000).toFixed(2), info: { bpm: M.party.bpm, firstBeat: M.party.firstBeat, duration: M.party.duration, stingers: M.memeCategories.party } };
    A.bed.hum.gain.value = 0; A.bed.air.gain.value = 0;
    A.stopAll(); await sleep(300);
    const buf = new Float32Array(2048), spec = new Float32Array(1024);
    const tap = A.debugTap('enemy');
    const rms = () => { tap.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };
    const db = (x) => x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -200;
    const measure = async (ms) => { let peak = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { peak = Math.max(peak, rms()); await sleep(20); } return db(peak); };
    out.silenceDb = await measure(300);
    out.voices0 = A.voices;

    // 1) a villain track is running, then the party starts: villain stopped, party loud on the enemy bus
    A.enemyStart('kanye', A.lx, 0, A.lz - 4);
    await sleep(900);
    out.enemyDb = await measure(400);
    const t0 = A.ctx.currentTime;
    const started = A.partyStart();
    out.started = started;
    out.enemyAfter = { active: A.enemy.active, charId: A.enemy.charId, slotsPlaying: A.enemySlots.filter((s) => s.src).length };
    await sleep(700); // the villain fade (0.3 s) is over; only the party is left
    out.partyDb = await measure(1200);
    out.duck = +A.duck.gain.value.toFixed(3);

    // 2) the beat follows the audio clock: 125 bpm = 2.083 beats per second
    const b1 = A.partyBeat(), c1 = A.ctx.currentTime;
    await sleep(1000);
    const b2 = A.partyBeat(), c2 = A.ctx.currentTime;
    out.beatRate = +((b2 - b1) / (c2 - c1)).toFixed(4);
    out.beatVsClock = +((b2 - ((c2 - t0) - M.party.firstBeat) * M.party.bpm / 60)).toFixed(3); // ~0 minus lead/latency

    // 3) sync: kick attacks (rises in low-band energy) binned by beat phase must land on the beat (4 on the floor).
    // the analyser shows what was just rendered, partyBeat() what is heard: add the output latency back, and the
    // analyser window (2048 samples) is centred ~1024 samples in the past
    const bins = new Float64Array(8), cnt = new Float64Array(8);
    const binHz = A.ctx.sampleRate / 2 / spec.length;
    tap.smoothingTimeConstant = 0;
    const lat = A.ctx.outputLatency || A.ctx.baseLatency || 0;
    out.latencyMs = +(lat * 1000).toFixed(1);
    const bps = M.party.bpm / 60;
    let prev = -1;
    const tEnd = performance.now() + 8000;
    while (performance.now() < tEnd) {
      const b = A.partyBeat();
      tap.getFloatFrequencyData(spec);
      let lo = 0; for (let i = 1; i * binHz < 150; i++) lo += Math.pow(10, spec[i] / 10);
      if (prev >= 0) {
        const ph = (((b + (lat - 1024 / A.ctx.sampleRate) * bps) % 1) + 1) % 1;
        const k = Math.floor(ph * 8) % 8; bins[k] += Math.max(0, lo - prev); cnt[k]++;
      }
      prev = lo;
      await sleep(4 + Math.random() * 6);
    }
    const prof = Array.from(bins, (v, i) => cnt[i] && v > 0 ? 10 * Math.log10(v / cnt[i]) : -200);
    out.phaseProfileDb = prof.map((v) => +v.toFixed(1));
    out.phasePeakBin = prof.indexOf(Math.max(...prof));
    out.phaseContrastDb = +(Math.max(...prof) - Math.min(...prof)).toFixed(1);

    // the shipped clip is ~11 s (party mode is capped at 10 s): restart it so pause/mute run mid-song
    A.partyStart(); for (let i = 0; i < 40 && !A.party.src; i++) await sleep(50); await sleep(300);

    // 4) pause freezes the beat, resume carries on
    A.pauseAll(); const pb = A.partyBeat(); await sleep(500); const pb2 = A.partyBeat();
    out.pause = { state: A.ctx.state, drift: +(pb2 - pb).toFixed(4) };
    A.resumeAll(); await sleep(300);
    out.resume = { state: A.ctx.state, advanced: +(A.partyBeat() - pb2).toFixed(3), playing: !!A.party.src };

    // 5) mute releases the track, the beat keeps going on the wall clock, unmute rejoins in place
    const mb = A.partyBeat();
    S.set('muted', true); await sleep(600);
    const mutedState = { ctx: A.ctx.state, playing: !!A.party.src, beatAdvanced: +(A.partyBeat() - mb).toFixed(3) };
    S.set('muted', false);
    for (let i = 0; i < 40 && !A.party.src; i++) await sleep(50);
    await sleep(300);
    const posAudio = A.partyState().pos, wallPos = A._wall() - A.party.wall0;
    out.mute = { ...mutedState, rejoined: !!A.party.src, posAfter: +posAudio.toFixed(3), wallMinusAudioMs: +((wallPos - posAudio) * 1000).toFixed(1), db: await measure(500) };

    // 6) stop releases: silent, no source, beat null, ambience back
    const voicesBefore = A.voices;
    A.partyStop(0.3);
    await sleep(800);
    out.stop = { db: await measure(300), playing: !!A.party.src, beat: A.partyBeat(), duck: +A.duck.gain.value.toFixed(3), voicesBefore, voicesAfter: A.voices };

    // 7) stopAll (restart / death) also releases
    A.partyStart({ sting: true });
    await sleep(600);
    const sting = A.stats().memes.playing;
    const dbOn = await measure(300);
    A.stopAll(); await sleep(400);
    out.stopAll = { dbOn, sting, db: await measure(300), active: A.party.active, playing: !!A.party.src };

    // 8) loop option: jump the clock past the end, the track wraps inside the chorus loop
    A.partyStart({ loop: true });
    await sleep(300);
    A._partyRelease(0); A.party.wall0 -= 40; // 40 s later
    await sleep(400); // update() restarts the source at the wrapped position
    out.loop = { playing: !!A.party.src, pos: +A.partyState().pos.toFixed(3), loopStart: M.party.loopStart, loopEnd: M.party.loopEnd, db: await measure(400) };
    A.partyStop(0.05); await sleep(200);

    // 9) natural end without loop: the source ends by itself
    A.partyStart();
    await sleep(300);
    A._partyRelease(0); A.party.wall0 -= M.party.duration - 1.2; // 1.2 s before the end
    await sleep(2200);
    out.end = { active: A.party.active, playing: !!A.party.src, db: await measure(200) };
    A.partyStop(0.05);
    await sleep(300);
    out.final = { live: A.party.live, enemy: A.enemy.active };
    A.bed.hum.gain.value = 0.9; A.bed.air.gain.value = 0.9;
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));
  const checks = {
    decoded: r.decoded && Math.abs(r.bufDur - r.info.duration) < 0.1,
    started: r.started === true,
    enemyStopped: r.enemyDb > -30 && r.enemyAfter.active === false && r.enemyAfter.slotsPlaying === 0,
    partyLoud: r.partyDb > -12,
    ducked: r.duck < 0.3,
    beatRate: Math.abs(r.beatRate - 125 / 60) < 0.02,
    onBeat: (r.phasePeakBin === 0 || r.phasePeakBin === 7) && r.phaseContrastDb > 3,
    pause: r.pause.state === 'suspended' && Math.abs(r.pause.drift) < 0.01 && r.resume.state === 'running' && r.resume.advanced > 0.3 && r.resume.playing,
    mute: r.mute.ctx === 'suspended' && !r.mute.playing && r.mute.beatAdvanced > 0.9 && r.mute.rejoined && Math.abs(r.mute.wallMinusAudioMs) < 80 && r.mute.db > -15,
    stop: r.stop.db < -80 && !r.stop.playing && r.stop.beat === null && r.stop.duck > 0.9,
    stopAll: r.stopAll.dbOn > -12 && r.stopAll.db < -80 && !r.stopAll.active && !r.stopAll.playing && r.stopAll.sting.length > 0,
    loop: r.loop.playing && r.loop.pos >= r.loop.loopStart && r.loop.pos <= r.loop.loopEnd && r.loop.db > -15,
    end: !r.end.playing && r.end.db < -60,
    released: r.final.live === 0 && !r.final.enemy,
  };
  console.log(JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? 'ok   party audio' : 'FAIL party audio');
  return ok;
}
