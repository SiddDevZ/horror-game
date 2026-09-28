const KEY = 'br.settings.v1';

export const DEFAULTS = {
  quality: 'auto',
  sensitivity: 1,
  invertY: false,
  sprintMode: 'hold',
  fov: 74,
  headBob: 0.6,
  shake: 0.6,
  grain: 0.35,
  vhs: 0,
  flicker: 1,
  volMaster: 0.8,
  volAmbience: 0.7,
  volEnemy: 1,
  volInteraction: 0.8,
  volSudden: 0.8,
  muted: false,
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (k in raw && typeof raw[k] === typeof DEFAULTS[k]) out[k] = raw[k];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

const values = load();
const listeners = [];
let saveTimer = 0;

export const settings = {
  get: (k) => values[k],
  all: () => ({ ...values }),
  set(k, v) {
    if (!(k in DEFAULTS) || values[k] === v) return;
    values[k] = v;
    for (const fn of listeners) fn(k, v);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
    }, 200);
  },
  reset() {
    for (const k of Object.keys(DEFAULTS)) settings.set(k, DEFAULTS[k]);
  },
  on(fn) {
    listeners.push(fn);
    return () => listeners.splice(listeners.indexOf(fn), 1);
  },
};
