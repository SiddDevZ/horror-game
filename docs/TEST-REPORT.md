# Test report (2026-09-27)

**v3 (task rooms, hallway tasks, meme props, no haze, sparser world), lead integration run:**
- **Unit tests:** `node test/unit/run.mjs` passes 4/4 files.
- **`game-v2`:** 43 ok, 0 failed. It covers:
  - the full v3 chain: phone, 6 work orders, 3 wiring breakers, exit, win;
  - a director-on phone regression, where Kanye crashes the call.
- **`game-flow`:** 13/13.
- **Villain keys (`lead-summon`):** 0 gives Jeffrey, 8 swaps to Kanye, 8 again is ignored, 9 gives Donald.
- **Intro card:** gone; Start goes straight into play (`lead-nointro`). The card is still available with `?intro=1`.
- **150 s soak:**
  - frame p99 at most 7.6 ms;
  - draw calls up to 66, since the render radius is now 4 chunks;
  - programs 12 and textures 18, both flat;
  - heap flat at 113-123 MB.
- **World now:**
  - no dark or wet zones, and no puddles or mops;
  - tasks 0.55 per chunk, memes 0.30, posters 0.68;
  - no far haze: distant corridors stay yellow.
- **Still unverified:**
  - nothing was listened to;
  - no real-GPU or real-mouse play;
  - the Among Us "task complete" sound had no archive copy, so a substitute is used;
  - the image model refused the Shrek standee, so the prop is a "GET OUT OF MY SWAMP" sign instead.


**v2 (lore, objectives, memes, pixel UI, open layout), lead integration run:**
- **`node test/unit/run.mjs`:** 3/3 files (world, director, objectives).
- **`game-v2` with the director off:** 39 ok, 0 failed. It covers the whole chain: intro, phone, 5 tapes (71-198 m), breaker holds (3.0-3.6 s, with progress kept on release), exit, win, and a clean restart. It also covers airhorn stuns (2.42 s), almond healing, and posters, TVs, vending and radio with their meme categories.
- **Intro test fix:** the UI's first E on the intro card reveals the text and the second closes it; the test was updated to match.
- **`game-flow`:** 12/12.
- **4-minute soak with the director on:** 9 encounters, 0 deaths. Frame p99 was 6.0-7.6 ms, draw calls up to 44, textures 18 and programs 11, both flat. Heap stayed flat at 91-103 MB, with no leak.
- **Restart:** now calls `audio.stopAll()`, so leftover memes and beacons are cut.
- **Still unverified:**
  - nothing was listened to;
  - no real-GPU or real-mouse play;
  - emitter light may leak through thin side walls;
  - the meme clips and templates are copyrighted: fine privately, not cleared for public release.


**Update after user feedback:** the second-chance rule was replaced by 8 pixel hearts (a catch costs 3, an escape heals 1, an alcove heals 3; the third catch kills). The character rotation now persists across restarts. Before this fix every restart reset to "encounter 1 = Kanye", so players who died early only ever met Kanye. Kanye and Epstein audio were reprocessed louder and bass-boosted (see docs/ASSETS.md). `game-flow` reran with 12/12 ok: first catch leaves 10/16 half-hearts, the third catch ends the run, and history (kanye, epstein, trump, trump) survives a restart. Numbers below that mention the second chance predate this change.

**Second update:**
- **Speeds:** player sprint 7.3 m/s; villains Kanye 6.5, Epstein 6.6, Trump 6.8 in bursts (stop-go 1.6/0.3 s).
- **Chase cap:** 10-15 s per encounter for a moving player, 35 s hard cap. Escapes need 2.5 s out of sight plus 20 m of path, after at least 6 s of pursuit.
- **Villain order:** never the same villain twice in a row. Encounter 2 is 50/50 Epstein/Trump. Encounter 3 picks the unseen villain about 90% of the time. A villain from two encounters ago returns about 17% of the time. Checked over 20,000 seeds.
- **Trump sounds:** he rotates between 3 tracks with no immediate repeats (`audio-trump-variants`, ok).
- **Look-behind:** now a critically damped spring. It reaches 90% in 0.32 s, peaks at 15 deg/frame at 60 fps, and does not overshoot.
- **Simulation (24 seeds):**
  - perfect bot: escapes 6.0-14.2 s (median 6.0);
  - casual bot: escapes 6.0-14.8 s (median 7.9), 36 of 128 ended by the villain giving up;
  - idle player: caught at a median of 9.6 s, dead at a median of 31.5 s.
- **Browser:** `game-flow` 12/12 ok. The order was kanye, trump, epstein, trump.

All measurements below come from headless Chrome on an Apple M5 Pro (ANGLE/Metal), with animation frames driven by a timer, plus Node for the pure-logic tests. Headless frame times show CPU and pipeline cost. They are not a real laptop GPU benchmark. Nobody played the game with a real mouse, and nobody listened to any audio.

## Verified

### World (`node test/unit/run.mjs`, world.mjs 16/16)
- Same seed gives byte-identical chunks in any generation order, and chunks regenerate identically after eviction.
- 5,544 chunk seams checked: openings on both sides always agree.
- Every chunk is connected for a 1 m-wide agent, has more than one exit, and keeps at least 1 m of clear width after props.
- 65% of chunks have an internal loop.
- Chunks at cx = ±20000 and 32000 work.
- Generation takes 0.13 ms per chunk on average (0.85 ms max). Grid queries take about 4 ns and allocate nothing.
- Zones: office 79.8%, maintenance 7.1%, wet 6.7%, dark 6.4%.

