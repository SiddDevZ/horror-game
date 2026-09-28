// v4 party mode against the real World + Game: jukebox, villain blasted away, director held (no spawns),
// frame.party beat/intensity, grace, cooldown, early stop, restart / win cleanup. exits non-zero on failure.
import { World } from '../../src/world/World.js';
import { Game } from '../../src/game/Game.js';
import { events } from '../../src/core/events.js';
import { PARTY } from '../../src/game/tuning.js';

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};
const settings = { get: (k) => ({ sensitivity: 1, fov: 74, headBob: 0.6, shake: 0.6, sprintMode: 'hold' })[k], on() {} };
const rec = [];
for (const n of ['party:start', 'party:end', 'toast']) events.on(n, (p) => rec.push([n, p]));
const count = (n) => rec.filter((r) => r[0] === n).length;

const world = new World(1337);
const sp = world.spawnPoint();
world.update(sp.x, sp.z);
const calls = { start: 0, stop: 0 };
const audio = { setListener() {}, enemyStart() {}, enemyUpdate() {}, enemyStop() {}, sfx() {}, setChase() {}, pauseAll() {}, resumeAll() {}, stopAll() {}, meme() {}, beacon() {}, beaconStop() {}, partyStart() { calls.start++; }, partyStop() { calls.stop++; } };
const game = new Game({ world, audio, settings, events, params: { encounterSeed: 41, seed: 1337, autostart: true }, spawn: sp });
game.start();
const p = game.player, e = game.enemy, d = game.director, party = game.party;
const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.update(1 / 60); world.update(p.x, p.z); } };
// answer the call so normal scheduling applies
game.objectives.useFeature(game.objectives.phoneFeature());
game.closeLore();

const jb = party.jukebox;
const jd = Math.hypot(jb.x - sp.x, jb.z - sp.z);
check(!!jb.id && jd >= 6 && jd < 20, `world spawn jukebox ${jb.id} ${jd.toFixed(1)} m from spawn`);
const jf = null;

// the look-at cone finds it and prompts
const jfeat = jf || (() => { for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (const f of world.getChunk(Math.floor(sp.x / 16) + dx, Math.floor(sp.z / 16) + dz).features) if (f.id === jb.id) return f; return null; })();
p.x = p.prevX = jfeat.x - Math.sin(jfeat.yaw || 0) * 1.3; p.z = p.prevZ = jfeat.z - Math.cos(jfeat.yaw || 0) * 1.3;
p.yaw = Math.atan2(-(jfeat.x - p.x), -(jfeat.z - p.z)); p.pitch = Math.atan2(1.0 - 1.68, 1.3);
game.interact._scan();
check(game.interact.kind === 'jukebox' && game.interact._label() === 'E  Press the button', `look-at targets the jukebox: "${game.interact._label()}"`);

// a villain is chasing; the party blasts it away
d.forceEncounter('trump');
let chasing = false;
for (let i = 0; i < 60 * 12 && !chasing; i++) { tick(1); chasing = d.state === 'CHASING'; }
check(chasing && e.active, `trump chasing (${d.state})`);
const hp0 = p.hp, enc0 = d.encounters;
game.interact.use();
const t0 = d.t;
tick(1);
const fIn = { ...game.frame.party };
check(party.active && count('party:start') === 1 && calls.start === 1 && e.mode === 'blast' && d.state === 'EXPLORING', `E starts the party: party:start ${JSON.stringify(rec.find((r) => r[0] === 'party:start')[1])}, villain mode ${e.mode}`);
let goneAt = -1, maxSpin = 0, dist0 = Math.hypot(e.x - p.x, e.z - p.z), distMax = dist0;
for (let i = 0; i < 120 && goneAt < 0; i++) { tick(1); if (!e.active) goneAt = d.t - t0; else { maxSpin = Math.max(maxSpin, e.spin); distMax = Math.max(distMax, Math.hypot(e.x - p.x, e.z - p.z)); } }
const last = d.encountersLog[d.encountersLog.length - 1];
check(goneAt > 0 && goneAt <= 1.5 && p.hp === hp0 && last.result === 'party' && maxSpin > 5 && distMax > dist0 + 3, `villain spun ${maxSpin.toFixed(1)} rad, slid ${(distMax - dist0).toFixed(1)} m away and despawned after ${goneAt.toFixed(2)} s; encounter "${last.result}", hp ${p.hp}/${hp0}`);

// frame.party
const f1 = fIn;
tick(60);
const f2 = { ...game.frame.party };
check(f1.active && f1.intensity > 0 && f1.intensity < 0.1 && f2.intensity === 1 && f2.beat > f1.beat && f2.bpm === PARTY.bpm, `frame.party: fades in (${f1.intensity.toFixed(2)} after one frame, 1 by ${(game.party.t).toFixed(1)} s), beat ${f1.beat.toFixed(2)} -> ${f2.beat.toFixed(2)} over 1 s (${PARTY.bpm} bpm fallback)`);
check(game.interact._label() === 'E  Stop the party', `prompt during the party: "${game.interact._label()}"`);

