# Backrooms (horror-fun-game) architecture contract

Frozen interfaces shared by all agents. Change an interface only through the lead. Plain JavaScript (ES modules, JSDoc where useful), Vite 8.3.1, three 0.186.1 pinned exactly, WebGL2 `WebGLRenderer` only (no WebGPU). Dev server: `npm run dev` on 127.0.0.1:5230. Build: `npm run build` (static, `base: './'`).

Read first: `docs/BRIEF.md` (verbatim brief), `docs/REFERENCE.md` (reel analysis, timings, scale), `reference/*.png` (reel frames).

## Units and coordinates
- Metres, y up. Sim positions are JS doubles in world space (no rebasing in sim).
- Grid: `CELL = 0.5` m. Cell `(ix, iz)` covers `x in [ix*CELL, ix*CELL+CELL)`. Chunk = `CHUNK_CELLS = 32` cells = `CHUNK = 16` m. `cx = Math.floor(ix / 32)`, local `lx = ix - cx*32`, index `lz*32 + lx`.
- Chunk key: `chunkKey(cx, cz)` from `src/world/constants.js` (numeric, valid for |c| < 32768, i.e. ±524 km).
- Heights: floor y = 0, ceiling `CEIL_H = 2.8`, eye `EYE_H = 1.68`.
- Render precision: the renderer alone keeps a render origin (multiple of CHUNK) and draws everything at `world - origin`, rebasing when the camera passes 256 m from origin. Nobody else knows about it.
- Yaw: 0 looks toward -z, positive yaw turns left (three.js Y rotation). Forward vector = `(-sin yaw, 0, -cos yaw)`.
- Camera FOV: vertical degrees (three.js convention), default 74 (= 90 deg horizontal at 4:3, Source/GMod style).

## Shared modules (lead owns)
- `src/config.js`: shared world constants re-exported from `src/world/constants.js` plus `QUALITY` presets table.
- `src/settings.js`: `settings` singleton. `settings.get(key)`, `settings.set(key, value)`, `settings.on(fn)` (fn(key, value)). Persisted to localStorage `br.settings.v1`. Keys: `quality` ('auto'|'low'|'medium'|'high'), `sensitivity` (1), `invertY` (false), `sprintMode` ('hold'|'toggle'), `fov` (74), `headBob` (0.6), `shake` (0.6), `grain` (0.35), `vhs` (0), `flicker` (1), `volMaster` (0.8), `volAmbience` (0.7), `volEnemy` (0.85), `volInteraction` (0.8), `volSudden` (0.8), `muted` (false).
- `src/core/rng.js`: `hash32(...ints)`, `hashFloat(...ints)` in [0,1), `makeRng(seed)` returning `{ next(), range(a,b), int(a,b), pick(arr), chance(p) }` (mulberry32). World randomness uses hashes of `(worldSeed, cx, cz, salt)`; encounter randomness uses its own `makeRng(encounterSeed)`. Never use `Math.random` for world or encounter decisions.
- `src/core/events.js`: `events.on(name, fn)`, `events.off(name, fn)`, `events.emit(name, payload)`.
- `src/core/debug.js`: `registerDebug(name, obj)` attaches to `window.__br[name]`. `window.__br.ready = true` once the first frame after boot renders.
- `src/main.js`: boot, loop, wiring. Query params: `seed`, `eseed`, `autostart=1`, `quality`, `nodirector=1`, `debug=1`, `spawn=x,z,yaw`.

## Frame order (main.js)
```
dt = min(realDt, 0.1)
game.update(dt)                      // input, fixed 1/120 sim, director, enemy, audio calls; fills game.frame
world.update(game.player.x, game.player.z)
renderer.render(dt, game.frame)
ui.update(dt)
```
`game.frame` is one preallocated object (no per-frame allocation):
```
frame = {
  cam: { x, y, z, yaw, pitch, roll, fov },             // interpolated, world space
  viewmodel: { bobX, bobY, swayX, swayY, sprint, swing, visible },
  flashlight: false,
  enemy: { active, charId, x, y, z, alpha, facingYaw }, // y = bottom of sprite (floor = 0)
  fx: { impact: 0, shake: 0, chase: 0, death: 0, protect: 0, lookBehind: 0 },
  paused: false,
}
```

