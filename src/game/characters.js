// per-character behaviour plus the encounter character selector (pure, node-testable).
import { makeRng } from '../core/rng.js';

export const CHAR_IDS = ['kanye', 'epstein', 'trump'];

export const CHARS = {
  kanye: {
    speed: 6.5,
    turnRate: 3.6, // rad/s heading limit: wide, awkward cornering
    minCornerSpeed: 0.5,
    lookahead: 6,
    commit: 0.75,
    commitCreep: 0.9,
    reacquireFreeze: 0,
    lines: [
      'Kanye caught you. You are now featured on the deluxe edition.',
      'Kanye caught you. He says you were not the stronger one.',
      'Kanye caught you. Imma let you finish, actually no.',
    ],
  },
  epstein: {
    speed: 6.6,
    turnRate: 12,
    minCornerSpeed: 0.3,
    lookahead: 24,
    commit: 0.95, // the unsettling hesitation
    commitCreep: 0,
    reacquireFreeze: 0.3,
    lines: [
      'Epstein caught you. The cameras were off. Convenient.',
      'Epstein caught you. Your file has been sealed.',
      'Epstein caught you. Nobody will ever find the flight logs.',
    ],
  },
  trump: {
    speed: 6.8,
    stopGo: [1.6, 0.3], // seconds moving, seconds stopped
    turnRate: 8,
    minCornerSpeed: 0.35,
    lookahead: 16,
    commit: 0.8,
    commitCreep: 0,
    reacquireFreeze: 0,
    lines: [
      "Trump caught you. You're fired.",
      'Trump caught you. Tremendous catch. The best catch.',
      'Trump caught you. He asked to be saved, not you.',
    ],
  },
};

// weights for the next committed encounter given the committed history (user rules, 2026-09-27):
// encounter 1 is kanye; the same villain never comes twice in a row; a villain from two encounters ago can
// return only with a small chance; unseen and long-absent villains are strongly favoured.
export const SEL = { unseen: 3, twoAgo: 0.35, perAbsent: 0.6 };
export function selectionWeights(history, out = [0, 0, 0]) {
  const n = history.length;
  if (n === 0) {
    out[0] = 1; out[1] = 0; out[2] = 0;
    return out;
  }
  const last = history[n - 1];
  for (let c = 0; c < 3; c++) {
    const id = CHAR_IDS[c];
    if (id === last) { out[c] = 0; continue; }
    const at = history.lastIndexOf(id);
    if (at < 0) { out[c] = SEL.unseen; continue; }
    const since = n - 1 - at; // encounters since last seen (1 = two encounters ago)
    out[c] = since <= 1 ? SEL.twoAgo : 1 + SEL.perAbsent * (since - 1);
  }
  return out;
}

export function createSelector(seed) {
  const rng = makeRng(seed);
  const history = [];
  const w = [0, 0, 0];
  return {
    history,
    get count() { return history.length; },
    peekWeights() { return selectionWeights(history, [0, 0, 0]); },
    // call only once an encounter is committed (spawn validated); forced ids still count
    commit(forced = null) {
      let id = forced;
      if (!id) {
        selectionWeights(history, w);
        const total = w[0] + w[1] + w[2];
        let r = rng.next() * total;
        id = CHAR_IDS[2];
        for (let c = 0; c < 3; c++) {
          if (w[c] <= 0) continue;
          if (r < w[c]) { id = CHAR_IDS[c]; break; }
          r -= w[c];
        }
      }
      history.push(id);
      return id;
    },
  };
}
