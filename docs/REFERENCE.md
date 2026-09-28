# Reference analysis (lead, 2026-09-27)

Source reel: `~/Downloads/trimmed.mp4` (720x720, 26 fps, 65.5 s, stereo 48 kHz). Frames were sampled with ffmpeg (1 fps contact sheet + 4 fps for 0-8 s); saved copies live in `reference/`. Audio was analysed numerically (RMS envelopes, spectral cross-correlation). Nobody listened to anything; claims below are from signal analysis and frame images only.

No separate Backrooms "supplied screenshot" was found in Downloads (the newest WhatsApp image is an unrelated Jio ad), so the reel frames are the visual reference.

## Visual
- Walls: saturated mustard yellow wallpaper with faint vertical chevron/damask stripes, low contrast. Walls are flat and slightly darker toward the floor; soft light pools on walls under fixtures.
- Ceiling: off-white/cream acoustic tiles in a grid (~0.6 m), recessed 0.6x1.2 m fluorescent panels that are blown-out white. Missing/dark ceiling tiles occasionally.
- Carpet: pale beige-yellow, matte, very uniform with faint mottling; a few dark stains.
- Light: bright, flat, slightly greenish-yellow, near-uniform; contact darkening at wall bases and corners is subtle. Some areas are dark (lights off) where a flashlight cone is used.
- Architecture: long corridors (width ~1.1-1.3x ceiling height, i.e. ~3-3.5 m), column rooms with 0.8-1 m square pillars, thick partition walls with offset openings, wooden office doors, arches in a couple of shots, stacked chairs/furniture piles.
- Camera: level horizon at frame centre, eye ~1.6-1.7 m, fairly wide lens. We use vertical FOV 74 deg (three.js PerspectiveCamera convention: vertical), which equals Source/GMod 90 deg horizontal at 4:3 and reads right against the corridor frames.
- UI: nearly nothing. Tiny dot crosshair at screen centre, first-person black tactical hatchet held low in the right hand (blade up, hand visible at the bottom right edge). Flashlight cone in dark areas.

## Enemy (Kanye in reel)
- Flat head-and-shoulders cutout (black shirt), background removed crudely with a hard edge, no shading, no lighting response, rotates to face the camera (visible skew when seen at an angle).
- Scale: nearly floor-to-ceiling. In the 7.75 s frame the cutout spans roughly the full corridor height, bottom edge at the floor. We use sprite height 2.35 m, bottom 0.05 m above floor, width from aspect.
- First visible frame: between 0.25 s and 0.50 s (it pops up behind a furniture pile at 0.50 s).

## Audio timing
- Reel audio onset 0.72 s (RMS jumps from -55 dB to -23 dB).
- Cross-correlation of 5 s reel windows against `Kanye West - All Of The Lights ft. Rihanna, Kid Cudi.mp3` gives a constant mapping reel t -> song t + 68.04 s (scores 0.60-0.94 across the reel; the 5 s window matched a repeated chorus at 262 s once).
- The song has a hard onset at 68.70 s (-47 dB -> -25 dB). So: Kanye clip source start = 68.70 s, and the song enters ~0.2-0.45 s after the first visible frame. In game: song entrance 0.25 s after the reveal moment.

## Epstein (`Jeffrey Epstein Edit Lil Pump - Boss X Hunnid dolla.mp3`, 89.47 s)
- 0.00-1.10 s: irregular bursts with almost no bass (<0.10 bass fraction), unlike the music: the opening intro.
- 1.10-1.54 s: near silence (-37 to -46 dB): the boundary.
- 1.54-2.04 s: bass-less vocal pickup at -12 to -22 dB, then the beat drops at 2.04 s (bass fraction 0.3-0.4, -7 dB).
- Cut: start at 1.50 s (inside the silence, short fade-in). Loop region should start at the beat drop.

## Trump (`Donald Trump please save me 🥺🙏 - Meme Asylum.mp3`, 35.64 s)
- Fairly uniform speech/music at about -19 dB with brief dips near 27 s. Preserve as supplied; only trim edge silence, set gain, avoid clipping.

## Character images (originals in Downloads, never modified)
- Kanye: `cover2-1.webp` (810x580, selfie, wooden background, white shirt)
- Epstein: `images (6).jpeg` (678x452, navy zip sweater; blurred person on the left must be cropped out)
- Trump: `Donald-Trump-Mugshot-Depth-Of-Field-Culture-1621335357.webp` (1500x1500 mugshot, grey background, sheriff badge top-left)
None have alpha; cutouts are produced into `public/assets/img/`.