## World (world agent owns `src/world/*`)
`new World(seed)`; data only, no three.js imports.
- `world.update(px, pz)`: streams chunk data. Maintains `world.active` (Set of keys within `ACTIVE_RADIUS` chunks, Chebyshev) and a bounded LRU data cache. Pinned chunks (`world.pin(key, owner)`, `world.unpin(key, owner)`) are never evicted. Emits `world:chunkActive` (chunk) and `world:chunkInactive` (chunk) through `events`.
- `world.getChunk(cx, cz)`: ChunkData (generated deterministically on demand; same seed => identical data forever).
- `world.cell(ix, iz)`: cell type. `world.blocksMove(ix, iz)`: WALL | COLUMN | prop footprint | door not open enough. `world.blocksSight(ix, iz)`: WALL | COLUMN | closed door (props never block sight).
- `world.lineOfSight(x0, z0, x1, z1)`: boolean, grid DDA over blocksSight, zero allocation.
- `world.spawnPoint()`: `{ x, z, yaw }` in a readable corridor near origin looking down its length.
- `world.doorAt(ix, iz)` -> door or null. `world.setDoorTarget(door, open01)`; `world.tickDoors(dt)` animates `door.openT` toward `door.target` (called by game). Emits `world:door`.
- `world.setFixture(fixture, on)` emits `world:fixture` with the fixture (renderer relights affected chunks).
- `world.stats()` -> `{ cached, active, pinned, generatedTotal, genMsAvg }`.

ChunkData:
```
{ cx, cz, key,
  cells: Uint8Array(1024)   // CELL_TYPE: EMPTY 0, WALL 1, COLUMN 2, DOOR 3
  prop:  Uint8Array(1024)   // 1 = prop footprint blocks movement (never sight)
  zone:  Uint8Array(1024)   // ZONE: OFFICE 0 (yellow), MAINT 1 (grey storage), WET 2 (damp yellow), DARK 3 (lights mostly off)
  fixtures: [{ id, x, z, sx, sz, intensity, on, flicker }]   // ceiling panels, world metres, centre + size
  doors:    [{ id, ix, iz, axis: 'x'|'z', hinge: -1|1, openT, target }]  // 2-cell door spans list both cells via doorAt
  features: [{ id, type, x, z, yaw, w, d, data }]  // type: chair, chairStack, desk, cooler, phone, sign, vent, shelf, boxes, pipes, puddle, stain, recovery, darkTile, exitSign ...
  openings: { n: [[a,b]...], s, e, w }             // local cell spans open on each edge (for validation/tests)
}
```
Guarantees (tests enforce): every chunk edge has at least one opening shared exactly with the neighbour; all EMPTY cells of a chunk are connected to every opening (after props); each chunk has at least two distinct routes out (no dead-end-only chunks); props never reduce connectivity or corridor clear width below 1.0 m; doors never lock.

## Render (render agent owns `src/render/*`)
`new GameRenderer(canvas, world)`; `await renderer.init()` (creates GL, compiles shared programs, builds the spawn chunks before resolving); `renderer.render(dt, frame)`; `renderer.resize()`; `renderer.setQuality('low'|'medium'|'high')`; `renderer.stats()` -> `{ fps, frameMs, p99Ms, calls, tris, geometries, textures, programs, chunksMeshed, pendingBuilds }`; `renderer.loadEnemyTextures(manifest)` (async, called by main). Listens to world events for chunk mesh build/dispose (time-sliced, nearest first) and door/fixture updates. Owns lighting (baked per chunk + limited dynamic), materials, post, viewmodel hatchet, flashlight, enemy sprite drawing (world-space, depth tested, cylindrical billboard, alpha-tested cutout), capability fallback.

## Game (gameplay agent owns `src/game/*`)
`new Game({ world, renderer, audio, settings, events, params })`. `game.start()`, `game.pause()`, `game.resume()`, `game.restart()`, `game.update(dt)`, `game.frame`, `game.player` ({ x, z, vx, vz, yaw, pitch, ... }), `game.state` ('menu'|'playing'|'paused'|'dead'), `game.director.state` ('EXPLORING'|'WARNING'|'CHASING'|'SEARCHING'|'ESCAPED'|'RECOVERY'). Owns input (pointer lock, keys, virtual input for tests), player movement/collision, navigation (distance fields), enemies, director + character selection, interactions (doors, switches, phone, recovery alcoves), save (localStorage `br.save.v1`), hidden debug overlay (F3). Emits: `game:state` ({ state }), `game:prompt` ({ text } or null), `game:death` ({ distance, escapes, best, line }), `game:hit`, `director:state` ({ state, charId }). Debug: `__br.game`, `__br.input.set({ fwd, strafe, sprint })`, `__br.teleport(x, z, yaw)`, `__br.forceEncounter(charId)`.

