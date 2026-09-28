// touch controls on a phone: mobile emulation (dpr 3, coarse pointer, notch safe areas) and real multi-touch via
// CDP Input.dispatchTouchEvent. no ?touch=1: the page has to detect the phone by itself.
// run: node test/harness.mjs touch-mobile --tag=touch-land --size=844x390 --menu --query=nodirector:1
//      node test/harness.mjs touch-mobile --tag=touch-port --size=390x844 --menu --query=nodirector:1
import { PLAYER } from '../../src/game/tuning.js';

export default async function ({ evalJs, br, delay, send, shot, W, H }) {
  let failed = 0;
  const expect = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; return c; };
  const land = W > H;
  const SA = land ? { top: 0, left: 47, right: 47, bottom: 21 } : { top: 47, left: 0, right: 0, bottom: 34 };
  const snap = (name) => shot(name, { format: 'jpeg', quality: 72 });

  // ---- phone emulation, then reload so detection runs like on a real device ----
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenOrientation: land ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let saOk = true;
  try { await send('Emulation.setSafeAreaInsetsOverride', { insets: SA }); } catch { saOk = false; }
  await send('Page.navigate', { url: await evalJs('location.href') });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { await delay(400); try { ready = await evalJs('!!(window.__br && window.__br.ready)'); } catch {} }
  expect(ready, 'page ready under phone emulation');
  await delay(900);

  // ---- touch helpers (css px); touchEnd with a point list lifts just those fingers ----
  const pts = new Map();
  const list = (ids) => ids.map((id) => ({ id, x: pts.get(id).x, y: pts.get(id).y, radiusX: 4, radiusY: 4, force: 1 }));
  const down = async (id, x, y) => { pts.set(id, { x, y }); await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: list([...pts.keys()]) }); };
  const move = async (id, x, y) => { pts.set(id, { x, y }); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: list([...pts.keys()]) }); };
  const up = async (id) => { const l = list([id]); pts.delete(id); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: l }); };
  let tid = 20;
  const tap = async (x, y, ms = 60) => { const id = tid++; await down(id, x, y); await delay(ms); await up(id); };
  const box = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; if (el.closest('.sheet, .menu')) el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom, vis: !el.hidden && el.offsetParent !== null }; })()`);
  const tapEl = async (sel, ms) => { const b = await box(sel); if (!b || !b.vis) return false; await tap(b.x, b.y, ms); return true; };
  const waitFor = async (expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await br(expr)) return true; await delay(60); } return false; };
  // queued lore cards (briefing, tape logs) open on a calm moment, like with keys: close them with a tap
  let cardsClosed = 0;
  const closeCards = async (waitMs = 1100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      if (await br('!!B.game.reading')) { await delay(300); await tap(W * 0.5, H * 0.45); await delay(250); cardsClosed++; } else await delay(100);
    }
    return !(await br('!!B.game.reading'));
  };
  const dbg = async (tag) => console.log('  dbg', tag, JSON.stringify(await br(`({ state: B.game.state, reading: B.game.reading, title: document.getElementById('lore-title').textContent, uiState: B.ui.state, overlay: B.ui.overlay, kind: B.game.interact.kind, party: B.party.state, cd: B.party.cooldownT, task: !!B.game.tasks.active, guard: B.game.loreGuard })`)));
  const P = () => br('({ x: B.game.player.x, z: B.game.player.z, yaw: B.game.player.yaw, pitch: B.game.player.pitch, speed: B.game.player.speed, t: B.director.t })');

  // hud vs controls: no box of one set may touch a box of the other, and everything stays inside the safe area
  const layout = (tag) => evalJs(`(() => {
    const vis = (el) => el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0.05;
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const ctl = [...document.querySelectorAll('#touch .tbtn, #stick')].filter(vis).map((el) => [el.id, R(el)]);
    const hud = [];
    for (const id of ['objectives', 'compass', 'prompt', 'task']) { const el = document.getElementById(id); if (vis(el)) hud.push([id, R(el)]); }
    document.querySelectorAll('#toasts .toast').forEach((el, i) => { if (vis(el)) hud.push(['toast' + i, R(el)]); });
    const hearts = document.querySelector('#hud canvas.hearts'); if (vis(hearts)) hud.push(['hearts', R(hearts)]);
    if (vis(document.getElementById('party'))) hud.push(['party', R(document.querySelector('.party-stack'))]);
    const mt = document.getElementById('meme-toast'); if (!mt.classList.contains('out') && mt.textContent) hud.push(['meme', R(mt)]);
    const cs = getComputedStyle(document.documentElement), px = (v) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:0;left:0;width:' + v; document.body.append(d); const w = d.getBoundingClientRect().width; d.remove(); return w; };
    const sa = { l: px('var(--sa-l)'), r: px('var(--sa-r)'), t: px('var(--sa-t)'), b: px('var(--sa-b)') };
    const hit = (A, B) => A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b;
    const overlaps = [], unsafe = [];
    for (const [a, A] of hud) for (const [b, B] of ctl) if (hit(A, B)) overlaps.push(a + '/' + b);
    // every pair: checklist, compass, hearts, prompt, each toast, meme caption, party banner, task panel
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) { const [a, A] = hud[i], [b, B] = hud[j]; if (hit(A, B)) overlaps.push(a + '/' + b); }
    for (const [n, r] of [...hud, ...ctl]) if ((r.l < sa.l - 0.5 || r.t < sa.t - 0.5 || r.r > innerWidth - sa.r + 0.5 || r.b > innerHeight - sa.b + 0.5)) unsafe.push(n + ' ' + [r.l, r.t, r.r, r.b].map(Math.round).join(','));
    return { tag: ${JSON.stringify(tag)}, sa, hud: hud.map((h) => h[0]), ctl: ctl.map((c) => c[0]), overlaps, unsafe };
  })()`);
  const flood = (meme) => br(`(() => { const E = B.events;
    E.emit('toast', { text: 'M.E.G.: Work order 2/6 done. M.E.G. sent VHS log 2/5. It plays when it is quiet.', kind: 'lore', ms: 6000 });
    E.emit('toast', { text: 'Almond water. Press 1 to drink.', kind: 'info', ms: 6000 });
    E.emit('toast', { text: 'The EXIT has power somewhere out there.', kind: 'info', ms: 6000 });
    E.emit('toast', { text: ${JSON.stringify(meme)}, kind: 'meme', ms: 6000 });
    return true; })()`);
  const checkLayout = async (tag) => {
    const L = await layout(tag);
    if (tag.includes('meme') && !L.hud.includes('meme')) console.log(`  note: meme caption gave way in "${tag}"`);
    expect(L.overlaps.length === 0 && L.unsafe.length === 0, `layout ${tag}: hud [${L.hud}] vs controls [${L.ctl}], safe area ${JSON.stringify(L.sa)}; overlaps ${JSON.stringify(L.overlaps)} unsafe ${JSON.stringify(L.unsafe)}`);
  };
  // readable text + big enough targets
  const sizes = (tag) => evalJs(`(() => {
    const small = [], tiny = [];
    for (const el of document.querySelectorAll('#ui *')) {
      if (el.offsetParent === null || getComputedStyle(el).visibility === 'hidden') continue;
      const txt = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (txt && parseFloat(getComputedStyle(el).fontSize) < 12) small.push((el.id || el.className || el.tagName) + ':' + getComputedStyle(el).fontSize);
    }
    for (const el of document.querySelectorAll('#touch .tbtn, .wire-key, #ui .screen:not([hidden]) button')) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) tiny.push((el.id || el.className) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return { small, tiny };
  })()`).then((s) => expect(!s.small.length && !s.tiny.length, `${tag}: text >= 12 px, targets >= 44 px (${JSON.stringify(s)})`));

  // ---- detection + quality ----
  const det = await br(`({ touch: document.documentElement.classList.contains('touch'), coarse: matchMedia('(pointer: coarse)').matches, q: B.renderer.qualityName, auto: B.renderer.auto, pr: B.renderer.renderer.getPixelRatio(), dpr: devicePixelRatio, setting: B.settings.get('quality') })`);
  expect(det.touch && det.coarse, `touch controls detected from the coarse pointer (no ?touch param) ${JSON.stringify(det)}`);
  expect(det.q === 'mobile' && det.auto && det.pr === 1, `auto quality picked the mobile tier, pixel ratio capped at ${det.pr} (device ${det.dpr})`);
  expect(saOk, 'safe-area insets emulated');

  // ---- start screen ----
  const st = await box('#btn-start');
  expect(st && st.vis && st.t >= 0 && st.b <= H, `Start button on screen (${st && [st.l, st.t, st.r, st.b].map(Math.round)})`);
  const hint = await box('#rotate-hint');
  expect(land ? !hint.vis : hint.vis, `rotate hint ${land ? 'hidden in landscape' : 'shown in portrait'}`);
  await sizes('start screen');
  await snap('01-start');
  if (!land) { await tapEl('#btn-rotate-ok'); await delay(150); expect(!(await box('#rotate-hint')).vis, 'rotate hint dismissed with a tap'); }

  // tap Start: the audio unlock must run inside the tap (user activation) and the game must not ask for pointer lock
  await evalJs(`(() => { const a = __br.audio, u = a.unlock.bind(a); window.__unlock = []; a.unlock = () => { __unlock.push(navigator.userActivation ? navigator.userActivation.isActive : 'n/a'); return u(); };
    const c = HTMLCanvasElement.prototype.requestPointerLock; window.__locks = 0; HTMLCanvasElement.prototype.requestPointerLock = function () { __locks++; return c.call(this); }; })()`);
  await tapEl('#btn-start');
  await waitFor(`B.game.state === 'playing'`, 3000);
  await delay(300);
  const s0 = await br(`({ state: B.game.state, unlock: window.__unlock, ctx: B.audio.ctx && B.audio.ctx.state, locks: window.__locks, layer: !document.getElementById('touch').hidden })`);
  expect(s0.state === 'playing' && s0.unlock.length === 1 && s0.unlock[0] === true && s0.ctx === 'running', `tap Start: playing, audio unlocked inside the tap gesture (${JSON.stringify(s0)})`);
  expect(s0.locks === 0 && s0.layer, `no pointer lock request on touch; touch controls shown`);
  await br('(B.input.clear(), true)');

  // ---- stick: analogue walk, sprint at the edge ----
  const head = await evalJs(`(() => { const B = window.__br, p = B.game.player, w = B.world; let best = 0, by = 0;
    for (let k = 0; k < 32; k++) { const y = k * Math.PI / 16; let d = 0; while (d < 34 && !w.blocksMove(Math.floor((p.x - Math.sin(y) * d) / 0.5), Math.floor((p.z - Math.cos(y) * d) / 0.5))) d += 0.25; if (d > best) { best = d; by = y; } }
    p.yaw = by; p.pitch = 0; return { yaw: by, clear: best, x: p.x, z: p.z }; })()`);
  const sb = await box('#stick');
  const speedAt = async (push) => {
    await move(1, sb.x, sb.y - push); await delay(380);
    const a = await P(); await delay(320); const b = await P();
    return Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1e-3, b.t - a.t);
  };
  await down(1, sb.x, sb.y); await delay(60);
  const live = await evalJs(`document.getElementById('stick').classList.contains('live')`);
  const vHalf = await speedAt(26), v80 = await speedAt(42);
  const vRun = await speedAt(70);
  const runCls = await evalJs(`document.getElementById('stick').classList.contains('run')`);
  expect(live, 'stick appears under the thumb');
  expect(vHalf > 0.9 && vHalf < 1.8 && v80 > 2.0 && v80 < 2.8, `analogue walk: half push ${vHalf.toFixed(2)} m/s, 80% push ${v80.toFixed(2)} m/s (walk ${PLAYER.walk})`);
  expect(Math.abs(vRun - PLAYER.sprint) < 0.35 && runCls, `edge push sprints ${vRun.toFixed(2)} m/s (~${PLAYER.sprint}), stick shows sprint`);

  // ---- look with the right thumb while still moving, then USE with a third finger ----
  await move(1, sb.x, sb.y - 42);
  const lookX = land ? W * 0.62 : W * 0.72, lookY = H * 0.42;
  await evalJs(`(() => { const it = __br.game.interact, u = it.use.bind(it); window.__uses = 0; it.use = () => { __uses++; return u(); }; })()`);
  const y0 = await P();
  await down(2, lookX, lookY);
  for (let i = 1; i <= 6; i++) { await move(2, lookX - i * 20, lookY + i * 3); await delay(16); }
  const ub = await box('#t-use');
  await down(3, ub.x, ub.y);
  await delay(120);
  const mid = await br(`({ uses: window.__uses, held: B.game.input.t.use, speed: B.game.player.speed, yaw: B.game.player.yaw, pitch: B.game.player.pitch })`);
  await up(3); await up(2); await up(1);
  const sens = await br(`B.settings.get('sensitivity')`);
  const wantYaw = 120 * 2.3 * PLAYER.lookSens * sens;
  const dYaw = mid.yaw - y0.yaw;
  expect(Math.abs(dYaw - wantYaw) < 0.05 && mid.pitch < y0.pitch, `right drag of 120 px turned ${dYaw.toFixed(3)} rad left (want ${wantYaw.toFixed(3)}), pitch ${y0.pitch.toFixed(3)} -> ${mid.pitch.toFixed(3)}`);
  expect(mid.uses === 1 && mid.held && mid.speed > 1.5, `stick + look + USE at once: use fired ${mid.uses}x, held ${mid.held}, still moving ${mid.speed.toFixed(2)} m/s`);
  await delay(200);
  const after = await br(`({ t: B.game.input.t, speed: B.game.player.speed })`);
  expect(!after.t.use && after.t.fwd === 0 && after.t.strafe === 0 && !after.t.sprint, 'all fingers up: stick centred and USE released');

  // pressing and sliding on a button never looks
  const yb = await P();
  await down(4, ub.x, ub.y); await move(4, ub.x - 60, ub.y - 40); await delay(80); await up(4);
  const ya = await P();
  expect(Math.abs(ya.yaw - yb.yaw) < 1e-6 && Math.abs(ya.pitch - yb.pitch) < 1e-6, 'a drag that starts on USE does not turn the camera');

  // ---- approach helper: stand in front of a target until the interaction scan picks it ----
  await evalJs(`window.__approach = (f, kind, heights) => {
    const B = window.__br, g = B.game, it = g.interact, w = B.world, p = g.player;
    const fy = f.yaw || 0, bx = -Math.sin(fy), bz = -Math.cos(fy);
    for (const d of [1.2, 1.6, 0.9, 2.0]) for (const a of [0, 0.35, -0.35, 0.7, -0.7, 1.2, -1.2, Math.PI]) {
      const dx = bx * Math.cos(a) - bz * Math.sin(a), dz = bx * Math.sin(a) + bz * Math.cos(a);
      const x = f.x + dx * d, z = f.z + dz * d;
      if (w.blocksMove(Math.floor(x / 0.5), Math.floor(z / 0.5))) continue;
      for (const y of heights) {
        B.teleport(x, z, Math.atan2(-(f.x - x), -(f.z - z)));
        if (Math.hypot(p.x - x, p.z - z) > 0.05) continue;
        p.pitch = Math.atan2(y - 1.68, Math.hypot(f.x - p.x, f.z - p.z));
        it.scanT = 1; it._scan();
        if (it.kind === kind && (it.feature ? it.feature.id === f.id : true)) { it.scanT = 0.1; return { x, z, d, a, y }; }
      }
    }
    return null;
  }`);

  // ---- door ----
  const door = await evalJs(`(() => {
    const B = window.__br, w = B.world, p = B.game.player, it = B.game.interact;
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    for (let r = 0; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const d of w.getChunk(pcx + dx, pcz + dz).doors) for (const s of [-1, 1]) {
        const cx = (d.ix + (d.axis === 'x' ? 1 : 0.5)) * 0.5, cz = (d.iz + (d.axis === 'x' ? 0.5 : 1)) * 0.5;
        const ox = d.axis === 'x' ? 0 : s * 1.1, oz = d.axis === 'x' ? s * 1.1 : 0, x = cx + ox, z = cz + oz;
        if (w.blocksMove(Math.floor(x / 0.5), Math.floor(z / 0.5))) continue;
        B.teleport(x, z, Math.atan2(ox, oz)); p.pitch = 0;
        it.scanT = 1; it._scan();
        if (it.kind === 'door' && it.door === d) { it.scanT = 0.1; return { ix: d.ix, iz: d.iz, target: d.target }; }
      }
    }
    return null;
  })()`);
  if (expect(!!door, 'found a door to test')) {
    await delay(250);
    const ready = await evalJs(`document.getElementById('t-use').classList.contains('ready')`);
    await tapEl('#t-use');
    await delay(500);
    const t1 = await br(`B.world.doorAt(${door.ix}, ${door.iz}).target`);
    expect(ready && t1 !== door.target, `USE lit up and toggled the door (${door.target} -> ${t1})`);
  }

  // ---- phone: USE answers, the briefing card closes on a tap ----
  const phone = await br(`(() => { const f = B.objectives.phoneFeature(); return f ? window.__approach(f, 'phone', [0.8, 0.95, 0.6]) : null; })()`);
  if (expect(!!phone, 'standing at the ringing phone')) {
    await delay(150);
    await tapEl('#t-use');
    const answered = await br('B.objectives.check.phone');
    await waitFor(`B.game.reading === 'lore'`, 4000);
    const r = await br(`({ reading: B.game.reading, lore: !document.getElementById('lore').hidden, body: document.getElementById('lore-body').textContent })`);
    expect(answered && r.reading === 'lore' && r.lore, `USE answered the phone (${answered}), briefing card open`);
    expect(!/WASD|press G/.test(r.body), `briefing names the touch buttons, not keys ("${r.body.split('\n').find((l) => /thumb|USE/.test(l)) || ''}")`);
    await sizes('lore card');
    await snap('02-lore');
    await delay(300); // the reader ignores taps for its first 0.25 s (the press that opened it)
    await tap(W * 0.5, H * 0.45);
    await delay(250);
    const c = await br(`({ reading: B.game.reading, lore: !document.getElementById('lore').hidden, state: B.game.state })`);
    expect(!c.reading && !c.lore && c.state === 'playing', `lore card closed with a tap (${JSON.stringify(c)})`);
    await delay(300);
  }

  await closeCards();
  // ---- hold task: USE held fills it, letting go stops it ----
  const HOLD = ['touchGrass', 'fixLight', 'mop', 'copier', 'microwave'];
  const holdTask = await br(`(() => { const p = B.game.player; const list = B.world.tasksNear(p.x, p.z, 140).filter((f) => ${JSON.stringify(HOLD)}.includes(f.data.kind) && !B.game.tasks.isDone(f));
    for (const f of list.slice(0, 6)) { const a = window.__approach(f, 'task', [f.data.y ?? 1.1, 0.5, 0.3, 1.2]); if (a) return { id: f.id, kind: f.data.kind, a }; } return null; })()`);
  if (expect(!!holdTask, `found a hold task (${holdTask && holdTask.kind})`)) {
    await delay(700);
    const u = await box('#t-use');
    await down(5, u.x, u.y);
    await delay(700);
    const h1 = await br(`({ open: !!B.game.tasks.active, t: B.game.tasks.active ? B.game.tasks.active.run.t : -1, panel: !document.getElementById('task').hidden })`);
    await up(5);
    await delay(400);
    const h2 = await br(`B.game.tasks.active ? B.game.tasks.active.run.t : -1`);
    await checkLayout('hold task panel');
    await snap('03-hold-task');
    expect(h1.open && h1.panel && h1.t > 0.12 && Math.abs(h2 - h1.t) < 0.15, `holding USE fills the ${holdTask.kind} task (${h1.t.toFixed(2)} after 0.7 s), release holds it (${h2.toFixed(2)})`);
    await down(5, u.x, u.y);
    const done = await waitFor(`B.game.tasks.isDone({ id: ${JSON.stringify(holdTask.id)} })`, 4500);
    await up(5);
    expect(done, 'holding USE again finishes the hold task');
    await delay(1200);
  }

  await closeCards();
  // ---- wires: taps on the terminal keys ----
  const wires = await br(`(() => { const p = B.game.player; const list = B.world.tasksNear(p.x, p.z, 140, 'wires').filter((f) => !B.game.tasks.isDone(f));
    for (const f of list.slice(0, 6)) { const a = window.__approach(f, 'task', [f.data.y ?? 1.35, 1.2, 1.5]); if (a) return { id: f.id, a }; } return null; })()`);
  if (expect(!!wires, 'found a wiring panel')) {
    await delay(300);
    await tapEl('#t-use');
    await delay(350);
    await flood('BWAAAMP. NOTHING IN RANGE, BUT EVERYTHING HEARD THAT.');
    await delay(350);
    await checkLayout('wires panel + toasts + meme caption');
    const open = await br(`({ ui: B.game.tasks.active && B.game.tasks.active.run.ui, keys: [...document.querySelectorAll('.wire-key')].filter((b) => b.offsetParent !== null).length, hint: document.getElementById('task-hint').textContent })`);
    expect(open.ui === 'wires' && open.keys === 4, `USE opened the wiring panel with 4 tappable terminals, hint "${open.hint}"`);
    await sizes('wires panel');
    await checkLayout('wires panel');
    await snap('04-wires');
    // one wrong tap, then the right ones
    const wrong = await br(`(() => { const r = B.game.tasks.active.run; return [1, 2, 3, 4].find((n) => n !== r.expectKey()); })()`);
    await tapEl(`.wire-key:nth-child(${wrong})`);
    await delay(150);
    const wr = await br(`B.game.tasks.active.run.wrong`);
    for (let i = 0; i < 4; i++) {
      const n = await br(`B.game.tasks.active ? B.game.tasks.active.run.expectKey() : 0`);
      if (!n) break;
      await tapEl(`.wire-key:nth-child(${n})`);
      await delay(140);
    }
    const ok = await br(`B.game.tasks.isDone({ id: ${JSON.stringify(wires.id)} })`);
    expect(wr && ok, `wires: wrong tap flagged (${wr}), four right taps solved it (${ok})`);
    await delay(1300);
  }

  await closeCards();
  // ---- card swipe: hold USE, let go inside the window ----
  const card = await br(`(() => { const p = B.game.player; const list = B.world.tasksNear(p.x, p.z, 160, 'cardSwipe').filter((f) => !B.game.tasks.isDone(f));
    for (const f of list.slice(0, 6)) { const a = window.__approach(f, 'task', [f.data.y ?? 1.15, 1.2, 1.0]); if (a) return { id: f.id, a }; } return null; })()`);
  if (expect(!!card, 'found a card reader')) {
    await delay(700);
    const u = await box('#t-use');
    await down(6, u.x, u.y);
    const inWin = await waitFor(`(() => { const a = B.game.tasks.active; if (!a) return false; const [lo, hi] = a.run.spec.window; return a.run.t >= lo + (hi - lo) * 0.35; })()`, 3000, 10);
    await up(6);
    await delay(200);
    const ok = await br(`B.game.tasks.isDone({ id: ${JSON.stringify(card.id)} })`);
    expect(inWin && ok, `card swipe: hold USE, release in the green -> accepted (${ok})`);
    await delay(1300);
  }

  await closeCards();
  // ---- look back (hold), flashlight (tap) ----
  const bb = await box('#t-back');
  await down(7, bb.x, bb.y); await delay(650);
  const lb1 = await br('B.game.frame.fx.lookBehind');
  await up(7); await delay(650);
  const lb2 = await br('B.game.frame.fx.lookBehind');
  expect(lb1 > 0.9 && lb2 < 0.1, `BACK held looks behind (${lb1.toFixed(2)}), release looks forward (${lb2.toFixed(2)})`);
  const f0 = await br('B.game.frame.flashlight');
  await tapEl('#t-light'); await delay(120);
  const f1 = await br(`({ on: B.game.frame.flashlight, pressed: document.getElementById('t-light').getAttribute('aria-pressed') })`);
  expect(f1.on === !f0 && f1.pressed === String(f1.on), `LIGHT toggles the flashlight (${f0} -> ${f1.on}, aria-pressed ${f1.pressed})`);
  await tapEl('#t-light'); await delay(80);

  await closeCards();
  // ---- item buttons: only with items; drink and airhorn ----
  await br(`(() => { const i = B.objectives.inv; i.almond = 0; i.airhorn = 0; B.objectives.emitInv(); return true; })()`);
  await delay(80);
  const none = await br(`({ d: !document.getElementById('t-drink').hidden, h: !document.getElementById('t-horn').hidden })`);
  await br(`(() => { const i = B.objectives.inv; i.almond = 2; i.airhorn = 2; B.objectives.emitInv(); B.game.player.hp = 10; return true; })()`);
  await delay(120);
  const some = await br(`({ d: !document.getElementById('t-drink').hidden, h: !document.getElementById('t-horn').hidden, dc: document.querySelector('#t-drink .count').textContent })`);
  expect(!none.d && !none.h && some.d && some.h && some.dc === '2', `item buttons hidden without items, shown with them (${JSON.stringify({ none, some })})`);
  await tapEl('#t-drink'); await delay(150);
  const dr = await br(`({ almond: B.objectives.inv.almond, use: B.game.useKind })`);
  await delay(1600);
  await tapEl('#t-horn'); await delay(150);
  const ah = await br(`({ horn: B.objectives.inv.airhorn, use: B.game.useKind })`);
  expect(dr.almond === 1 && dr.use === 'almond', `DRINK drinks almond water (${JSON.stringify(dr)})`);
  expect(ah.horn === 1 && ah.use === 'airhorn', `AIRHORN blasts (${JSON.stringify(ah)})`);

  // ---- full hud for the layout check: checklist, compass, toasts, prompt, items ----
  await br(`(() => {
    const E = B.events;
    E.emit('obj:update', { activeId: 'work', list: [
      { id: 'phone', text: 'Answer the ringing phone', done: true },
      { id: 'work', text: 'Complete M.E.G. work orders', progress: 2, total: 6, active: true, sub: [{ text: 'Swipe card (admin office)', dist: 18 }, { text: 'Fix the wiring panel', dist: 31 }, { text: 'Microwave something', done: true }] },
      { id: 'power', text: 'Restore power at the breakers', progress: 0, total: 3 },
      { id: 'exit', text: 'Reach the EXIT' } ] });
    E.emit('toast', { text: 'VHS tape 2/5 recovered', kind: 'info', ms: 5000 });
    E.emit('toast', { text: 'Almond water. Press 1 to drink.', kind: 'info', ms: 5000 });
    E.emit('toast', { text: 'The EXIT has power somewhere out there.', kind: 'lore', ms: 5000 });
    return true; })()`);
  // a long prompt, as the game words it (keys), shown with the touch button names
  await br(`(B.events.emit('game:prompt', { text: 'Hold E  Microwave the almond water' }), true)`);
  await delay(600);
  const pr = await evalJs(`document.getElementById('prompt').textContent`);
  expect(/^Hold USE/.test(pr), `prompt names the USE button ("${pr}")`);
  const tt = await evalJs(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ')`);
  expect(/Tap the bottle/.test(tt) && !/Press 1/.test(tt), `toasts name the touch buttons ("${tt}")`);
  await checkLayout('hud with items + toasts');
  await sizes('hud');
  await snap('05-hud');

  await closeCards();
  // ---- party mode banner vs controls ----
  await br('(B.party.cooldownT = 0, true)'); // the stick + look + USE check above was aimed at the jukebox
  const juke = await br(`(() => { for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) { const f = B.world.getChunk(cx, cz).features.find((x) => x.type === 'jukebox'); if (f) return window.__approach(f, 'jukebox', [1.0, 0.8, 1.2]); } return null; })()`);
  if (expect(!!juke, 'standing at the jukebox')) {
    await delay(200);
    await tapEl('#t-use');
    await delay(900);
    const on = await br('B.game.frame.party.active');
    if (!on) await dbg('party did not start');
    expect(on, 'USE starts party mode');
    await flood('SIGMA SIGMA BOY. PARTY MODE. THE VILLAIN GOT BLASTED INTO NEXT WEEK.');
    await br(`(B.events.emit('game:prompt', { text: 'E  Stop the party' }), true)`);
    await delay(350);
    await checkLayout('party + 4 toasts + meme caption + prompt');
    await snap('06-party');
    await tapEl('#t-use');
    await delay(300);
  }

  await closeCards();
  // ---- pause + resume by taps, settings, visibility change ----
  await tapEl('#t-pause');
  await delay(300);
  const ps = await br(`({ state: B.game.state, menu: !document.getElementById('pause').hidden, layer: !document.getElementById('touch').hidden })`);
  expect(ps.state === 'paused' && ps.menu && !ps.layer, `PAUSE pauses (${JSON.stringify(ps)})`);
  await sizes('pause menu');
  await snap('07-pause');
  await tapEl('#btn-pause-settings'); await delay(300);
  const setv = await br(`({ open: !document.getElementById('settings').hidden, sens: document.querySelector('label[for=set-sensitivity]').textContent, sprintRow: document.getElementById('set-sprintMode').offsetParent !== null })`);
  expect(setv.open && setv.sens === 'Look sensitivity' && !setv.sprintRow, `settings open by tap, touch labels (${JSON.stringify(setv)})`);
  await snap('08-settings');
  await tapEl('#btn-back'); await delay(250);
  await tapEl('#btn-resume'); await delay(300);
  expect((await br('B.game.state')) === 'playing', 'Resume tap resumes');
  await evalJs(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; })()`);
  await delay(150);
  expect((await br('B.game.state')) === 'paused', 'hiding the page pauses');
  await tapEl('#btn-resume'); await delay(300);

  // ---- death + win screens by taps ----
  await br(`(B.game._die('kanye'), true)`);
  await delay(700);
  await tap(W * 0.5, H * 0.5);
  await delay(400);
  expect((await br('B.game.state')) === 'playing', 'death screen: tap anywhere goes again');
  await br(`(B.game.win(), true)`);
  await delay(600);
  await sizes('win screen');
  await tapEl('#btn-win-again');
  await delay(400);
  expect((await br('B.game.state')) === 'playing', 'win screen: tap Play again');
  await br('(B.input.clear(), true)');

  // ---- no scroll, zoom, pull-to-refresh ----
  await evalJs('window.__alive = 1');
  await down(8, W * 0.7, H * 0.15); for (let i = 1; i <= 8; i++) { await move(8, W * 0.7, H * 0.15 + i * 30); await delay(12); } await up(8);
  try { await send('Input.synthesizePinchGesture', { x: Math.round(W * 0.7), y: Math.round(H * 0.5), scaleFactor: 2.2, gestureSourceType: 'touch' }); } catch (e) { console.log('pinch n/a', e.message); }
  try { await send('Input.synthesizeTapGesture', { x: Math.round(W * 0.7), y: Math.round(H * 0.4), tapCount: 2, gestureSourceType: 'touch' }); } catch (e) { console.log('double tap n/a', e.message); }
  try { await send('Input.synthesizeScrollGesture', { x: Math.round(W * 0.6), y: Math.round(H * 0.3), yDistance: 300, gestureSourceType: 'touch', speed: 1200 }); } catch (e) { console.log('scroll n/a', e.message); }
  await delay(500);
  const vp = await evalJs(`({ alive: window.__alive, sx: scrollX, sy: scrollY, top: document.scrollingElement.scrollTop, scale: visualViewport.scale, ox: visualViewport.offsetLeft, oy: visualViewport.offsetTop, sel: String(getSelection()), us: getComputedStyle(document.body).userSelect, ta: getComputedStyle(document.getElementById('touch')).touchAction })`);
  expect(vp.alive === 1 && vp.sx === 0 && vp.sy === 0 && vp.top === 0 && vp.scale === 1 && vp.ox === 0 && vp.oy === 0 && !vp.sel && vp.us === 'none' && vp.ta === 'none', `no scroll / zoom / reload / selection after drags, pinch, double tap, fling ${JSON.stringify(vp)}`);
  await checkLayout('final');
  await snap('09-play');

  console.log(`lore cards closed by tap along the way: ${cardsClosed}`);
  console.log(failed ? `${failed} failed` : 'all ok');
  return failed === 0;
}
