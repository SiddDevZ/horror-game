// v3 objective chain end to end in the real page (world + renderer + audio + ui), keys through CDP.
// intro pause -> spawn phone briefing -> locked breaker -> 6 work orders (incl. a failed card swipe and a wrong
// wire) -> 3 breaker wiring panels -> powered exit -> win -> restart -> meme prop, airhorn, almond, fun features
// -> director ON phone regression (no early encounter, kanye crashes the call; answering mid-encounter works).
// run: node test/harness.mjs game-v2 --tag=game-v2 --size=960x540 --query=nodirector:1
const KEYS = { KeyE: ['e', 69], KeyG: ['g', 71], Digit1: ['1', 49], Digit2: ['2', 50], Digit3: ['3', 51], Digit4: ['4', 52] };
// interaction heights by task kind (match Interact.js TASK_AT) when the feature has no data.y
const TASK_Y = { cardSwipe: 1.2, wires: 1.3, touchGrass: 0.5, fixLight: 1.2, mop: 0.3, straighten: 1.55, router: 1.0, copier: 0.95, microwave: 1.1, vendingStuck: 1.0, timesheet: 0.8, skibidi: 0.45 };

export default async function ({ br, evalJs, shot, delay, send }) {
  let failed = 0;
  const expect = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; return c; };
  const down = (code) => send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });
  const up = (code) => send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });
  const press = async (code) => { await down(code); await delay(40); await up(code); };
  const waitFor = async (expr, maxMs, stepMs = 50) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await br(expr)) return true; await delay(stepMs); } return false; };
  const n = (name) => br(`(window.__v2.ev[${JSON.stringify(name)}] || []).length`);
  const last = (name) => br(`(window.__v2.ev[${JSON.stringify(name)}] || []).slice(-1)[0] || null`);
  const T = () => br('B.director.t');
  const t00 = Date.now();

  // ---- instrumentation: events, meme / beacon calls, and an "approach and look at" helper ----
  await evalJs(`(() => {
    const B = window.__br, a = B.audio;
    const rec = (window.__v2 = { ev: {}, memes: {}, beacons: {}, beaconStops: 0 });
    const names = ['obj:update', 'inv:update', 'toast', 'lore:open', 'lore:close', 'game:intro', 'game:win', 'item:spawn', 'item:remove', 'feature:state', 'game:hearts', 'game:airhorn', 'game:state', 'task:open', 'task:progress', 'task:result', 'task:close'];
    for (const nm of names) B.events.on(nm, (p) => (rec.ev[nm] ||= []).push(p == null ? null : JSON.parse(JSON.stringify(p))));
    const om = typeof a.meme === 'function' ? a.meme.bind(a) : null;
    a.meme = (cat, o) => { rec.memes[cat] = (rec.memes[cat] || 0) + 1; return om ? om(cat, o) : undefined; };
    const ob = typeof a.beacon === 'function' ? a.beacon.bind(a) : null, os = typeof a.beaconStop === 'function' ? a.beaconStop.bind(a) : null;
    a.beacon = (id, x, z) => { rec.beacons[id] = (rec.beacons[id] || 0) + 1; return ob ? ob(id, x, z) : undefined; };
    a.beaconStop = (id) => { rec.beaconStops++; return os ? os(id) : undefined; };
    B.input.set({ fwd: 0, strafe: 0, sprint: false, lookYaw: null, lookPitch: null });
    // stand within reach of (x, z), in front of its facing when possible, with a clear view, and look at height y
    window.__approach = (x, z, y, yaw = 0, dists = [1.4, 1.8, 1.1, 2.2]) => {
      const w = B.world, r = 0.32;
      const free = (px, pz) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]].every(([ox, oz]) => !w.blocksMove(Math.floor((px + ox) / 0.5), Math.floor((pz + oz) / 0.5)));
      const lx = x - Math.sin(yaw) * 0.3, lz = z - Math.cos(yaw) * 0.3;
      for (const d of dists) for (let k = 0; k < 16; k++) {
        const a2 = yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
        const px = x - Math.sin(a2) * d, pz = z - Math.cos(a2) * d;
        if (!free(px, pz) || !w.lineOfSight(px, pz, lx, lz)) continue;
        B.teleport(px, pz);
        const hd = Math.hypot(x - px, z - pz);
        B.look(Math.atan2(-(x - px), -(z - pz)), Math.atan2(y - 1.68, hd));
        return { x: +px.toFixed(2), z: +pz.toFixed(2), d };
      }
      return null;
    };
    return true;
  })()`);
  const approach = (t, y, dists) => br(`window.__approach(${t.x}, ${t.z}, ${y}, ${t.yaw || 0}${dists ? `, ${JSON.stringify(dists)}` : ''})`);
  const target = () => br(`({ kind: B.game.interact.kind, item: B.game.interact.item && B.game.interact.item.id, feat: B.game.interact.feature && B.game.interact.feature.id, prompt: B.game.interact.promptText, hl: { ...B.game.frame.highlight } })`);
  const featY = (f, kind) => (f.data && Number.isFinite(f.data.y) ? f.data.y : TASK_Y[kind] ?? 1.1);
  // close whatever card is open with E
  const closeCard = async () => { if (await br('B.game.reading')) { await press('KeyE'); await delay(120); } };

  const plan = await br(`(() => { const o = B.objectives, sp = B.game.spawn, d = (t) => +Math.hypot(t.x - sp.x, t.z - sp.z).toFixed(1);
    return { spawn: sp, phone: { ...o.phone, d: d(o.phone) }, items: o.items.map((i) => ({ ...i, d: d(i) })), breakers: o.breakers.map((b) => ({ id: b.id, x: b.x, z: b.z, yaw: b.yaw, y: b.y, virtual: b.virtual, d: d(b) })), exit: { ...o.exit, d: d(o.exit) }, landmarks: B.world.landmarks ? B.world.landmarks().length : 0 }; })()`);
  console.log('plan:', JSON.stringify({ phone: `${plan.phone.id} ${plan.phone.d} m spawn:${plan.phone.spawn}`, breakers: plan.breakers.map((b) => b.d + (b.virtual ? 'v' : '')), exit: plan.exit.d + (plan.exit.virtual ? 'v' : ''), landmarks: plan.landmarks, pickups: plan.items.length }));

  // ---- 1. intro card holds the sim; E dismisses it ----
  await br('(B.game.showIntro(), true)');
  const i0 = await T();
  await delay(600);
  const i1 = await T();
  const intro = await last('game:intro');
  expect(intro && /M\.E\.G\./.test(intro.title) && (await br('B.game.reading')) === 'intro' && Math.abs(i1 - i0) < 1e-6, `intro "${intro?.title}" holds director time (${i0.toFixed(2)} -> ${i1.toFixed(2)})`);
  // the ui types the transmission out: the first E reveals it all, the second dismisses it
  await press('KeyE');
  await delay(300);
  const still = await br('B.game.reading');
  await press('KeyE');
  await delay(300);
  expect(still === 'intro' && !(await br('B.game.reading')) && (await T()) > i1, 'first E reveals the whole transmission, second E dismisses it; time resumes');

  // ---- 2. initial state (autostart published before this script attached; events re-checked at restart) ----
  const obj0 = await br(`({ list: B.objectives.check.list(), activeId: B.objectives.check.activeId })`);
  const comp0 = await br('({ ...B.game.frame.compass })');
  expect(obj0.list.length === 4 && obj0.activeId === 'phone' && plan.phone.spawn && plan.phone.d >= 8 && plan.phone.d <= 32, `phone step active, target is the world's spawn desk phone at ${plan.phone.d} m`);
  expect(comp0.active && comp0.id === 'phone' && Math.abs(comp0.dist - plan.phone.d) < 3, `compass -> phone ${comp0.dist.toFixed(1)} m`);

  // ---- 3. spawn phone -> M.E.G. briefing ----
  const ap = await approach(plan.phone, 0.8, [1.2, 1.6, 0.9, 2.0]);
  await delay(250);
  const tg = await target();
  expect(ap && tg.kind === 'phone' && tg.feat === plan.phone.id && tg.hl.active, `look-at picks the spawn phone from ${ap?.d} m, prompt "${tg.prompt}"`);
  await press('KeyE');
  await delay(150);
  const brief = await last('lore:open');
  expect(brief && /LANDLINE/.test(brief.title) && /WORK ORDERS/.test(brief.body), `phone opens the v3 briefing "${brief?.title}"`);
  await shot('phone-briefing');
  await closeCard();
  await delay(1200);
  const obj1 = await last('obj:update');
  const tasksItem = obj1.list.find((x) => x.id === 'tasks');
  expect(obj1.activeId === 'tasks' && obj1.list[0].done && tasksItem.sub?.length >= 1, `phone done; work orders active with nearby tasks: ${tasksItem.sub?.map((s) => s.text).join('; ')}`);
  const comp1 = await br('({ ...B.game.frame.compass, near: B.objectives.near[0] && B.objectives.near[0].dist })');
  expect(comp1.id === 'tasks' && Math.abs(comp1.dist - comp1.near) < 2, `compass -> nearest task ${comp1.dist.toFixed(1)} m`);

  // ---- 4. a breaker panel refuses before the work orders ----
  const b0 = plan.breakers[0];
  await approach(b0, b0.y);
  await delay(250);
  const tb = await target();
  const opens0 = await n('task:open');
  await press('KeyE');
  await delay(150);
  const lockToast = await br(`(window.__v2.ev.toast || []).some((t) => /work orders/.test(t.text))`);
  expect(tb.kind === 'breaker' && (await n('task:open')) === opens0 && lockToast && /locked/i.test(tb.prompt), `locked breaker: prompt "${tb.prompt}", no panel, work-order toast`);

  // ---- 5. six work orders through real keys: a card swipe (fail fast first), a wiring panel (wrong wire
  // first), then the nearest ones ----
  const done = [];
  const doTask = async (f) => {
    const kind = f.data.kind;
    const s0 = await T();
    const a = await approach(f, featY(f, kind));
    await delay(250);
    const tt = await target();
    if (!expect(a && tt.kind === 'task' && tt.feat === f.id, `targets ${kind} ${f.id} (${Math.hypot(f.x - plan.spawn.x, f.z - plan.spawn.z).toFixed(0)} m from spawn), prompt "${tt.prompt}"`)) return false;
    const results0 = await n('task:result');
    const ui = await br(`B.game.tasks.kindOf({ type: 'task', data: { kind: ${JSON.stringify(kind)} } }) && ${JSON.stringify(kind)}`);
    let extra = '';
    if (kind === 'cardSwipe') {
      await down('KeyE'); await delay(200); await up('KeyE'); await delay(120);
      const r = await last('task:result');
      extra = ` (first try "${r?.msg}")`;
      expect(r && !r.ok && r.msg === 'Too fast. Try again.', `quick release on the card reader: "${r?.msg}"`);
      await down('KeyE');
      const inWin = await waitFor(`(() => { const r = B.game.tasks.active && B.game.tasks.active.run; return r && r.t >= r.spec.window[0] + 0.06; })()`, 3000, 10);
      await up('KeyE');
      if (!inWin) console.log('swipe never reached the window');
      await shot('task-swipe');
    } else if (kind === 'wires' || kind === 'breaker') {
      await press('KeyE');
      await delay(100);
      const good = await br('B.game.tasks.active.run.expectKey()');
      await press(`Digit${good === 1 ? 2 : 1}`);
      await delay(80);
      const w = await last('task:progress');
      extra = ` (wrong wire flashed: ${!!w?.wrong})`;
      for (let i = 0; i < 4; i++) { const k = await br('B.game.tasks.active && B.game.tasks.active.run.expectKey()'); if (!k) break; await press(`Digit${k}`); await delay(60); }
    } else {
      const spec = await br(`(() => { const r = B.game.tasks.run({ id: ${JSON.stringify(f.id)}, type: 'task', data: { kind: ${JSON.stringify(kind)} } }); return { ui: r.ui, presses: r.spec.presses || 0 }; })()`);
      if (spec.ui === 'hold') {
        await down('KeyE');
        await waitFor(`B.game.tasks.isDone({ id: ${JSON.stringify(f.id)} })`, 5000);
        await up('KeyE');
      } else {
        for (let i = 0; i < spec.presses; i++) { await press('KeyE'); await delay(450); }
      }
      extra = ` (${spec.ui}${spec.presses ? ` x${spec.presses}` : ''})`;
    }
    void ui;
    const ok = await waitFor(`B.game.tasks.isDone({ id: ${JSON.stringify(f.id)} })`, 2000);
    const res = await br(`(window.__v2.ev['task:result'] || []).slice(${results0}).filter((r) => r.ok).map((r) => r.msg)`);
    const opened = await waitFor(`B.game.reading === 'lore'`, 2000);
    const card = opened ? await last('lore:open') : null;
    await closeCard();
    done.push({ kind, sim: +((await T()) - s0).toFixed(2), card: card?.title || null });
    return expect(ok && res.length === 1, `${kind} done${extra}: "${res[0]}"${card ? `, then "${card.title}"` : ''}`);
  };
  const nearest = (kind) => br(`(() => { const p = B.game.player, done = B.game.tasks.done; const l = B.world.tasksNear(p.x, p.z, 120${kind ? `, ${JSON.stringify(kind)}` : ''}).filter((f) => !done.has(f.id) && f.type === 'task'); const f = l[0]; return f ? { id: f.id, x: f.x, z: f.z, yaw: f.yaw, data: f.data } : null; })()`);
  for (const pref of ['cardSwipe', 'wires', null, null, null, null]) {
    const f = (pref && (await nearest(pref))) || (await nearest(null));
    if (!f) { expect(false, 'no task within 120 m'); break; }
    await doTask(f);
  }
  const obj2 = await last('obj:update');
  const tapes = done.filter((d) => /TAPE/.test(d.card || '')).length;
  expect(obj2.activeId === 'breakers' && obj2.list[1].done && obj2.list[1].progress === 6 && tapes === 5, `work orders 6/6 (${done.map((d) => d.kind).join(', ')}), ${tapes} tape logs; breakers active, sub ${obj2.list[2].sub?.map((s) => s.text).join('; ')}`);
  const doneFs = await br(`new Set((window.__v2.ev['feature:state'] || []).filter((f) => f.type === 'task' && f.state === 'done').map((f) => f.id)).size`);
  expect(doneFs === 6, `feature:state task done for ${doneFs} props`);

  // ---- 6. breaker panels: wiring through keys 1-4 ----
  for (let k = 0; k < plan.breakers.length; k++) {
    const b = plan.breakers[k];
    await approach(b, b.y);
    await delay(250);
    const tb2 = await target();
    const o0 = await n('task:open');
    await press('KeyE');
    await delay(100);
    const op = (await n('task:open')) > o0 ? await last('task:open') : null;
    for (let i = 0; i < 4; i++) { const key = await br('B.game.tasks.active && B.game.tasks.active.run.expectKey()'); if (!key) break; await press(`Digit${key}`); await delay(60); }
    const on = await waitFor(`B.objectives.breakers[${k}].on`, 2000);
    if (k === 0) await shot('breaker-wires');
    expect(tb2.kind === 'breaker' && op?.data?.breaker && op.data.left?.length === 4 && on, `breaker ${k + 1} (${b.d} m): prompt "${tb2.prompt}", wires panel ${JSON.stringify(op?.data?.left)}, on`);
  }
  const powered = await br(`(window.__v2.ev['feature:state'] || []).some((f) => f.type === 'exitDoor' && f.state === 'powered')`);
  const noise = await br(`B.director.log.filter((x) => x.ev === 'noise').map((x) => x.why)`);
  expect(powered, `exit powered; noise events ${noise.join(',')}`);

  // ---- 7. exit: approach opens it, walking in wins ----
  const e0 = await T();
  const ae = await approach(plan.exit, 1.1, [2.4, 2.0, 2.8, 3.4]);
  await delay(300);
  const opened = await br(`B.objectives.exit.state`);
  const ex = plan.exit;
  await evalJs(`(() => { const B = window.__br, p = B.game.player; window.__steer = setInterval(() => { B.look(Math.atan2(-(${ex.x} - p.x), -(${ex.z} - p.z)), 0); B.input.set({ fwd: 1 }); }, 50); return true; })()`);
  const won = await waitFor(`B.game.state === 'won'`, 4000);
  await evalJs(`(() => { clearInterval(window.__steer); window.__br.input.set({ fwd: 0 }); return true; })()`);
  const win = await last('game:win');
  const save = JSON.parse((await evalJs(`localStorage.getItem('br.save.v1')`)) || '{}');
  expect(ae && opened === 'open' && won && win && win.tasks === 6 && win.tapes === 5 && save.bestTime === win.best, `exit opened at ${ae?.d} m, walked in (${((await T()) - e0).toFixed(2)} s): game:win ${JSON.stringify(win)}`);
  await delay(300);
  await shot('win');

  // ---- 8. restart resets the chain ----
  const spawnN = await n('item:spawn');
  await br('(B.game.restart(), true)');
  await delay(300);
  const rs = await br(`({ state: B.game.state, active: B.objectives.check.activeId, tasks: B.objectives.check.tasks, done: B.game.tasks.done.size, breakers: B.objectives.breakers.some((b) => b.on), exit: B.objectives.exit.state, inv: B.objectives.inv.snapshot(), taken: B.objectives.items.filter((i) => i.taken).length, phone: B.objectives.phoneFeature().answered })`);
  const objR = await last('obj:update'), invR = await last('inv:update');
  expect(rs.state === 'playing' && rs.active === 'phone' && rs.tasks === 0 && rs.done === 0 && !rs.breakers && rs.exit === 'locked' && rs.inv.almond === 0 && rs.taken === 0 && rs.phone === false && (await n('item:spawn')) - spawnN === plan.items.length && objR.activeId === 'phone' && invR.almond === 0, `restart resets objectives ${JSON.stringify(rs)}, re-emits obj/inv, re-spawns pickups`);

  // ---- 9. meme prop ----
  const mp = await br(`(() => { const w = B.world, p = B.game.player, pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16); let best = null, bd = 1e9;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) for (const f of w.getChunk(pcx + dx, pcz + dz).features) if (f.type === 'meme') { const d = Math.hypot(f.x - p.x, f.z - p.z); if (d < bd) { bd = d; best = { id: f.id, x: f.x, z: f.z, yaw: f.yaw, data: f.data }; } }
    return best; })()`);
  if (!mp) expect(false, 'no meme prop within 4 chunks');
  else {
    const t0 = await n('toast');
    await approach(mp, featY(mp, null));
    await delay(250);
    const tm = await target();
    await press('KeyE');
    await delay(150);
    const toast = await last('toast');
    const memeKey = `meme:${mp.data.kind}`;
    expect(tm.kind === 'meme' && (await n('toast')) > t0 && (await br(`window.__v2.memes[${JSON.stringify(memeKey)}] || 0`)) > 0, `meme prop ${mp.data.kind}: "${toast?.text}", sound ${memeKey}`);
    await shot('meme-prop');
  }

  // ---- 10. airhorn: pick one up, blast an echo in sight ----
  const horn = plan.items.find((i) => i.type === 'airhorn');
  await approach(horn, 0.12);
  await delay(250);
  await press('KeyE');
  await delay(150);
  expect((await last('inv:update')).airhorn === 3, 'airhorn picked up (3 charges)');
  await br(`(B.forceEncounter('trump'), true)`);
  const inSight = await waitFor(`B.game.enemy.active && B.director.los && B.director.straight < 10`, 15000, 20);
  const pre = await br(`({ d: B.director.straight, state: B.director.state })`);
  await press('KeyG');
  await delay(60);
  const st0 = await br(`({ mode: B.game.enemy.mode, t: B.director.t, d: B.director.straight })`);
  const unstun = await waitFor(`B.game.enemy.mode !== 'stun'`, 5000, 20);
  const st1 = await br(`({ mode: B.game.enemy.mode, t: B.director.t, d: B.director.straight })`);
  const blast = await last('game:airhorn');
  expect(inSight && st0.mode === 'stun' && unstun && blast?.hit, `G at ${pre.d.toFixed(1)} m (${pre.state}): stunned ${(st1.t - st0.t).toFixed(2)} s, resumed "${st1.mode}", ${blast?.charges} charges left`);
  await br(`(B.director._escape('test'), true)`);
  await waitFor(`!B.game.enemy.active`, 4000);

  // ---- 11. almond water: pick up, drink with key 1 ----
  const alm = plan.items.filter((i) => i.type === 'almond').sort((a, b) => a.d - b.d)[0];
  await approach(alm, 0.12);
  await delay(250);
  await press('KeyE');
  await delay(150);
  await br(`(B.game.player.hp = 10, true)`);
  await press('Digit1');
  await delay(250);
  const vm = await br('({ item: B.game.frame.viewmodel.item })');
  await waitFor(`!B.game.useKind`, 3000);
  const h1 = await br('B.game.player.hp');
  expect(vm.item === 'almond' && h1 === 12 && (await last('inv:update')).almond === 0, `key 1 drinks: hp 10 -> ${h1}`);

  // ---- 12. fun features nearby, best effort ----
  const fun = await br(`(() => { const w = B.world, p = B.game.player, out = {};
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    for (let r = 0; r <= 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const f of w.getChunk(pcx + dx, pcz + dz).features) if (['poster', 'tv', 'vending', 'radio'].includes(f.type) && !out[f.type]) out[f.type] = { id: f.id, x: f.x, z: f.z, yaw: f.yaw, y: f.data && Number.isFinite(f.data.y) ? f.data.y : null };
    }
    return out; })()`);
  const Y = { poster: 1.55, tv: 1.2, vending: 1.1, radio: 0.9 };
  for (const type of ['poster', 'tv', 'vending', 'radio']) {
    const f = fun[type];
    if (!f) { console.log(`no ${type} within 6 chunks; skipped`); continue; }
    const toasts = await n('toast');
    await approach(f, f.y ?? Y[type]);
    await delay(250);
    const tf = await target();
    await press('KeyE');
    await delay(150);
    const toast = await last('toast');
    expect(tf.kind === type && (await n('toast')) > toasts, `${type}: prompt "${tf.prompt}", toast "${toast?.text}"`);
  }

  // ---- 13. memes and beacons ----
  const memes = await br('window.__v2.memes');
  const beacons = await br('({ ids: Object.keys(window.__v2.beacons), stops: window.__v2.beaconStops })');
  console.log('memes:', JSON.stringify(memes));
  console.log('beacons:', JSON.stringify(beacons));
  const want = ['phone', 'taskStart', 'taskFail', 'task:cardSwipe', 'breaker', 'win', 'airhorn', 'drink', 'escape'];
  expect(want.every((c) => memes[c] > 0), `meme categories fired: ${want.map((c) => `${c} ${memes[c] || 0}`).join(', ')}`);
  expect(beacons.ids.length > 0 && beacons.stops > 0, `objective beacons started (${beacons.ids.length} ids) and stopped (${beacons.stops})`);

  // ---- 14. REGRESSION, director ON: no encounter before the call; kanye crashes it 3-5 s after ----
  await br('(B.game.restart(), B.game.params.noDirector = false, true)');
  await delay(7000);
  const early = await br(`({ t: B.director.t, enc: B.director.encounters, state: B.director.state, next: B.director.nextT })`);
  expect(early.enc === 0 && early.state === 'EXPLORING', `director on, phone not answered after ${early.t.toFixed(1)} s: no encounter yet (next in ${early.next.toFixed(1)} s)`);
  await approach(plan.phone, 0.8, [1.2, 1.6, 0.9, 2.0]);
  await delay(250);
  await press('KeyE');
  await delay(150);
  const answered = await br(`({ phone: B.objectives.check.phone, reading: B.game.reading })`);
  await delay(500);
  await closeCard();
  const warned = await waitFor(`B.director.state === 'WARNING'`, 8000, 25);
  // the director logs 'call' at the exact sim time the briefing closed
  const tClose = await br(`(B.director.log.find((x) => x.ev === 'call') || { t: -99 }).t`);
  const w1 = await br(`({ t: B.director.t, char: B.director.charId })`);
  expect(answered.phone && answered.reading === 'lore' && warned && w1.t - tClose >= 2.9 && w1.t - tClose <= 5.2, `director on: answered (${JSON.stringify(answered)}), first warning (${w1.char}; rotation persists across restarts, so kanye only on a fresh session) ${(w1.t - tClose).toFixed(2)} s after the briefing closed`);
  await waitFor(`B.director.revealed`, 4000);
  await shot('kanye-crashes-call');
  // and the original bug: answering while kanye is already out must still count
  await br('(B.game.restart(), true)');
  await br(`(B.forceEncounter('kanye'), true)`);
  await waitFor(`B.game.enemy.active`, 5000);
  await approach(plan.phone, 0.8, [1.2, 1.6, 0.9, 2.0]);
  await delay(250);
  const tp = await target();
  await press('KeyE');
  await delay(150);
  const mid = await br(`({ phone: B.objectives.check.phone, active: B.objectives.check.activeId, enemy: B.game.enemy.active, queued: B.objectives.loreQueue.length, reading: B.game.reading })`);
  const midObj = await last('obj:update');
  expect(tp.kind === 'phone' && mid.phone && mid.active === 'tasks' && midObj.list[0].done && mid.enemy && mid.queued === 1 && !mid.reading, `answering with kanye out completes the phone step ${JSON.stringify(mid)}`);
  await br('(B.game.params.noDirector = true, B.game.restart(), true)');

  console.log('timings:', JSON.stringify({ tasks: done, wallSec: ((Date.now() - t00) / 1000).toFixed(1) }));
  console.log(failed ? `${failed} failed` : 'all ok');
  return failed === 0;
}