## Audio (audio agent owns `src/audio/*`, `scripts/*`, `public/assets/*`)
`new AudioSystem(settings, world)`. `audio.unlock()` must be called synchronously inside the Start click. `await audio.preload(manifest, ['kanye'])` decodes clips; other characters load in the background after start. `audio.setListener(x, y, z, yaw)`. Enemy track: `audio.enemyStart(charId, x, y, z)` (entrance once, then loop; replaces any current track), `audio.enemyUpdate(x, y, z, muffle01, dt)`, `audio.enemyStop(fadeSec)`. One-shots: `audio.sfx(name, { x, z, gain })` for `step`, `stepRun`, `doorOpen`, `doorClose`, `impact`, `sting`, `death`, `recover`, `switch`, `flickerBuzz`, `distantDoor`, `ventKnock`, `phoneRing`. `audio.setChase(0..1)` ducks ambience slightly. `audio.pauseAll()`, `audio.resumeAll()`, `audio.stopAll()`. Ambience bed + nearby feature emitters (cooler hum, phone ring, vent knocks) are handled inside `audio.update(dt)` by reading `world.active` chunks' features. Processed files and `public/assets/manifest.json` come from `scripts/process-assets.mjs` (ffmpeg, offline).

Manifest shape:
```
{ "characters": { "kanye": { "image": "img/kanye.webp", "imageSource": "cover2-1.webp", "aspect": 0.8, "heightM": 2.35,
    "audio": "audio/kanye.mp3", "audioSource": "...mp3", "sourceStart": 68.70, "sourceEnd": ..., "loopStart": ..., "loopEnd": ...,
    "entranceDelay": 0.25, "gainDb": ..., "lufs": ..., "processing": "..." }, "epstein": {...}, "trump": {...} } }
```

## UI (audio agent owns `src/ui/*`, `index.html` markup/CSS)
`new UI({ game, audio, renderer, settings, events })`; `ui.update(dt)`. Screens: start (title + Start + Settings, no landing page), settings, pause (Resume, Settings, Restart), death (short funny line, distance/escapes/best, instant restart on click/R/Space), loading bar during boot, HUD (tiny dot crosshair like the reel, interaction prompt). Settings apply live via `settings`.

## Testing
`node test/harness.mjs <script> [--tag=x] [--size=1280x720] [--query=k:v]` runs `test/scripts/<script>.mjs` in headless Chrome (muted, shared lock `/tmp/luma-browser.lock`, rAF pumped by timer, pointer lock stubbed). Scripts get `{ evalJs, shot, delay, br(expr) }`. Node-only tests: `node test/unit/*.mjs` (world connectivity, director probabilities). Never play audio audibly; verify audio with analysers or OfflineAudioContext.

## World conventions (added after world landed)
- `chunk.kind`: 'corridor' | 'hall' | 'columns' | 'storage'. Zones are per chunk (hard switch at seams; renderer may blend).
- Doors: `door.swing` ±1 = side the leaf opens toward (perpendicular to the door axis). ~40% start open (openT = target = 1). Blocks move when openT < 0.6, sight when openT < 0.3. Swing space kept clear 2 cells both sides. `world:door` fires only while moving.
- Features: `w` along local +x = (cos yaw, -sin yaw); `d` along forward (-sin yaw, -cos yaw). Wall-mounted features have x,z on the wall face with yaw facing away from the wall; wall-placed props are centred flush. Types add `pile`. Data: sign {text,y}; vent {mount:'wall',y}; exitSign {mount:'ceiling',doorId} | {mount:'wall',y}; phone {ringing:true,deskId}; pipes {y:2.55,count}, w = run length; chairStack/boxes {count}; pile {seed}; shelf {levels}; stain/puddle {v}; darkTile {hole:true} 0.6x1.2 when replacing a panel, else null 0.6x0.6; recovery {x0,z0,x1,z1,doorId} world metres.
- Fixtures: lattice every 3.0 m, long axis across corridors, edges on the 0.6 m world grid, sx/sz in {0.6,1.2}.
- `world:chunkActive` is emitted nearest-first.

