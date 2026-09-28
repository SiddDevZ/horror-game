// menu screenshots over the live scene. run: node test/harness.mjs ui-menus --tag=ui --size=1280x720 --menu
export default async function ({ evalJs, shot, delay }) {
  const q = (js) => evalJs(`(() => { ${js} })()`);
  const overflow = () => q(`const out = []; for (const el of document.querySelectorAll('#ui *')) { if (el.offsetParent === null) continue; const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1 || el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.tagName !== 'OUTPUT') out.push(el.id || el.className || el.tagName); } return out;`);
  await delay(1200);
  const res = {};
  res.startVisible = await q(`return !document.getElementById('start').hidden && document.activeElement.id`);
  res.startOverflow = await overflow();
  await shot('start');
  await q(`document.getElementById('btn-start-settings').click()`);
  await delay(400);
  res.settingsFocus = await q(`return document.activeElement.id`);
  res.settingsOverflow = await overflow();
  res.labelled = await q(`return [...document.querySelectorAll('#settings-form input, #settings-form select')].every((i) => document.querySelector('label[for="' + i.id + '"]'))`);
  // live apply: move a slider through the dom and read the setting back
  res.liveApply = await q(`const i = document.getElementById('set-grain'); i.value = 0.8; i.dispatchEvent(new Event('input')); return __br.settings.get('grain');`);
  await shot('settings');
  await q(`const i = document.getElementById('set-grain'); i.value = 0.35; i.dispatchEvent(new Event('input'));`);
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
  await delay(200);
  res.backToStart = await q(`return !document.getElementById('start').hidden && document.activeElement.id`);
  await q(`document.getElementById('btn-start').click()`);
  await delay(900);
  res.playing = await q(`return __br.game.state + ' hud:' + !document.getElementById('hud').hidden + ' start:' + document.getElementById('start').hidden`);
  await q(`__br.events.emit('game:prompt', { text: 'E  Open door' })`);
  await delay(200);
  await shot('hud-prompt');
  await q(`__br.events.emit('game:prompt', null); __br.game.pause()`);
  await delay(500);
  res.pause = await q(`return !document.getElementById('pause').hidden && document.activeElement.id`);
  await shot('pause');
  await q(`__br.game.resume()`);
  await delay(300);
  await q(`__br.game._die ? __br.game._die('kanye') : __br.events.emit('game:state', { state: 'dead' })`);
  await delay(600);
  res.death = await q(`return !document.getElementById('death').hidden && document.getElementById('death-line').textContent`);
  res.deathOverflow = await overflow();
  await shot('death');
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }))`);
  await delay(400);
  res.afterRestart = await q(`return __br.game.state + ' death hidden:' + document.getElementById('death').hidden`);
  console.log(JSON.stringify(res, null, 1));
}
