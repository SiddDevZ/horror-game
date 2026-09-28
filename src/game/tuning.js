// gameplay tuning. every number the chase feel depends on lives here.
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

export const PLAYER = {
  walk: 3.0,
  sprint: 7.3, // a touch faster than every villain's top speed
  backMax: 3.0, // backpedal never sprints
  accel: 44, // m/s^2 toward wish velocity
  decel: 38, // m/s^2 with no input
  radius: 0.28,
  strideWalk: 0.9,
  strideRun: 1.45,
  lookSens: 0.0022, // rad per mouse count at sensitivity 1
  fovKick: 3.5, // degrees at full sprint
  bobV: 0.028, // metres at full sprint, scaled by settings.headBob
  bobH: 0.018,
  lookBehindOmega: 13, // spring rate for the 180 look-behind (~0.3 s to settle)
  doorPush: 0.12, // seconds pushing into a closed door before it swings open
};

export const ENEMY = {
  radius: 0.35,
  spriteY: 0.05, // sprite bottom above floor (reference analysis)
  earY: 1.45,
  approachSpeed: 4.6, // WARNING approach before the reveal
  searchMul: 0.74,
  retreatSpeed: 3.4,
  accel: 16,
  decel: 26,
  planInterval: 0.1,
  stunTime: 1.0,
  knockSpeed: 5.5,
};

export const DIRECTOR = {
  firstEncounter: [5.4, 7.2], // legacy (v2): the first encounter is now scheduled around the M.E.G. call
  firstAfterCall: [3, 5], // first kanye warning this long after the briefing card closes (he crashes the call)
  firstNoCall: [24, 27], // ...or this long into the run if the phone is ignored
  sprintEncounter: [12, 20], // measured from escape
  slowSpeed: 4.2, // actual m/s below which the player counts as walking/stopped
  slowTrigger: 4.0, // continuous seconds
  warnMax: 2.0, // forced reveal if the enemy is still unseen
  lurkDist: 9, // unseen enemy stops approaching inside this navigable range
  recovery: 3.0,
  recoveryIntense: 4.5,
  recoveryHurt: 7.0,
  intenseChase: 22, // chase seconds that count as an intense sequence
  protect: 4.5, // seconds of catch immunity after a catch
  maxHp: 16, // 8 hearts, counted in half hearts
  catchDmg: 6, // a catch costs 3 hearts
  escapeHeal: 2, // an escape heals 1 heart
  alcoveHeal: 6, // a recovery alcove heals 3 hearts
  catchDist: 0.72,
  losRange: 30, // enemy cannot "see" beyond this straight-line range
  losHz: 20,
  losGrace: 0.4, // seconds the enemy keeps tracking after losing sight
  escapeNoLos: 2.5,
  escapeSep: 20, // navigable metres
  minChase: 6, // pursuit seconds before any escape can resolve
  searchMax: 5,
  chaseCap: [10, 15], // pursuit budget per encounter; a moving player is let go after this
  slowChaseMax: 35, // a walking/stopped player can be chased longer, but never forever
  reacquireRange: 24,
  spawnMin: 12,
  spawnMax: 20,
  fairLead: 8, // player must reach some far cell this many metres before the enemy
  fairFar: 14,
  navField: 70, // metres covered by distance fields
  sealedRange: 24, // if nothing this far is reachable without passing a closed door, the player is sealed in
  alcoveProtect: 2.5,
  alcoveLimit: 3,
};

// v2 items and interactions
export const ITEMS = {
  reach: 2.6, // metres, horizontal, from the eye
  cone: 0.3, // rad half-angle of the look-at cone, widened by the target's size
  autoPick: 0.85, // walking over a pickup collects it
  almondMax: 3,
  almondHeal: 2, // half hearts (+1 heart)
  drinkTime: 0.9,
  vendingStock: 2,
  coolerStock: 1,
  airhornMax: 3,
  airhornRange: 12,
  airhornStun: 2.5,
  airhornKnock: 12, // m/s initial knockback, decays at 6/s (~2 m)
  airhornTime: 0.6,
  airhornCooldown: 0.9,
};

// v2 objective chain
export const OBJ = {
  tasks: 6, // work orders to finish (the first 5 each send a VHS log)
  taskScan: 4, // chunk radius searched for the nearest incomplete tasks (checklist, compass, beacons)
  breakers: 3,
  breakerRange: [85, 170],
  exitRange: [250, 350],
  exitOpen: 4.5, // a powered exit door opens when the player gets this close
  exitWin: 1.35, // and walking up to it wins
  beaconRange: 45,
  beaconMax: 3,
  noiseHold: 0.5, // chance opening a breaker panel pulls the next encounter in
  noiseDone: 0.85, // chance a finished breaker does
  noiseAirhorn: 0.3,
  noiseDelay: [1.5, 4.0], // seconds until the pulled-in encounter
  harden: 0.7, // objective progress share of director difficulty
  escapeSooner: 0.25, // next encounter after an escape comes up to 25% sooner at full progress
  ambientFar: [40, 80], // seconds between distant meme sounds while exploring
  calm: 0.8, // seconds of calm before a queued lore card opens
};

// v4 party mode (Sigma Boy jukebox)
export const PARTY = {
  duration: 40, // seconds, when manifest.party.duration is missing
  maxDuration: 10, // user: a party lasts 10 s, then a villain comes straight away
  bpm: 130, // fallback tempo when the audio has no partyBeat() / manifest bpm
  fade: 0.6, // seconds for frame.party.intensity to fade in / out
  grace: 0, // no calm after the party: the next villain comes immediately
  cooldown: 45, // seconds after a party before the jukebox plays again
  after: [0, 0], // first encounter this long after the grace ends
  blastSpeed: 11, // m/s the villain is flung away (decays), while spinning and fading
  blastSpin: 16, // rad/s
  blastTime: 1.2, // seconds to fade out and despawn
};