# v2: lore, objectives, memes (lead, 2026-09-27)
User request: "more interesting and cool, lore and a todo list to actually beat this, tasks, fewer random small pillars and more open spaces/corridors, more stuff while still infinite scary backrooms, more tasks and more reach, more memes (Gen Z meme sounds, meme posters on walls), fun and intuitive." Existing contract above still holds; this section adds to it.

## Lore (gameplay owns text in `src/game/lore.js`)
You noclipped into Level 0. M.E.G. (Major Explorer Group) radios in. The villains are "memetic echoes": the Backrooms prints the internet's most-memed faces as flat cutouts that hunt by sound. Tone: deadpan Backrooms wiki meets shitpost. Keep it PG-13, no real-world accusations beyond the existing jokes, nothing graphic.

## Objectives ("todo list", gameplay owns `src/game/Objectives.js`)
1. Answer the ringing phone near spawn (M.E.G. briefing, lore card). 2. Recover 5 VHS tapes (placed 40-220 m from spawn in different directions via `world.findSpot`). 3. Restore power at 3 breaker boxes (in reserved MAINT landmark chunks, hold E ~3 s, noisy: can trigger an encounter). 4. Reach the EXIT (reserved exit room ~250-350 m out; opens when powered) => win. Side: vending machines (almond water: carry max 3, key 1 drinks, +1 heart), airhorn (found, 3 charges, key G: villains within ~12 m in sight are stunned ~2.5 s and knocked back), posters (E: meme caption toast + sound), TVs (E: next channel), phones, radios, recovery alcoves (existing). Interaction reach ~2.6 m with a look-at cone and highlight. HUD compass points to the active objective's nearest target.

## Events (game -> ui/render/audio)
- `obj:update` { list: [{ id, text, done, progress, total, active }], activeId } — full checklist each change.
- `toast` { text, kind: 'meme' | 'lore' | 'info', ms }
- `lore:open` { title, body } / `lore:close` — UI reader overlay; game counts reading as a protected interaction (timers paused). UI closes on E/Esc/click and calls `game.closeLore()`.
- `inv:update` { almond, almondMax, airhorn, airhornMax }
- `game:win` { time, distance, escapes, tapes, best } — UI win screen, restart via `game.restart()`.
- `game:intro` — first Start of a session; UI shows the M.E.G. transmission card, dismiss continues play (`game.closeLore()`).
- `item:spawn` { id, type: 'tape' | 'almond' | 'airhorn' | 'note', x, y, z, yaw } / `item:remove` { id } — renderer pools pickups.
- `feature:state` { id, type, state } — breaker 'off'|'on', tv channel index, exitDoor 'locked'|'powered'|'open', radio 'on'|'off'.
- frame additions: `frame.highlight = { active, x, y, z, r }` (interaction target), `frame.compass = { active, bearing /*world yaw to target*/, dist }`, `frame.viewmodel.item = null | 'airhorn' | 'almond'`, `frame.viewmodel.useT` (0..1 animation).

## World additions (world agent)
- Layout: far fewer small pillars and random wall blocks; more long corridors, wide corridors, big open halls with a few large (1-1.5 m) columns, reconnecting loops; still infinite, still mostly yellow Level 0. New landmark room kinds mixed in rarely: break room (vending, tables, tv), cubicle-ish office pockets, big atrium.
- New feature types: `poster` (wall-mounted, data { y, h, v }), `vending` (floor against wall, prop footprint), `tv` (data { v }), `radio`, `breaker` (wall-mounted, data { id }), `exitDoor` (wall-mounted big door, data {}), `table`.
- `world.findSpot(cx, cz, { kind })` -> { x, z, yaw } | null: deterministic floor spot beside a wall, reachable, clear of door swing, for items. `world.reserveLandmark(cx, cz, type)` type 'breaker' | 'exit': call before the chunk is generated (regenerates it if cached but not active; returns false if active). Reserved chunks always contain that landmark and stay connected. `world.landmarks()` lists reservations.

