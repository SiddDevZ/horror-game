// forces each character in the real page with a runner bot: spawn, glide, one track start, escape, despawn.
// run: node test/harness.mjs game-chars --tag=game-chars --size=960x540 --query=nodirector:1
export default async function ({ br, evalJs, delay }) {
  let failed = 0;
  const expect = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
  await evalJs(`(async () => {
    const B = window.__br, a = B.audio;
    const rec = (window.__rec = { starts: [], stops: 0, updates: 0, muffle: [] });
    const s = a.enemyStart.bind(a), st = a.enemyStop.bind(a), u = a.enemyUpdate.bind(a);
    a.enemyStart = (...x) => { rec.starts.push(x[0]); return s(...x); };
    a.enemyStop = (...x) => { rec.stops++; return st(...x); };
    a.enemyUpdate = (...x) => { rec.updates++; if (rec.updates % 30 === 0) rec.muffle.push(+x[3].toFixed(2)); return u(...x); };
    const { Bot } = await import('/test/scripts/game-bot.mjs');
    window.__bot = new Bot(B.game, { mode: 'runner', seed: 5, react: 0.3 });
    let last = performance.now();
    setInterval(() => { const n = performance.now(); window.__bot.update(Math.min(0.1, (n - last) / 1000)); last = n; }, 16);
    return true;
  })()`);
  await delay(1500);
  for (const id of ['kanye', 'epstein', 'trump']) {
    await evalJs(`(() => { const r = window.__rec; r.starts.length = 0; r.stops = 0; r.muffle.length = 0; window.__br.forceEncounter('${id}'); return true; })()`);
    const t0 = Date.now();
    let seenChar = null, maxMoved = 0, done = false;
    while (Date.now() - t0 < 40000) {
      const s = await evalJs(`(() => { const B = window.__br, e = B.game.enemy, f = B.game.frame.enemy; return { st: B.director.state, active: e.active, fchar: f.active ? f.charId : null, moved: e.moved, dead: B.game.state === 'dead' }; })()`);
      if (s.fchar) seenChar = s.fchar;
      if (s.active) maxMoved = Math.max(maxMoved, s.moved);
      if (s.dead) break;
      if (!s.active && (s.st === 'RECOVERY' || s.st === 'EXPLORING') && maxMoved > 0) { done = true; break; }
      await delay(200);
    }
    const r = await evalJs(`(() => { const B = window.__br, d = B.director, c = d.encountersLog[d.encountersLog.length - 1]; return { rec: window.__rec, enc: c, pinned: B.world.stats().pinned, state: B.game.state }; })()`);
    console.log(id, JSON.stringify({ enc: r.enc, starts: r.rec.starts, stops: r.rec.stops, muffleSamples: r.rec.muffle.slice(0, 24), pinned: r.pinned }));
    expect(seenChar === id, `${id}: frame.enemy carried charId ${seenChar}`);
    expect(maxMoved > 5, `${id}: glided ${maxMoved.toFixed(1)} m`);
    expect(r.rec.starts.length === 1 && r.rec.starts[0] === id, `${id}: enemyStart called once (${r.rec.starts.join(',')})`);
    expect(r.rec.stops >= 1, `${id}: enemyStop called on end (${r.rec.stops})`);
    expect(done && r.pinned === 0, `${id}: despawned, result ${r.enc?.result} after ${r.enc?.escapeDur}s pursuit, pins released (${r.pinned})`);
    if (r.state === 'dead') await br('(B.game.restart(), true)');
    await delay(3500);
  }
  console.log(failed ? `${failed} failed` : 'all ok');
  return failed === 0;
}