### Director (director.mjs 13/13)
- Encounter 1 is always Kanye.
- Encounter 2 comes out at about 40/30/30 (Kanye/Epstein/Trump).
- Encounter 3 always differs from encounter 2:
  - after Kanye then Epstein it is about 80/20 Trump/Kanye;
  - after Kanye then Kanye it is 50/50 Epstein/Trump.
- No character ever appears three times in a row.
- Only committed encounters count toward these rules.
- Encounter randomness is separate from world randomness.

### Encounter flow in the browser (`game-flow`, 12/12 ok, run by the lead with every system live)
- First Kanye reveal at 8.66 s (target 6-10 s). Reveal to pursuit takes 0.76 s (target 0.6-1 s).
- Pausing freezes the timers.
- A runner bot escaped in 8.0 s (41.8 m of path separation).
- Recovery held for 3.01 s.
- After stopping dead: warning at 4.08 s, reveal at 6.09 s.
- First catch gives a second chance: knockback plus 4.46 s of protection.
- Second catch ends the run with the line "Trump caught you. Tremendous catch. The best catch."
- The run is saved and restart resets cleanly.
- Audio calls:
  - `enemyStart` fires exactly once per encounter (kanye, epstein, trump);
  - `enemyStop` fires on every ending;
  - every enemy pin is released.

### Encounter simulation (`game-sim all --seeds=24`, real generator)
- First reveal lands at 6.2-9.2 s.
- If you keep sprinting, the next warning comes 12.0-19.9 s after an escape.
- Perfect-routing bot: 116 of 124 escapes take 8-15 s (median 8.0).
- Casual bot (0.5 s reaction): 78 of 111 escapes take 8-15 s (median 10.9 s), with similar medians per character.

### Rendering
- **Light leaks** (`render-leaks`): 0 across 145,780 floor texels. The light step across a chunk seam (0.132) matches the step inside a chunk (0.137).
- **Streaming**: each chunk bakes in about 7-8 ms, split into slices of 1.4 ms or less. The per-frame build budget is 4.3 ms or less.
- **Fixtures**: switching a fixture off relights the floor under it from 1.16 to 0.28, and switching it back restores it exactly.
- **Far coordinates**: rendering at 5 km uses a rebased render origin and looks correct.
- **Colour match**: floor and wall albedo were tuned by measuring pixels against reel frames. Reel floor (196,184,100) against ours (185,171,86); reel wall (190,173,70) against ours (177,156,56).

### Performance
- **3-minute soak** (`soak`, runner bot, 6 encounters):
  - frame p99 of 6.8 ms or less in every 10 s window;
  - 31-40 draw calls and 23k-48k triangles;
  - resources stay flat: 52-59 geometries, 12 textures, 12 programs;
  - the world cache stays bounded at 250, and the heap stays flat at 74-87 MB.
- **First 12 s after boot**, including streaming and the first reveal: p50 4.8 ms, p99 5.4 ms, max 8.3 ms, and 0 frames over 20 ms.
- **Late shader compile, fixed by the lead**: the enemy shader used to compile at the moment of the first warning, which would cause a hitch right at the scare. The cause was precompiling against the canvas rather than the HDR target. After the fix, 8 programs compile at boot and none compile later.
- **Build size**: 202 KB gzipped JS; 1.8 MB for the whole `dist/` including audio.

### Audio (`audio-enemy`)
- At 5 m in front, all three tracks are audible at the enemy bus: -26/-22/-20 dB.
- Muffling takes 6.5-13.4 dB off.
- Loops keep playing past the wrap point.
- Stopping or switching tracks releases every voice.
- Loudness per file: kanye -17.0 LUFS, epstein -17.2 LUFS, trump -19.1 LUFS with +2.1 dB of playback gain.

### UI (`ui-menus`)
- Every menu flow works at 1280x720 and at 360x640 without overflow.

## Not verified / known limits
- **Real hardware**: 60 fps on an ordinary laptop GPU has not been measured. Use F3 to see fps and p99 in play.
- **Needs a real mouse and window**: mouse look, pause when pointer lock is lost, and the sprint toggle. Headless Chrome stubs pointer lock.
- **Sound**: how any audio actually sounds (Kanye's degradation, the loop wraps, the ambience balance). Everything was checked with signal measurements only.
- **Escape length for skilled players**: set mainly by the 8 s minimum pursuit. A perfect bot always escapes at about 8 s.
- **Sound-first encounters**: about 20% of encounters start with the song and a distant-door cue before the enemy becomes visible. This is deliberate, so an unseen enemy doesn't close in to 2.5 m.
- **Hard zone switch**: zones change sharply at chunk seams. A carpet-to-concrete line is visible at the edge of maintenance rooms.
- **Untested renderer paths**: the fallback for GPUs without float colour buffers, WebGL context loss, and the auto-quality step-down. Only Chrome was tested.
- **Reference screenshot**: no separate reference screenshot was found in Downloads. The reel frames were the only visual reference.