## Render additions (render agent)
Posters (atlas from `manifest.posters`), vending machine, tv (screen from `manifest.tv` atlas, channel from `feature:state`), radio, breaker box (lever + lamp by state), exit door/elevator with lit EXIT sign and state light, table, pickups (tape, almond water bottle, airhorn, note) from `item:spawn`/`item:remove` with gentle bob/glow, `frame.highlight` outline/brighten, viewmodel item (airhorn blast pose, drinking), keep perf budget.

## Audio/UI/assets additions (assets agent)
- Meme sounds downloaded into `public/assets/sfx/` via `scripts/fetch-memes.mjs` (record source URLs), processed loud like the enemy tracks, in `manifest.sfx` { id: { file, duration, gainDb, source, sourceUrl } } and `manifest.memeCategories` { category: [ids] }.
- `audio.meme(nameOrCategory, { x, z, gain })` plays one clip (random from a category, avoiding immediate repeats); positional when x/z given. Categories used by gameplay: reveal, hit, death, collect, win, ambientFar, poster, tv, phone, airhorn, drink, vending, breaker, escape, radio.
- `audio.beacon(id, x, z)` / `audio.beaconStop(id)`: quiet positional loop for objective items (pooled, max 4).
- Posters/TV images in `public/assets/img/posters.webp` / `tv.webp` atlases + `manifest.posters` { cols, rows, cells: [{ caption, source }] }, `manifest.tv` likewise.
- UI: objective checklist (top-left), compass (top-centre), inventory (almond/airhorn pixel icons, bottom-left, Minecraft hotbar feel to match the hearts), toasts, lore reader, intro transmission card, win screen, updated key hints (1 drink, G airhorn).

## World v2 conventions (landed)
- `chunk.kind` adds 'atrium' (2x2-chunk open halls, 1.5 m columns on an 8 m grid). `chunk.landmark`: null | 'breaker' | 'exit'. Breaker chunks are fully MAINT, kind 'storage', door into the room, breaker on the opposite wall. Exit chunks are kind 'hall'; exit room lights always on, no flicker.
- Feature sizes: `poster.data.v` 0..255 (take modulo atlas cells). `tv` floor-standing CRT on a stand against a wall, 0.8 x 0.5 m, prop footprint. `radio` has `data.y` surface height (0.75 on desk/table), no footprint. `table` 1.2 x 0.75 m. `breaker` wall-mounted 0.45 m wide, `data.id = 'breaker:cx,cz'` (gameplay uses feature id). `exitDoor` 1.6 m wide on the wall face, floor in front kept clear.
- `world.landmarks()` -> [{ type, cx, cz, key, id, x, z, yaw }]. `findSpot` depends on reservations: reserve first. `reserveLandmark` drops a pinned-but-inactive cached chunk (stale object risk; no events).
- Gameplay v2 extras (approved): `game.state` may be 'won'. `feature:state` also covers vending/cooler (state = bottles left). `game:airhorn` { hit, charges }. `frame.highlight` adds `kind`, `progress` (breaker hold 0..1). `frame.compass` adds `id`. `game:intro` carries { title, body }. `game:win` = { time, distance, escapes, tapes, best, newBest, title, line }. Keys: E use/hold, 1 drink, G airhorn; E/Enter/Space close lore cards.
- Spawn phone: every seed has a desk + ringing phone on the spawn corridor wall in chunk (1,0), 10-30 m ahead of spawn, visible; phone data { ringing: true, deskId, spawn: true }.

# v3: task rooms, hallway tasks, meme props, well-lit (lead, 2026-09-27)
User feedback: "remove the outline around [menu buttons]; I answered the phone but it still said not done; the other tasks feel like not part of the game, have more rooms where we can actually do tasks, even in the hallway; remove the dark backrooms and the white glow in the end, keep it lightened; more meme references, memes with actual stuff (like the vending machine), more across it; well lit backrooms, really fun."

## Lighting
No DARK zone anymore and almost no switched-off fixtures; flicker stays rare. No flat haze at corridor ends: long corridors stay visible like the reel (subtle depth fog only). The exit's open light must not blow out white.

