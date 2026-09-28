// on-screen touch controls for phones and tablets: a floating left-thumb stick (analogue walk, sprint at the edge),
// drag anywhere on the right to look, and pixel buttons (use, look back, flashlight, drink, airhorn, pause).
// everything reaches the game through Input's touch api (touchMove / touchLook / press / release), so doors, tasks,
// lore and the party behave exactly like the keys. markup + css live in index.html (#touch, html.touch).

const ZONE = 0.45; // left share of the screen that starts the stick
const TRAVEL = 52; // px of knob travel = full speed
const DEAD = 0.12;
const SPRINT_AT = 0.9; // stick pushed this far out sprints
const FOLLOW = 1.5; // the base trails a thumb that drifts past this many travels

/** ?touch=1 forces touch controls on, ?touch=0 off; null = decide from the device */
export function touchPref(search = typeof location !== 'undefined' ? location.search : '') {
  const v = new URLSearchParams(search).get('touch');
  return v === '1' ? true : v === '0' ? false : null;
}

export const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// gameplay text names keys; on touch it names the buttons instead
const SWAPS = [
  [/WASD move\. Shift sprint\. Q look back\. E use\. F flashlight\./g, 'Left thumb moves (push the stick to the edge to sprint). Drag on the right to look. BACK looks behind you. USE uses things. LIGHT is the flashlight.'],
  [/Almond water heals \(1\)/g, 'Almond water heals (tap the bottle)'],
  [/\bpress G\b/g, 'tap the airhorn'],
  [/\bPress 1 to drink\b/g, 'Tap the bottle to drink'],
  [/\bG to deploy\b/g, 'Tap the airhorn to deploy'],
  [/\bPress 1-4\b/g, 'Tap 1-4'],
  [/\bpress E\b/g, 'tap USE'],
  [/\bHold E\b/g, 'Hold USE'],
  [/\bE x3\b/g, 'USE x3'],
  [/\bE off, then E on\b/g, 'USE off, then USE on'],
  [/^E$/, 'USE'],
  [/^E(\s{2,})/, 'USE$1'],
];
export function touchText(s) {
  if (typeof s !== 'string') return s;
  for (const [re, to] of SWAPS) s = s.replace(re, to);
  return s;
}

export class TouchControls {
  constructor({ game, events }) {
    this.game = game;
    this.input = game.input;
    const $ = (id) => document.getElementById(id);
    this.el = { layer: $('touch'), stick: $('stick'), use: $('t-use'), back: $('t-back'), light: $('t-light'), drink: $('t-drink'), horn: $('t-horn'), pause: $('t-pause') };
    this.el.knob = this.el.stick.querySelector('.knob');
    this.stick = { id: -1, ox: 0, oy: 0, rx: 0, ry: 0, run: false };
    this.look = { id: -1, x: 0, y: 0 };
    this.held = new Map(); // pointerId -> { el, action, tapOnUp }
    this._ready = null;
    this._light = null;
    this._bind();
    events.on('inv:update', (d) => this._items(d));
    events.on('lore:open', () => this.reset());
    events.on('game:intro', () => this.reset());
  }

  show(on) {
    const l = this.el.layer;
    if (l.hidden === !on) return;
    l.hidden = !on;
    if (!on) this.reset();
  }

  // drop every finger: stick centred, held buttons released, look ended
  reset() {
    for (const [id, h] of this.held) {
      h.el.classList.remove('on');
      if (!h.tapOnUp) this.input.release(h.action);
      try { h.el.releasePointerCapture(id); } catch {}
    }
    this.held.clear();
    this._stickEnd();
    this.look.id = -1;
  }

  // per frame while playing: only touches the dom when a state flips
  update() {
    const g = this.game, f = g.frame;
    const ready = !!(f.highlight.active || g.tasks.busy);
    if (ready !== this._ready) { this._ready = ready; this.el.use.classList.toggle('ready', ready); }
    const light = !!f.flashlight;
    if (light !== this._light) { this._light = light; this.el.light.setAttribute('aria-pressed', String(light)); this.el.light.classList.toggle('lit', light); }
  }

  _items(d) {
    if (!d) return;
    const set = (btn, n, label) => {
      btn.hidden = !(n > 0);
      btn.querySelector('.count').textContent = String(n || 0);
      btn.setAttribute('aria-label', `${label}, ${n || 0} left`);
    };
    set(this.el.drink, d.almond, 'Drink almond water');
    set(this.el.horn, d.airhorn, 'Airhorn');
  }

