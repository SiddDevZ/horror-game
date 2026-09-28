// production build on a slow network: the party song must actually play from the top even when the jukebox is
// used right after Start. usage (serve dist under /horror-game/ on :5299 first):
//   BR_PORT=5299 node test/harness.mjs prod-party --path=/horror-game/ --tag=prod-party
export default async function ({ evalJs, delay, send, args }) {
  const url = `http://127.0.0.1:${process.env.BR_PORT || 5230}${args.path || '/'}?autostart=1&nodirector=1`;
  await send('Network.enable');
  // ~2 Mbps down, 120 ms latency, cache off: a slow phone connection
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 250000, uploadThroughput: 100000 });
  await send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { await delay(250); try { ready = await evalJs('!!(window.__br && window.__br.ready)'); } catch {} }
  const t0 = Date.now();
  // press the jukebox immediately (no walking): worst case for loading
  const started = await evalJs(`(() => { const B = window.__br, j = B.party.jukebox; let f = null;
    for (let dz = -2; dz <= 2 && !f; dz++) for (let dx = -2; dx <= 2 && !f; dx++) f = B.world.getChunk(Math.floor(j.x / 16) + dx, Math.floor(j.z / 16) + dz).features.find((q) => q.id === j.id) || null;
    B.party.cooldownT = 0; return B.party.use(f); })()`);
  let firstPlay = -1, posAtPlay = null;
  const samples = [];
  for (let i = 0; i < 90; i++) {
    const s = await evalJs(`(() => { const a = window.__br.audio.partyState(); return { playing: a.playing, pos: +a.pos.toFixed(2), decoded: a.decoded, pending: a.pending, party: window.__br.party.state }; })()`);
    samples.push(s);
    if (s.playing && firstPlay < 0) { firstPlay = (Date.now() - t0) / 1000; posAtPlay = s.pos; }
    if (s.party !== 'active') break;
    await delay(250);
  }
  const heardFor = samples.filter((s) => s.playing).length * 0.25;
  console.log(JSON.stringify({ started, firstPlay, posAtPlay, heardFor, last: samples[samples.length - 1] }));
  const ok = started && firstPlay >= 0 && posAtPlay < 1.0 && heardFor >= 8;
  console.log(ok ? `ok   slow network: song started ${firstPlay.toFixed(1)} s after pressing, from ${posAtPlay} s, played ${heardFor} s of the 10 s party`
    : 'FAIL party song did not play properly on a slow network');
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  return ok;
}