## Tasks (feature type `task`, data { kind, ... }; world places, gameplay drives, render draws, ui shows mini-games)
Kinds (Among Us / meme office chores): `cardSwipe` (wall card reader: hold E and release inside a timing window, "Too fast. Try again."), `wires` (wall panel: press 1-4 to match 4 coloured wires in order), `touchGrass` (planter: hold E), `fixLight` (ladder under a flickering fixture: hold E, the fixture stops flickering), `mop` (puddle + bucket: hold E, puddle goes away), `straighten` (crooked poster: E, it straightens), `router` (server rack: E off, E on: "have you tried turning it off and on again"), `copier` (hold E, prints a meme page), `microwave` (hold E ~3 s, "mmmm BEEP"), `vendingStuck` (vending with a stuck item: E x3 to hit it), `timesheet` (desk: E sign), `skibidi` (restroom toilet: E flush).
Task rooms (world): copy room, server closet, restroom, break room (microwave + fridge + vending), admin office (card reader), atrium planter. Hallway tasks: ladders under flickering fixtures, puddle + mop bucket, crooked posters, card readers by doors, wiring panels.
Objective chain v3: phone -> M.E.G. work orders (complete 6 tasks across rooms/hallways; the first 5 each reward a VHS tape lore log) -> power (the 3 breakers are `wires` tasks) -> EXIT. Optional side tasks everywhere reward almond water, airhorn charges, meme toasts.
Events: `task:open` { id, kind, title, hint, data } (ui shows the mini-game panel for cardSwipe/wires/hold kinds), `task:progress` { id, kind, t, window?, step?, total? }, `task:result` { id, kind, ok, msg }, `task:close` { id }. Gameplay owns all input (pointer lock); ui only renders. `feature:state` { id, type:'task', state:'done'|... } lets the renderer change the prop (light fixed, puddle gone, poster straight, router lights, toilet flush).

## Meme props (feature type `meme`, data { kind })
Physical meme references placed across the world (not just posters): e.g. hydration-drink vending (Prime parody), purple Grimace-style shake on tables, crewmate plush, Minecraft grass/dirt block, "ONLY IN OHIO" road sign, chill-guy / Shrek / Big-Chungus cardboard standees, doge statue, "SUS" and trollface graffiti near vents, Stanley-style cup, nerd-emoji sign, "FANUM TAX" note on the break-room fridge, skibidi toilet in restrooms. E on a meme prop: caption toast + meme sound. Keep it PG-13, no real people other than the three existing villains.
- v3 naming (agreed): meme prop `data.kind` in { prime, grimace, crewmate, grassBlock, ohio, chillGuy, shrek, chungus, doge, sus, trollface, stanley, nerd, fanumTax, skibidi }; sounds via `audio.meme('meme:' + kind, { x, z })` (unknown kinds fall back to 'poster'). Task sounds: categories taskStart, taskOk, taskFail, plus `task:<kind>` for microwave, skibidi, router, copier, cardSwipe, mop, touchGrass, vendingStuck. `task:open` data: wires { left: [colors], right: [colors] }, cardSwipe { window: [a,b] } (0..1), optional `data.ui` 'swipe'|'wires'|'hold'|'press'. `task:progress`: t 0..1 (hold fill or card position), window [a,b], step/total, wrong: true flashes a wrong wire. `task:result.msg` shown in the panel. `obj:update` items may carry `sub: [{ text, done }]` (nearby task names under the active item).
- World v3 (landed): no DARK zone generated; off fixtures 0.2%, flicker 2.6%. Task data links: mop { puddleId } (hide the puddle when done), wires { y: 1.35 }, cardSwipe { y: 1.15, doorId? }, fixLight { fixtureId } (that fixture is flicker), straighten { y, posterId } (poster.data.crooked = tilt rad), timesheet { y: 0.75, deskId }, microwave { y: 0.9, counterId }; router/copier/skibidi/touchGrass/vendingStuck are floor props with footprints. Breakers stay type 'breaker' with data.task = 'wires'. Meme placements: wall signs/graffiti carry { y }; grimace/stanley sit on table/desk tops { y: 0.75 }; fanumTax on a fridge { y: 1.3, fridgeId }. New furniture: counter (1.8 x 0.6, top 0.9), fridge (0.8 x 0.75), sink (0.6 x 0.45). Helpers: `world.tasksNear(x, z, r, kind?)` (nearest first; generates covered chunks, call at run start, r=120 ~50 ms), `world.findTask(cx, cz, kind?)`.
- Gameplay v3 extras (approved): task `feature:state` also 'idle' (sent on restart for tasks that were done) and router 'off' (between presses); finished task/breaker/exit states are re-sent on `world:chunkActive`; `game:win` adds `tasks`; `task:open.data` adds `total`, `time`, `breaker`. fixLight/mop only emit `feature:state done`: the renderer stops the flicker / hides the linked puddle itself.
- World density pass (landed): tasks ~0.59/chunk (hallway 0.29, mop 0.03), memes 0.28 (max 2/chunk), posters 0.65. Spawn corridor always has a wires task panel 16-30 m ahead with data.spawn = true (first work order).
- Doors v3 (landed): villains never open doors; a door with openT < 0.6 is a wall for enemy movement and enemy nav fields (open doors ~0.5 m extra cost; closed doors 20 m in the enemy field so they route to another open entrance, else stop at the doorstep and camp). Door movement rebuilds enemy nav within 0.15 s. Spawns search a doors-passable field; if the player is sealed (nothing within 24 m reachable without a closed door), spawns inside the sealed area are rejected and the fair-escape check is skipped. Camping ends at the normal chase budget with escape reason 'camped' (35 s hard cap if the player stands still). Live tuning objects on `__br.tuning`.