  // ---------- stick + look (the layer itself) ----------
  _down(e) {
    if (e.target.closest && e.target.closest('.tbtn')) return;
    e.preventDefault();
    const layer = this.el.layer;
    if (e.clientX < innerWidth * ZONE) {
      if (this.stick.id !== -1) return;
      this._stickStart(e);
    } else {
      if (this.look.id !== -1) return;
      this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY;
    }
    try { layer.setPointerCapture(e.pointerId); } catch {}
  }

  _move(e) {
    if (e.pointerId === this.stick.id) { this._stickMove(e.clientX, e.clientY); return; }
    const L = this.look;
    if (e.pointerId !== L.id) return;
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    L.x = e.clientX; L.y = e.clientY;
    if (dx || dy) this.input.touchLook(dx, dy);
  }

  _up(e) {
    if (e.pointerId === this.stick.id) this._stickEnd();
    else if (e.pointerId === this.look.id) this.look.id = -1;
  }

  _stickStart(e) {
    const S = this.stick, el = this.el.stick;
    // the base's resting centre (it has no transform while idle)
    const r = el.getBoundingClientRect();
    S.rx = r.left + r.width / 2; S.ry = r.top + r.height / 2;
    const h = r.width / 2;
    S.id = e.pointerId;
    S.ox = Math.min(Math.max(e.clientX, h), innerWidth - h);
    S.oy = Math.min(Math.max(e.clientY, h), innerHeight - h);
    el.classList.add('live');
    this._stickMove(e.clientX, e.clientY);
  }

  _stickMove(x, y) {
    const S = this.stick;
    let dx = x - S.ox, dy = y - S.oy, d = Math.hypot(dx, dy);
    if (d > TRAVEL * FOLLOW) {
      const k = (d - TRAVEL * FOLLOW) / d;
      S.ox += dx * k; S.oy += dy * k;
      dx = x - S.ox; dy = y - S.oy; d = Math.hypot(dx, dy);
    }
    const m = Math.min(1, d / TRAVEL);
    const run = m >= SPRINT_AT;
    // analogue below the edge (dead zone remapped), a full-length vector once it sprints
    const out = run ? 1 : m < DEAD ? 0 : (m - DEAD) / (1 - DEAD);
    const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : 0;
    this.input.touchMove(nx * out, -ny * out, run);
    const kx = nx * m * TRAVEL, ky = ny * m * TRAVEL;
    this.el.stick.style.transform = `translate(${Math.round(S.ox - S.rx)}px, ${Math.round(S.oy - S.ry)}px)`;
    this.el.knob.style.transform = `translate(${Math.round(kx)}px, ${Math.round(ky)}px)`;
    if (run !== S.run) { S.run = run; this.el.stick.classList.toggle('run', run); }
  }

  _stickEnd() {
    const S = this.stick;
    if (S.id === -1) return;
    S.id = -1;
    S.run = false;
    this.input.touchMove(0, 0, false);
    const el = this.el.stick;
    el.classList.remove('live', 'run');
    el.style.transform = '';
    this.el.knob.style.transform = '';
  }

  // ---------- buttons: press on touch-down (hold until up); pause acts on a completed tap ----------
  _button(el, action, tapOnUp = false) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.held.has(e.pointerId)) return;
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.held.set(e.pointerId, { el, action, tapOnUp });
      el.classList.add('on');
      if (!tapOnUp) this.input.press(action);
    });
    const up = (e) => {
      const h = this.held.get(e.pointerId);
      if (!h || h.el !== el) return;
      this.held.delete(e.pointerId);
      el.classList.remove('on');
      if (!tapOnUp) { this.input.release(action); return; }
      if (e.type !== 'pointerup') return;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) this.input.press(action);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  _bind() {
    const l = this.el.layer;
    l.addEventListener('pointerdown', (e) => this._down(e));
    l.addEventListener('pointermove', (e) => this._move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) l.addEventListener(t, (e) => this._up(e));
    // no compat mouse events, synthetic clicks, double-tap zoom or callouts from the control layer
    for (const t of ['touchstart', 'touchmove', 'touchend']) l.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    l.addEventListener('contextmenu', (e) => e.preventDefault());
    const E = this.el;
    this._button(E.use, 'use');
    this._button(E.back, 'lookBack');
    this._button(E.light, 'flashlight');
    this._button(E.drink, 'drink');
    this._button(E.horn, 'airhorn');
    this._button(E.pause, 'pause', true);
  }
}
