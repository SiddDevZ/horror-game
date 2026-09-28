# Asset provenance and processing

> **Update (2026-09-27, user request: "super low quality, meme level, extra bass, super loud"):** Kanye and Epstein were reprocessed. `public/assets/manifest.json` carries the exact chain strings and measured numbers; they supersede any older chain/loudness figures below.
> - Kanye: loudnorm leveller, bass shelf +26 dB @ 60 Hz, +10 dB @ 110 Hz, LPF 3.8 kHz, +14 dB into hard clip, 5-bit log crush with 5x sample hold, +6 dB into hard clip, 11025 Hz, 24 kbps mp3. File -9 LUFS / -1.8 dBTP, playback target -7 LUFS. Energy below 150 Hz: 4% in the source section, 33% after.
> - Epstein (lighter): bass shelf +4 dB @ 70 Hz, +4 dB @ 900 Hz, 8-bit crush mix 0.5, tanh drive, 16 kHz, 40 kbps. File -10.2 LUFS. Below-150 Hz energy 66% -> 74%, vocal band kept (22%).
> - Trump: file unchanged (-19.1 LUFS, unfiltered); playback target raised to -12 LUFS via `playbackGainDb`.
> - Runtime: enemy bus +4 dB above the slider, enemy volume default 100%, flatter distance falloff (ref 6 m, rolloff 0.55), muffling keeps the bass through walls, master safety limiter at -1.5 dB.
> - Trump extra sounds (added later the same day): `Trump They're eating the dogs, the cats.mp3` (14.44 s, edge-trimmed at -60 dBFS -> `audio/trump_dogs.mp3`, 14.8 s loop) and `Donald Trump Says China.mp3` (180 s speech supercut with gaps, no beat; window 77.725-107.975 s chosen as the densest 30-45 s stretch, 93% of 50 ms frames above -35 dB, both edges on >= 200 ms silences -> `audio/trump_china.mp3`, 30.7 s loop). Both unfiltered like the original, playback target -12 LUFS. Listed in `manifest.clips` and `characters.trump.audioVariants`; each Trump encounter picks one, never the same twice in a row.
> - Still unauditioned: all of this is measured, not listened to.


All processed assets come from `npm run assets` (`scripts/process-assets.mjs`). It reads the originals from `~/Downloads` (override with `BR_SOURCES`), never writes to them, and regenerates `public/assets/img/*.webp`, `public/assets/audio/*.mp3` and `public/assets/manifest.json`. Two consecutive runs produce byte-identical outputs (md5 compared). Tools: ffmpeg/ffprobe 8 (Homebrew, `FFMPEG_DIR`), python3 with numpy, scipy, OpenCV 4.13 and Pillow 12. Helpers: `scripts/cutout.py` (image cutouts) and `scripts/audio_tools.py` (onset/tempo analysis, loop refinement, baked crossfade, decode alignment, spectra). No npm dependencies were added.

Nobody listened to any audio or watched any video. Every timing, loudness and quality claim below comes from signal measurements (RMS envelopes, spectral flux, feature similarity, EBU R128 scans) and from looking at still images.

Every number below is also stored per character in `manifest.json` (the `analysis` block has the raw measurements).

## Originals (read-only)

| Character | File in ~/Downloads | Format as probed | Size |
|---|---|---|---|
| Kanye image | `cover2-1.webp` | WebP 810x580, no alpha | 351,734 B |
| Epstein image | `images (6).jpeg` | JPEG 678x452 | 20,145 B |
| Trump image | `Donald-Trump-Mugshot-Depth-Of-Field-Culture-1621335357.webp` | WebP 1500x1500 | 120,162 B |
| Kanye audio | `Kanye West - All Of The Lights ft. Rihanna, Kid Cudi.mp3` | **AAC** in an .mp3-named file, 44.1 kHz stereo, 327.70 s | 5,304,286 B |
| Epstein audio | `Jeffrey Epstein Edit Lil Pump - Boss X Hunnid dolla.mp3` | **AAC** in an .mp3-named file, 44.1 kHz stereo, 89.47 s | 1,448,674 B |
| Trump audio | `Donald Trump please save me 🥺🙏 - Meme Asylum.mp3` | MP3, 48 kHz stereo, 35.64 s | 1,425,715 B |

The Kanye and Epstein files are AAC despite the extension. Every time below is on ffmpeg's decoded timeline, which trims AAC priming.

## Images

Method (`scripts/cutout.py`), identical for all three:
1. Crop the source.
2. Seed GrabCut from hand-placed shapes, in source pixels, kept in `process-assets.mjs`. An outer ellipse/polygon is probable foreground and everything outside it is definite background. An inner face ellipse plus a shoulder polygon are definite foreground. Optional shapes can force areas to background.
3. Run 8 GrabCut iterations with a fixed OpenCV RNG seed.
4. Clean the mask: 5 px open, keep the largest component, fill holes, close with padding so the crop edges survive, blur the outline at sigma 2-3 and re-threshold, erode 2 px (3 px for Trump), keep the largest component again.
5. Crop tight to the subject, then bleed the foreground colour 24 px outward under the transparent area so mip/bilinear sampling never pulls in the old background.
6. Resize to 512 px tall (INTER_AREA, or INTER_CUBIC for Epstein, whose crop is only 420 px tall).
7. Steepen alpha to about 1 px of antialias around 0.5, so an alpha test at 0.5 gives a clean hard "pasted" silhouette.
8. Save WebP (quality 82, lossless-quality alpha).

| | Crop (source px) | Output | Aspect (w/h) | Bytes | Notes |
|---|---|---|---|---|---|
| kanye | x 140-690, y 0-580 | 486x512 | 0.9492 | 12,234 | The selfie is already a head-and-shirt close-up: the head is cut flat by the photo's top edge and the white T-shirt by the crop sides, much like the reel's rectangular shirt edges. The vase at x > 715 is outside the crop. |
| epstein | x 205-600, y 0-420 | 477x512 | 0.9316 | 16,348 | The blurred person sits at x < 195 (hair up to about x 190), so the crop at x 205 removes her entirely. A dark wall shadow left of his neck (x 230-287, y 130-214) is forced to background. The sweater is cut by the crop's left and bottom edges. |
| trump | x 400-1500, y 200-1420 | 472x512 | 0.9219 | 12,944 | The sheriff badge (x 170-390, y 180-390) is outside the crop. Both suit shoulders needed definite-foreground seeds, because GrabCut otherwise classed the near-black jacket as background. |

`heightM` is 2.35 for all three (docs/REFERENCE.md). In the reel frame at 7.75 s the Kanye cutout measures about 131x165 px (aspect about 0.8), with the head filling most of it. Our aspects run 0.92-0.95 because the supplied Kanye selfie is framed tighter and wider than the image in the reel. Narrowing it to 0.8 would have cut into the cheeks, so I kept the natural head-and-shoulders framing.

Checked visually: each cutout composited on mustard with an alpha test at 0.5, at 300, 120 and 48 px tall. No halos, no rectangular fringe, no background islands. Debug composites and seed overlays are in `shots/assets/` (`npm run assets -- --debug` rewrites them).

## Audio

