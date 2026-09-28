// v3 tasks: little office chores on `task` features (and the breaker panels, which are `wires`).
// TaskRun is a pure per-task state machine (node-testable); TaskBoard binds the one open task to input,
// events (task:open / task:progress / task:result / task:close) and the objective chain.
import { hash32, makeRng } from '../core/rng.js';
import { TASK_TEXT } from './lore.js';

// ui: 'swipe' (hold E, release in the window), 'wires' (keys 1-4), 'hold' (hold E), 'press' (E, n presses)
// reward: what a finished task pays out besides counting as a work order
export const TASK_KINDS = {
  cardSwipe: { ui: 'swipe', swipe: 1.6, window: [0.55, 0.85], reward: 'airhorn' },
  wires: { ui: 'wires', total: 4, reward: 'meme' },
  touchGrass: { ui: 'hold', time: 2.0, reward: 'meme' },
  fixLight: { ui: 'hold', time: 2.5, reward: 'meme' },
  mop: { ui: 'hold', time: 2.5, reward: 'almond' }, // it was mostly almond water
  straighten: { ui: 'press', presses: 1, reward: 'meme' },
  router: { ui: 'press', presses: 2, gap: 0.4, mid: 'off', reward: 'airhorn' },
  copier: { ui: 'hold', time: 2.0, reward: 'meme' },
  microwave: { ui: 'hold', time: 3.0, reward: 'almond' },
  vendingStuck: { ui: 'press', presses: 3, reward: 'almond' },
  timesheet: { ui: 'press', presses: 1, reward: 'meme' },
  skibidi: { ui: 'press', presses: 1, reward: 'meme' },
};
// kinds with their own sound category (task:<kind>); the rest use taskOk
export const KIND_SOUND = new Set(['microwave', 'skibidi', 'router', 'copier', 'cardSwipe', 'mop', 'touchGrass', 'vendingStuck']);
export const WIRE_COLORS = ['red', 'blue', 'yellow', 'pink'];

export const strHash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

const shuffle = (rng, a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
};

// one task's mechanic. down()/up() are E edges, update(dt, held) runs every frame while open, key(n) is 1-4.
// each returns null (nothing decided) or { ok, msg }. progress: t (0..1), step/total, wrong.
export class TaskRun {
  constructor(kind, seed = 0) {
    this.kind = kind;
    this.spec = TASK_KINDS[kind];
    this.done = false;
    this.t = 0;
    this.step = 0;
    this.clock = 0;
    this.lastPress = -1e9;
    this.swiping = false;
    this.wrong = false;
    if (this.spec.ui === 'wires') {
      const rng = makeRng(hash32(seed >>> 0, 0x3173));
      this.left = shuffle(rng, WIRE_COLORS.slice());
      this.right = shuffle(rng, WIRE_COLORS.slice());
    }
  }

  get ui() { return this.spec.ui; }
  get total() { const s = this.spec; return s.ui === 'wires' ? s.total : s.ui === 'press' ? s.presses : 1; }

  _ok() {
    this.done = true;
    this.t = 1;
    this.step = this.total;
    this.swiping = false;
    return { ok: true, msg: TASK_TEXT[this.kind]?.ok || 'Done.' };
  }

  // partial state that should not survive closing the panel
  abort() {
    this.swiping = false;
    if (this.spec.ui === 'swipe') this.t = 0;
    if (this.spec.ui === 'wires') this.step = 0;
    this.wrong = false;
  }

  down() {
    if (this.done) return null;
    const s = this.spec;
    this.wrong = false;
    if (s.ui === 'swipe') { this.swiping = true; this.t = 0; return null; }
    if (s.ui !== 'press') return null;
    if (this.step > 0 && s.gap && this.clock - this.lastPress < s.gap) return null;
    this.lastPress = this.clock;
    this.step++;
    this.t = this.step / s.presses;
    return this.step >= s.presses ? this._ok() : null;
  }

  up() {
    if (this.done || this.spec.ui !== 'swipe' || !this.swiping) return null;
    this.swiping = false;
    const [a, b] = this.spec.window, t = this.t;
    if (t >= a && t <= b) return this._ok();
    this.t = 0;
    return { ok: false, msg: t < a ? TASK_TEXT.fast : TASK_TEXT.slow };
  }

  update(dt, held) {
    this.clock += dt;
    if (this.done) return null;
    const s = this.spec;
    if (s.ui === 'hold') {
      if (!held) return null;
      this.t = Math.min(1, this.t + dt / s.time);
      return this.t >= 1 ? this._ok() : null;
    }
    if (s.ui === 'swipe' && this.swiping) {
      this.t += dt / s.swipe;
      if (this.t >= 1) { this.swiping = false; this.t = 0; return { ok: false, msg: TASK_TEXT.slow }; }
    }
    return null;
  }

  // wires: key n (1-4) picks the right-hand terminal right[n-1]; it must match the next left wire
  key(n) {
    if (this.done || this.spec.ui !== 'wires') return null;
    if (this.right[n - 1] === this.left[this.step]) {
      this.wrong = false;
      this.step++;
      this.t = this.step / this.spec.total;
      return this.step >= this.spec.total ? this._ok() : null;
    }
    this.step = 0;
    this.t = 0;
    this.wrong = true;
    return { ok: false, msg: TASK_TEXT.wrongWire };
  }

