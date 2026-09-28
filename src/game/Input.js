// keyboard, mouse and pointer lock, plus a virtual input used by tests and bots.
const MOVE_KEYS = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};


const SUMMON_KEYS = { 8: 'kanye', 9: 'trump', 0: 'epstein' };
const SUMMON_NAMES = { kanye: 'Kanye', trump: 'Donald', epstein: 'Jeffrey' };
// touch look: mouse counts per css pixel of drag (the settings sensitivity still multiplies)
const TOUCH_LOOK = 2.3;
export class Input {
  constructor(game, canvas) {
    this.g = game;
    this.canvas = canvas;
    this.k = { f: false, b: false, l: false, r: false, shift: false, q: false, mmb: false, e: false };
    this.latched = false; // sprint toggle mode
    this.idleT = 0;
    this.mdx = 0;
    this.mdy = 0;
    this.locked = false;
    this.lastPointer = 'mouse'; // pointerType of the latest press; touch never asks for pointer lock
    // on-screen touch controls: analogue stick, held buttons
    this.t = { fwd: 0, strafe: 0, sprint: false, use: false, lookBack: false };
    this.virtual = { active: false, fwd: 0, strafe: 0, sprint: false, lookYaw: null, lookPitch: null, lookBehind: false, use: false };
    if (typeof document !== 'undefined' && typeof window !== 'undefined') this._bind();
  }

  // ---- touch api (src/ui/touch.js): same code paths as the keys ----
  /** stick: x = strafe right, y = forward, both -1..1 (analogue); sprint at the stick's edge */
  touchMove(x, y, sprint = false) {
    const t = this.t;
    t.strafe = x > 1 ? 1 : x < -1 ? -1 : x || 0;
    t.fwd = y > 1 ? 1 : y < -1 ? -1 : y || 0;
    t.sprint = !!sprint;
  }

  /** drag look in css pixels */
  touchLook(dx, dy) {
    if (this.g.state !== 'playing' || this.g.reading) return;
    this.mdx += dx * TOUCH_LOOK;
    this.mdy += dy * TOUCH_LOOK;
  }

  /** action: 'use' | 'lookBack' | 'flashlight' | 'drink' | 'airhorn' | 'pause' | 'wire1'..'wire4' */
  press(action) {
    const g = this.g;
    if (action === 'pause') { g.pause(); return; }
    if (g.state !== 'playing') return;
    if (g.reading) { if (action === 'use') g.closeLore(); return; }
    switch (action) {
      case 'use':
        if (g.loreGuard > 0) return;
        this.t.use = true;
        this._use();
        break;
      case 'lookBack': this.t.lookBack = true; break;
      case 'flashlight': g.toggleFlashlight(); break;
      case 'drink': g.drink(); break;
      case 'airhorn': g.airhorn(); break;
      default: {
        const m = /^wire([1-4])$/.exec(action);
        if (m) this._wire(+m[1]);
      }
    }
  }

  release(action) {
    if (action === 'use') { if (this.t.use) { this.t.use = false; this.g.tasks.up(); } }
    else if (action === 'lookBack') this.t.lookBack = false;
  }

  _use() {
    const g = this.g;
    if (g.tasks.busy) g.tasks.down(); else g.interact.use();
  }

  // an open wiring panel takes 1-4
  _wire(n) {
    const g = this.g;
    if (g.tasks.busy && g.tasks.active.run.ui === 'wires') { g.tasks.key(n); return true; }
    return false;
  }

  // test/bot api: __br.input.set({ fwd, strafe, sprint, lookYaw, lookPitch, lookBehind, use })
  set(o) {
    Object.assign(this.virtual, o);
    this.virtual.active = true;
    return this.virtual;
  }

  clear() {
    const v = this.virtual;
    v.active = false; v.fwd = 0; v.strafe = 0; v.sprint = false; v.lookYaw = null; v.lookPitch = null; v.lookBehind = false; v.use = false;
  }

  releaseAll() {
    const k = this.k;
    k.f = k.b = k.l = k.r = k.shift = k.q = k.mmb = k.e = false;
    this.latched = false;
    this.mdx = this.mdy = 0;
    const t = this.t;
    t.fwd = t.strafe = 0; t.sprint = t.use = t.lookBack = false;
  }

