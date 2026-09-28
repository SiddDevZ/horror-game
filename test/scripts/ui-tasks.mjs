// v3 task panels (swipe, wires, hold, press), checklist sub-steps, and no focus outlines anywhere.
// run: node test/harness.mjs ui-tasks --tag=ui-tasks --size=1280x720 --menu
export default async function ({ evalJs, shot, delay }) {
  const q = (js) => evalJs(`(() => { ${js} })()`);
  const emit = (name, payload) => q(`__br.events.emit(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
  const res = {};
  await delay(1200);

  // 1) focus: every button / control, focused from the keyboard, draws no outline
  const outlines = async (screen) => q(`
    const out = [];
    for (const el of document.querySelectorAll('#${screen} button, #${screen} input, #${screen} select')) {
      if (el.offsetParent === null) continue;
      el.focus({ focusVisible: true });
      const cs = getComputedStyle(el);
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) out.push((el.id || el.className) + ':' + cs.outlineStyle + ' ' + cs.outlineWidth);
    }
    return out;`);
  // a keydown first so chrome treats programmatic focus as keyboard focus
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }))`);
  res.outlineStart = await outlines('start');
  await q(`document.getElementById('btn-start-settings').click()`); await delay(250);
  res.outlineSettings = await outlines('settings');
  await q(`document.getElementById('btn-back').click()`); await delay(150);
  await q(`document.getElementById('btn-start').click()`); await delay(1500);
  if (await q(`return !!__br.game.reading`)) { await q(`__br.game.closeLore()`); await delay(300); }
  await q(`__br.game.pause()`); await delay(400);
  res.pauseFocus = await q(`const a = document.activeElement; return a.id + ' visible:' + a.matches(':focus-visible') + ' outline:' + getComputedStyle(a).outlineStyle`);
  res.outlinePause = await outlines('pause');
  await shot('pause-focus');
  await q(`__br.game.resume()`); await delay(400);

  // 2) checklist with sub-steps under the active objective
  await emit('obj:update', { activeId: 'work', list: [
    { id: 'phone', text: 'Answer the ringing phone', done: true },
    { id: 'work', text: 'Complete M.E.G. work orders', progress: 2, total: 6, active: true, sub: [{ text: 'Swipe card (admin office)', dist: 18 }, { text: 'Fix the wiring panel', dist: 31 }, { text: 'Microwave something', done: true }] },
    { id: 'power', text: 'Restore power at the breakers', progress: 0, total: 3 },
    { id: 'exit', text: 'Reach the EXIT' },
  ] });
  await delay(200);
  res.sub = await q(`return [...document.querySelectorAll('#obj-list .obj-sub li')].filter((l) => l.offsetParent !== null).length`);

  // 3) card swipe: open, slide into the window, fail too fast, then accept
  await emit('task:open', { id: 'c1', kind: 'cardSwipe', title: 'Swipe card', hint: 'Hold [E], release in the green', data: { window: [0.6, 0.78] } });
  for (const t of [0.1, 0.3, 0.45]) { await emit('task:progress', { id: 'c1', kind: 'cardSwipe', t }); await delay(40); }
  await emit('task:result', { id: 'c1', kind: 'cardSwipe', ok: false, msg: 'Too fast. Try again.' });
  await delay(250);
  res.swipeFail = await q(`const t = document.getElementById('task'); return !t.hidden && t.classList.contains('fail') && document.getElementById('task-msg').textContent`);
  await shot('task-swipe-fail');
  await emit('task:progress', { id: 'c1', kind: 'cardSwipe', t: 0.7 });
  await emit('task:result', { id: 'c1', kind: 'cardSwipe', ok: true, msg: 'Accepted.' });
  await delay(200);
  res.swipeOk = await q(`return document.querySelector('.reader-lcd').textContent + ' | ' + document.querySelector('.id-card').style.transform`);
  await shot('task-swipe-ok');
  await emit('task:close', { id: 'c1' });
  await delay(1300);
  res.closedAfterLinger = await q(`return document.getElementById('task').hidden`);

  // 4) wires: two connected, one wrong press
  await emit('task:open', { id: 'w1', kind: 'wires', title: 'Fix wiring', hint: 'Press [1]-[4] for the lit wire', data: { left: ['red', 'blue', 'yellow', 'pink'], right: ['yellow', 'red', 'pink', 'blue'] } });
  await emit('task:progress', { id: 'w1', kind: 'wires', step: 2, total: 4 });
  await emit('task:progress', { id: 'w1', kind: 'wires', step: 2, total: 4, wrong: true });
  await delay(250);
  res.wires = await q(`return document.querySelectorAll('#task polyline').length / 2`);
  await shot('task-wires');

  // 5) hold (microwave) and multi-press (vending)
  await emit('task:open', { id: 'm1', kind: 'microwave', title: 'Microwave', hint: 'Hold [E] until it beeps' });
  await emit('task:progress', { id: 'm1', kind: 'microwave', t: 0.55 });
  await delay(150);
  res.hold = await q(`return document.querySelector('#task .bar i').style.transform`);
  await shot('task-hold');
  await emit('task:open', { id: 'v1', kind: 'vendingStuck', title: 'Unstick the vending machine', hint: 'Hit it: [E]', data: { total: 3 } });
  await emit('task:progress', { id: 'v1', kind: 'vendingStuck', step: 2, total: 3 });
  await emit('task:result', { id: 'v1', kind: 'vendingStuck', ok: true, msg: 'It dropped. Fanum tax paid.' });
  await delay(200);
  res.press = await q(`return document.querySelectorAll('.pips b.on').length + ' ' + document.querySelector('.pips span').textContent`);
  await shot('task-press');
  await emit('task:close', { id: 'v1' });

  // 6) layout: the task panel stays on screen and clear of the hud widgets
  await emit('task:open', { id: 'w2', kind: 'wires', title: 'Breaker 2 of 3', hint: 'Press [1]-[4]' });
  await delay(200);
  res.layout = await q(`
    const out = [], box = (id) => { const el = document.getElementById(id); return el && !el.hidden && el.offsetParent !== null ? el.getBoundingClientRect() : null; };
    const t = box('task');
    if (t.left < 0 || t.right > innerWidth || t.top < 0 || t.bottom > innerHeight) out.push('task offscreen');
    for (const id of ['objectives', 'compass', 'hotbar', 'toasts']) { const r = box(id); if (r && r.width && r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom) out.push('overlap ' + id); }
    if (!document.getElementById('prompt').hidden) out.push('prompt visible under task');
    return out;`);
  await shot('task-wires-default');
  await q(`__br.game.pause()`); await delay(300);
  res.hiddenOnPause = await q(`return document.getElementById('task').offsetParent === null`);
  console.log(JSON.stringify(res, null, 1));
  const ok = !res.outlineStart.length && !res.outlineSettings.length && !res.outlinePause.length && res.sub === 3 && res.swipeFail === 'Too fast. Try again.' &&
    res.closedAfterLinger && res.wires === 2 && res.press.startsWith('3 3/3') && !res.layout.length && res.hiddenOnPause;
  console.log(ok ? 'ok   ui tasks' : 'FAIL ui tasks');
  return ok;
}
