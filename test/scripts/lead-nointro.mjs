// menu start (no autostart): start goes straight into play, no intro card
export default async function ({ evalJs, delay }) {
  await evalJs(`(() => { window.__intro = 0; __br.events.on('game:intro', () => window.__intro++); document.getElementById('btn-start').click(); return true; })()`);
  await delay(1500);
  const r = await evalJs(`({ state: __br.game.state, reading: __br.game.reading, intro: window.__intro, introVisible: !document.getElementById('intro')?.hidden })`);
  console.log(JSON.stringify(r));
  const ok = r.state === 'playing' && !r.reading && r.intro === 0 && !r.introVisible;
  console.log(ok ? 'ok   start goes straight into play' : 'FAIL intro still shown');
  return ok;
}
