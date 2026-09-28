// all story and joke text. tone: deadpan backrooms wiki meets shitpost. pg-13, nothing graphic,
// no real-world claims beyond the existing catch lines. the villains are "memetic echoes".

export const ECHO_NAMES = { kanye: 'Kanye', epstein: 'Epstein', trump: 'Trump' };

export const INTRO = {
  title: 'INCOMING TRANSMISSION // M.E.G. BASE ALPHA',
  body: [
    'This is the Major Explorer Group. If you can read this, you noclipped out of reality and landed in Level 0. Congrats. Nobody is proud of you.',
    'Level 0 is roughly 600 million square miles of damp carpet, mono-yellow wallpaper and fluorescent hum. The hum is not the problem.',
    'The problem is the Echoes. The Backrooms reads the internet, finds the most-memed faces on it and prints them out as flat cardboard. They hunt by sound. They are faster than you think and slower than you sprint.',
    'A landline is ringing somewhere near you. Pick it up. We will talk you out.',
    'WASD move. Shift sprint. Q look back. E use. F flashlight.',
  ].join('\n\n'),
};

export const BRIEFING = {
  title: 'M.E.G. // LANDLINE, CRACKLING',
  body: [
    'Good, you have hands. Here is the plan. Yes, it is a to-do list. We are a very organised cult.',
    '1. WORK ORDERS. This level is falling apart and it will not let anyone leave until the chores are done. Card readers, wiring, puddles, a haunted microwave. Finish 6 of them. Your compass and list point at the nearest ones. For each of the first five we send you a tape from the last explorer.',
    '2. POWER. Three breaker panels feed the EXIT. Match the wires on each. They are LOUD. Echoes will hear it.',
    '3. The EXIT room is far out. Once it has power, the door opens. Walk through it.',
    'Almond water heals (1). If you find an airhorn, press G at anything flat and angry. Trust us.',
  ].join('\n\n'),
};

// tape logs by field explorer Wren, sent by M.E.G. for each of the first five work orders. each teaches a mechanic.
export const TAPES = [
  {
    title: 'TAPE 1/5 // WREN, DAY 1',
    body: 'My name is Wren, M.E.G. field unit 7. The carpet squelches. The hum is in B flat.\n\nMet my first Echo today. A cardboard cutout of a rapper, maybe eight feet tall, gliding. It took the corner wide, like it had never practised corners. I sprinted and it lost me.\n\nNote to self: they corner badly. Use corners.\n\nCode digit one: 4.',
  },
  {
    title: 'TAPE 2/5 // WREN, DAY 3',
    body: 'M.E.G. says the Echoes are not people. They are memes the Backrooms swallowed. The more a face got posted, the stronger the print. Nobody gets a cardboard hunter from a face with 12 followers.\n\nOne of them stops and starts, like it is pausing for applause. Every pause is free distance.\n\nCode digit two: 0.',
  },
  {
    title: 'TAPE 3/5 // WREN, DAY 6',
    body: 'Found a vending machine that only sells almond water. Price tag says "free, probably". Drink it and your chest stops hurting.\n\nAlso found an airhorn taped under a desk. Blasted it at an Echo by accident. It froze like a buffering video and slid backwards. Airhorns are the most powerful weapon known to M.E.G. This is not a joke. It is also a joke.\n\nCode digit three: 4.',
  },
  {
    title: 'TAPE 4/5 // WREN, DAY 9',
    body: 'The quiet one hesitates longest before it comes at you. Then it does not stop. M.E.G. redacted its file. I asked why. They redacted the answer.\n\nIf you stand still too long, something always finds you. The Backrooms hates a loiterer. Keep moving and they give up after ten seconds or so.\n\nCode digit four: 0.',
  },
  {
    title: 'TAPE 5/5 // WREN, DAY 12',
    body: 'Found the breakers. Grey panels in the maintenance wings, full of coloured wires. Match them up and the whole panel clunks like a dishwasher falling down the stairs. Every Echo on the level hears it.\n\nThe EXIT is past the hum, where the wallpaper gets older. When its sign lights up, it opens.\n\nCode digit five: 4. Yes. The code is 40404. Exit not found. Go find it anyway.\n\nIf you are hearing this, I either made it or I am cardboard now.',
  },
];

