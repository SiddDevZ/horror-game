// local run records: localStorage br.save.v1
const KEY = 'br.save.v1';

const store = () => {
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
};

export function loadSave() {
  const out = { best: 0, bestEscapes: 0, totalEscapes: 0, runs: 0, wins: 0, bestTime: 0, last: { distance: 0, escapes: 0 } };
  const ls = store();
  if (!ls) return out;
  try {
    const s = JSON.parse(ls.getItem(KEY) || '{}');
    if (Number.isFinite(s.best)) out.best = s.best;
    if (Number.isFinite(s.bestEscapes)) out.bestEscapes = s.bestEscapes;
    if (Number.isFinite(s.totalEscapes)) out.totalEscapes = s.totalEscapes;
    if (Number.isFinite(s.runs)) out.runs = s.runs;
    if (Number.isFinite(s.wins)) out.wins = s.wins;
    // fastest escape through the EXIT, seconds of play (0 = never escaped)
    if (Number.isFinite(s.bestTime)) out.bestTime = s.bestTime;
    if (s.last && Number.isFinite(s.last.distance)) out.last = { distance: s.last.distance, escapes: s.last.escapes | 0 };
  } catch {}
  return out;
}

export function writeSave(s) {
  const ls = store();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(s)); } catch {}
}
