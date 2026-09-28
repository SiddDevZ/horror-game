// v4 party hud over the live scene: rainbow "PARTY MODE" title, splash, now-playing line, song bar, hearts / hotbar
// on the beat, reduced motion, fade out. drives the real party (game.party) so frame.party comes from gameplay.
// run: node test/harness.mjs ui-party --tag=ui-party --size=1280x720 --query=nodirector:1
//      node test/harness.mjs ui-party --tag=ui-party-360 --size=360x640 --query=nodirector:1
export default async function ({ evalJs, shot, delay, send }) {
  const q = (js) => evalJs(`(() => { ${js} })()`);
  const layout = () => q(`
    const out = [], boxes = [];
    const vis = (el) => el && !el.hidden && el.offsetParent !== null;
    for (const el of document.querySelectorAll('#party *')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) out.push('offscreen:' + (el.id || el.className || el.tagName));
    }
    for (const id of ['objectives', 'compass', 'hotbar', 'toasts', 'prompt']) {
      const el = document.getElementById(id);
      if (vis(el)) { const r = el.getBoundingClientRect(); if (r.width && r.height) boxes.push([id, r]); }
    }
    const h = document.querySelector('#hud canvas.hearts'); if (vis(h)) boxes.push(['hearts', h.getBoundingClientRect()]);
    const party = [['stack', document.querySelector('.party-stack')], ['splash', document.querySelector('.party-splash')]];
    for (const [n, el] of party) {
      if (!vis(el)) continue;
      const P = el.getBoundingClientRect();
      for (const [b, B] of boxes) if (P.left < B.right && B.left < P.right && P.top < B.bottom && B.top < P.bottom) out.push('overlap:' + n + '/' + b);
    }
    return out;`);
  const snap = () => q(`
    const p = __br.game.frame.party, L = [...document.querySelectorAll('#party-letters .l')];
    return { active: p.active, beat: +p.beat.toFixed(3), intensity: +p.intensity.toFixed(3), t: +p.t.toFixed(2), hidden: document.getElementById('party').hidden,
      opacity: document.querySelector('.party-stack').style.opacity, colors: L.map((l) => l.style.color), ys: L.map((l) => l.style.transform),
      fill: document.getElementById('party-fill').style.transform, time: document.getElementById('party-time').textContent,
      hot: document.getElementById('hotbar').style.transform, hearts: (() => { const c = document.querySelector('#hud canvas.hearts'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 3]) | 0; return h; })(), splash: document.querySelector('.party-splash').style.transform,
      audio: __br.audio.partyState(), live: document.getElementById('party-live').textContent };`);
  const res = {};
  await delay(800);
  // a hud with everything on it: checklist, compass, hotbar, a prompt near the jukebox
  await q(`
    const E = __br.events;
    E.emit('obj:update', { activeId: 'tasks', list: [
      { id: 'phone', text: 'Answer the ringing phone', done: true },
      { id: 'tasks', text: 'Finish M.E.G. work orders', done: false, progress: 1, total: 6, active: true },
      { id: 'power', text: 'Restore power', done: false, progress: 0, total: 3 },
    ] });
    E.emit('inv:update', { almond: 2, almondMax: 3, airhorn: 3, airhornMax: 3 });
    E.emit('game:prompt', { text: 'E  Press the button' });
    E.emit('game:hearts', { hp: 14, delta: 0 });`);
  await delay(300);
  res.heartsBase = (await snap()).hearts;
  await shot('prompt');
  await q(`__br.events.emit('game:prompt', { text: 'E  Stop the party' }); return __br.game.party.start()`);
  // fade in, then a few beats in
  await delay(2600);
  res.a = await snap();
  await delay(137);
  res.b = await snap();
  res.layout = await layout();
  await shot('party');
  await delay(1311);
  await shot('party-b');
  res.c = await snap();
  // the regen wave: sample the hearts canvas across a beat
  res.heartSigs = [];
  for (let i = 0; i < 12; i++) { res.heartSigs.push((await snap()).hearts); await delay(40); }

  // reduced motion: colours still step, nothing moves
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await delay(600);
  res.r1 = await snap();
  await delay(420);
  res.r2 = await snap();
  await shot('party-reduced');
  await send('Emulation.setEmulatedMedia', { features: [] });

  // end: E again -> fade out, hidden, transforms released
  await q(`__br.events.emit('game:prompt', null); __br.game.party.stop(true)`);
  await delay(200);
  res.fading = await snap();
  await delay(2600);
  res.end = await snap();
  await shot('after');
  console.log(JSON.stringify(res, null, 1));
  const moved = (x, y) => x.ys.some((v, i) => v !== y.ys[i]);
  const checks = {
    shows: res.a.active && !res.a.hidden && +res.a.opacity > 0.9 && res.a.live.startsWith('Party mode'),
    audioSynced: res.a.audio.active && Math.abs(res.a.beat - res.a.audio.beat) < 0.2,
    rainbow: new Set(res.a.colors).size >= 5,
    bounces: moved(res.a, res.b) && res.a.ys.some((v) => /-\d/.test(v)),
    colorsStep: res.a.colors.join() !== res.c.colors.join(),
    bar: /scaleX\(0\.\d+\)/.test(res.c.fill) && /^0:0[3-9] \/ 0:1[0-9]$/.test(res.c.time),
    hotbarHops: res.a.hot !== res.b.hot || res.a.hot !== '',
    layout: res.layout.length === 0,
    reducedStill: res.r1.ys.every((v, i) => v === res.r2.ys[i]) && res.r1.hot === res.r2.hot,
    reducedColor: res.r1.colors.join() !== res.r2.colors.join() || Math.floor(res.r1.beat / 2) === Math.floor(res.r2.beat / 2),
    fades: res.fading.hidden === false && res.fading.intensity < 1,
    heartsWave: new Set(res.heartSigs).size >= 3,
    ends: res.end.hidden && res.end.hot === '' && res.end.hearts === res.heartsBase && !res.end.audio.active,
  };
  console.log(JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? 'ok   party hud' : 'FAIL party hud');
  return ok;
}
