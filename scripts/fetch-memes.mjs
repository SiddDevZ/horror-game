// meme sounds + meme images: download (cached outside public), verify, process into public/assets.
// usage: node scripts/fetch-memes.mjs [--sounds] [--images] [--atlas] [--party] [--refetch] [--only=id,id]
//        no stage flag = all four stages. --party builds audio/sigma.mp3 + manifest.party (v4 jukebox).
// sounds: myinstants.com is behind a cloudflare challenge for scripted clients, so every page and mp3 is read
// through its wayback machine capture (web.archive.org). each entry's archived page title must match `expect`
// before the mp3 is accepted; the page title, view count and both urls are recorded in the manifest.
// images: imgflip template images (i.imgflip.com) and wikimedia commons, recorded the same way.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FF = process.env.FFMPEG_DIR || '/opt/homebrew/bin';
const ffmpeg = join(FF, 'ffmpeg');
const PY = process.env.PYTHON || 'python3';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const only = args.only ? args.only.split(',') : null;
const allStages = !args.sounds && !args.images && !args.atlas && !args.party;
const CACHE = join(root, '.cache/memes');
const WORK = join(tmpdir(), 'br-memes-work');
const OUT = join(root, 'public/assets');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const MI = 'https://www.myinstants.com';
const WB_YEARS = ['2026', '2025', '2024'];

