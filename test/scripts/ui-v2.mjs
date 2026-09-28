// v2 hud + overlays over the live scene: start, intro card, hud (checklist, compass, hotbar, toasts), lore reader,
// pause, settings, death, win. run: node test/harness.mjs ui-v2 --tag=ui-v2 --size=1280x720 --menu
export default async function ({ evalJs, shot, delay }) {
  const q = (js) => evalJs(`(() => { ${js} })()`);
  const vis = (id) => q(`const el = document.getElementById('${id}'); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'`);
  const key = (code, target = 'window') => evalJs(`${target}.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${code}', bubbles: true, cancelable: true }))`);
  // everything visible inside #ui must stay on screen, and hud boxes must not overlap each other
  const layout = () => q(`
    const out = [], boxes = [];
    for (const el of document.querySelectorAll('#ui *')) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // rows inside a scroll container (settings sheet, reader body) are reachable by scrolling
      let sc = el.parentElement, scrolls = false;
      while (sc && sc.id !== 'ui') { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) { scrolls = true; break; } sc = sc.parentElement; }
      if (scrolls) continue;
      if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) if (!el.closest('.death-face, #death-face, .meme-toast')) out.push('offscreen:' + (el.id || el.className || el.tagName));
    }
    for (const id of ['objectives', 'compass', 'hotbar', 'toasts', 'prompt']) {
      const el = document.getElementById(id);
      if (el && !el.hidden && el.offsetParent !== null) { const r = el.getBoundingClientRect(); if (r.width && r.height) boxes.push([id, r]); }
    }
    const h = document.querySelector('#hud canvas.hearts'); if (h && h.offsetParent !== null) boxes.push(['hearts', h.getBoundingClientRect()]);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, A] = boxes[i], [b, B] = boxes[j];
      if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) out.push('overlap:' + a + '/' + b);
    }
    return out;`);
  const res = {};
  await delay(1500);
  res.font = await q(`return document.fonts.check('18px Monocraft') + ' ' + [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + f.weight).join(',')`);
  res.icons = await q(`return !document.documentElement.classList.contains('no-icons')`);
  res.startLayout = await layout();
  await shot('start');
  await q(`document.getElementById('btn-start').click()`);
  await delay(1600);
  res.state = await q(`return __br.game.state`);
  res.intro = await vis('intro');
  if (!res.intro) await q(`__br.events.emit('game:intro', { title: 'INCOMING TRANSMISSION // M.E.G. BASE ALPHA', body: 'Para one.\\n\\nPara two.\\n\\nPara three.' })`);
  await delay(2600);
  res.introLayout = await layout();
  await shot('intro');
  // first E reveals, second E closes (the game owns E while reading)
  await key('KeyE'); await delay(150); await key('KeyE'); await delay(400);
  res.introClosed = !(await vis('intro')) && (await q(`return !__br.game.reading`));

  // hud: real game events plus a filled-in checklist / inventory so every widget shows
  await q(`
    const E = __br.events;
    E.emit('obj:update', { activeId: 'tapes', list: [
      { id: 'phone', text: 'Answer the ringing phone', done: true, active: false },
      { id: 'tapes', text: 'Recover the VHS tapes', done: false, progress: 2, total: 5, active: true },
      { id: 'power', text: 'Restore power at the breakers', done: false, progress: 0, total: 3, active: false },
      { id: 'exit', text: 'Reach the EXIT', done: false, active: false },
    ] });
    E.emit('inv:update', { almond: 2, almondMax: 3, airhorn: 3, airhornMax: 3 });
    const c = __br.game.frame.compass; c.active = true; c.bearing = __br.game.frame.cam.yaw + 0.6; c.dist = 42;
    E.emit('game:prompt', { text: 'E  Watch tape' });
    E.emit('toast', { text: 'VHS tape 2/5 recovered', kind: 'info', ms: 6000 });
    E.emit('toast', { text: 'The EXIT has power somewhere out there.', kind: 'lore', ms: 6000 });
    E.emit('toast', { text: 'emotional damage', kind: 'meme', ms: 6000 });`);
  await delay(700);
  res.hud = await q(`return { obj: document.querySelectorAll('#obj-list li').length, count: document.getElementById('obj-count').textContent, compass: !document.getElementById('compass').hidden && document.getElementById('compass-dist').textContent, rot: getComputedStyle(document.querySelector('#compass .ico')).getPropertyValue('--rot'), hotbar: !document.getElementById('hotbar').hidden && document.querySelector('#slot-almond .count').textContent, toasts: document.querySelectorAll('#toasts .toast').length, meme: getComputedStyle(document.getElementById('meme-toast')).opacity }`);
  res.hudLayout = await layout();
  await shot('hud');
  await q(`__br.events.emit('game:prompt', null)`);

  // lore reader: opened by the game, closed with Esc (ui path) -> game.closeLore()
  const opened = await q(`const g = __br.game; if (g.openLore) { g.openLore({ title: 'TAPE 2 // WREN', body: 'Day 6. The vending machine only sells almond water and regret.\\n\\nThe breakers are loud. Do them fast, then run.\\n\\nThe code digit is 7. Write it on your hand.' }); return 'game'; } __br.events.emit('lore:open', { title: 'TAPE 2', body: 'text' }); return 'event';`);
  await delay(500);
  res.lore = { opened, visible: await vis('lore'), reading: await q(`return __br.game.reading`) };
  res.loreLayout = await layout();
  await shot('lore');
  await key('Escape'); await delay(300);
  res.loreClosed = { visible: await vis('lore'), reading: await q(`return __br.game.reading`) };

  await q(`__br.game.pause()`); await delay(400);
  res.pause = await vis('pause');
  await shot('pause');
  await q(`document.getElementById('btn-pause-settings').click()`); await delay(300);
  res.settingsLayout = await layout();
  await shot('settings');
  await key('Escape'); await delay(200);
  await q(`__br.game.resume()`); await delay(400);

  if (await q(`return typeof __br.game.win === 'function'`)) await q(`__br.game.win()`);
  else await q(`__br.events.emit('game:win', { time: 734.2, distance: 1840, escapes: 4, tapes: 5, best: 734.2, newBest: true }); __br.events.emit('game:state', { state: 'won' })`);
  await delay(700);
  res.win = { visible: await vis('win'), time: await q(`return document.getElementById('win-time').textContent`), focus: await q(`return document.activeElement.id`) };
  res.winLayout = await layout();
  await shot('win');
  await key('KeyR'); await delay(600);
  res.afterWin = await q(`return __br.game.state + ' win hidden:' + document.getElementById('win').hidden`);

  await q(`__br.game._die ? __br.game._die('trump') : __br.events.emit('game:state', { state: 'dead' })`);
  await delay(700);
  res.deathLayout = await layout();
  await shot('death');
  console.log(JSON.stringify(res, null, 1));
  const bad = [...res.startLayout, ...res.introLayout, ...res.hudLayout, ...res.loreLayout, ...res.settingsLayout, ...res.winLayout, ...res.deathLayout];
  const ok = res.introClosed && res.lore.visible && !res.loreClosed.visible && !res.loreClosed.reading && res.win.visible && res.hud.obj === 4 && res.hud.toasts === 2 && !bad.length;
  console.log(ok ? 'ok   ui v2' : `FAIL ui v2 ${bad.join(' ')}`);
  return ok;
}
