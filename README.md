# NOCLIPPED

An infinite Backrooms meme-horror game in three.js. You noclipped into Level 0. The rooms are lit and textured like the real thing. The things chasing you are badly cut-out PNGs of Kanye West, Jeffrey Epstein and Donald Trump, each with their own song.

## Run

```
npm install
npm run dev        # http://127.0.0.1:5230
npm run build      # static build in dist/ (relative base, host anywhere)
npm run preview    # serve dist/ on :5231
```

Needs a browser with WebGL2. If WebGL2 is missing, the page says so instead of failing silently.

## Deploy

It's a plain static site (`npm run build` -> `dist/`, relative paths), so any static host works:

- **GitHub Pages:** already wired up in `.github/workflows/pages.yml`. One-time: repo Settings -> Pages -> Source: **GitHub Actions**. After that every push to `main` deploys to `https://<user>.github.io/<repo>/`.
- **Vercel:** import the repo; it detects Vite (build `npm run build`, output `dist`). No config needed.
- **Netlify:** import the repo; `netlify.toml` already sets the build command and `dist`.
- **Anything else:** run `npm run build` and upload `dist/`.

Heads-up: the enemy songs, meme sounds and meme images are copyrighted material from third parties (see `docs/ASSETS.md`); fine for a private meme project, but a public deployment could draw takedown requests.

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Mouse | look |
| Shift | sprint (hold, or toggle in Settings) |
| Q / middle mouse | look behind |
| E | use / hold (doors, phones, tapes, breakers, posters, TVs, vending, radios, alcoves) |
| 1 | drink almond water (+1 heart) |
| G | MLG airhorn (stuns a nearby villain) |
| 8 / 9 / 0 | summon Kanye / Donald / Jeffrey (replaces the active villain) |
| F | flashlight |
| Left click | swing the hatchet (cosmetic, bumps doors) |
| Esc | pause |
| F3 | debug overlay |

You have 8 hearts (top right). A catch costs 3 hearts, so the third catch ends the run. An escape heals 1 heart, and a recovery alcove heals 3. The first villain is Kanye; after that the same villain never comes twice in a row, and unseen or long-absent ones are favoured. The rotation carries over between runs. You sprint slightly faster than every villain; a chase lasts 10-15 s at most if you keep moving (less if you break line of sight and get about 20 m away), but walking or standing still lets them keep going. Best distance and escape counts are saved locally.

## Mobile

Phones and tablets get on-screen controls automatically (coarse pointer, or the first real touch on a touchscreen laptop). `?touch=1` forces them on for testing, `?touch=0` turns them off.

- Tap Start (no pointer lock). Landscape is best; portrait works and the start screen suggests rotating.
- Left thumb: a stick appears wherever you touch the left ~45% of the screen. Walk speed follows how far you push; push to the edge to sprint.
- Right side: drag anywhere to look (Settings > Look sensitivity, Invert look Y).
- Buttons: USE (tap, or hold for hold tasks and the card swipe), BACK (hold to look behind), LIGHT (flashlight), the almond water and airhorn slots (only once you have them), pause (top right). The wiring panel gets four tappable terminals. Lore cards, death and win screens close with a tap.
- Auto quality picks the `mobile` tier on phones and tablets: low's settings drawn at 1 CSS pixel (not the screen's 2-3x), fewer dynamic lights and party particles; it steps down to `low` if frames stay slow. Desktop tiers are unchanged.
- Test: `node test/harness.mjs touch-mobile --size=844x390 --menu --query=nodirector:1` (and `--size=390x844`) emulates a DPR-3 phone with notch insets and drives real multi-touch.

## How to win

M.E.G. radios in: the villains are "memetic echoes", the internet's most-memed faces printed as flat cutouts that hunt by sound. The checklist (top left) is the way out:

1. Answer the ringing phone in the first corridor (a villain crashes the call a few seconds later).
2. Finish 6 M.E.G. work orders: tasks in task rooms and hallways (card swipe, wiring, router off/on, copier, microwave, stuck vending, touch grass, fix a flickering light, straighten a poster, timesheet, skibidi flush). The first 5 each unlock a VHS lore log.
3. Restore power at 3 breaker wiring panels (keys 1-4; loud, draws villains).
4. Walk through the EXIT elevator (250-350 m out).

The compass (top centre) points at the nearest unfinished target. Villains can't open doors: close one behind you and they wait outside until they give up (open doors are still fair game). Vending machines, coolers and some tasks give almond water; airhorns lie around; meme props, posters, TVs and radios are meme bait. Provenance in `docs/ASSETS.md`, generated art in `public/assets/gen/README.md`.

## Party mode

A neon Sigma Boy jukebox stands about 8-14 m down the first corridor. Press E on it: the song plays for 10 s and any villain gets blasted away; the moment it ends, the next villain comes for you. You get disco spots, colour-cycling lights, lasers, confetti and a rainbow PARTY MODE banner. E again stops it early. 45 s cooldown after. Song provenance in `docs/ASSETS.md` (private use only).

## URL parameters

`?seed=N` world seed · `?eseed=N` encounter seed (reproducible character order) · `?quality=low|medium|high` · `?nodirector=1` (no enemies) · `?debug=1` (overlay on) · `?spawn=x,z,yaw` · `?autostart=1` · `?intro=1` (show the M.E.G. intro card) · `?touch=1|0` (force the touch controls on / off)

## Layout

| Path | Owner | What |
|---|---|---|
| `src/main.js`, `src/config.js`, `src/settings.js`, `src/core/` | lead | boot, loop, shared constants, settings, rng, events |
| `src/world/` | world | deterministic streamed chunk generator, grid queries, doors |
| `src/render/` | render | baked chunk lighting, materials, post, enemy sprite, hatchet |
| `src/game/` | gameplay | input, player, collision, navigation, enemies, director, save, debug overlay |
| `src/audio/`, `src/ui/`, `index.html` | audio/ui | WebAudio buses and spatial enemy tracks, procedural ambience, menus |
| `scripts/process-assets.mjs` | audio | offline cutouts + audio processing from `~/Downloads` originals |

`ARCHITECTURE.md` is the interface contract. `docs/REFERENCE.md` has the reel analysis. `docs/ASSETS.md` covers asset provenance, trims, loop points and gains. `docs/TEST-REPORT.md` covers what was tested and what wasn't. Screenshots are in `docs/screenshots/`.

## Tests

```
node test/unit/run.mjs                                   # world connectivity/determinism + director probabilities
node test/scripts/game-sim.mjs all --seeds=24            # headless encounter simulation on the real generator
node test/harness.mjs game-flow --size=960x540           # full browser flow (needs npm run dev)
node test/harness.mjs soak --secs=180                    # long session: frame times, resources, heap
node test/harness.mjs render-views --query=nodirector:1  # repeatable reference views
node test/harness.mjs render-leaks                       # light-leak check
node test/harness.mjs audio-enemy --menu                 # enemy tracks: level, muffle, release
node scripts/world-map.mjs --seed=1337                   # top-down map PNG in shots/world/
```

The browser harness runs headless Chrome with audio muted.

## Regenerating assets

`npm run assets` rebuilds `public/assets/` from the originals in `~/Downloads` (read only). It uses ffmpeg and python3 with numpy, scipy, opencv and Pillow. The output is deterministic.