Shared pipeline for every clip:
1. Decode to a mono float working copy with ffmpeg `-ac 1`. Note that ffmpeg's stereo-to-mono downmix is (L+R)/sqrt(2), which raises the peak-to-loudness ratio of correlated material by about 3 dB compared with a stereo measurement.
2. Sample-accurate `atrim`, then the per-character chain.
3. Bake fades and an equal-power loop crossfade, where the last N ms before `loopEnd` are blended with the N ms before `loopStart`, so the wrap is continuous.
4. Loudness in two passes: a loudnorm analysis pass on the processed audio (I and TP), then a static gain plus an optional `alimiter` peak guard, an MP3 encode, and a re-measure of the encoded file with `ebur128=peak=true`. This repeats up to 5 times until the result is within ±0.25 LU of -17 LUFS with true peak ≤ -1.5 dBTP.
5. Decode the MP3 with ffmpeg and cross-correlate it against the pre-gain wav. The decoded timeline offset was 0 samples for all three (correlation 0.991 / 0.999 / 0.9998), so the loop points in the manifest are on the decoded timeline.

Target: -17 LUFS integrated, true peak ≤ -1.5 dBTP. All files are mono libmp3lame CBR, encoded with bitexact flags and no ID3 tags.

### Kanye

- **Source start 68.700 s.** docs/REFERENCE.md found this onset by cross-correlating the reel's audio against the song. I re-verified it: 20 ms RMS sits at -45 to -47 dB before it and jumps to -34 then -23 dB between 68.70 and 68.74 s. The spectral-flux peak is at 68.743 s (44.1 kHz analysis, window-centred, so it lands slightly late).
- **Tempo 142.145 BPM** (beat 0.4221 s, bar 1.6884 s). Fitted by maximising mean spectral flux on a beat grid anchored at the onset over 60 s. Autocorrelation cross-check: 142.1 BPM. The anchor lands on the downbeat phase with the strongest flux (phase 0).
- **Structure** (RMS per bar after the onset, source): bar 0 is a hit at -20 dB, bars 1-5 sit around -26 dB, bars 6-15 around -19 dB, and a louder section starts at bar 16 (95.76 s source) around -10 dB.
- **Loop bars 18-26.** loopStart is anchor + 18 bars - 20 ms, and loopEnd is 8 bars later, refined by waveform cross-correlation (+1.8 ms, correlation 0.67). Every bar-aligned 8- and 16-bar candidate ending by bar 27 was scored on feature similarity (log-band spectra, 2 bars after and 1 bar before each point). 18-26 scored best (post 0.48, pre 0.58 at the 22.05 kHz scan; 0.38 / 0.50 at 44.1 kHz). The best loop that includes the quieter opening, bars 8-24, scored only 0.21 / 0.22 and would drop about 9 dB at the wrap.
- **In the file:** duration 43.983 s (entrance 0 to 30.41 s, played once), loopStart **30.4142 s**, loopEnd **43.9234 s** (13.51 s = 8 bars). The source span is 68.700-112.683 s.
- **Degradation chain:** mono → high-pass 300 Hz (2x 12 dB/oct) → low-pass 3.5 kHz (2x 12 dB/oct) → acrusher (6-bit linear, 4x sample-and-hold, i.e. 11.025 kHz, no anti-aliasing, mix 0.85) → +10 dB into a tanh soft clip (4x oversampled) → -10 dB → low-pass 4.2 kHz (2x) → loudnorm in dynamic mode as a slow section leveller (I -17, LRA 4) → 22.05 kHz → static gain -0.74 dB → limiter ceiling -2 dBFS (it never engaged: 0% of 10 ms windows reduced) → 40 kbps.
- **Why the leveller:** without it, the song's quiet build meant the first 12 s (what most 8-15 s chases hear) measured -22.2 LUFS against -15.1 in the loop. With it: first 12 s -18.9, bars 7-18 -16.6, loop -16.4 LUFS. A dynaudnorm attempt made the opening quieter (-24.2) and was dropped.
- **Measured result:** -17.0 LUFS integrated, -3.5 dBTP, LRA 4.6 LU. 93.1% of the energy sits in 300-3500 Hz (source: 24.0%), 0.11% in 3.5-6 kHz and 0.00% above 6 kHz, so there is no harsh top end. The spectral centroid is 913 Hz (source 418 Hz). Crest factor is 13.7 dB. Loop wrap (ffmpeg decode): sample jump 0.0107 against a p99 sample step of 0.088 (ratio 0.12). 220,394 B.
- **entranceDelay 0.25 s**, from the reel: the cutout is first visible between 0.25 and 0.50 s, and the audio onset is at 0.72 s.

### Epstein