# v4: Sigma Boy jukebox + PARTY MODE (lead, 2026-09-28)
User: "add something which if I interact it plays the sigma sigma boy, near our starting position, it should be fun, and have a party mode, and in that party mode the villain goes away, with colors and stuff happening, super cool".
- World: feature `jukebox` (type 'jukebox', floor prop against a wall, ~1.0 x 0.6 m, footprint) guaranteed in view within ~8-15 m of spawnPoint(), not blocking the hero corridor, not overlapping the spawn phone / spawn wires task. `data.spawn = true`.
- Audio assets: Sigma Boy (Betsy & Maria Yankovskaya, 2024) chorus clip "sigma sigma boy, sigma boy" ~35-45 s, loud and bass-boosted (party-grade, not bit-crushed), in `public/assets/audio/sigma.mp3`; `manifest.party = { audio, source, sourceUrl, duration, bpm, firstBeat, loopStart, loopEnd, gainDb }`.
- Gameplay: E on the jukebox -> PARTY MODE for the clip length (E again ends it early). On start: the active villain gets blasted away (spin + slide out of sight, then despawn, no damage), director fully paused (no warnings/spawns), encounter timers frozen, player gets protection; on end: short grace (~5 s) then normal play. Cooldown ~45 s after it ends ("The jukebox is recharging its aura"). Events: `party:start` { duration, bpm, firstBeat, x, z }, `party:end`. Frame: `frame.party = { active, t /*s since start*/, beat /*float beats*/, bpm, intensity /*0..1 fade in/out*/, x, z }`. Meme toast + `audio.meme` stingers allowed.
- Audio runtime: `audio.partyStart()` / `audio.partyStop(fade)` play the clip (2D, loud, on the enemy-music level), stop any enemy track, duck ambience, and `audio.partyBeat()` returns the current beat from the AudioContext clock so visuals stay in sync.
- Render: jukebox prop (glowing neon-trim retro jukebox or boombox with a small disco ball hanging above it), and party visuals while `frame.party.active`: spinning coloured disco spots sweeping walls/floor/ceiling (cheap, e.g. projected pattern in the world shader, not many real lights), fixtures cycling hue on the beat, beat-pulsed bloom, confetti particles (pooled), subtle rainbow grade, a couple of lasers. Must stay performant, no mid-game shader compiles, and fully revert when it ends.
- UI: big rainbow pixel "PARTY MODE" / "SIGMA SIGMA BOY" banner that bounces to `frame.party.beat`, a song-time bar, hearts/hotbar hop on the beat, prompt "E  Play Sigma Boy" / "E  Stop the party" / cooldown text.
- Jukebox (landed): exactly one per seed, type 'jukebox' { spawn: true }, 1.0 x 0.6 m flush on a spawn-lane side wall, 8.4-14.3 m ahead of spawn, visible; chunk (0,0) usually, (1,0) ~2.5%. gen.js spawnCellX mirrors World.spawnPoint(): update both together.
- Party gameplay (landed): src/game/Party.js; states idle/active/grace (5 s)/cooldown (45 s); party:end { early, t }; blasted villain logged with result 'party'; summons 8/9/0 refused during party + grace; frame.enemy.facingYaw includes blast spin; __br.party debug hook; PARTY in tuning.js.
