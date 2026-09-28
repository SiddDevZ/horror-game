// meme clips + objective beacons, measured with analysers (chrome runs muted; nothing is ever audible).
// run: node test/harness.mjs audio-meme --tag=audio --size=640x360 --query=nodirector:1
export default async function ({ evalJs, delay }) {
  const r = await evalJs(`(async () => {
    const A = window.__br.audio, M = window.__br.manifest, S = window.__br.settings;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    A.unlock();
    await A.preload(M, ['kanye']);
    // wait for the core meme set (queued after the first enemy clip)
    for (let i = 0; i < 100 && A.memeBufs.size < 20; i++) await sleep(100);
    const out = { decoded: A.memeBufs.size, state: A.ctx.state };
    // quiet the ambience bed so the beacon / far measurements only see what we play
    A.bed.hum.gain.value = 0; A.bed.air.gain.value = 0;
    A.stopAll();
    await sleep(300);
    const tap = (bus) => A.debugTap(bus);
    const buf = new Float32Array(2048), spec = new Float32Array(1024);
    // peak short-term rms (dBFS) + high-band share over a window while something plays
    const measure = async (bus, ms = 600) => {
      const a = typeof bus === 'string' ? tap(bus) : bus; let peak = 0, hi = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        a.getFloatTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length);
        if (rms > peak) {
          peak = rms;
          a.getFloatFrequencyData(spec);
          // share of the loudest moment's power above 1.5 khz, in db
          const bin = A.ctx.sampleRate / 2 / spec.length; let h = 0, t = 0;
          for (let i = 1; i < spec.length; i++) { const p = Math.pow(10, spec[i] / 10); t += p; if (i * bin > 1500) h += p; }
          hi = t > 0 && h > 0 ? 10 * Math.log10(h / t) : -120;
        }
        await sleep(20);
      }
      return { db: peak > 0 ? +(20 * Math.log10(peak)).toFixed(1) : -200, hi: +hi.toFixed(1) };
    };
    const quiet = await measure('master', 300);
    out.silenceDb = quiet.db;

    // 1) categories: 2D, right bus, loud
    out.cats = {};
    for (const [cat, bus] of [['reveal', 'sudden'], ['hit', 'sudden'], ['death', 'sudden'], ['collect', 'interaction'], ['airhorn', 'sudden'], ['escape', 'sudden']]) {
      A.stopAll(); await sleep(80);
      const id = A.meme(cat);
      const m = await measure(bus, 500);
      out.cats[cat] = { id, bus, db: m.db };
    }
    // 1b) v3: task feedback, per-kind task sounds, meme props (prefixed categories), and fallbacks for unknown kinds
    out.v3 = {};
    for (const [cat, bus] of [['taskOk', 'sudden'], ['taskFail', 'sudden'], ['taskStart', 'interaction'], ['task:microwave', 'interaction'], ['task:skibidi', 'interaction'], ['meme:ohio', 'interaction'], ['meme:shrek', 'interaction'], ['meme:chillGuy', 'interaction'], ['meme:someNewKind', 'interaction'], ['task:someNewKind', 'interaction']]) {
      A.stopAll(); await sleep(80);
      const id = A.meme(cat, { x: A.lx, z: A.lz - 2 });
      const m = await measure(bus, 700);
      out.v3[cat] = { id, bus, db: m.db };
    }
    // 2) no immediate repeats inside a category
    const picks = []; for (let i = 0; i < 24; i++) picks.push(A._pickMeme('hit'));
    out.hitRepeats = picks.filter((p, i) => i && p === picks[i - 1]).length;
    out.hitDistinct = new Set(picks).size;

    // 3) positional: same clip near vs far (distance model), then the ambientFar muffle vs dry 2D
    const L = { x: A.lx, z: A.lz };
    A.stopAll(); await sleep(80);
    A.meme('mlg_airhorn', { x: L.x, z: L.z - 2 });
    const near = await measure('sudden', 500);
    A.stopAll(); await sleep(80);
    A.meme('mlg_airhorn', { x: L.x, z: L.z - 30 });
    const far = await measure('sudden', 500);
    out.positional = { nearDb: near.db, farDb: far.db, drop: +(near.db - far.db).toFixed(1) };
    A.stopAll(); await sleep(80);
    // the voice's own post-filter signal: the ambience bus also carries live emitters at this level
    const voiceTap = (id) => {
      const v = A.memeVoices.find((x) => x.src && x.id === id) || A.meme2d.find((x) => x.src && x.id === id);
      const a = A.ctx.createAnalyser(); a.fftSize = 2048;
      (v.lp || v.gn).connect(a);
      return a;
    };
    A.meme('taco_bell', { far: false, x: L.x, z: L.z - 2 });
    const dry = await measure(voiceTap('taco_bell'), 700);
    A.stopAll(); await sleep(80);
    // same clip id, placed far: its ambientFar category gives distance, lowpass and the dark room
    A.meme('taco_bell', { x: L.x + 24, z: L.z });
    const farAmb = await measure(voiceTap('taco_bell'), 700);
    A.stopAll(); await sleep(80);
    A.meme('taco_bell', { x: L.x + 24, z: L.z });
    const farBus = await measure('ambience', 700);
    A.stopAll(); await sleep(80);
    A.meme('taco_bell', { far: false, x: L.x, z: L.z - 2 });
    const dryBus = await measure('ambience', 700);
    A.stopAll(); await sleep(80);
    const catId = A.meme('ambientFar');
    const catFar = await measure('ambience', 900);
    out.ambientFar = { dryHiDb: dry.hi, farHiDb: farAmb.hi, dryDb: dryBus.db, farDb: farBus.db, categoryPick: catId, categoryDb: catFar.db };

    // 4) lazy decode: a category outside the core set still plays once decoded
    const lazyCat = 'radio';
    const before = M.memeCategories[lazyCat].filter((id) => A.memeBufs.has(id)).length;
    A.stopAll(); await sleep(50);
    const lazyId = A.meme(lazyCat);
    const lazy = await measure('interaction', 900);
    out.lazy = { before, id: lazyId, decodedAfter: A.memeBufs.has(lazyId), db: lazy.db };

    // 5) beacons: pooled to 4, farthest yields, audible near, release on stop/stopAll
    A.stopAll(); await sleep(2600); // let the far room tail die out
    const amb0 = await measure('ambience', 300);
    for (let i = 0; i < 4; i++) A.beacon('t' + i, L.x + 3 + i * 10, L.z);
    const fifthNear = A.beacon('t4', L.x + 1, L.z);   // nearer than t3: takes its voice
    const sixthFar = A.beacon('t5', L.x + 200, L.z);  // farther than all: refused
    A.beacon('t0', L.x + 2, L.z);                     // same id: moves, no new voice
    await sleep(400);
    const live = A.stats().beacons;
    const bOn = await measure('ambience', 1100);
    A.beaconStop('t0'); A.beaconStop('t1'); A.beaconStop('t2'); A.beaconStop('t4');
    await sleep(700);
    const bOff = await measure('ambience', 400);
    out.beacons = { ids: live.map((b) => b.id), live: live.filter((b) => b.live).length, fifthNear, sixthFar, onDb: bOn.db, offDb: bOff.db, baseDb: amb0.db, afterStop: A.stats().beacons.length };

    // 6) pause / mute / stopAll release
    A.beacon('p1', L.x + 2, L.z);
    A.meme('coffin_dance');
    await sleep(150);
    const voicesPlaying = A.voices;
    A.pauseAll();
    await sleep(200);
    const paused = A.ctx.state;
    const whilePaused = A.meme('hit');
    A.resumeAll(); await sleep(250);
    const resumed = A.ctx.state;
    S.set('muted', true); await sleep(200);
    const muted = A.ctx.state;
    S.set('muted', false); await sleep(250);
    A.stopAll();
    await sleep(600);
    out.release = { voicesPlaying, paused, resumed, muted, after: A.ctx.state, voicesAfter: A.voices, beaconsAfter: A.stats().beacons.length, playingAfter: A.stats().memes.playing.length, whilePaused };
    A.bed.hum.gain.value = 0.9; A.bed.air.gain.value = 0.9;
    out.memeCats = { poster: M.memeCategories.poster, taskStart: M.memeCategories.taskStart };
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));
  const checks = {
    decoded: r.decoded >= 20,
    catsLoud: Object.values(r.cats).every((c) => c.id && c.db > -24),
    v3Loud: Object.values(r.v3).every((c) => c.id && c.db > -30),
    v3Fallback: r.memeCats.poster.includes(r.v3['meme:someNewKind'].id) && r.memeCats.taskStart.includes(r.v3['task:someNewKind'].id),
    noRepeats: r.hitRepeats === 0 && r.hitDistinct >= 3,
    distance: r.positional.drop > 8,
    farMuffled: r.ambientFar.farHiDb < r.ambientFar.dryHiDb - 10 && r.ambientFar.farDb < r.ambientFar.dryDb - 6 && r.ambientFar.categoryDb > -45,
    lazy: r.lazy.decodedAfter && r.lazy.db > -40,
    beaconPool: r.beacons.ids.length === 4 && r.beacons.fifthNear === true && r.beacons.sixthFar === false && !r.beacons.ids.includes('t3'),
    beaconAudible: r.beacons.onDb > r.beacons.baseDb + 10 && r.beacons.afterStop === 0 && r.beacons.offDb < r.beacons.onDb - 10,
    pausedNoPlay: r.release.whilePaused === null,
    release: r.release.paused === 'suspended' && r.release.resumed === 'running' && r.release.muted === 'suspended' && r.release.playingAfter === 0 && r.release.beaconsAfter === 0,
  };
  console.log(JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? 'ok   memes + beacons' : 'FAIL memes + beacons');
  return ok;
}