  // the key that is correct right now (tests, bots)
  expectKey() { return this.spec.ui === 'wires' ? this.right.indexOf(this.left[this.step]) + 1 : 0; }
}

// the open task panel. one at a time; closes when you walk off, finish, get hit or a lore card opens.
export class TaskBoard {
  constructor(game) {
    this.g = game;
    this.runs = new Map(); // feature id -> TaskRun (hold progress survives closing the panel)
    this.done = new Set();
    this.active = null; // { f, run, kind, breaker }
    this.progT = 0;
    this.closeT = -1;
    this.stats = { opened: 0, ok: 0, fail: 0 };
  }

  reset() {
    this.close();
    this.runs.clear();
    this.done.clear();
  }

  // a panel is taking input (not just showing its success for a beat)
  get busy() { return !!this.active && this.closeT < 0; }

  kindOf(f) {
    if (f.type === 'breaker') return 'wires';
    return f.type === 'task' && f.data && TASK_KINDS[f.data.kind] ? f.data.kind : null;
  }

  isDone(f) { return this.done.has(f.id); }
  title(kind) { return TASK_TEXT[kind]?.title || kind; }

  run(f) {
    let r = this.runs.get(f.id);
    if (!r) {
      r = new TaskRun(this.kindOf(f), hash32(this.g.world.seed >>> 0, strHash(String(f.id))));
      this.runs.set(f.id, r);
    }
    return r;
  }

  open(f, breaker = false) {
    const kind = this.kindOf(f);
    if (!kind || this.done.has(f.id)) return false;
    if (this.active) this.close();
    const run = this.run(f);
    this.active = { f, run, kind, breaker };
    this.closeT = -1;
    this.stats.opened++;
    const tx = TASK_TEXT[kind] || {};
    const data = { ui: run.ui, total: run.total, breaker };
    if (run.ui === 'wires') { data.left = run.left.slice(); data.right = run.right.slice(); }
    if (run.ui === 'swipe') data.window = run.spec.window.slice();
    if (run.ui === 'hold') data.time = run.spec.time;
    this.g.events.emit('task:open', { id: f.id, kind, title: breaker ? TASK_TEXT.breakerTitle : tx.title, hint: tx.hint, data });
    this.g.meme('taskStart', f, 0.7);
    this._progress();
    return true;
  }

  close() {
    const a = this.active;
    if (!a) return;
    if (!a.run.done) a.run.abort();
    this.active = null;
    this.closeT = -1;
    this.g.events.emit('task:close', { id: a.f.id });
  }

  down() { if (this.active && this.closeT < 0) this._apply(this.active.run.down()); }
  up() { if (this.active && this.closeT < 0) this._apply(this.active.run.up()); }
  key(n) { if (this.active && this.closeT < 0) this._apply(this.active.run.key(n)); }

  update(dt, held) {
    const a = this.active;
    if (!a) return;
    const p = this.g.player, f = a.f;
    if (Math.hypot(f.x - p.x, f.z - p.z) > 3.3) { this.close(); return; }
    if (this.closeT >= 0) {
      this.closeT -= dt;
      if (this.closeT < 0) this.close();
      return;
    }
    const res = a.run.update(dt, held);
    if (res) { this._apply(res); return; }
    this.progT -= dt;
    if (this.progT <= 0 && (a.run.swiping || (a.run.ui === 'hold' && held))) this._progress();
  }

  _progress() {
    const a = this.active;
    if (!a) return;
    this.progT = 1 / 15;
    const r = a.run;
    const ev = { id: a.f.id, kind: a.kind, t: +r.t.toFixed(3) };
    if (r.ui === 'swipe') ev.window = r.spec.window;
    if (r.ui === 'wires' || r.ui === 'press') { ev.step = r.step; ev.total = r.total; }
    if (r.wrong) ev.wrong = true;
    this.g.events.emit('task:progress', ev);
  }

  _apply(res) {
    const a = this.active;
    if (!a) return;
    if (a.run.ui === 'press' && a.run.spec.mid && a.run.step === 1 && !res) {
      this.g.events.emit('feature:state', { id: a.f.id, type: 'task', state: a.run.spec.mid });
    }
    this._progress();
    if (!res) return;
    const g = this.g, f = a.f;
    g.events.emit('task:result', { id: f.id, kind: a.kind, ok: res.ok, msg: res.msg });
    if (!res.ok) {
      this.stats.fail++;
      g.meme('taskFail', f, 0.9);
      g.toast(res.msg, 'info', 1800);
      return;
    }
    this.stats.ok++;
    this.done.add(f.id);
    this.closeT = 0.7; // leave the success on screen for a beat
    if (!a.breaker) {
      g.events.emit('feature:state', { id: f.id, type: 'task', state: 'done' });
      g.meme(KIND_SOUND.has(a.kind) ? `task:${a.kind}` : 'taskOk', f, 1);
    } else g.meme('taskOk', f, 1);
    g.objectives.onTaskDone(f, a.kind, a.breaker, res.msg);
  }
}
