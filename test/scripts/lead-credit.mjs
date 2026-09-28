// start screen shows the credit link; clicking it must not start the game
export default async function ({ evalJs, delay, shot }) {
  await delay(800);
  const r = await evalJs(`(() => { const a = document.querySelector('.credit a'); const b = a.getBoundingClientRect();
    a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click();
    return { text: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.href, visible: b.width > 0 && b.bottom <= innerHeight, state: __br.game.state }; })()`);
  await delay(300);
  const state = await evalJs('__br.game.state');
  console.log(JSON.stringify({ ...r, stateAfter: state }));
  await shot('start');
  const ok = r.visible && /buildwithsid/.test(r.href) && state === 'menu';
  console.log(ok ? 'ok   credit visible, links to x.com/buildwithsid, click does not start the game' : 'FAIL credit');
  return ok;
}