// ---------- the list ----------
// id: file name. slug: myinstants instant page. expect: archived page title must match. cats: memeCategories.
// max: seconds kept after the leading silence trim (longer clips get a 0.2 s fade out). from: skip seconds first.
const SOUNDS = [
  // reveal: villain spotted
  { id: 'vine_boom', slug: 'vine-boom-sound-70972', expect: /vine boom/i, cats: ['reveal', 'poster'] },
  { id: 'among_us_reveal', slug: 'among-us-role-reveal-sound-34956', expect: /among us role reveal/i, cats: ['reveal', 'meme:sus'], max: 4 },
  { id: 'mgs_alert', slug: 'metal-gear-solid-alert', expect: /metal gear solid alert/i, cats: ['reveal'] },
  { id: 'dun_dun_dun', slug: 'dun-dun-dunnnnnnnn-68584', expect: /dun dun dun/i, cats: ['reveal'], max: 4 },
  // hit: you got hurt
  { id: 'roblox_oof', slug: 'roblox-oof', expect: /roblox oof/i, cats: ['hit'] },
  { id: 'metal_pipe', slug: 'jixaw-metal-pipe-falling-sound-28270', expect: /metal pipe/i, cats: ['hit', 'task:vendingStuck'], max: 3 },
  { id: 'emotional_damage', slug: 'emotional-damage-99808', expect: /emotional.damage/i, cats: ['hit'], max: 3 },
  { id: 'minecraft_hurt', slug: 'minecraft-hurt', expect: /minecraft hurt/i, cats: ['hit'] },
  { id: 'bonk', slug: 'doge-bonk-84044', expect: /bonk/i, cats: ['hit', 'task:vendingStuck', 'meme:doge'], max: 2.5 },
  // death
  { id: 'gta_wasted', slug: 'gta-v-wasted', expect: /wasted/i, cats: ['death'], max: 6 },
  { id: 'mission_failed', slug: 'mission-failed-we-get-em-next-time-6737', expect: /mission failed/i, cats: ['death'], max: 5 },
  { id: 'coffin_dance', slug: 'coffin-dance-meme-31063', expect: /coffin dance/i, cats: ['death'], max: 7 },
  { id: 'xp_shutdown', slug: 'windows-xp-shutdown', expect: /windows xp shutdown/i, cats: ['death'], max: 5 },
  // collect: tape / pickup
  { id: 'sheesh', slug: 'sheesh', expect: /^sheesh$/i, cats: ['collect'], max: 4 },
  { id: 'anime_wow', slug: 'anime-wow', expect: /^anime wow$/i, cats: ['collect'], max: 3 },
  { id: 'yippee', slug: 'yippee-tbh-93589', expect: /yippee/i, cats: ['collect'], max: 3 },
  { id: 'zelda_item', slug: 'zelda-item-get', expect: /zelda.*item get/i, cats: ['collect'], max: 4 },
  // win
  { id: 'mission_passed', slug: 'gta-san-andreas-mission-passed', expect: /mission passed/i, cats: ['win'], max: 8 },
  { id: 'victory_royale', slug: 'victory-royale-35710', expect: /victory royale/i, cats: ['win'], max: 8 },
  { id: 'ff_fanfare', slug: 'final-fantasy-victory-fanfare', expect: /final fantasy victory fanfare/i, cats: ['win'], max: 8 },
  // escape: you lost them
  { id: 'rizz', slug: 'rizz-sound-effect-54189', expect: /rizz/i, cats: ['escape'], max: 3 },
  { id: 'erm_sigma', slug: 'erm-what-the-sigma-51754', expect: /what the sigma/i, cats: ['escape', 'meme:prime', 'party'], max: 3 },
  { id: 'why_running', slug: 'why-are-you-running-15312', expect: /why are you running/i, cats: ['escape'], max: 4 },
  // ambientFar: distant, muffled, creepy-funny
  { id: 'emergency_meeting', slug: 'among-us-emergency-meeting-5844', expect: /emergency meeting/i, cats: ['ambientFar'], max: 4 },
  { id: 'taco_bell', slug: 'taco-bell-bong-42481', expect: /taco bell bong/i, cats: ['ambientFar'], max: 4 },
  { id: 'bruh', slug: 'bruh', expect: /^bruh$/i, cats: ['ambientFar', 'poster'] },
  { id: 'cave_noise', slug: 'minecraft-cave-sound-10-16617', expect: /minecraft cave sound/i, cats: ['ambientFar'], max: 8 },
  { id: 'discord_call', slug: 'discord-call-44910', expect: /discord call/i, cats: ['ambientFar', 'phone'], max: 5 },
  { id: 'smoke_detector', slug: 'smoke-detector-beep-97430', expect: /smoke detector/i, cats: ['ambientFar'], max: 2 },
  // poster: pressing E on a meme poster
  { id: 'huh_cat', slug: 'huh-cat-21280', expect: /huh cat/i, cats: ['poster'], max: 3 },
  { id: 'dog_doin', slug: 'what-da-dog-doin-35890', expect: /dog doin/i, cats: ['poster'], max: 3 },
  { id: 'owen_wow', slug: 'owen-wilson-wow-80640', expect: /owen wilson wow/i, cats: ['poster', 'meme:doge', 'meme:stanley'], max: 3 },
  { id: 'sus', slug: 'amongus-sus-74999', expect: /sus/i, cats: ['poster', 'meme:sus', 'meme:crewmate'], max: 3 },
  // tv channels
  { id: 'to_be_continued', slug: 'to-be-continued-jojo', expect: /to be continued/i, cats: ['tv'], max: 7 },
  { id: 'few_moments_later', slug: 'spongebob-a-few-moments-later-', expect: /few moments later/i, cats: ['tv'], max: 4 },
  { id: 'curb', slug: 'directed-by-robert-b-weide-451', expect: /robert b weide/i, cats: ['tv'], max: 7 },
  // phone
  { id: 'brainrot_ringtone', slug: 'italian-brainrot-ringtone-99727', expect: /italian brainrot ringtone/i, cats: ['phone'], max: 5 },
  { id: 'hello_there', slug: 'hello-there-obi-wan-39670', expect: /hello there/i, cats: ['phone'], max: 3 },
  // items
  { id: 'mlg_airhorn', slug: 'mlg-air-horn', expect: /mlg air horn/i, cats: ['airhorn', 'party'], max: 3 },
  { id: 'dj_airhorn', slug: 'dj-airhorn', expect: /dj airhorn/i, cats: ['airhorn', 'party'], max: 3 },
  { id: 'minecraft_drink', slug: 'minecraft-drinking-sound-35393', expect: /minecraft drinking/i, cats: ['drink', 'meme:prime', 'meme:stanley'], max: 3 },
  { id: 'ka_ching', slug: 'ka-ching', expect: /ka-ching/i, cats: ['vending'], max: 3 },
  { id: 'bing_chilling', slug: 'bing-chilling-44511', expect: /bing chilling/i, cats: ['vending'], max: 4 },
  { id: 'xp_startup', slug: 'windows-xp-startup-sound-58970', expect: /windows xp.*startup/i, cats: ['breaker', 'task:router'], max: 6 },
  { id: 'inception', slug: 'inception-button', expect: /inception/i, cats: ['breaker'], max: 4 },
  { id: 'crab_rave', slug: 'crab-rave-34272', expect: /crab rave/i, cats: ['radio'], max: 8 },
  { id: 'elevator_music', slug: 'elevator-music-background-5865', expect: /elevator music/i, cats: ['radio'], max: 8 },
  // v3 tasks: start / ok / fail, then per task kind (task:<kind>)
  { id: 'feud_ding', slug: 'family-feud-yes-ding-24818', expect: /family feud/i, cats: ['taskOk'], max: 3 },
  { id: 'card_deny', slug: 'among-us-card-swipe-deny-27349', expect: /card swipe deny/i, cats: ['taskFail'], max: 3 },
  { id: 'wrong_buzzer', slug: 'extremely-loud-incorrect-buzzer-43033', expect: /incorrect buzzer/i, cats: ['taskFail'], max: 2.5 },
  { id: 'spongebob_fail', slug: 'spongebob-fail-11236', expect: /spongebob fail/i, cats: ['taskFail'], max: 3 },
  { id: 'mc_click', slug: 'minecraft-click', expect: /minecraft click/i, cats: ['taskStart'], max: 1 },
  { id: 'switch_click', slug: 'nintendo-switch-click-69023', expect: /switch click/i, cats: ['taskStart'], max: 1.5 },
  { id: 'card_accept', slug: 'among-us-card-accept-47667', expect: /card accept/i, cats: ['task:cardSwipe', 'taskOk'], max: 3 },
  { id: 'microwave', slug: 'microwave-be-like-67793', expect: /microwave be like/i, cats: ['task:microwave'], from: 2.2, max: 5.4 },
  { id: 'toilet_flush', slug: 'toilet-flush-95497', expect: /toilet flush/i, cats: ['task:skibidi'], max: 5 },
  { id: 'skibidi_bop', slug: 'skibidi-bop-mm-dada-20297', expect: /skibidi bop/i, cats: ['task:skibidi', 'meme:skibidi'], max: 4 },
  { id: 'it_crowd', slug: 'have-you-tried-turning-it-off-and-on-again-88847', expect: /turning it off and on again/i, cats: ['task:router'], max: 5 },
  { id: 'printer', slug: 'printer-sound-37760', expect: /printer/i, cats: ['task:copier'], max: 6 },
  { id: 'squidward_walk', slug: 'squidward-walking-sound-11310', expect: /squidward walking/i, cats: ['task:mop'], max: 4 },
  { id: 'mc_block', slug: 'minecraft-block-46061', expect: /minecraft block/i, cats: ['task:touchGrass', 'meme:grassBlock'], max: 3 },
  // v3 meme props (meme:<kind>)
  { id: 'grimace_shake', slug: 'grimace-shake-74353', expect: /grimace shake/i, cats: ['meme:grimace'], from: 25.4, max: 5 },
  { id: 'among_us_drip', slug: 'among-us-35001', expect: /^among us$/i, cats: ['meme:crewmate'], max: 5 },
  { id: 'only_in_ohio', slug: 'only-in-ohio-68247', expect: /only in ohio/i, cats: ['meme:ohio'], max: 4 },
  { id: 'ohio_ahh', slug: 'ohio-ahh-sound-effect-42027', expect: /ohio/i, cats: ['meme:ohio'], max: 4 },
  { id: 'chill_guy', slug: 'chill-guy-14363', expect: /chill guy/i, cats: ['meme:chillGuy'], max: 6 },
  { id: 'swamp', slug: 'what-are-you-doing-in-my-swamp', expect: /my swamp/i, cats: ['meme:shrek'], max: 4 },
  { id: 'big_chungus', slug: 'big-chungus-81422', expect: /big chungus/i, cats: ['meme:chungus'], max: 6 },
  { id: 'trololo', slug: 'trololo', expect: /trololo/i, cats: ['meme:trollface'], max: 6 },
  { id: 'homer_nerd', slug: 'nerd', expect: /nerd/i, cats: ['meme:nerd'], max: 3 },
  { id: 'fanum_brainrot', slug: 'skibidi-toilet-sigma-fanum-tax-only-in-ohio-64631', alts: ['fanum-explosion-395'], expect: /fanum/i, cats: ['meme:fanumTax'], max: 5 },
  { id: 'no_more_skibidi', slug: 'my-mommy-said-no-more-skibidi-toilet-45304', expect: /no more skibidi/i, cats: ['meme:skibidi'], max: 4 },
];
// categories every gameplay call may use: ARCHITECTURE.md v2 + v3 (task kinds and meme props are prefixed)
const CATEGORIES = ['reveal', 'hit', 'death', 'collect', 'win', 'ambientFar', 'poster', 'tv', 'phone', 'airhorn', 'drink', 'vending', 'breaker', 'escape', 'radio',
  'taskStart', 'taskOk', 'taskFail',
  'task:cardSwipe', 'task:microwave', 'task:skibidi', 'task:router', 'task:copier', 'task:mop', 'task:touchGrass', 'task:vendingStuck',
  'meme:prime', 'meme:grimace', 'meme:crewmate', 'meme:grassBlock', 'meme:ohio', 'meme:chillGuy', 'meme:shrek', 'meme:chungus',
  'meme:doge', 'meme:sus', 'meme:trollface', 'meme:stanley', 'meme:nerd', 'meme:fanumTax', 'meme:skibidi',
  'party'];

