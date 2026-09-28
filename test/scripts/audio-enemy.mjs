// headless audio check (chrome is muted; everything is measured with analysers / offline renders).
// run: node test/harness.mjs audio-enemy --tag=audio --size=640x360 --menu
export default async function ({ br }) {
  const res = await br(`(async () => {
    const A = B.audio, M = B.manifest, S = B.settings;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { ok: true, fails: [] };
    const fail = (m) => { out.ok = false; out.fails.push(m); };
    S.set('muted', false);
    A.unlock();
    await A._initPromise;
    out.ctx = { state: A.ctx.state, rate: A.ctx.sampleRate };
    if (A.ctx.state !== 'running') fail('context not running after unlock');

    // one-shots rendered and non-silent
    out.oneShots = {};
    for (const [k, set] of Object.entries(A.oneShots)) {
      out.oneShots[k] = set.map((b) => { const d = b.getChannelData(0); let s = 0, p = 0; for (const v of d) { s += v * v; p = Math.max(p, Math.abs(v)); } return { dur: +b.duration.toFixed(3), rmsDb: +(10 * Math.log10(s / d.length)).toFixed(1), peak: +p.toFixed(3) }; });
      for (const x of out.oneShots[k]) if (!(x.rmsDb > -60) || x.peak > 1.2) fail('one-shot ' + k + ' level ' + x.rmsDb + ' / ' + x.peak);
    }

    const t0 = performance.now();
    await A.preload(M, ['kanye']);
    out.kanyeReadyMs = Math.round(performance.now() - t0);
    await A.preload(M, ['epstein', 'trump']);
    out.clips = A.stats().clips;

    const tap = A.debugTap('enemy');
    const buf = new Float32Array(tap.fftSize);
    const rms = async (ms) => { let s = 0, n = 0; const end = performance.now() + ms; while (performance.now() < end) { tap.getFloatTimeDomainData(buf); for (const v of buf) { s += v * v; } n += buf.length; await wait(40); } return +(10 * Math.log10(s / n + 1e-12)).toFixed(1); };
    const master = A.debugTap('master');
    const mbuf = new Float32Array(master.fftSize);
    const masterRms = async (ms) => { let s = 0, n = 0; const end = performance.now() + ms; while (performance.now() < end) { master.getFloatTimeDomainData(mbuf); for (const v of mbuf) s += v * v; n += mbuf.length; await wait(40); } return +(10 * Math.log10(s / n + 1e-12)).toFixed(1); };

    // the game drives setListener every frame; place test sources relative to wherever the listener is
    const at = (fwd, side = 0) => { const sy = Math.sin(A.yaw), cy = Math.cos(A.yaw); return [A.lx - sy * fwd - cy * side, A.lz - cy * fwd + sy * side]; };
    out.listener = { x: A.lx, z: A.lz, yaw: A.yaw };
    await wait(300);
    out.bedMasterDb = await masterRms(500);
    if (!(out.bedMasterDb > -70)) fail('ambience bed silent');
    const base = A.voices;
    out.enemy = {};
    for (const id of ['kanye', 'epstein', 'trump']) {
      const r = {};
      A.enemyStart(id, ...at(5).slice(0, 1), 0, at(5)[1]);
      r.silentDuringEntranceDelay = await rms(Math.max(80, M.characters[id].entranceDelay * 1000 - 80));
      A.enemyStart(id, at(5)[0], 0, at(5)[1]); // repeat call must not restart
      r.voicesAfterRepeat = A.voices - base;
      await wait(500);
      r.near5m = await rms(900);
      A.enemyUpdate(at(5)[0], 0, at(5)[1], 1);
      await wait(700);
      r.near5mMuffled = await rms(700);
      A.enemyUpdate(at(35)[0], 0, at(35)[1], 0);
      await wait(500);
      r.far35m = await rms(700);
      // behind-left vs front: listener space placement check through the panner (hrtf, so just non-silent)
      A.enemyUpdate(at(-2, -4)[0], 0, at(-2, -4)[1], 0);
      await wait(300);
      r.behindLeft = await rms(400);
      A.enemyStop(0.2);
      await wait(700);
      r.afterStop = await rms(300);
      r.voicesLeft = A.voices - base;
      // loop wrap: start just before loopEnd and make sure it keeps sounding past it
      const c = A.clips.get(id);
      A.enemyStart(id, at(5)[0], 0, at(5)[1], { offset: c.loopEnd - 0.5 });
      await wait(c.entranceDelay * 1000 + 200);
      r.beforeWrap = await rms(250);
      await wait(250);
      r.afterWrap = await rms(600);
      A.enemyStop(0.05);
      await wait(300);
      r.voicesAfterLoopTest = A.voices - base;
      out.enemy[id] = r;
      if (!(r.near5m > -45)) fail(id + ' silent at 5 m');
      if (!(r.near5mMuffled < r.near5m - 2)) fail(id + ' muffling ineffective');
      if (!(r.far35m < r.near5m - 6)) fail(id + ' distance attenuation weak');
      if (!(r.afterStop < -90)) fail(id + ' still sounding after stop');
      if (r.voicesLeft !== 0 || r.voicesAfterLoopTest !== 0) fail(id + ' voices not released');
      if (r.voicesAfterRepeat !== 1) fail(id + ' repeat enemyStart restarted the track');
      if (!(r.afterWrap > -50)) fail(id + ' silent after loop wrap');
    }

    // switching characters mid-track replaces (one enemy track at a time)
    A.enemyStart('kanye', at(5)[0], 0, at(5)[1]);
    await wait(400);
    A.enemyStart('trump', at(5)[0], 0, at(5)[1]);
    await wait(900);
    out.switchVoices = A.voices - base;
    if (out.switchVoices !== 1) fail('switch left ' + out.switchVoices + ' enemy voices');

    // pause / mute suspend the whole graph; resume brings it back
    A.pauseAll(); await wait(150); out.pausedState = A.ctx.state;
    A.resumeAll(); await wait(150); out.resumedState = A.ctx.state;
    S.set('muted', true); await wait(150); out.mutedState = A.ctx.state;
    S.set('volMaster', 0.5); await wait(100); out.masterGainWhileMuted = +A.bus.master.gain.value.toFixed(3);
    S.set('muted', false); await wait(200); out.unmutedState = A.ctx.state;
    S.set('volMaster', 0.8);
    if (out.pausedState !== 'suspended' || out.mutedState !== 'suspended') fail('pause/mute did not suspend');
    if (out.resumedState !== 'running' || out.unmutedState !== 'running') fail('resume/unmute did not run');
    if (out.masterGainWhileMuted !== 0) fail('volume change unmuted the master');
    A.stopAll();
    await wait(400);
    out.voicesAfterStopAll = A.voices - base;
    if (out.voicesAfterStopAll !== 0) fail('stopAll left voices');

    // one-shots through the live graph: positioned and not
    const before = A.voices;
    for (const n of ['step', 'stepRun', 'doorOpen', 'doorClose', 'impact', 'sting', 'death', 'recover', 'switch', 'flickerBuzz', 'distantDoor', 'ventKnock', 'phoneRing']) A.sfx(n, n.startsWith('step') ? undefined : { x: at(3)[0], z: at(3)[1] });
    out.sfxVoicesPlaying = A.voices - before;
    out.sfxMasterDb = await masterRms(300);
    await wait(2600);
    out.sfxVoicesAfter = A.voices - before;
    if (out.sfxVoicesAfter !== 0) fail('one-shot voices not released');

    // seam check in the browser's own decode: render the wrap offline and compare the jump to normal steps
    out.seams = {};
    for (const id of ['kanye', 'epstein', 'trump']) {
      const c = A.clips.get(id), sr = c.buffer.sampleRate;
      const oc = new OfflineAudioContext(1, Math.ceil(0.2 * sr), sr);
      const s = oc.createBufferSource(); s.buffer = c.buffer; s.loop = true; s.loopStart = c.loopStart; s.loopEnd = c.loopEnd;
      s.connect(oc.destination); s.start(0, c.loopEnd - 0.1);
      const d = (await oc.startRendering()).getChannelData(0);
      const w = Math.round(0.1 * sr);
      const steps = []; for (let i = 1; i < d.length; i++) steps.push(Math.abs(d[i] - d[i - 1]));
      const wrapJump = Math.max(...steps.slice(w - 3, w + 3));
      const p99 = steps.slice().sort((a, b) => a - b)[Math.floor(steps.length * 0.99)];
      out.seams[id] = { wrapJump: +wrapJump.toFixed(4), p99Step: +p99.toFixed(4) };
    }
    return out;
  })()`);
  console.log(JSON.stringify(res, null, 1));
  return res.ok;
}