// nothing spawns while the party runs, summons are refused, timers frozen
d.nextT = 0; d.slowT = 0;
const refused = !d.forceEncounter('kanye') && !d.summon();
p.x = p.prevX = sp.x; p.z = p.prevZ = sp.z; // standing still the whole time
let spawned = 0;
while (party.active) { tick(1); if (e.active) spawned++; }
check(refused && spawned === 0 && d.encounters === enc0 && d.slowT === 0, `party ran its ${party.duration} s: no spawns (${spawned}), summons refused, slow timer frozen (${d.slowT})`);
check(count('party:end') === 1 && party.state === 'grace' && calls.stop === 1 && party.cooldownT > 40, `party:end after ${party.t.toFixed(1)} s, grace ${PARTY.grace} s, cooldown ${party.cooldownT.toFixed(1)} s`);
let fadeOut = 0;
for (let i = 0; i < 60 && game.frame.party.active; i++) { tick(1); fadeOut = i + 1; }
check(!game.frame.party.active && game.frame.party.intensity === 0 && fadeOut / 60 >= 0.5 && fadeOut / 60 <= 0.7, `visuals fade out in ${(fadeOut / 60).toFixed(2)} s`);

// cooldown refuses
const ts = count('toast');
party.use(jfeat);
check(!party.active && count('toast') > ts && /recharging its aura/.test(rec.filter((r) => r[0] === 'toast').slice(-1)[0][1].text) && /recharging/.test(party.label()), `cooldown: "${party.label()}"`);

// user rule (2026-09-28): no grace, the next villain comes straight after the party
let endAt = -1, warnAt = -1;
const g0 = d.t;
for (let i = 0; i < 60 * 10 && warnAt < 0; i++) {
  tick(1);
  if (!party.holds && endAt < 0) endAt = d.t - g0;
  if (!party.holds && (d.state === 'WARNING' || e.active)) warnAt = d.t - g0;
}
check(endAt >= 0 && warnAt >= 0 && warnAt - endAt <= 1.0, `villain comes straight after the party: warning ${(warnAt - endAt).toFixed(2)} s after it ends`);

// the party clock keeps running under a lore card; the end follows the audio clock when it reports one
{
  party.cooldownT = 0;
  if (e.active) d._endEncounter('forced', false);
  party.use(jfeat);
  game.openLore({ title: 'TEST', body: 'x' });
  const pt0 = party.t, dt0 = d.t;
  tick(120);
  check(game.reading && party.t - pt0 > 1.9 && d.t === dt0, `lore card open 2 s: party clock ${pt0.toFixed(2)} -> ${party.t.toFixed(2)} (sim held, director ${dt0.toFixed(2)} -> ${d.t.toFixed(2)})`);
  game.closeLore();
  // audio clock ahead of the sim clock (e.g. a hitch): the song end wins
  audio.partyBeat = () => (PARTY.duration * PARTY.bpm) / 60 + 0.5;
  tick(1);
  check(party.state === 'grace' && party.t < 5, `audio partyBeat past the clip end stops the party at sim t ${party.t.toFixed(2)} s`);
  delete audio.partyBeat;
  audio.partyTime = () => 3;
  party.cooldownT = 0; tick(60 * 6); party.use(jfeat);
  const tRun = party.t;
  for (let i = 0; i < 60 * (PARTY.duration + 2) && party.active; i++) tick(1);
  check(party.active, `audio partyTime stuck at 3 s: the party waits for the song, not the sim clock (${(tRun + PARTY.duration + 2).toFixed(0)} s later still on)`);
  audio.partyTime = () => PARTY.duration;
  tick(1);
  check(party.state === 'grace', 'partyTime reaching the duration ends it');
  delete audio.partyTime;
  party.cooldownT = 0;
  tick(60 * 6);
}

// early stop with E, restart mid-party, win mid-party
party.cooldownT = 0;
if (e.active) { d._endEncounter('forced', false); }
tick(1);
party.use(jfeat);
tick(30);
party.use(jfeat);
const early = rec.filter((r) => r[0] === 'party:end').slice(-1)[0][1];
check(party.state === 'grace' && early.early === true && early.t < 1, `E again ends it early (${JSON.stringify(early)})`);
party.cooldownT = 0;
tick(60 * 6);
party.use(jfeat);
const endsBefore = count('party:end');
game.restart();
check(party.state === 'idle' && party.cooldownT === 0 && !game.frame.party.active && count('party:end') === endsBefore + 1 && party.label() === 'E  Press the button', 'restart ends the party cleanly and clears the cooldown');
party.use(jfeat);
game.win();
check(game.state === 'won' && party.state === 'idle' && count('party:end') === endsBefore + 2, 'win ends the party');

console.log(failed ? `\n${failed} party check(s) failed` : '\nparty: all checks passed');
if (failed) process.exitCode = 1;