// file loudness: KEEP IT LOUD. these are integrated targets in the file; the runtime adds per-category gain.
const TARGET_LUFS = -9;
const MAX_TP = -1.0;
const RATE = 32000;
const BITRATE = '64k';

// ---------- helpers ----------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, { binary = false, tries = 4 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(40000) });
      if (r.ok) return { url: r.url, status: r.status, type: r.headers.get('content-type') || '', body: binary ? Buffer.from(await r.arrayBuffer()) : await r.text() };
      last = new Error(`http ${r.status}`);
      if (r.status === 404) break;
    } catch (e) { last = e; }
    await delay(1500 * (i + 1));
  }
  throw new Error(`${url}: ${last?.message || last}`);
}
// wayback capture lookups sometimes 500 for one timestamp; try neighbouring years
async function getWb(path, opts = {}, mode = '') {
  let last;
  for (const y of WB_YEARS) {
    try { return await get(`https://web.archive.org/web/${y}${mode}/${path}`, { ...opts, tries: 2 }); } catch (e) { last = e; }
  }
  throw last;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}
const ff = (a) => {
  try { return execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }); }
  catch (e) { throw new Error(`ffmpeg failed: ${a.join(' ')}\n${e.stderr?.slice(-1200)}`); }
};
const ffReport = (a) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(r.stderr.slice(-1200));
  return r.stderr;
};
const probe = (f) => JSON.parse(execFileSync(join(FF, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', f], { encoding: 'utf8' }));
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const size = (f) => statSync(f).size;
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function loudness(file) {
  const err = ffReport(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const s = err.slice(err.lastIndexOf('Summary:'));
  const num = (re) => { const m = s.match(re); return m ? +m[1] : null; };
  let I = num(/I:\s+(-?[\d.]+) LUFS/);
  const tp = num(/True peak:\s+Peak:\s+(-?[\d.]+)/);
  // clips under ~0.4 s have no gated block: fall back to rms (close enough for a static gain)
  if (I == null || I <= -69) {
    const st = ffReport(['-i', file, '-af', 'astats=metadata=0:measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-']);
    const m = st.match(/RMS level dB:\s+(-?[\d.]+)/);
    I = m ? +m[1] - 0.7 : -30;
  }
  return { I, tp };
}

// ---------- sounds ----------
async function fetchSounds(list) {
  mkdirSync(join(CACHE, 'sfx'), { recursive: true });
  const srcPath = join(CACHE, 'sounds.json');
  const known = existsSync(srcPath) ? JSON.parse(readFileSync(srcPath, 'utf8')) : {};
  const failed = [];
  await pool(list, 5, async (d) => {
    const file = join(CACHE, 'sfx', `${d.id}.mp3`);
    if (!args.refetch && known[d.id] && existsSync(file)) return;
    for (const slug of [d.slug, ...(d.alts || [])]) {
    try {
      const page = await getWb(`${MI}/en/instant/${slug}/`);
      const title = decodeEntities((page.body.match(/<title>([^<]*?) - Instant Sound/) || [])[1] || '');
      const media = (page.body.match(/\/media\/sounds\/[^'"\s]+\.mp3/) || [])[0];
      const views = +((page.body.match(/([\d,]+) views/) || [])[1] || '0').replace(/,/g, '');
      if (!title || !media) throw new Error('archived page has no title/media');
      if (!d.expect.test(title)) throw new Error(`title "${title}" does not match ${d.expect}`);
      const mp3 = await getWb(`${MI}${media}`, { binary: true }, 'id_');
      if (!/audio|mpeg|octet/.test(mp3.type) || mp3.body.length < 1500) throw new Error(`media not audio (${mp3.type}, ${mp3.body.length} B)`);
      writeFileSync(file, mp3.body);
      const p = probe(file);
      if (!p.streams?.length || !(+p.format.duration > 0.05) || !/mp3|aac|vorbis|opus|pcm|flac/.test(p.streams[0].codec_name || '')) throw new Error('media does not decode as audio');
      known[d.id] = {
        title, views, sourceUrl: `${MI}/en/instant/${slug}/`, mediaUrl: `${MI}${media}`,
        archivePage: page.url, archiveMedia: mp3.url, bytes: mp3.body.length, codec: p.streams[0].codec_name,
        sourceDuration: r3(+p.format.duration), fetchedAt: new Date().toISOString().slice(0, 10),
      };
      console.log(`got ${d.id.padEnd(18)} "${title}" (${views} views) ${r2(+p.format.duration)} s ${mp3.body.length} B${slug !== d.slug ? ` (alternate ${slug})` : ''}`);
      return;
    } catch (e) {
      failed.push(`${d.id} (${slug}): ${e.message}`);
      console.log(`FAIL ${d.id} (${slug}): ${e.message}`);
    }
    }
  });
  writeFileSync(srcPath, JSON.stringify(known, null, 2) + '\n');
  return { known, failed };
}

function processSound(d, src) {
  const inFile = join(CACHE, 'sfx', `${d.id}.mp3`);
  const w = (n) => join(WORK, `${d.id}-${n}.wav`);
  const out = join(OUT, 'sfx', `${d.id}.mp3`);
  // mono float, trim leading/trailing silence, optional window, gentle low cut + bass shelf, fade out
  const trim = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.01,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,areverse';
  ff(['-i', inFile, '-ac', '1', '-ar', '48000', '-af', trim, '-c:a', 'pcm_f32le', w('t')]);
  let dur = +probe(w('t')).format.duration;
  const from = d.from || 0, max = d.max || 6;
  const cut = dur - from > max;
  const len = cut ? max : dur - from;
  const fadeOut = cut ? 0.2 : Math.min(0.03, len * 0.1);
  const chain = [
    `atrim=start=${from}:end=${from + len}`, 'asetpts=N/SR/TB',
    'afade=t=in:d=0.004', `afade=t=out:st=${Math.max(0, len - fadeOut)}:d=${fadeOut}`,
    'highpass=f=40', 'bass=g=3:f=100:w=0.8',
  ].join(',');
  ff(['-i', w('t'), '-af', chain, '-c:a', 'pcm_f32le', w('a')]);
  const pre = loudness(w('a'));
  const gain0 = TARGET_LUFS - pre.I;
  let gainDb = gain0, limit = MAX_TP - 0.6, res;
  for (let pass = 0; pass < 6; pass++) {
    const lim = Math.pow(10, limit / 20).toFixed(5);
    ff(['-i', w('a'), '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${lim}:attack=2:release=40:level=0:latency=1`, '-c:a', 'pcm_f32le', w('b')]);
    ff(['-i', w('b'), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-ac', '1', '-ar', String(RATE), '-c:a', 'libmp3lame', '-b:a', BITRATE, '-write_id3v1', '0', '-id3v2_version', '0', out]);
    res = loudness(out);
    const over = res.tp - MAX_TP, err = res.I - TARGET_LUFS;
    if (over <= 0 && Math.abs(err) <= 0.5) break;
    let changed = false;
    if (over > 0) { limit -= over + 0.1; changed = true; }
    // very dynamic clips stop at 8 dB of extra drive into the limiter rather than being crushed flat
    const next = Math.max(gain0 - 6, Math.min(gain0 + 8, gainDb - err));
    if (Math.abs(err) > 0.5 && Math.abs(next - gainDb) > 0.05) { gainDb = next; changed = true; }
    if (!changed) break;
  }
  res.I = r2(res.I);
  const duration = r3(+probe(out).format.duration);
  return {
    file: `sfx/${d.id}.mp3`, duration, categories: d.cats,
    gainDb: r2(gainDb), lufs: res.I, truePeak: res.tp, playbackGainDb: r2(Math.max(0, TARGET_LUFS - res.I)), bytes: size(out),
    source: `myinstants: "${src.title}"`, sourceUrl: src.sourceUrl, mediaUrl: src.mediaUrl, archiveUrl: src.archiveMedia, views: src.views,
    sourceDuration: src.sourceDuration, window: [r3(from), r3(from + len)], trimmed: cut,
  };
}

async function soundsStage() {
  const list = only ? SOUNDS.filter((d) => only.includes(d.id)) : SOUNDS;
  const { known, failed } = await fetchSounds(list);
  mkdirSync(join(OUT, 'sfx'), { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const man = readManifest();
  const sfx = { ...(man.sfx || {}) };
  for (const d of list) {
    if (!known[d.id] || !existsSync(join(CACHE, 'sfx', `${d.id}.mp3`))) continue;
    try {
      sfx[d.id] = processSound(d, known[d.id]);
      const s = sfx[d.id];
      console.log(`sfx ${d.id.padEnd(18)} ${String(s.duration).padStart(6)} s  ${s.lufs} LUFS  ${s.truePeak} dBTP  ${s.bytes} B  [${d.cats.join(',')}]`);
    } catch (e) { failed.push(`${d.id}: process ${e.message.split('\n')[0]}`); console.log('FAIL process', d.id, e.message.slice(0, 300)); }
  }
  // keep only ids still in the list, in list order
  const ordered = {};
  for (const d of SOUNDS) if (sfx[d.id]) ordered[d.id] = sfx[d.id];
  const cats = {};
  for (const c of CATEGORIES) cats[c] = [];
  for (const d of SOUNDS) if (ordered[d.id]) for (const c of d.cats) cats[c].push(d.id);
  man.sfx = ordered;
  man.memeCategories = cats;
  man.sfxMeta = { targetLufs: TARGET_LUFS, maxTruePeak: MAX_TP, rate: RATE, bitrate: BITRATE, processing: 'mono, silence trim -48/-50 dB, window + fades, highpass 40 Hz, +3 dB bass shelf @ 100 Hz, static gain to target, lookahead limiter, libmp3lame CBR; playbackGainDb makes up any shortfall in the float graph' };
  writeManifest(man);
  const empty = CATEGORIES.filter((c) => !cats[c].length);
  console.log(`sounds: ${Object.keys(ordered).length} clips, ${Object.values(ordered).reduce((a, s) => a + s.bytes, 0)} B total${empty.length ? `, EMPTY categories: ${empty.join(',')}` : ''}`);
  if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
}

// ---------- images ----------
// meme stills for posters and tv: imgflip blank-template pages. the page's #mtm-title must name the meme and
// #mtm-img is the exact image downloaded (stock templates live at /s/meme/, user templates at i.imgflip.com).
const IMAGES = [
  { id: 'doge', tpl: 'Doge', expect: 'Doge' },
  { id: 'stonks', tpl: '187184518/Stonks', expect: 'Stonks' },
  { id: 'this_is_fine', tpl: 'This-Is-Fine', expect: 'This Is Fine' },
  { id: 'harold', tpl: 'Hide-the-Pain-Harold', expect: 'Hide the Pain Harold' },
  { id: 'gigachad', tpl: '190327839/Giga-Chad', expect: 'Giga Chad' },
  { id: 'trollface', tpl: 'Troll-Face', expect: 'Troll Face' },
  { id: 'surprised_pikachu', tpl: 'Surprised-Pikachu', expect: 'Surprised Pikachu' },
  { id: 'among_us', tpl: '263503022/Among-Us', expect: 'Among Us' },
  { id: 'drake', tpl: 'Drake-Hotline-Bling', expect: 'Drake Hotline Bling' },
  { id: 'distracted', tpl: 'Distracted-Boyfriend', expect: 'Distracted Boyfriend' },
  { id: 'rollsafe', tpl: 'Roll-Safe-Think-About-It', expect: 'Roll Safe' },
  { id: 'cat_yell', tpl: 'Woman-Yelling-At-Cat', expect: 'Woman Yelling At Cat' },
  { id: 'impostor', tpl: '264837999/There-is-1-imposter-among-us', expect: 'imposter among us' },
  { id: 'monkey_puppet', tpl: 'Monkey-Puppet', expect: 'Monkey Puppet' },
  { id: 'disaster_girl', tpl: 'Disaster-Girl', expect: 'Disaster Girl' },
  // v3 additions
  { id: 'sad_pablo', tpl: 'Sad-Pablo-Escobar', expect: 'Sad Pablo Escobar' },
  { id: 'pigeon', tpl: 'Is-This-A-Pigeon', expect: 'Is This A Pigeon' },
  { id: 'bernie', tpl: 'Bernie-I-Am-Once-Again-Asking-For-Your-Support', expect: 'Bernie I Am Once Again' },
  { id: 'left_exit', tpl: 'Left-Exit-12-Off-Ramp', expect: 'Left Exit 12' },
  { id: 'evil_kermit', tpl: 'Evil-Kermit', expect: 'Evil Kermit' },
  { id: 'two_buttons', tpl: 'Two-Buttons', expect: 'Two Buttons' },
];

async function imagesStage() {
  mkdirSync(join(CACHE, 'img'), { recursive: true });
  const srcPath = join(CACHE, 'images.json');
  const known = existsSync(srcPath) ? JSON.parse(readFileSync(srcPath, 'utf8')) : {};
  const failed = [];
  await pool(IMAGES.filter((d) => !only || only.includes(d.id)), 4, async (d) => {
    if (!args.refetch && known[d.id] && existsSync(join(CACHE, 'img', known[d.id].file))) return;
    try {
      const pageUrl = `https://imgflip.com/memetemplate/${d.tpl}`;
      const page = await get(pageUrl);
      const title = decodeEntities((page.body.match(/id="mtm-title">([^<]*)/) || [])[1] || '');
      let src = (page.body.match(/id="mtm-img"[^>]*src="([^"]+)"/) || [])[1];
      if (!title.toLowerCase().includes(d.expect.toLowerCase())) throw new Error(`template title "${title}" lacks "${d.expect}"`);
      if (!src) throw new Error('no template image on page');
      src = src.startsWith('//') ? `https:${src}` : src.startsWith('/') ? `https://imgflip.com${src}` : src;
      const img = await get(src, { binary: true });
      if (!/image/.test(img.type)) throw new Error(`not an image (${img.type})`);
      const file = `${d.id}.${src.split('.').pop().split('?')[0]}`;
      writeFileSync(join(CACHE, 'img', file), img.body);
      known[d.id] = { title, page: pageUrl, url: src, file, bytes: img.body.length, fetchedAt: new Date().toISOString().slice(0, 10) };
      console.log(`img ${d.id.padEnd(18)} "${title}" ${img.body.length} B`);
    } catch (e) { failed.push(`${d.id}: ${e.message}`); console.log(`FAIL ${d.id}: ${e.message}`); }
  });
  writeFileSync(srcPath, JSON.stringify(known, null, 2) + '\n');
  if (failed.length) console.log('image failures:\n  ' + failed.join('\n  '));
}

function atlasStage() {
  // generated meme textures (gpt-image raws kept in .cache/ui-gen-raw) -> public/assets/ui-gen, before the atlas packs the posters
  let memeTextures = null;
  if (existsSync(join(root, '.cache/ui-gen-raw/jobs.json'))) {
    memeTextures = JSON.parse(execFileSync(PY, [join(root, 'scripts/ui_gen_post.py'), root], { encoding: 'utf8' }).trim().split('\n').pop());
  }
  const res = execFileSync(PY, [join(root, 'scripts/meme_atlas.py'), CACHE, OUT, root, ...(args.debug ? [join(root, 'shots/assets')] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 << 20 });
  const j = JSON.parse(res.trim().split('\n').pop());
  const man = readManifest();
  man.posters = j.posters;
  man.tv = j.tv;
  if (memeTextures) man.memeTextures = memeTextures;
  writeManifest(man);
  console.log(`posters ${j.posters.cols}x${j.posters.rows} (${j.posters.bytes} B), tv ${j.tv.cols}x${j.tv.rows} (${j.tv.bytes} B)`);
}

// ---------- party (v4): sigma boy ----------
// myinstants only has short chorus clips (the canonical "sigma boy" instant is 6.9 s), so the full track comes from a
// public archive.org upload whose metadata and id3 tags must name the song and artist. the myinstants clip is the
// reference: it has to be found inside the full track by waveform correlation, which both proves the upload is the
// same recording and pins the chorus. the edit is bar-aligned on the measured tempo:
//   2 beats of pickup + chorus 1 first half (8 bars) -> the final chorus second half (same bar, 50 bars later) + outro.
const PARTY = {
  item: 'sigma-boy', file: 'Sigma Boy.mp3', expectTitle: /sigma boy/i, expectCreator: /betsy/i,
  expectTagTitle: /sigma boy|сигма бой/i, expectTagArtist: /betsy/i,
  ref: { slug: 'sigma-boy-32341', expect: /^sigma boy$/i },
  bpmRange: [120, 130], leadBeats: 2, firstHalfBars: 8, jumpBars: 42,
  // +3 dB sub shelf on an already bass-heavy master; the 16 kHz lowpass keeps the encoder's own lowpass from ringing over the ceiling
  eq: 'highpass=f=28,bass=g=3:f=60:w=0.7,treble=g=1.5:f=9000,lowpass=f=16000:p=2',
  rate: 48000, bitrate: '96k', lufs: -9, maxTp: -1.0,
  // party mode is capped at 10 s in game, so only this much ships (frame-copied, no re-encode): ~1/3 the download
  gameSeconds: 11,
};

async function partyStage() {
  const dir = join(CACHE, 'party');
  mkdirSync(dir, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const fullMp3 = join(dir, 'sigma-boy-full.mp3'), refMp3 = join(dir, 'sigma-boy-ref.mp3');
  const srcPath = join(dir, 'source.json');
  let src = existsSync(srcPath) && !args.refetch ? JSON.parse(readFileSync(srcPath, 'utf8')) : null;
  if (!src || !existsSync(fullMp3) || !existsSync(refMp3)) {
    // full track: archive.org item metadata + the file's own tags
    const meta = JSON.parse((await get(`https://archive.org/metadata/${PARTY.item}`)).body);
    const md = meta.metadata || {};
    if (!PARTY.expectTitle.test(md.title || '') || !PARTY.expectCreator.test(md.creator || '')) throw new Error(`archive item "${md.title}" by "${md.creator}" does not match`);
    const f = (meta.files || []).find((x) => x.name === PARTY.file);
    if (!f) throw new Error(`archive item has no ${PARTY.file}`);
    const fileUrl = `https://archive.org/download/${PARTY.item}/${encodeURIComponent(PARTY.file)}`;
    const full = await get(fileUrl, { binary: true });
    writeFileSync(fullMp3, full.body);
    const tags = JSON.parse(execFileSync(join(FF, 'ffprobe'), ['-v', 'error', '-show_entries', 'format_tags=title,artist,date', '-of', 'json', fullMp3], { encoding: 'utf8' })).format.tags || {};
    if (!PARTY.expectTagTitle.test(tags.title || '') || !PARTY.expectTagArtist.test(tags.artist || '')) throw new Error(`file tags "${tags.title}" / "${tags.artist}" do not match`);
    // reference chorus clip: myinstants through the wayback machine, same rules as the meme sounds
    const page = await getWb(`${MI}/en/instant/${PARTY.ref.slug}/`);
    const title = decodeEntities((page.body.match(/<title>([^<]*?) - Instant Sound/) || [])[1] || '');
    const media = (page.body.match(/\/media\/sounds\/[^'"\s]+\.mp3/) || [])[0];
    const views = +((page.body.match(/([\d,]+) views/) || [])[1] || '0').replace(/,/g, '');
    if (!PARTY.ref.expect.test(title) || !media) throw new Error(`reference page title "${title}" does not match`);
    const ref = await getWb(`${MI}${media}`, { binary: true }, 'id_');
    writeFileSync(refMp3, ref.body);
    src = {
      archiveItem: `https://archive.org/details/${PARTY.item}`, fileUrl, archiveTitle: md.title, archiveCreator: md.creator, archiveDate: md.date,
      archiveUploaded: md.publicdate, tags, bytes: full.body.length, sourceDuration: r3(+probe(fullMp3).format.duration),
      ref: { title, views, sourceUrl: `${MI}/en/instant/${PARTY.ref.slug}/`, mediaUrl: `${MI}${media}`, archivePage: page.url, archiveMedia: ref.url, bytes: ref.body.length, duration: r3(+probe(refMp3).format.duration) },
      fetchedAt: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(srcPath, JSON.stringify(src, null, 2) + '\n');
  }
  console.log(`party source: "${src.tags.title}" / ${src.tags.artist} (${src.sourceDuration} s), reference "${src.ref.title}" (${src.ref.views} views, ${src.ref.duration} s)`);

  const w = (n) => join(WORK, `party-${n}.wav`);
  const py = (script, a) => JSON.parse(execFileSync(PY, [join(root, 'scripts', script), ...a.map(String)], { encoding: 'utf8' }).trim().split('\n').pop());
  ff(['-i', fullMp3, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', w('mono')]);
  ff(['-i', fullMp3, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', w('stereo')]);
  ff(['-i', refMp3, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', w('ref')]);
  const loc = py('party_audio.py', ['locate', w('mono'), w('ref')]);
  if (loc.waveCorr < 0.8) throw new Error(`reference clip not found in the full track (corr ${loc.waveCorr})`);
  const an = py('audio_tools.py', ['analyze', w('mono'), loc.offset + 0.05, ...PARTY.bpmRange]);
  const anchor = an.onset, beat = 60 / an.bpm, bar = 4 * beat;
  const pre = 0.02;
  const a0 = anchor - PARTY.leadBeats * beat - pre;
  const a1 = anchor + PARTY.firstHalfBars * bar;
  const b0 = a1 + PARTY.jumpBars * bar;
  const sp = py('party_audio.py', ['splice', w('stereo'), w('edit'), JSON.stringify({ a0, a1, b0, fadeIn: 0.004, fadeOut: 0.6 })]);
  if (sp.matchCorr < 0.6) throw new Error(`splice does not line up (corr ${sp.matchCorr})`);
  ff(['-i', w('edit'), '-af', PARTY.eq, '-c:a', 'pcm_f32le', w('eq')]);

  const out = join(OUT, 'audio', 'sigma.mp3');
  mkdirSync(dirname(out), { recursive: true });
  const pre0 = loudness(w('eq'));
  // the source is already a hot master, so this is mostly a trim down; the limiter runs 4x oversampled so it holds
  // inter-sample peaks too, and the ceiling only drops by what the mp3 encode adds back
  const gain0 = PARTY.lufs - pre0.I;
  let gainDb = gain0, limit = PARTY.maxTp - 1.0, res, used;
  for (let pass = 0; pass < 8; pass++) {
    used = { gainDb, limit };
    const lim = Math.pow(10, limit / 20).toFixed(5);
    ff(['-i', w('eq'), '-af', `volume=${gainDb.toFixed(2)}dB,aresample=192000,alimiter=limit=${lim}:attack=1:release=60:level=0:latency=1,aresample=48000`, '-c:a', 'pcm_f32le', w('lim')]);
    ff(['-i', w('lim'), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-ac', '2', '-ar', String(PARTY.rate), '-c:a', 'libmp3lame', '-b:a', PARTY.bitrate, '-write_id3v1', '0', '-id3v2_version', '0', out]);
    res = loudness(out);
    const over = res.tp - PARTY.maxTp, err = res.I - PARTY.lufs;
    if (over <= 0 && Math.abs(err) <= 0.3) break;
    if (over > 0) { limit -= over + 0.1; continue; }
    // at most 1.5 dB of extra drive into the limiter: a banger, not a brick. playbackGainDb makes up the rest
    const next = Math.max(gain0 - 3, Math.min(gain0 + 1.5, gainDb - err));
    if (Math.abs(err) <= 0.3 || Math.abs(next - gainDb) < 0.05) break;
    gainDb = next;
  }
  gainDb = used.gainDb;
  const lra = +((ffReport(['-i', out, '-af', 'ebur128', '-f', 'null', '-']).split('Summary:').pop().match(/LRA:\s+(-?[\d.]+) LU/) || [])[1] ?? NaN);
  const lim = py('audio_tools.py', ['limited', w('eq'), w('lim'), gainDb.toFixed(2)]);
  // the grid measured on the decoded output (encoder delay included)
  ff(['-i', out, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', w('dec')]);
  ff(['-i', w('eq'), '-ac', '1', '-c:a', 'pcm_f32le', w('eqmono')]);
  const align = py('audio_tools.py', ['align', w('eqmono'), w('dec')]);
  const firstBeat = r3(pre + align.offsetMs / 1000);
  const dropAt = r3(firstBeat + PARTY.leadBeats * beat);
  const fit = py('party_audio.py', ['beats', w('dec'), firstBeat, an.bpm]);
  const onset = py('audio_tools.py', ['onset', w('dec'), 0.05]);
  const fullDuration = r3(+probe(out).format.duration);
  ff(['-i', out, '-t', String(PARTY.gameSeconds), '-c:a', 'copy', '-map_metadata', '-1', w('short.mp3')]);
  copyFileSync(w('short.mp3'), out);
  const duration = r3(+probe(out).format.duration);
  const party = {
    audio: 'audio/sigma.mp3',
    source: `archive.org "${src.archiveTitle}" (${src.archiveCreator}); file tags "${src.tags.title}" / ${src.tags.artist}, ${src.tags.date}. Chorus verified against myinstants "${src.ref.title}"`,
    sourceUrl: src.archiveItem, sourceFileUrl: src.fileUrl,
    reference: { title: src.ref.title, views: src.ref.views, sourceUrl: src.ref.sourceUrl, archiveUrl: src.ref.archiveMedia, foundAt: loc.offset, waveCorr: loc.waveCorr },
    duration, bpm: an.bpm, firstBeat, dropAt,
    // one pass through the 16 chorus bars (drop to the start of the outro): a musical loop if the party ever outlasts the file
    loopStart: dropAt, loopEnd: r3(Math.min(dropAt + 16 * bar, duration - 0.05)), fullDuration, shippedSeconds: PARTY.gameSeconds,
    gainDb: r2(gainDb), limiterCeilingDb: r2(used.limit), playbackGainDb: r2(Math.max(0, PARTY.lufs - res.I)), lufs: r2(res.I), truePeak: res.tp, lra,
    onsetAt: onset.onsetAt, onsetThreshold: 0.05,
    edit: { sourceWindows: [[r3(a0), r3(a1 - 0.06)], [r3(sp.b0 - 0.06), r3(sp.b0 - 0.06 + sp.duration - sp.cutAt)]], spliceAt: r3(sp.cutAt), spliceCorr: sp.matchCorr, bars: `${PARTY.leadBeats} beats pickup + chorus 1 bars 1-8 + final chorus bars 9-16 + outro` },
    beatFit: fit, limiter: lim, decodeAlign: align, rate: PARTY.rate, channels: 2, bitrate: PARTY.bitrate, bytes: size(out),
    processing: `stereo 48 kHz float edit (equal-power 12 ms splice, 4 ms fade in, 0.6 s fade out, -50 dB tail trim); ${PARTY.eq}; static gain toward ${PARTY.lufs} LUFS (max +1.5 dB extra drive), 4x oversampled lookahead limiter; libmp3lame ${PARTY.bitrate} CBR joint stereo ${PARTY.rate} Hz`,
  };
  const man = readManifest();
  man.party = party;
  // party stingers reuse existing clips (same ids the sounds stage lists under 'party'); no re-processing needed
  if (man.memeCategories && man.sfx) man.memeCategories.party = SOUNDS.filter((d) => d.cats.includes('party') && man.sfx[d.id]).map((d) => d.id);
  writeManifest(man);
  console.log(`party sigma.mp3 ${duration} s  ${party.lufs} LUFS  ${party.truePeak} dBTP  LRA ${lra}  ${party.bytes} B  bpm ${an.bpm}  firstBeat ${firstBeat}  drop ${dropAt}  loop ${party.loopStart}-${party.loopEnd}`);
  console.log(`  reference at ${loc.offset} s (corr ${loc.waveCorr}), splice corr ${sp.matchCorr}, grid ${JSON.stringify(fit)}, limiter ${JSON.stringify(lim)}, align ${JSON.stringify(align)}`);
}

// ---------- manifest (merge, never drop keys owned by process-assets) ----------
const manifestPath = join(OUT, 'manifest.json');
function readManifest() { return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1, characters: {} }; }
function writeManifest(m) { writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n'); }

if (allStages || args.sounds) await soundsStage();
if (allStages || args.images) await imagesStage();
if (allStages || args.atlas) atlasStage();
if (allStages || args.party) await partyStage();