  requestLock() {
    const c = this.canvas;
    if (!c || !c.requestPointerLock || this.locked || this.lastPointer === 'touch') return;
    try {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  exitLock() {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.();
  }

  // E held (breakers); the virtual flag lets tests hold it
  useHeld() {
    return this.k.e || this.t.use || (this.virtual.active && !!this.virtual.use);
  }

  // fills out = { fwd, strafe, sprint, lookBehind }
  read(out, dt) {
    const v = this.virtual;
    if (v.active) {
      out.fwd = v.fwd; out.strafe = v.strafe; out.sprint = !!v.sprint; out.lookBehind = !!v.lookBehind;
      return out;
    }
    const k = this.k, t = this.t;
    const fwd = (k.f ? 1 : 0) - (k.b ? 1 : 0) + t.fwd, strafe = (k.r ? 1 : 0) - (k.l ? 1 : 0) + t.strafe;
    out.fwd = fwd > 1 ? 1 : fwd < -1 ? -1 : fwd;
    out.strafe = strafe > 1 ? 1 : strafe < -1 ? -1 : strafe;
    const mode = this.g.settings.get('sprintMode');
    if (mode === 'toggle') {
      // a latched sprint drops once the player stops moving
      if (out.fwd === 0 && out.strafe === 0) { this.idleT += dt; if (this.idleT > 0.35) this.latched = false; } else this.idleT = 0;
      out.sprint = this.latched || t.sprint;
    } else out.sprint = k.shift || t.sprint;
    out.lookBehind = k.q || k.mmb || t.lookBack;
    return out;
  }

  _bind() {
    const g = this.g;
    const playing = () => g.state === 'playing';
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); g.toggleDebug(); return; }
      if (!playing()) return;
      // a lore card or the intro is open: E / Enter / Space dismiss it (the ui may also close it)
      if (g.reading) {
        if (!e.repeat && (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); g.closeLore(); }
        return;
      }
      const mk = MOVE_KEYS[e.code];
      if (mk) { this.k[mk] = true; e.preventDefault(); return; }
      switch (e.code) {
        case 'ShiftLeft': case 'ShiftRight':
          this.k.shift = true;
          if (!e.repeat) this.latched = !this.latched;
          break;
        case 'KeyQ': this.k.q = true; break;
        case 'KeyE':
          if (g.loreGuard > 0) break; // the same press just closed a lore card
          this.k.e = true;
          if (!e.repeat) this._use();
          break;
        case 'Digit1': case 'Numpad1': case 'Digit2': case 'Numpad2': case 'Digit3': case 'Numpad3': case 'Digit4': case 'Numpad4': {
          if (e.repeat) break;
          const n = +e.code.slice(-1);
          // an open wiring panel takes 1-4; otherwise 1 drinks
          if (!this._wire(n) && n === 1) g.drink();
          break;
        }
        case 'KeyG': if (!e.repeat) g.airhorn(); break;
        // summon a specific villain: 8 kanye, 9 trump, 0 epstein (swaps out whoever is active)
        case 'Digit8': case 'Numpad8': case 'Digit9': case 'Numpad9': case 'Digit0': case 'Numpad0': {
          if (e.repeat) break;
          const id = SUMMON_KEYS[e.code.slice(-1)];
          if (g.enemy.active && g.director.charId === id) g.toast?.(`${SUMMON_NAMES[id]} is already coming for you.`, 'info', 1800);
          else g.director.forceEncounter(id);
          break;
        }
        case 'KeyF': if (!e.repeat) g.toggleFlashlight(); break;
        case 'Space': e.preventDefault(); break;
        case 'Escape': if (!this.locked) g.pause(); break;
      }
    });
    addEventListener('keyup', (e) => {
      const mk = MOVE_KEYS[e.code];
      if (mk) { this.k[mk] = false; return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.k.shift = false;
      else if (e.code === 'KeyQ') this.k.q = false;
      else if (e.code === 'KeyE') { this.k.e = false; g.tasks.up(); }
    });
    addEventListener('blur', () => this.releaseAll());
    addEventListener('pointerdown', (e) => { this.lastPointer = e.pointerType || 'mouse'; }, true);
    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === this.canvas;
      const was = this.locked;
      this.locked = now;
      if (was && !now) { this.releaseAll(); if (playing()) g.pause(); }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !playing()) return;
      // chrome occasionally reports a huge spike on lock; drop it
      const dx = e.movementX, dy = e.movementY;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
      this.mdx += dx;
      this.mdy += dy;
    });
    const target = this.canvas || document;
    target.addEventListener('mousedown', (e) => {
      if (!playing()) return;
      if (!this.locked) {
        // click to recapture the mouse (after a failed relock); headless never locks, so still allow actions
        this.requestLock();
      }
      if (e.button === 0) g.swing();
      else if (e.button === 1) { e.preventDefault(); this.k.mmb = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 1) this.k.mmb = false; });
    addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }
}