export const NOTES = [
  { title: 'STICKY NOTE', body: 'Sprint beats all of them. Barely. Keep moving and they lose interest in about ten seconds.\n\nStanding still is how you get featured.' },
  { title: 'PRINTOUT, SLIGHTLY DAMP', body: 'Doors do not lock. Run into one and it opens. Echoes open them too, just slower.\n\nQ lets you look behind you without turning. Use it. Do not stare.' },
  { title: 'NAPKIN', body: 'Low on hearts? Small side rooms with one door are recovery alcoves. Walk in, press E, breathe.\n\nThree per run. Do not get greedy.' },
  { title: 'RECEIPT', body: '1x almond water ....... $0.00\n1x airhorn ............ $0.00\n1x sense of dread ..... complimentary\n\nThank you for shopping at Level 0. You cannot leave.' },
];

export const LINES = {
  phoneStatic: 'Static. Something is too close to hear. Pick up again when it is quiet.',
  briefingQueued: 'M.E.G. will brief you when it is quiet. Run.',
  orderDone: (n, total, title) => `Work order ${n}/${total}: ${title}.`,
  orderTape: (n) => `M.E.G. sent VHS log ${n}/5. It plays when it is quiet.`,
  ordersDone: 'Work orders done. Now the power: three breaker panels.',
  noteQueued: 'Note pocketed. Read it when it is quiet.',
  breakerLocked: (n, total) => `Panel locked. M.E.G. wants the work orders done first (${n}/${total}).`,
  breakerOn: [
    'Breaker 1/3: CLUNK. A fluorescent tube wakes up and immediately regrets it.',
    'Breaker 2/3: the hum drops a semitone. Something far away stops to listen.',
    'Breaker 3/3: FULL POWER. The EXIT sign is lit. Every Echo on the level just got a notification.',
  ],
  breakerAlready: 'Already on. Humming smugly.',
  exitLocked: (n, total) => `EXIT. No power. The sign is dead (${n}/${total} breakers).`,
  exitPowered: 'The EXIT is powered. Follow the compass and walk through.',
  exitOpen: 'The EXIT door grinds open. Go. Go go go.',
  almondPick: 'Almond water. Press 1 to drink.',
  almondFull: (max) => `Pockets full (${max}/${max}). Drink one first (1).`,
  almondNone: 'No almond water. Vending machines and water coolers have some.',
  drink: 'Almond water. Tastes like vanilla and a warm hug. +1 heart.',
  drinkFull: 'Hearts are full. Save it for later.',
  vending: 'Almond water, dispensed with a sound like a sigh.',
  vendingOut: 'SOLD OUT. The machine looks smug about it.',
  cooler: 'The water cooler glugs out almond water. Do not ask.',
  coolerOut: 'The cooler is empty. It gurgles apologetically.',
  airhornPick: (n) => `AIRHORN acquired (${n} blasts). G to deploy.`,
  airhornRefill: (n) => `Airhorn topped up (${n} blasts).`,
  airhornNone: 'No airhorn. Somebody in here has one taped under a desk.',
  airhornMiss: 'BWAAAMP. Nothing in range, but everything heard that.',
  airhornHit: {
    kanye: 'AIRHORNED. Kanye is buffering.',
    epstein: 'AIRHORNED. The file has been delayed.',
    trump: 'AIRHORNED. Sad! Very sad.',
  },
  partyStart: 'SIGMA SIGMA BOY. PARTY MODE. The Echoes cannot handle this aura.',
  partyBlast: 'SIGMA SIGMA BOY. The Echo got vibe-checked into next week.',
  partyOver: 'The party is over. The hum is back. It is jealous.',
  partyStopped: 'You stopped the party. Buzzkill. The Echoes are on their way back.',
  partyCooldown: (s) => `The jukebox is recharging its aura (${s} s).`,
  partyNoSummon: 'Nobody gets summoned during the party. Rules of the dance floor.',
  winTitle: 'YOU NOCLIPPED OUT',
  win: [
    'Reality loads back in at 30 fps. It smells like a normal office. Suspiciously normal.',
    'You are outside. The sky is a real colour. M.E.G. sends a thumbs up emoji and nothing else.',
    'EXIT reached. The Echoes go back to being jpegs. For now.',
  ],
};

export const PHONE_QUIPS = [
  'You answer. "Have you considered an extended warranty on your sanity?"',
  'You answer. A voice whispers "left, then left again". They hang up.',
  'You answer. It is Kanye. He wants to know if you have heard the album.',
  'You answer. Hold music. It is the same four seconds forever.',
  'You answer. "Your call is important to us." Nobody is there.',
  'You answer. "Hi, this is your car\'s warranty. Also, run."',
  'You answer. Someone breathing, then a single airhorn. Respect.',
];

