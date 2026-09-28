// 8 kanye, 9 trump, 0 epstein: each summons that villain (swapping the active one); same key again is ignored
export default async function ({ evalJs, delay, send }) {
  const key = async (code, k, vk) => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk });
  };
  const st = () => evalJs(`({ active: __br.game.enemy.active, enc: __br.game.director.encounters, state: __br.game.director.state, char: __br.game.director.charId })`);
  await evalJs(`(() => { __br.game.director.nextT = 999; return true; })()`);
  await delay(300);
  const out = {};
  await key('Digit0', '0', 48); await delay(3000); out.zero = await st();
  await key('Digit8', '8', 56); await delay(3000); out.eight = await st();
  await key('Digit8', '8', 56); await delay(800); out.eightAgain = await st();
  await key('Digit9', '9', 57); await delay(3000); out.nine = await st();
  console.log(JSON.stringify(out));
  const ok = out.zero.char === 'epstein' && out.zero.active && out.eight.char === 'kanye' && out.eight.active
    && out.eightAgain.enc === out.eight.enc && out.nine.char === 'trump' && out.nine.active;
  console.log(ok ? 'ok   0 -> epstein, 8 -> kanye (swap), 8 again ignored, 9 -> trump' : 'FAIL summon keys');
  return ok;
}
