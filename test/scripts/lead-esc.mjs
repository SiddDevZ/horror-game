// esc toggles pause: pause, then esc resumes (and a second esc on the same frame as pausing doesn't flip it back)
export default async function ({ evalJs, delay, send }) {
  const esc = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 }); };
  await delay(500);
  await esc(); await delay(400);
  const a = await evalJs(`({ state: __br.game.state, ui: __br.ui && __br.ui.state })`);
  await esc(); await delay(400);
  const b = await evalJs(`({ state: __br.game.state, ui: __br.ui && __br.ui.state, hint: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|') })`);
  console.log(JSON.stringify({ a, b }));
  const ok = a.state === 'paused' && b.state === 'playing';
  console.log(ok ? 'ok   esc pauses, esc again resumes' : 'FAIL esc toggle');
  return ok;
}