// used when the manifest has no poster / tv captions yet
export const POSTER_CAPTIONS = [
  'HANG IN THERE (you cannot leave)',
  '0 DAYS SINCE LAST NOCLIP',
  'It is giving liminal.',
  'Me when the hum hits 60 Hz',
  'POV: you tried to go back',
  'STONKS (almond water futures)',
  'This is fine.',
  'MANDATORY FUN. ATTENDANCE IS FOREVER.',
];

export const TV_CHANNELS = [
  'CH 3: static that feels like it is watching you.',
  'CH 4: an ad for a couch that does not exist. Only 3 easy payments.',
  'CH 7: "Is this the EXIT?" "No, this is Level 0."',
  'CH 9: a livestream of this exact room. You wave. It waves late.',
  'CH 12: weather. 72 F, humid, forever.',
  'CH 0: we interrupt this program to remind you: 404.',
];

export const RADIO_LINES = [
  'Elevator music at 0.8x speed. It slaps, weirdly.',
  'A voice reads numbers. 4. 0. 4. Then a sponsor read for almond water.',
  'Lo-fi beats to get chased to.',
  'A call-in show. Every caller is you, from slightly later.',
];

// v3 task text: panel title, hint, success line
export const TASK_TEXT = {
  cardSwipe: { title: 'Swipe your keycard', hint: 'Hold E, let go in the green', ok: 'Accepted. Thank you.' },
  wires: { title: 'Fix the wiring', hint: 'Press 1-4 to match each wire', ok: 'Wires fixed. No sparks. Mostly.' },
  touchGrass: { title: 'Touch grass', hint: 'Hold E. Feel something.', ok: 'You touched grass. Mental health +1.' },
  fixLight: { title: 'Fix the flickering light', hint: 'Hold E', ok: 'Light fixed. The hum sounds almost grateful.' },
  mop: { title: 'Mop the puddle', hint: 'Hold E', ok: 'Puddle gone. It was mostly almond water, so you kept some.' },
  straighten: { title: 'Straighten the poster', hint: 'E', ok: 'Poster straightened. Inner peace unlocked.' },
  router: { title: 'Reboot the router', hint: 'E off, then E on', ok: 'Have you tried turning it off and on again? It worked.' },
  copier: { title: 'Print the report', hint: 'Hold E', ok: 'The copier prints a meme instead of the report. Close enough.' },
  microwave: { title: 'Microwave the almond water', hint: 'Hold E', ok: 'mmmmmm... BEEP. Hot almond water acquired.' },
  vendingStuck: { title: 'Free the stuck snack', hint: 'Hit it: E x3', ok: 'THUNK. Something falls out. It is almond water. It is always almond water.' },
  timesheet: { title: 'Sign the timesheet', hint: 'E', ok: 'Timesheet signed. Hours worked: yes.' },
  skibidi: { title: 'Flush the toilet', hint: 'E', ok: 'Flushed. Something in there was singing.' },
  fast: 'Too fast. Try again.',
  slow: 'Too slow. Try again.',
  wrongWire: 'Wrong wire. Zap. Start over.',
  breakerTitle: 'Breaker panel: match the wires',
  already: 'Already done. Look at you.',
};

// E on a meme prop (feature type 'meme', data.kind)
export const MEME_PROPS = {
  prime: 'A vending machine full of hydration drinks. Every bottle is sold out. Somehow.',
  grimace: 'A purple shake. Do not drink the purple shake. Everyone who drank the purple shake is now lore.',
  crewmate: 'A crewmate plush. It looks sus. It looks at you. You look away first.',
  grassBlock: 'A grass block. Touch it? It is technically grass.',
  ohio: 'ONLY IN OHIO. Level 0 is technically in Ohio now.',
  chillGuy: 'A cardboard chill guy. Hands in pockets. Totally unbothered by the Echoes.',
  shrek: 'A cardboard ogre. "What are you doing in my backrooms?"',
  chungus: 'A very large cardboard rabbit. Big. Chungus.',
  doge: 'Such liminal. Very carpet. Wow.',
  sus: 'Someone sprayed SUS by the vent. Correct.',
  trollface: 'A trollface on the wall. Problem?',
  stanley: 'A giant insulated cup. It survived a car fire. It will survive this.',
  nerd: 'A sign with the nerd emoji: "Um, actually, the exit is that way."',
  fanumTax: 'A note on the fridge: FANUM TAX. Half your almond water now belongs to Fanum.',
  skibidi: 'A toilet. It hums a tune. You have heard this tune before. You wish you had not.',
};