- **Intro removal**, re-verified with 20 ms RMS: 0.00-1.10 s is the intro bursts, 1.10-1.54 s is near silence (-37 to -46 dB), the pickup rises at 1.54-1.56 s, and the beat drops at 2.04 s (-22 dB, then -7 dB). The flux peak of the drop is at 2.038 s and its steepest attack at 2.031 s.
- **Source start 1.500 s**: inside the silence, with a 10 ms sine-squared fade-in. The file keeps the 0.5 s bass-less pickup, so the drop arrives 0.52 s into the file.
- **Tempo 120.0 BPM** (bar 2.000 s). The flux fit gives 119.985 and autocorrelation 119.85.
- **Loop bars 0-24**, drop to drop. Scanning loop lengths of 8-24 bars from the drop, 24 bars scored far above the rest (post-similarity 0.90 at 22.05 kHz, 0.83 at 44.1 kHz, against 0.35 or less for the others). Bar 23 is a break (-13.5 dB against -5 dB elsewhere), and bar 24 is the song's own second drop. So the wrap reproduces the track's own break-into-drop. Pre-similarity is negative (-0.15) because the break before the second drop doesn't resemble the audio before the loop start, which is expected at a section boundary. The refinement found 0 ms lag at correlation 0.946.
- **In the file:** duration 48.578 s, loopStart **0.5176 s** (the drop minus a 20 ms pre-roll), loopEnd **48.5176 s** (48.000 s, 24 bars). The source span is 1.500-50.078 s. The loop is 48 s, a little past the 30-45 s guideline, because the next musically clean wrap point (8 bars, 16 s) scored far worse.
- **Lighter degradation:** mono → high-pass 80 Hz → low-pass 7 kHz → acrusher (9-bit, 2x hold at 22.05 kHz, mix 0.35) → +4 dB tanh soft clip → -4 dB → 22.05 kHz → static gain -1.46 dB → limiter ceiling -2 dBFS (never engaged) → 56 kbps.
- **Measured result:** -17.2 LUFS integrated (first 12 s -17.5), -3.8 dBTP, LRA 1.1 LU. Centroid 434 Hz (source 216 Hz; the hot master's sub-bass is partly removed). Seam ratio 0.009. 340,662 B.
- **entranceDelay 0.35 s**, my choice. The file has 0.52 s of pickup before the drop, so the drop lands about 0.87 s after the reveal. That's the end of the brief's 0.6-1 s reveal/commitment window, which matches Epstein's "short unsettling hesitation, then steadier pursuit".

### Trump

- **Preserved:** no filtering, no degradation, no limiting.
- **Edge trim** at -60 dBFS over 10 ms windows: content runs 0.080-35.430 s, and the file uses 0.075-35.440 s. The start is digital silence (0.00-0.07 s), and the tail is the source's own fade, reaching -60 dB at about 35.43 s. Then a 3 ms fade-in, a 20 ms fade-out, and 0.45 s of silence appended as the gap before the loop repeats.
- **Loop:** the whole clip. loopStart **0**, loopEnd **35.815 s** (end of the gap). The clip is a continuous meme mix with a bass bed and no sectional repeat I could find (the 0.65 s ACF peak suggests about 92 BPM, but that's not reliable enough to cut on), so it loops whole with a short breath rather than being re-cut.
- **Why Trump's file is quieter:** after the mono downmix the clip's true peak sits only 17.8 dB above its integrated loudness. Reaching -17 LUFS in the file would have meant limiting 4.7% of 10 ms windows, some by more than 2 dB, which goes beyond peak cleanup. So the file gain stops at the true-peak budget: -0.95 dB, giving **-19.1 LUFS** and -1.5 dBTP. The remaining **+2.1 dB** is `playbackGainDb` in the manifest, applied in the float WebAudio graph, where there's no clipping (the master bus has only a safety compressor at -6 dBFS). Integrated loudness at playback is therefore about -17 LUFS, like the others.
- **Character check** (decoded output vs mono source): centroid 295.7 vs 295.1 Hz, energy below 300 Hz 0.831 vs 0.832, crest factor 15.35 vs 15.31 dB. Seam ratio 0.001 (the wrap is from silence to the first sample). 358,800 B at 80 kbps, 48 kHz (source rate, not resampled).
- **entranceDelay 0.15 s**, my choice. The clip has sound from its first sample, so a short beat after the visual pop keeps the reel's "picture, then sound" order while leaving room for his stop-start movement around the cue.

### Loudness balance summary (EBU R128 on the decoded MP3s)

| | Integrated (file) | Playback trim | First 12 s | Loop region | True peak | LRA | Limiter activity |
|---|---|---|---|---|---|---|---|
| kanye | -17.0 LUFS | 0 dB | -18.9 | -16.4 | -3.5 dBTP | 4.6 LU | none |
| epstein | -17.2 LUFS | +0.2 dB | -17.5 | -17.2 | -3.8 dBTP | 1.1 LU | none |
| trump | -19.1 LUFS | +2.1 dB | -19.0 (-16.9 played) | -19.1 (-17.0 played) | -1.5 dBTP | 6.2 LU | off |

## Runtime use (src/audio/AudioSystem.js)

- The enemy source plays from 0 (the entrance, once) and loops between `loopStart` and `loopEnd`, starting `entranceDelay` after `enemyStart`. A repeat `enemyStart` for the same character never restarts the track.
- Decoders differ on MP3 encoder-delay trimming. After decoding, the runtime finds the first sample above `onsetThreshold` (0.05) and compares it with the manifest's `onsetAt`, shifting the loop points by the difference (clamped to ±100 ms). Headless Chrome measured offsets of +0.03, -0.06 and 0 ms, meaning Chrome trims the delay itself.
- In-browser check (`node test/harness.mjs audio-enemy --menu`): an OfflineAudioContext render across each wrap in Chrome's own decode gave a wrap step against p99 step of 0.072/0.061 (kanye), 0.006/0.031 (epstein) and 0/0.006 (trump). Every wrap is within the signal's normal step range.

## Limitations (honest)

- Nothing was auditioned. "Recognisable but low quality" for Kanye rests on measurement alone: the band stays 300-3500 Hz, where the vocal and hook live, with a 6-bit crush at 11 kHz and a soft clip, and there's no energy above 6 kHz to make it painful. Whether it actually sounds funny is unverified.
- Loop quality is judged from spectral-feature similarity and waveform correlation, not listening. The Kanye loop (bars 18-26) was the best of the candidates scored, but its feature similarity (0.38-0.58) means the eight bars around the wrap aren't identical. Vocals may change phrase at the wrap.
- Bar and downbeat positions come from a flux-maximising grid fit. The Epstein grid sits on its drop (verified by the 24-bar repeat, correlation 0.95). The Kanye downbeat phase choice rests on flux strength only.
- The reel-to-song offset (68.04 s) and the 68.70 s onset come from the lead's cross-correlation in docs/REFERENCE.md. I re-measured the onset but not the reel cross-correlation.
- Trump's "no sectional structure" is a negative finding from ACF and RMS only.
- Loudness is measured on mono files. The runtime centre-pans them (equal power), so every clip gets the same treatment and the balance holds, but absolute playback LUFS depends on the volume settings and distance.
- Cutout seed shapes are hand-placed for these specific images. Replacing an image means re-placing its seeds.

## Meme sounds, posters and TV (v2, 2026-09-27)

User request: "more meme sounds and memes ... posters on walls with memes too ... actually good memes for genz ... KEEP IT LOUD". Everything here comes from `node scripts/fetch-memes.mjs` (stages `--sounds`, `--images`, `--atlas`; no flag runs all three, `--refetch` ignores the cache, `--only=id,id` limits a run, `--debug` writes atlas PNGs to `shots/assets/`). Downloads are cached in `.cache/memes/` (outside `public/`, git-ignored) together with `sounds.json` / `images.json`, which record every URL and page title. Outputs are `public/assets/sfx/*.mp3`, `public/assets/img/posters.webp`, `public/assets/img/tv.webp`, and the `sfx`, `memeCategories`, `sfxMeta`, `posters` and `tv` keys in `manifest.json`. `scripts/process-assets.mjs` now passes any manifest key it does not write straight through, so `npm run assets` keeps them (checked: a `--skip-images --skip-audio` run left the manifest identical).

**Rights:** these are clips of other people's games, films, TV and music as re-uploaded to a public soundboard, plus imgflip meme templates. They are fine for a private meme project. They are not licensed for redistribution, so clear them before shipping this anywhere public.

### How the sounds were sourced

- **Source:** myinstants.com instant pages. Scripted requests to myinstants.com get a Cloudflare challenge (HTTP 403), so every page and mp3 was read through its Wayback Machine capture: the page at `web.archive.org/web/<year>/https://www.myinstants.com/en/instant/<slug>/`, the mp3 raw at `web.archive.org/web/<year>id_/https://www.myinstants.com/media/sounds/<file>.mp3`. It tries 2026, then 2025, then 2024, because the archive sometimes returns 500 for one timestamp.
- **Choosing:** candidates came from the archived "best of all time" listing (478 entries, 14 pages) and from CDX prefix searches. The script ranks candidates by the page's view count and prefers the canonical upload.
- **Verification:** each entry declares a regex (`expect`) that the archived page title must match before the mp3 is accepted. The mp3 must be `audio/*`, over 1.5 KB and decode with ffprobe. Titles and view counts below are exactly as the page showed them.
- **Processing:** mono, 48 kHz float. Trim leading silence at -48 dB and trailing silence at -50 dB. Optional window capped at `max` seconds, with a 0.2 s fade when cut. High-pass at 40 Hz, +3 dB bass shelf at 100 Hz. Static gain to **-9 LUFS**, lookahead limiter, libmp3lame 64 kbps CBR mono at 32 kHz, no tags. Then re-measure (EBU R128 on the encoded file) and iterate up to 6 times for true peak ≤ -1.0 dBTP and ±0.5 LU. Very dynamic clips stop at +8 dB of extra drive rather than being crushed flat. Any remaining shortfall goes in `playbackGainDb` and is applied in the float WebAudio graph, as the enemy tracks do. The master limiter at -1.5 dB catches overs.
- **Skipped on purpose:** sexual or hateful entries in the popular list (for example the step-bro, "nut button", "hawk tuah" and "social credit" clips).

### Clips (47, 1.20 MB total)

| id | categories | page title (views) | dur s | LUFS | dBTP | trim dB | source page |
|---|---|---|---|---|---|---|---|
| `vine_boom` | reveal, poster | VINE BOOM SOUND (10,972,324) | 1.179 | -10 | -1.4 | 1 | https://www.myinstants.com/en/instant/vine-boom-sound-70972/ |
| `among_us_reveal` | reveal | Among Us role reveal sound (3,035,041) | 4 | -12.1 | -1.3 | 3.1 | https://www.myinstants.com/en/instant/among-us-role-reveal-sound-34956/ |
| `mgs_alert` | reveal | Metal Gear Solid Alert (1,355,110) | 1.077 | -12 | -1.4 | 3 | https://www.myinstants.com/en/instant/metal-gear-solid-alert/ |
| `dun_dun_dun` | reveal | dun dun dunnnnnnnn (1,506,263) | 4 | -10.1 | -0.8 | 1.1 | https://www.myinstants.com/en/instant/dun-dun-dunnnnnnnn-68584/ |
| `roblox_oof` | hit | ROBLOX oof (2,183,367) | 0.34 | -9.41 | -1.9 | 0.41 | https://www.myinstants.com/en/instant/roblox-oof/ |
| `metal_pipe` | hit | jixaw metal pipe falling sound (948,979) | 3 | -10.8 | -1.2 | 1.8 | https://www.myinstants.com/en/instant/jixaw-metal-pipe-falling-sound-28270/ |
| `emotional_damage` | hit | Emotional_Damage (116,865) | 2.58 | -9.4 | -1.6 | 0.4 | https://www.myinstants.com/en/instant/emotional-damage-99808/ |
| `minecraft_hurt` | hit | Minecraft Hurt (704,522) | 0.345 | -11.03 | -1.4 | 2.03 | https://www.myinstants.com/en/instant/minecraft-hurt/ |
| `bonk` | hit | Doge bonk (444,656) | 0.425 | -9.5 | -1.6 | 0.5 | https://www.myinstants.com/en/instant/doge-bonk-84044/ |
| `gta_wasted` | death | GTA V - Wasted (591,689) | 6 | -13 | -1.3 | 4 | https://www.myinstants.com/en/instant/gta-v-wasted/ |
| `mission_failed` | death | mission failed, we get em next time (52,360) | 3.043 | -9.9 | -1.4 | 0.9 | https://www.myinstants.com/en/instant/mission-failed-we-get-em-next-time-6737/ |
| `coffin_dance` | death | Coffin Dance Meme (392,659) | 5.829 | -11.1 | -2.2 | 2.1 | https://www.myinstants.com/en/instant/coffin-dance-meme-31063/ |
| `xp_shutdown` | death | windows xp shutdown (746,062) | 2.885 | -10.4 | -1.8 | 1.4 | https://www.myinstants.com/en/instant/windows-xp-shutdown/ |
| `sheesh` | collect | Sheesh (16,299) | 1.597 | -12.3 | -1 | 3.3 | https://www.myinstants.com/en/instant/sheesh/ |
| `anime_wow` | collect | Anime Wow (4,270,243) | 3 | -10.1 | -1.4 | 1.1 | https://www.myinstants.com/en/instant/anime-wow/ |
| `yippee` | collect | yippee tbh (447,396) | 0.844 | -9.3 | -1.7 | 0.3 | https://www.myinstants.com/en/instant/yippee-tbh-93589/ |
| `zelda_item` | collect | Zelda - Item Get (154,831) | 2.452 | -11.1 | -1.4 | 2.1 | https://www.myinstants.com/en/instant/zelda-item-get/ |
| `mission_passed` | win | GTA San Andreas Mission Passed (586) | 6.589 | -10.4 | -1.3 | 1.4 | https://www.myinstants.com/en/instant/gta-san-andreas-mission-passed/ |
| `victory_royale` | win | Victory Royale (4,744) | 4.733 | -11.4 | -1.2 | 2.4 | https://www.myinstants.com/en/instant/victory-royale-35710/ |
| `ff_fanfare` | win | Final Fantasy Victory Fanfare (120,268) | 8 | -10.2 | -1 | 1.2 | https://www.myinstants.com/en/instant/final-fantasy-victory-fanfare/ |
| `rizz` | escape | rizz sound effect (2,383,814) | 1.535 | -11.4 | -1.8 | 2.4 | https://www.myinstants.com/en/instant/rizz-sound-effect-54189/ |
| `erm_sigma` | escape | erm what the sigma (382,375) | 1.395 | -13.3 | -1.8 | 4.3 | https://www.myinstants.com/en/instant/erm-what-the-sigma-51754/ |
| `why_running` | escape | Why are you running? (414,818) | 4 | -9.6 | -1.2 | 0.6 | https://www.myinstants.com/en/instant/why-are-you-running-15312/ |
| `emergency_meeting` | ambientFar | Among Us Emergency Meeting (75,778) | 4 | -10.6 | -1.5 | 1.6 | https://www.myinstants.com/en/instant/among-us-emergency-meeting-5844/ |
| `taco_bell` | ambientFar | Taco Bell Bong (1,623,212) | 1.758 | -9.7 | -1.6 | 0.7 | https://www.myinstants.com/en/instant/taco-bell-bong-42481/ |
| `bruh` | ambientFar, poster | BRUH (5,575,023) | 0.57 | -9.5 | -1.3 | 0.5 | https://www.myinstants.com/en/instant/bruh/ |
| `cave_noise` | ambientFar | Minecraft Cave Sound 10 (14,073) | 1.565 | -9.5 | -1.4 | 0.5 | https://www.myinstants.com/en/instant/minecraft-cave-sound-10-16617/ |
| `discord_call` | ambientFar, phone | discord call (1,393,191) | 5 | -9.6 | -1.3 | 0.6 | https://www.myinstants.com/en/instant/discord-call-44910/ |
| `smoke_detector` | ambientFar | Smoke Detector Beep (767,986) | 0.659 | -10.7 | -1.7 | 1.7 | https://www.myinstants.com/en/instant/smoke-detector-beep-97430/ |
| `huh_cat` | poster | Huh Cat (396,862) | 3 | -10.8 | -1.5 | 1.8 | https://www.myinstants.com/en/instant/huh-cat-21280/ |
| `dog_doin` | poster | what da dog doin (776,592) | 1.115 | -9.9 | -1.3 | 0.9 | https://www.myinstants.com/en/instant/what-da-dog-doin-35890/ |
| `owen_wow` | poster | Owen Wilson Wow (109,845) | 0.523 | -10.1 | -1.6 | 1.1 | https://www.myinstants.com/en/instant/owen-wilson-wow-80640/ |
| `sus` | poster | Amongus Sus (419,444) | 3 | -11.2 | -1.1 | 2.2 | https://www.myinstants.com/en/instant/amongus-sus-74999/ |
| `to_be_continued` | tv | To be Continued (jojo) (1,043,473) | 7 | -10.3 | -1.7 | 1.3 | https://www.myinstants.com/en/instant/to-be-continued-jojo/ |
| `few_moments_later` | tv | SPONGEBOB A FEW MOMENTS LATER (326,848) | 2.162 | -11.8 | -1.3 | 2.8 | https://www.myinstants.com/en/instant/spongebob-a-few-moments-later-/ |
| `curb` | tv | Directed by Robert B Weide (569,847) | 6.309 | -10.2 | -1.1 | 1.2 | https://www.myinstants.com/en/instant/directed-by-robert-b-weide-451/ |
| `brainrot_ringtone` | phone | italian brainrot ringtone (407,605) | 5 | -9.5 | -0.9 | 0.5 | https://www.myinstants.com/en/instant/italian-brainrot-ringtone-99727/ |
| `hello_there` | phone | Hello there- obi Wan (506,282) | 0.816 | -12.3 | -1 | 3.3 | https://www.myinstants.com/en/instant/hello-there-obi-wan-39670/ |
| `mlg_airhorn` | airhorn | MLG AIR HORN!!!!!!!!!!! (1,567,332) | 2.935 | -9.3 | -1.3 | 0.3 | https://www.myinstants.com/en/instant/mlg-air-horn/ |
| `dj_airhorn` | airhorn | DJ Airhorn (533,043) | 2.781 | -9.3 | -1.1 | 0.3 | https://www.myinstants.com/en/instant/dj-airhorn/ |
| `minecraft_drink` | drink | Minecraft drinking sound (248,410) | 1.752 | -10.4 | -1.1 | 1.4 | https://www.myinstants.com/en/instant/minecraft-drinking-sound-35393/ |
| `ka_ching` | vending | Ka-Ching! (199,709) | 2.257 | -11.1 | -1.4 | 2.1 | https://www.myinstants.com/en/instant/ka-ching/ |
| `bing_chilling` | vending | bing chilling (370,741) | 2.489 | -11.6 | -1.4 | 2.6 | https://www.myinstants.com/en/instant/bing-chilling-44511/ |
| `xp_startup` | breaker | Windows XP - Startup Sound (269,862) | 3.735 | -10.1 | -1.7 | 1.1 | https://www.myinstants.com/en/instant/windows-xp-startup-sound-58970/ |
| `inception` | breaker | Inception Button (702,167) | 2.867 | -10.1 | -2 | 1.1 | https://www.myinstants.com/en/instant/inception-button/ |
| `crab_rave` | radio | Crab Rave (159,779) | 8 | -10.9 | -1.3 | 1.9 | https://www.myinstants.com/en/instant/crab-rave-34272/ |
| `elevator_music` | radio | Elevator Music Background (447,714) | 8 | -9.5 | -1.1 | 0.5 | https://www.myinstants.com/en/instant/elevator-music-background-5865/ |

The mp3 URL (`mediaUrl`) and the exact Wayback capture fetched (`archiveUrl`) are in each `manifest.sfx` entry and in `.cache/memes/sounds.json`.

**Categories** (`manifest.memeCategories`): reveal: vine_boom, among_us_reveal, mgs_alert, dun_dun_dun; hit: roblox_oof, metal_pipe, emotional_damage, minecraft_hurt, bonk; death: gta_wasted, mission_failed, coffin_dance, xp_shutdown; collect: sheesh, anime_wow, yippee, zelda_item; win: mission_passed, victory_royale, ff_fanfare; ambientFar: emergency_meeting, taco_bell, bruh, cave_noise, discord_call, smoke_detector; poster: vine_boom, bruh, huh_cat, dog_doin, owen_wow, sus; tv: to_be_continued, few_moments_later, curb; phone: discord_call, brainrot_ringtone, hello_there; airhorn: mlg_airhorn, dj_airhorn; drink: minecraft_drink; vending: ka_ching, bing_chilling; breaker: xp_startup, inception; escape: rizz, erm_sigma, why_running; radio: crab_rave, elevator_music.

**Not downloaded:** `yo-phone-lining-56973` ("Yo phone lining") has no Wayback capture (404), so `italian-brainrot-ringtone-99727` replaced it. `vine-boom` and `inception-button` failed with Wayback 500 on the 2026 timestamp and succeeded on a fallback year. Nothing was fabricated. Each file on disk is the archived mp3 for the page title shown.

### Runtime (src/audio/AudioSystem.js)

- `audio.meme(nameOrCategory, { x, z, y, gain, far })` picks a random clip from the category, never the previous one, and prefers clips that are already decoded. It also accepts a clip id directly. With `x`/`z` it plays on one of 6 pooled positional voices (equal-power panner, inverse model, ref 3 m, rolloff 0.9). Without them it plays on one of 4 pooled 2D voices. It returns the clip id, or null while paused, muted or before the manifest is known.
- Buses and gains: reveal, hit, death, win, escape and airhorn go to the `sudden` bus (airhorn x1.15, escape x0.95). collect, poster, tv, phone, radio, drink, vending and breaker go to `interaction`. ambientFar goes to `ambience`.
- **ambientFar:** placed 18-32 m away at a random bearing when no position is given. Lowpass at `max(380, 1600 - 35 x distance)` Hz, rolloff 0.5 so it carries, and a 0.3 send into a shared 2.2 s dark-room convolver. Playback rate 0.90-0.98, to sound slightly wrong.
- **Decoding:** `preload()` remembers the manifest. After the first enemy clip, the core set (reveal, hit, death, collect, escape, airhorn, ambientFar: 28 clips) decodes 3 at a time. Other categories decode on first use, together with the rest of their category, and the requested clip still plays if it is ready within 0.8 s.
- `audio.beacon(id, x, z)` / `audio.beaconStop(id)`: up to 4 pooled looping voices through HRTF panners (ref 2 m, rolloff 1.0) on the ambience bus. The loop is a procedural 2 s buffer from `synth.js`: tape hiss with flutter, a thin 60 Hz hum, and a 90 ms 880 Hz locator blip once a second, phase-offset per beacon. Gain is 0.45, with a lowpass (9 kHz, or 900 Hz behind walls, re-checked every 0.3 s). Calling it again with the same id moves the beacon. A 5th beacon replaces the farthest one only if it is nearer. `stopAll()` releases every meme voice and beacon, and discards pending lazy plays. Pause and mute suspend the context, as before.
- **Headless check** (`node test/harness.mjs audio-meme --query=nodirector:1`, analysers only, Chrome muted):
  - 28 core clips decode after Start.
  - Category peaks on their bus: -6 to -12 dBFS.
  - 24 picks from `hit` have 0 immediate repeats and cover 5 distinct clips.
  - The same airhorn is 19.2 dB quieter at 30 m than at 2 m.
  - Taco Bell at 24 m: -22 dBFS vs -15 dBFS dry at 2 m, and its energy above 1.5 kHz drops from -10.7 dB to -30.6 dB of the total (measured on the voice).
  - A lazy radio clip decodes and plays.
  - A beacon at 2 m reads -33 dBFS on the ambience bus against -60 dBFS without it.
  - Pause and mute suspend the context; `stopAll` leaves 0 beacons and 0 meme voices playing.
  - None of this was listened to.

### Meme images (imgflip templates)

Each image is the template image of an imgflip meme-template page (`#mtm-img`). The page's `#mtm-title` must contain the expected name before the image is accepted.

| id | template page title | image URL |
|---|---|---|
| `harold` | Hide the Pain Harold Meme Template | https://imgflip.com/s/meme/Hide-the-Pain-Harold.jpg |
| `doge` | Doge Meme Template | https://imgflip.com/s/meme/Doge.jpg |
| `this_is_fine` | This Is Fine Meme Template | https://imgflip.com/s/meme/This-Is-Fine.jpg |
| `stonks` | Stonks Template | https://i.imgflip.com/33g0hy.jpg |
| `trollface` | Troll Face Meme Template | https://imgflip.com/s/meme/Troll-Face.jpg |
| `gigachad` | Giga Chad Template | https://i.imgflip.com/35bdwf.jpg |
| `surprised_pikachu` | Surprised Pikachu Meme Template | https://imgflip.com/s/meme/Surprised-Pikachu.jpg |
| `among_us` | Among Us Template | https://i.imgflip.com/4cvs8e.png |
| `drake` | Drake Hotline Bling Meme Template | https://imgflip.com/s/meme/Drake-Hotline-Bling.jpg |
| `rollsafe` | Roll Safe Think About It Meme Template | https://imgflip.com/s/meme/Roll-Safe-Think-About-It.jpg |
| `cat_yell` | Woman Yelling At Cat Meme Template | https://imgflip.com/s/meme/Woman-Yelling-At-Cat.jpg |
| `distracted` | Distracted Boyfriend Meme Template | https://imgflip.com/s/meme/Distracted-Boyfriend.jpg |
| `impostor` | There is 1 imposter among us Template | https://i.imgflip.com/4doeb3.png |
| `disaster_girl` | Disaster Girl Meme Template | https://imgflip.com/s/meme/Disaster-Girl.jpg |
| `monkey_puppet` | Monkey Puppet Meme Template | https://imgflip.com/s/meme/Monkey-Puppet.jpg |

Stonks, Gigachad and Among Us are not stock templates, so they come from user templates (`187184518/Stonks`, `190327839/Giga-Chad`, `263503022/Among-Us`), chosen after viewing a contact sheet of the candidates. Wojak was skipped because the only candidate was an odd variant.

### Poster atlas `img/posters.webp`

4 x 4 cells of 256x356 (aspect 0.7191), WebP q80, 269,298 B. Built by `scripts/meme_atlas.py`. Cells, left to right and top to bottom (the full `source` string for each is in `manifest.posters.cells`):

0. **meme**: such hallway very moist. wow.
1. **meme**: almond water futures: stonks
2. **meme**: this is fine
3. **meme**: 0 days since last noclip
4. **meme**: average level 0 enjoyer
5. **meme**: problem, wanderer?
6. **meme**: the hallway had another hallway
7. **meme**: when the cutout is sus
8. **meme**: Leaving the Backrooms? Nah. One more hallway? Yeah.
9. **generated**: Employee of the Month: nobody (again). Month: ongoing.
10. **generated**: Have you seen this man? Answers to: Kevin.
11. **generated**: Stay hydrated. It is probably fine.
12. **generated**: M.E.G. safety notice: do not make eye contact with the PNG.
13. **generated**: Caution: moist carpet. Do not ask why.
14. **generated**: Level 0 is not a vibe.
15. **original**: WANTED for loitering in Level 0. Reward: 3 almond water.

The meme posters are the template on paper, with an Impact caption band (top text on some), tape corners and light grain. Captions are original jokes. The generated posters come from `public/assets/gen/posters/` (gpt-image via mchat, see `gen/README.md`; read-only for this script). Employee of the Month gets the Kanye cutout in its empty gold frame (x 142-378, y 188-452 at 512 px). Have You Seen This Man gets a photocopied grey Trump cutout over the silhouette. The WANTED poster is composed from all three cutouts in sepia. Fonts are macOS system Impact, Arial Black and Arial Bold; on another OS, PIL falls back to its default font.

### TV atlas `img/tv.webp`

3 x 3 cells of 256x192 (4:3), WebP q80, 60,532 B. Channels: 0 PLEASE STAND BY. M.E.G. emergency broadcast.; 1 Distracted boyfriend: you, the exit sign, almond water.; 2 This is fine.; 3 Can't get caught if you never stop running.; 4 Woman yelling at cat (reruns).; 5 There is 1 impostor among us.; 6 *looks away from the cutout*; 7 Somebody touched the breaker.; 8 To be continued.... Channel 0 is an original SMPTE-style "PLEASE STAND BY" card and channel 8 an original sepia "TO BE CONTINUED" freeze. The rest are imgflip template stills cropped to 4:3, with caption areas cropped away.

### UI font

Monocraft v4.2.1 (Idrees Hassan, SIL OFL 1.1; license at `public/assets/fonts/Monocraft-OFL.txt`) from the GitHub release `Monocraft-ttf.zip`. Regular and Bold are subset with fontTools `pyftsubset` to Basic Latin, Latin-1 and a few symbols (quotes, ellipsis, bullet, arrows, triangles), ligatures dropped, woff2 (3.0 KB + 10.1 KB). The Python `brotli` module was installed for the woff2 step. The font has no check mark glyph, so checkboxes use the generated icon atlas.


## v3 additions: task and meme-prop sounds, more posters/TV, generated textures (2026-09-27)

Same pipeline and processing as the v2 section. Now 72 clips (1.85 MB).

### New clips (25)

| id | categories | page title (views) | dur s | LUFS | dBTP | trim dB | source page |
|---|---|---|---|---|---|---|---|
| `feud_ding` | taskOk | Family Feud YES Ding (69,242) | 0.865 | -9.4 | -1.8 | 0.4 | https://www.myinstants.com/en/instant/family-feud-yes-ding-24818/ |
| `card_deny` | taskFail | among us card swipe deny (7,847) | 0.209 | -10.96 | -1.5 | 1.96 | https://www.myinstants.com/en/instant/among-us-card-swipe-deny-27349/ |
| `wrong_buzzer` | taskFail | Extremely loud incorrect buzzer (290,473) | 1.01 | -9.4 | -1.9 | 0.4 | https://www.myinstants.com/en/instant/extremely-loud-incorrect-buzzer-43033/ |
| `spongebob_fail` | taskFail | SpongeBob Fail (2,661,215) | 3 | -9.5 | -1.4 | 0.5 | https://www.myinstants.com/en/instant/spongebob-fail-11236/ |
| `mc_click` | taskStart | Minecraft Click (364,751) | 0.077 | -16.75 | -1.9 | 7.75 | https://www.myinstants.com/en/instant/minecraft-click/ |
| `switch_click` | taskStart | Nintendo Switch Click (98,966) | 0.333 | -17.92 | -2.5 | 8.92 | https://www.myinstants.com/en/instant/nintendo-switch-click-69023/ |
| `card_accept` | task:cardSwipe, taskOk | Among Us Card Accept (654) | 0.295 | -12.19 | -1.6 | 3.19 | https://www.myinstants.com/en/instant/among-us-card-accept-47667/ |
| `microwave` | task:microwave | Microwave Be Like (1,653) | 5.4 | -9.4 | -1.4 | 0.4 | https://www.myinstants.com/en/instant/microwave-be-like-67793/ |
| `toilet_flush` | task:skibidi | Toilet Flush (38,006) | 5 | -9.7 | -1.6 | 0.7 | https://www.myinstants.com/en/instant/toilet-flush-95497/ |
| `skibidi_bop` | task:skibidi, meme:skibidi | skibidi bop mm dada (39,903) | 1.713 | -10.3 | -2 | 1.3 | https://www.myinstants.com/en/instant/skibidi-bop-mm-dada-20297/ |
| `it_crowd` | task:router | Have you tried turning it off and on again? (2,226) | 1.607 | -11.8 | -1.6 | 2.8 | https://www.myinstants.com/en/instant/have-you-tried-turning-it-off-and-on-again-88847/ |
| `printer` | task:copier | Printer Sound (1,966) | 6 | -11.8 | -1 | 2.8 | https://www.myinstants.com/en/instant/printer-sound-37760/ |
| `squidward_walk` | task:mop | squidward walking sound (206,468) | 3.189 | -14.6 | -1 | 5.6 | https://www.myinstants.com/en/instant/squidward-walking-sound-11310/ |
| `mc_block` | task:touchGrass, meme:grassBlock | Minecraft block (3,324) | 0.282 | -12.49 | -1.6 | 3.49 | https://www.myinstants.com/en/instant/minecraft-block-46061/ |
| `grimace_shake` | meme:grimace | Grimace Shake (248) | 5 | -10.5 | -1.2 | 1.5 | https://www.myinstants.com/en/instant/grimace-shake-74353/ |
| `among_us_drip` | meme:crewmate | Among us (742,372) | 3.754 | -10.5 | -1.4 | 1.5 | https://www.myinstants.com/en/instant/among-us-35001/ |
| `only_in_ohio` | meme:ohio | Only in ohio (2,267) | 4 | -10.5 | -0.5 | 1.5 | https://www.myinstants.com/en/instant/only-in-ohio-68247/ |
| `ohio_ahh` | meme:ohio | Ohio ahh sound effect (52,358) | 4 | -10.6 | -1.6 | 1.6 | https://www.myinstants.com/en/instant/ohio-ahh-sound-effect-42027/ |
| `chill_guy` | meme:chillGuy | CHILL GUY (161,092) | 6 | -9.5 | -1.4 | 0.5 | https://www.myinstants.com/en/instant/chill-guy-14363/ |
| `swamp` | meme:shrek | WHAT ARE YOU DOING IN MY SWAMP (393,818) | 2.841 | -10.6 | -1.8 | 1.6 | https://www.myinstants.com/en/instant/what-are-you-doing-in-my-swamp/ |
| `big_chungus` | meme:chungus | Big Chungus (5,652) | 6 | -11.9 | -1.3 | 2.9 | https://www.myinstants.com/en/instant/big-chungus-81422/ |
| `trololo` | meme:trollface | Trololo (421,577) | 6 | -11 | -2.6 | 2 | https://www.myinstants.com/en/instant/trololo/ |
| `homer_nerd` | meme:nerd | NERD!! (9,930) | 3 | -9.5 | -1.4 | 0.5 | https://www.myinstants.com/en/instant/nerd/ |
| `fanum_brainrot` | meme:fanumTax | FANUM EXPLOSION (574) | 5 | -10.8 | -1 | 1.8 | https://www.myinstants.com/en/instant/fanum-explosion-395/ |
| `no_more_skibidi` | meme:skibidi | my mommy said no more skibidi toilet (345,758) | 4 | -9.9 | -1.4 | 0.9 | https://www.myinstants.com/en/instant/my-mommy-said-no-more-skibidi-toilet-45304/ |

**New categories:** `taskStart`, `taskOk`, `taskFail`, `task:<kind>` for task-specific sounds, and `meme:<kind>` for props. The full lists are in `manifest.memeCategories`. Existing clips joined some of them: xp_startup is also task:router; metal_pipe and bonk are task:vendingStuck; bonk and owen_wow are meme:doge; sus and among_us_reveal are meme:sus; erm_sigma and minecraft_drink are meme:prime; owen_wow and minecraft_drink are meme:stanley.

**Windows:**
- Microwave: the source is a 240 Hz "mmmm" for 5 s, then 1.95 kHz beeps once a second (FFT-checked). The window is 2.2-7.6 s: about 3 s of mmmm, then three beeps.
- Grimace Shake: taken from 25.4 s, where the source gets loud.
- Long songs (Big Chungus, Trololo, chill guy) are capped at 6 s.

**Not downloaded, nothing fabricated:**
- The Among Us "task complete" sound: none of the three myinstants uploads has an archived mp3. A CDX search of every archived myinstants media file with "among" or "task" in its name found no match. `taskOk` uses the Among Us card-accept chime and the Family Feud ding instead.
- The "nerd emoji" and "nerd face" mp3s: not archived. meme:nerd uses "NERD!!".
- "Hydrate! - Robin Williams": not archived. meme:prime and meme:stanley reuse existing clips.
- The long "skibidi toilet sigma fanum tax only in ohio" mp3: not archived. meme:fanumTax uses "FANUM EXPLOSION".
- The Minecraft grass-walking page served a non-audio file, so `minecraft-block` replaced it. The fetch now rejects anything that does not probe as audio.

**Runtime:**
- Categories containing a colon play on the `interaction` bus. `taskOk` and `taskFail` play on `sudden`, `taskStart` on `interaction`.
- An unknown `meme:<kind>` falls back to `poster` and an unknown `task:<kind>` to `taskStart`.
- taskStart, taskOk and taskFail joined the core preload.
- Headless check: each new category measured -14 to -19 dBFS at 2 m, and both fallbacks played.

### More posters and TV

- `posters.webp` is now 4 x 6 cells. The first 16 cells are unchanged, so existing indices hold.
  - Cells 16-18 are imgflip templates with captions: Sad Pablo Escobar, Is This A Pigeon, and Bernie ("i am once again asking you to do your tasks").
  - Cells 19-23 are generated posters from `public/assets/ui-gen/posters/`: touch grass, work order, off and on again, microwave rules, wet floor / skill issue.
  - The atlas is WebP q72, 301,760 B.
- `tv.webp` is now 4 x 3 (12 channels). New: Left Exit 12, Evil Kermit, Two Buttons (bottom half). 74,234 B.
- New template sources:
  - `sad_pablo`: "Sad Pablo Escobar Meme Template", https://imgflip.com/s/meme/Sad-Pablo-Escobar.jpg
  - `pigeon`: "Is This A Pigeon Meme Template", https://imgflip.com/s/meme/Is-This-A-Pigeon.jpg
  - `bernie`: "Bernie I Am Once Again Asking For Your Support Meme Template", https://imgflip.com/s/meme/Bernie-I-Am-Once-Again-Asking-For-Your-Support.jpg
  - `left_exit`: "Left Exit 12 Off Ramp Meme Template", https://imgflip.com/s/meme/Left-Exit-12-Off-Ramp.jpg
  - `evil_kermit`: "Evil Kermit Meme Template", https://imgflip.com/s/meme/Evil-Kermit.jpg
  - `two_buttons`: "Two Buttons Meme Template", https://imgflip.com/s/meme/Two-Buttons.jpg

### Generated meme textures (`public/assets/ui-gen/`, `manifest.memeTextures`)

- Made with gpt-image-2 through mchat. Prompts, returned sizes and latency are in `public/assets/ui-gen/README.md`; raws and the run log are in `.cache/ui-gen-raw/`.
- `scripts/ui_gen_post.py` post-processes them. The atlas stage of `fetch-memes.mjs` runs it and writes `manifest.memeTextures`.
- Props, each `{ image, w, h, alpha, aspect }`:
  - `sign_ohio`: green highway sign, "ONLY IN OHIO / NEXT EXIT: NONE"
  - `note_fanum_tax`: sticky note, "this fridge is taxed 30%"
  - `label_hydrate`: "HYDRATE OR DIEDRATE" bottle label
  - `sign_nerd`: "UM, ACTUALLY" with a nerd emoji face
  - `decal_sus`: red "SUS" graffiti with a bean doodle
- All are original generations. The bean doodle only nods to Among Us.

## v4: Sigma Boy party track (2026-09-28)

User request: "add something which if I interact it plays the sigma sigma boy ... have a party mode". Built with `node scripts/fetch-memes.mjs --party` (helpers: `scripts/party_audio.py` for locate / splice / beat fit, `scripts/audio_tools.py` for tempo, align, onset, limiter stats). Downloads are cached in `.cache/memes/party/`, together with `source.json`, which records every URL, title and tag. Outputs: `public/assets/audio/sigma.mp3` and `manifest.party`. The stage also writes `manifest.memeCategories.party` for stingers (existing clips `erm_sigma`, `mlg_airhorn`, `dj_airhorn`, with no re-processing). Re-running the stage produces the same bytes.

**Rights:** "Sigma Boy" (Сигма Бой) by Betsy and Maria Yankovskaya, 2024, is a commercial recording. The archive.org copy is a user upload of that release (its tags say it was converted from a streaming service), not a licensed source. That is fine for this private meme project, but clear it before shipping anywhere public.

### Source and verification

- **Why not myinstants:** every Sigma Boy instant on myinstants is a short clip. The canonical page is `sigma boy` (209,364 views): a 6.93 s chorus clip. Of the others checked, `Sigma Boy (Сигма Бой)` is 29 s but a different edit that does not align with the release (flux correlation 0.09), and `sigma boy bass boost` is 7.6 s and polarity-inverted. Too short for a ~35 s party, so the myinstants clip is used only as the reference.
- **Full track:** archive.org item [`sigma-boy`](https://archive.org/details/sigma-boy) ("Sigma Boy", creator "betsy", uploaded 2024-12-16), file `Sigma Boy.mp3` (134.43 s, 320 kbps stereo, 5,496,053 B). File tags: title "Sigma Boy - Сигма Бой", artist "Betsy/Мария Янковская", date 2024. The script checks the item's title and creator and the file's title and artist tags before accepting it. A second upload (item `sigmaboy`, 140 kbps, tags "Betsy, Мария Янковская - Сигма Бой (official Audio)") is the same 134.5 s track. It was not used.
- **Same recording, chorus located:** the myinstants reference clip (read through its Wayback capture `web.archive.org/web/20260107114905id_/https://www.myinstants.com/media/sounds/sigma-boy.mp3`, page title "sigma boy") is found inside the full track at **17.742 s** with waveform correlation **0.997**. That proves the upload is the same recording and pins the "sigma sigma boy, sigma boy, sigma boy" hook.
- **Structure (measured):** tempo **125.0 BPM** (bar 1.92 s), first chorus downbeat at 17.788 s. The hook repeats on an exact bar grid: chorus 1 at 17.74 and 33.10 s, final chorus at 98.38 and 113.74 s (exactly 42 bars later). The intro is quiet (about -15 dB RMS) until a pre-drop sub hit on beat 3 of the bar before the chorus.

### The edit (35.04 s)

2 beats of pickup (so the sub hit lands at 0.24 s and the hook drops at 0.98 s), then chorus 1 bars 1-8, then a splice into the final chorus bars 9-16 plus the song's real outro. Source windows are 16.808-33.088 s and 113.728-132.488 s. The splice is 60 ms before a downbeat with a 12 ms equal-power crossfade. The B side was phase-refined against the natural continuation (the chorus 1 repeat): lag 0.0 ms, correlation 0.82. The alternatives were worse: a full 16-bar chorus 1 into the final chorus's third hook correlates at only 0.15, and chorus 1 + final chorus + outro runs 49.5 s. The tail is trimmed at -50 dB with a 0.6 s fade.

### Mastering and numbers (EBU R128 on the encoded file)

| | value |
|---|---|
| duration | 35.04 s, stereo, 48 kHz, libmp3lame 96 kbps CBR, 421,056 B |
| loudness | **-10.0 LUFS** integrated in the file + `playbackGainDb` 1.0 in the WebAudio graph = **-9 LUFS** effective; LRA 1.5 LU |
| true peak | **-1.3 dBTP** |
| EQ | HPF 28 Hz, +3 dB low shelf at 60 Hz, +1.5 dB treble at 9 kHz, 16 kHz lowpass |
| bass | energy below 300 Hz 82.4% (source edit) -> 86.2%; crest factor 10.0 -> 9.0 dB |
| limiter | 4x oversampled lookahead, ceiling -3.1 dBFS, max 5.3 dB gain reduction |
| grid | 125 BPM, `firstBeat` 0.02 s, `dropAt` 0.98 s; 65 of 73 beats have an onset peak within 60 ms of the grid, median -6.7 ms, p90 14 ms; decoded file aligns with the encoder input at 0 samples |
| loop | `loopStart` 0.98 / `loopEnd` 31.70 (the 16 chorus bars; the wrap is B-line -> hook, as in the song). Only used with `partyStart({ loop: true })`; by default the track plays once and ends on its outro |

Why -10 and not -9 in the file: the source is already a dense commercial master (-6.4 LUFS with +1.8 dBFS decoded overs, PLR 8.2). The 96 kbps encode adds about 2 dB of inter-sample overshoot to anything this dense, whatever the bitrate, joint stereo or sample rate (all measured). Pushing -9 into the file would mean 3+ dB more limiting. Instead the file stays at PLR 8.7, which is gentler than the original master, and the last 1 dB is applied in the float graph, the same as the meme clips. It is still not bit-crushed: no crusher, no clipper.

### Runtime (src/audio/AudioSystem.js)

`audio.partyStart({ loop, gain, sting })` stops any villain track (`enemyStop(0.3)`), ducks the ambience bus to 0.2, and plays the track 2D on the enemy bus: the same +4 dB-over-slider level as the villains, through the master limiter. `audio.partyStop(fade = 0.8)` fades it out and brings the ambience back. `audio.partyBeat()` returns float beats (0 = first downbeat, 2 = the drop) from the AudioContext clock minus output latency (what is heard), or `null` with no party. `audio.partyTime()` returns seconds into the file, or NaN. The track decodes after the meme core set (`preload()` queues it) or on first use. If it is still decoding, or the game is muted, the beat keeps running on a pause-aware wall clock and the track joins in place once it can play. Pause freezes both clocks. Mute releases the source, and unmute restarts it at the right position. `stopAll()` (restart / death) releases it. Each start gets its own gain node, so a fading old track can never come back up.

Verified headless (`node test/harness.mjs audio-party --tag=audio --size=640x360 --query=nodirector:1`, muted Chrome, analysers only):
- villain -2.6 dBFS short-term peak, then 0 slots playing after `partyStart`; party -2.3 dBFS; ambience duck 0.207
- beat rate 2.0833/s (125 BPM)
- kick attacks binned by `partyBeat()` phase peak in the first eighth of the beat (27.7 dB contrast, 24 ms output latency compensated)
- pause drift 0; mute releases the source while the beat still advances, and unmute rejoins within 49 ms of the wall clock
- stop and `stopAll` go to digital silence; loop wraps inside 0.98-31.70; with no loop the track ends on its own; 0 live party sources afterwards
