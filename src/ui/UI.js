// minimal pixel menus over the live corridor: loading, start, settings, pause, death, win, plus the hud (the reel's dot
// crosshair, hearts, objective checklist, compass, hotbar, toasts) and the lore reader / intro transmission overlays.
import { HeartsHud } from './hearts.js';
import { TouchControls, touchText, coarsePointer } from './touch.js';

const $ = (id) => document.getElementById(id);

const pct = (v) => `${Math.round(v * 100)}%`;
const SCHEMA = [
  { legend: 'Picture', rows: [
    { key: 'quality', label: 'Quality', type: 'select', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
    { key: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, fmt: (v) => `${v}°` },
    { key: 'headBob', label: 'Head bob', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'shake', label: 'Camera shake', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'grain', label: 'Film grain', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'vhs', label: 'VHS effect', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'flicker', label: 'Light flicker', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  ] },
  { legend: 'Controls', rows: [
    { key: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}x` },
    { key: 'invertY', label: 'Invert mouse Y', type: 'check' },
    { key: 'sprintMode', label: 'Sprint', type: 'select', options: [['hold', 'Hold Shift'], ['toggle', 'Toggle Shift']] },
  ] },
  { legend: 'Sound', rows: [
    { key: 'volMaster', label: 'Master', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'volAmbience', label: 'Ambience', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'volEnemy', label: 'Enemies', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'volInteraction', label: 'Footsteps, doors', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'volSudden', label: 'Sudden sounds', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'muted', label: 'Mute all', type: 'check' },
  ] },
];
const FALLBACK_LINES = ['You got got.', 'The carpet will remember this.', 'Somebody had to be the jump scare.'];
const DEATH_GUARD = 0.35; // seconds before the death screen accepts a restart (swallows in-flight clicks)
const READER_GUARD = 0.25; // seconds before a reader accepts a closing click / key
const TOAST_MAX = 3;
const TAU = Math.PI * 2;
const COMPASS_STEPS = 16; // the pixel arrow snaps to 22.5 degree steps
// task kinds -> panel type (task:open data.ui overrides)
const TASK_UI = { cardSwipe: 'swipe', wires: 'wires', breaker: 'wires', vendingStuck: 'press', router: 'press', straighten: 'press', timesheet: 'press', skibidi: 'press' };
const WIRE_COLORS = { red: '#d8342c', blue: '#3a67e0', yellow: '#ecd23c', pink: '#e052b4', magenta: '#e052b4', green: '#45b64e', cyan: '#43c8d2', orange: '#ef8a2c', white: '#ece6d0' };
const TASK_LINGER = 0.9; // seconds a result stays readable before task:close hides the panel
const SVGNS = 'http://www.w3.org/2000/svg';
// v4 party: minecraft chat colours (c 6 e a b 9 d) and their 1/4-brightness drop shadows, like the game's own text
const RAINBOW = ['#ff5555', '#ffaa00', '#ffff55', '#55ff55', '#55ffff', '#5555ff', '#ff55ff'];
const RAINBOW_SH = RAINBOW.map((c) => '#' + [1, 3, 5].map((i) => ((parseInt(c.slice(i, i + 2), 16) & 0xfc) >> 2).toString(16).padStart(2, '0')).join(''));
const PARTY_TITLE = 'PARTY MODE';
const PARTY_HOP = 14; // px the title letters jump per beat (parabola, landing on the beat)
const PARTY_WAVE = 0.07; // beats between neighbouring letters
const fmtTime = (t) => {
  const s = Math.max(0, Math.round(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class UI {
  constructor({ settings, events, touch = null }) {
    this.settings = settings;
    this.events = events;
    this.onStart = null;
    this.game = null;
    this.state = 'boot';
    this.settingsFrom = null;
    this.deathT = 0;
    this.menuT = 0;
    this._osdSec = -1;
    this.readerT = 0;
    this.overlay = null; // 'lore' | 'intro' while a reader is up
    this._introT = 0;
    this._introNext = 0;
    this._cmp = { on: null, step: -1, dist: -1, behind: null };
    this._toasts = []; // { el, t }
    this._meme = { t: 0 };
    this._inv = { almond: -1, airhorn: -1 };
    this._reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this._narrow = matchMedia('(max-width: 640px)');
    this._portrait = matchMedia('(orientation: portrait)');
    // touch controls: true / false forced by ?touch, null = coarse pointer now or the first real touch later
    this.touch = false;
    this.touchCtl = null;
    this._touchPref = touch;
    this._touchT = -1e9; // last touch pointer event (drops the compat mouse events that follow a tap)
    // party banner state: per-element last written values so a frame only touches what moved
    this._party = { on: false, k: -1, step: null, dur: 0, sec: -1, fill: -1, splash: -1, hot: 0, lifted: false, ly: null, letters: [] };
    this.task = null; // { id, kind, ui, data, t, step, total, window, resultT, closeT, el... }
    this.el = {
      loading: $('loading'), loadLabel: $('load-label'), loadFill: $('load-fill'),
      start: $('start'), pause: $('pause'), death: $('death'), settings: $('settings'), hud: $('hud'), prompt: $('prompt'),
      osd: $('osd-time'), form: $('settings-form'),
      deathLine: $('death-line'), deathDistance: $('death-distance'), deathEscapes: $('death-escapes'), deathBest: $('death-best'),
      win: $('win'), lore: $('lore'), intro: $('intro'),
      objectives: $('objectives'), objList: $('obj-list'), objCount: $('obj-count'),
      compass: $('compass'), compassIco: $('compass').querySelector('.ico'), compassDist: $('compass-dist'),
      hotbar: $('hotbar'), slotAlmond: $('slot-almond'), slotAirhorn: $('slot-airhorn'),
      toasts: $('toasts'), memeToast: $('meme-toast'),
      task: $('task'), taskTitle: $('task-title'), taskBody: $('task-body'), taskMsg: $('task-msg'), taskHint: $('task-hint'),
      party: $('party'), partyStack: $('party').querySelector('.party-stack'), partySplash: $('party').querySelector('.party-splash'),
      partyNow: $('party').querySelector('.party-now'), partyFill: $('party-fill'), partyTime: $('party-time'), partyLive: $('party-live'),
    };
    this._buildParty();
    this._checkIcons();
    this._controls = new Map();
    this._buildSettings();
    this._bind();
    if (touch === true || (touch == null && coarsePointer())) this.setTouch(true);
    else if (touch == null && navigator.maxTouchPoints > 0) {
      const first = (e) => { if (e.pointerType === 'touch') { removeEventListener('pointerdown', first, true); this.setTouch(true); } };
      addEventListener('pointerdown', first, true);
    }
  }

  // switch to touch controls (one way: a device that was touched keeps them; keys and mouse still work)
  setTouch(on) {
    if (!on || this.touch) return;
    this.touch = true;
    document.documentElement.classList.add('touch');
    const lab = (k, t) => { const c = this._controls.get(k); if (c) c.input.closest('.row').querySelector('label').textContent = t; };
    lab('sensitivity', 'Look sensitivity');
    lab('invertY', 'Invert look Y');
    const sm = this._controls.get('sprintMode');
    if (sm) sm.input.closest('.row').classList.add('kb-only');
    // no pinch / rubber-band / pull-to-refresh outside the scrollable panels
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      const t = e.target;
      if (e.cancelable && (e.touches.length > 1 || !(t.closest && t.closest('.menu, .sheet, .reader-body, input, select')))) e.preventDefault();
    }, { passive: false });
    addEventListener('resize', () => { if (this._meme.t > 0) this._fitMeme(); this._touchFit(); });
    if (this.game) this._makeTouch();
  }

  _makeTouch() {
    if (this.touchCtl || !this.game) return;
    this.touchCtl = new TouchControls({ game: this.game, events: this.events });
    this.touchCtl.show(this.state === 'playing');
  }

  _tt(s) { return this.touch ? touchText(s) : s; }
  attach({ game, audio, renderer }) {
    this.game = game;
    this.audio = audio;
    this.renderer = renderer;
    this.events.on('game:state', ({ state }) => this._onState(state));
    this.events.on('game:death', (d) => this._fillDeath(d));
    this.events.on('game:prompt', (p) => this._prompt(p && p.text));
    this.hearts = new HeartsHud(this.el.hud, 8);
    this.events.on('game:hearts', ({ hp, delta }) => this.hearts.set(hp, delta));
    const ev = this.events;
    ev.on('obj:update', (d) => this._objectives(d));
    ev.on('inv:update', (d) => this._inventory(d));
    ev.on('toast', (d) => this.toast(d));
    ev.on('lore:open', (d) => this._openReader('lore', d));
    ev.on('game:intro', (d) => this._openReader('intro', d));
    ev.on('lore:close', () => this._closeReader(false));
    ev.on('game:win', (d) => this._fillWin(d));
    ev.on('task:open', (d) => this._taskOpen(d));
    ev.on('task:progress', (d) => this._taskProgress(d));
    ev.on('task:result', (d) => this._taskResult(d));
    ev.on('task:close', (d) => this._taskClose(d));
    ev.on('party:start', (d) => { if (d && d.duration > 0) this._party.dur = d.duration; this.el.partyLive.textContent = 'Party mode. Sigma Boy is playing.'; });
    ev.on('party:end', () => { this.el.partyLive.textContent = 'Party over.'; });
    if (this.touch) this._makeTouch();
  }

  // icon atlas from the image agent (public/assets/gen); without it the hud falls back to text only
  _checkIcons() {
    const img = new Image();
    img.onerror = () => document.documentElement.classList.add('no-icons');
    img.src = './assets/gen/icons.png';
    const logo = $('logo');
    if (logo) logo.addEventListener('error', () => { logo.replaceWith(document.createTextNode('Level 0')); }, { once: true });
  }

  setLoading(p, label) {
    const e = this.el;
    const v = Math.max(0, Math.min(1, p || 0));
    e.loadFill.style.transform = `scaleX(${v})`;
    e.loading.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    if (label) e.loadLabel.textContent = label;
    if (v >= 1) {
      e.loading.classList.add('done');
      e.loading.setAttribute('aria-hidden', 'true');
      setTimeout(() => { e.loading.hidden = true; }, 360);
    }
  }

  showStart() {
    this._show('start');
    this.el.start.querySelector('#btn-start').focus({ preventScroll: true });
  }

  update(dt) {
    if (this.state === 'dead' || this.state === 'win') this.deathT += dt;
    if (this.state === 'playing') {
      if (this.touchCtl) this.touchCtl.update();
      if (this.hearts) this.hearts.update(dt);
      this._updateCompass();
      this._updateParty();
      this._updateToasts(dt);
      if (this.task && this.task.closeT > 0) { this.task.closeT -= dt; if (this.task.closeT <= 0) this._taskHide(); }
      if (this.overlay) { this.readerT += dt; if (this.overlay === 'intro') this._updateIntro(dt); }
    }
    if (this.state === 'start') {
      // vhs counter on the start screen, touched once a second
      this.menuT += dt;
      const s = Math.floor(this.menuT);
      if (s !== this._osdSec) {
        this._osdSec = s;
        this.el.osd.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      }
    }
  }

  // ---------- screens ----------
  _show(name) {
    const e = this.el;
    this.state = name;
    e.start.hidden = name !== 'start';
    e.pause.hidden = name !== 'pause';
    e.death.hidden = name !== 'dead';
    e.win.hidden = name !== 'win';
    // readers belong to play: hidden under pause/settings, back when play resumes
    e.lore.hidden = !(name === 'playing' && this.overlay === 'lore');
    e.intro.hidden = !(name === 'playing' && this.overlay === 'intro');
    e.settings.hidden = name !== 'settings';
    e.hud.hidden = name !== 'playing';
    if (this.touchCtl) this.touchCtl.show(name === 'playing');
    if (name !== 'playing') this._prompt(null);
  }

  _onState(state) {
    if (state === 'playing') this._show('playing');
    else if (state === 'paused') { this._pausedAt = performance.now(); if (this.state !== 'settings') { this._show('pause'); $('btn-resume').focus({ preventScroll: true }); } }
    else if (state === 'dead') { this.deathT = 0; this._fillDeath(this.game && this.game.deathInfo); this._show('dead'); $('btn-again').focus({ preventScroll: true }); }
    else if (state === 'won') { this.deathT = 0; this._fillWin(this.game && this.game.winInfo); this._show('win'); $('btn-win-again').focus({ preventScroll: true }); }
    else if (state === 'menu') this.showStart();
    if (state !== 'playing') this._clearToasts();
    if (state === 'dead' || state === 'won' || state === 'menu') this._taskHide();
    // a restart or a death drops any open reader
    if (state === 'dead' || state === 'won' || state === 'menu') this.overlay = null;
  }

  _fillWin(d) {
    d = d || {};
    $('win-title').textContent = d.title || 'You got out';
    $('win-line').textContent = d.line || 'The EXIT was real. M.E.G. would like a word.';
    $('win-time').textContent = fmtTime(d.time);
    $('win-distance').textContent = `${Math.round(d.distance || 0)} m`;
    $('win-escapes').textContent = String(d.escapes || 0);
    const best = $('win-best');
    best.textContent = fmtTime(d.best || d.time);
    best.classList.toggle('best-flag', !!d.newBest);
    if (d.newBest) best.textContent += ' new';
    $('win-tapes').textContent = d.tapes != null ? `VHS tapes recovered: ${d.tapes}` : '';
  }

  // ---------- hud: objectives ----------
  _objectives(d) {
    const e = this.el, list = (d && d.list) || [];
    e.objectives.hidden = !list.length;
    let done = 0;
    const frag = document.createDocumentFragment();
    for (const it of list) {
      if (it.done) done++;
      const li = document.createElement('li');
      li.className = it.done ? 'done' : it.active || it.id === d.activeId ? 'active' : '';
      const box = document.createElement('i');
      box.className = `ico ${it.done ? 'ico-checkbox_checked' : 'ico-checkbox_unchecked'}`;
      box.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = it.text;
      const prog = document.createElement('span');
      prog.className = 'prog';
      if (it.total > 1) prog.textContent = `${Math.min(it.progress || 0, it.total)}/${it.total}`;
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = it.done ? 'done: ' : it.active ? 'current: ' : '';
      li.append(box, sr, txt, prog);
      frag.append(li);
      // nearby task names under the active step
      const sub = it.sub || it.tasks;
      if (sub && sub.length && li.className === 'active') {
        const ul = document.createElement('ul');
        ul.className = 'obj-sub';
        for (const st of sub.slice(0, 4)) {
          const s = typeof st === 'string' ? { text: st } : st;
          const sl = document.createElement('li');
          if (s.done) sl.className = 'done';
          sl.textContent = s.text;
          if (s.dist != null) { const d = document.createElement('span'); d.className = 'd'; d.textContent = ` ${Math.round(s.dist)} m`; sl.append(d); }
          ul.append(sl);
        }
        const wrap = document.createElement('li');
        wrap.className = 'sub-wrap';
        wrap.append(ul);
        frag.append(wrap);
      }
    }
    e.objList.replaceChildren(frag);
    e.objCount.textContent = `${done}/${list.length}`;
    this._touchFit();
  }

  // ---------- hud: compass (frame.compass, no dom writes unless the snapped value changes) ----------
  _updateCompass() {
    const g = this.game, e = this.el, c = this._cmp;
    const f = g && g.frame, k = f && f.compass;
    const on = !!(k && k.active);
    if (on !== c.on) { c.on = on; e.compass.hidden = !on; }
    if (!on) return;
    // bearing is the world yaw that faces the target; yaw grows to the left, css rotation grows clockwise
    let rel = (k.bearing - f.cam.yaw) % TAU;
    if (rel > Math.PI) rel -= TAU; else if (rel < -Math.PI) rel += TAU;
    const step = ((Math.round(-rel / (TAU / COMPASS_STEPS)) % COMPASS_STEPS) + COMPASS_STEPS) % COMPASS_STEPS;
    if (step !== c.step) { c.step = step; e.compassIco.style.setProperty('--rot', `${step * (360 / COMPASS_STEPS)}deg`); }
    const dist = Math.round(k.dist);
    const behind = Math.abs(rel) > 2.2;
    if (dist !== c.dist || behind !== c.behind) {
      c.dist = dist; c.behind = behind;
      e.compassDist.textContent = `${dist} m`;
      e.compassDist.classList.toggle('behind', behind);
      e.compass.setAttribute('aria-label', `Objective ${dist} metres ${behind ? 'behind you' : rel > 0.3 ? 'to the left' : rel < -0.3 ? 'to the right' : 'ahead'}`);
    }
  }

  // ---------- hud: inventory hotbar ----------
  _inventory(d) {
    if (!d) return;
    const e = this.el, v = this._inv;
    const set = (slot, n, max, label) => {
      slot.classList.toggle('empty', !(n > 0));
      slot.querySelector('.count').textContent = String(n || 0);
      slot.setAttribute('aria-label', `${label}: ${n || 0}${max ? ` of ${max}` : ''}`);
    };
    const bump = (slot, before, now) => {
      if (before < 0 || now === before) return;
      slot.classList.add('bump');
      clearTimeout(slot._bump);
      slot._bump = setTimeout(() => slot.classList.remove('bump'), 450);
    };
    bump(e.slotAlmond, v.almond, d.almond || 0);
    bump(e.slotAirhorn, v.airhorn, d.airhorn || 0);
    set(e.slotAlmond, d.almond, d.almondMax, 'Almond water');
    set(e.slotAirhorn, d.airhorn, d.airhornMax, 'Airhorn charges');
    v.almond = d.almond || 0; v.airhorn = d.airhorn || 0;
    // the hotbar appears with the first thing you pick up and then stays
    if ((d.almond || 0) > 0 || (d.airhorn || 0) > 0) e.hotbar.hidden = false;
  }

  // ---------- hud: party mode (frame.party, read every frame; transforms + opacity only) ----------
  _buildParty() {
    const box = $('party-letters'), P = this._party;
    for (const ch of PARTY_TITLE) {
      const s = document.createElement('span');
      if (ch === ' ') { s.className = 'gap'; box.append(s); continue; }
      s.className = 'l';
      s.textContent = ch;
      box.append(s);
      P.letters.push(s);
    }
    P.ly = new Int8Array(P.letters.length);
  }

  _updateParty() {
    const g = this.game, P = this._party, e = this.el;
    const fp = g && g.frame && g.frame.party;
    const on = !!(fp && fp.active && fp.intensity > 0.001);
    if (on !== P.on) this._partyShow(on);
    if (!on) return;
    const k = fp.intensity > 1 ? 1 : fp.intensity;
    if (Math.abs(k - P.k) > 0.004 || (k === 1 && P.k !== 1)) {
      P.k = k;
      // enters from 0.94, never from nothing
      e.partyStack.style.opacity = k.toFixed(3);
      e.partyStack.style.transform = `scale(${(0.94 + 0.06 * k).toFixed(3)})`;
    }
    const reduce = this._reduceMotion.matches;
    const b = Number.isFinite(fp.beat) ? fp.beat : 0;
    const n = Math.floor(b), f = b - n;
    // colours step once per beat (reduced motion: every other beat); the rainbow walks right across the title
    const step = reduce ? n >> 1 : n;
    if (step !== P.step) {
      P.step = step;
      for (let i = 0; i < P.letters.length; i++) {
        const c = (((i - step) % 7) + 7) % 7, s = P.letters[i].style;
        s.color = RAINBOW[c];
        s.setProperty('--sh', RAINBOW_SH[c]);
      }
      // the small line skips the dark blue, which does not read at 13.5 px over a lit corridor
      let c = ((step % 6) + 6) % 6;
      if (c >= 5) c++;
      e.partyNow.style.color = RAINBOW[c];
      e.partyNow.style.textShadow = `2px 2px 0 ${RAINBOW_SH[c]}`;
    }
    if (!reduce) {
      // letters bounce in a wave, each landing on its beat
      for (let i = 0; i < P.letters.length; i++) {
        let fi = b - i * PARTY_WAVE;
        fi -= Math.floor(fi);
        const y = Math.round(-PARTY_HOP * 4 * fi * (1 - fi) * k);
        if (y !== P.ly[i]) { P.ly[i] = y; P.letters[i].style.transform = `translateY(${y}px)`; }
      }
      // splash text: minecraft title-screen pulse, kicked on the beat
      const q = 1 - f, pulse = Math.round(q * q * q * q * 100) / 100;
      if (pulse !== P.splash) { P.splash = pulse; e.partySplash.style.transform = `rotate(-6deg) scale(${(1 + 0.14 * pulse).toFixed(3)})`; }
      // hotbar hops with the letters; hearts ripple like minecraft regeneration over the first half of each beat
      const hot = e.hotbar.hidden ? 0 : Math.round(-6 * 4 * f * (1 - f) * k);
      if (hot !== P.hot) { P.hot = hot; e.hotbar.style.transform = hot ? `translateY(${hot}px)` : ''; }
      if (this.hearts) this.hearts.hop(f < 0.5 ? Math.floor(f * 16) : -1);
    } else {
      // reduced motion: no movement, the splash only brightens on the beat
      const pulse = Math.round((1 - f) * (1 - f) * 20) / 20;
      if (pulse !== P.splash) { P.splash = pulse; e.partySplash.style.opacity = (0.7 + 0.3 * pulse).toFixed(2); }
    }
    // song bar: the audio clock when there is one, else the party's own clock
    const a = this.audio;
    let t = a && typeof a.partyTime === 'function' ? a.partyTime() : NaN;
    if (!Number.isFinite(t)) t = fp.t || 0;
    const dur = P.dur || (g.manifest && g.manifest.party && g.manifest.party.duration) || 35;
    const fill = Math.round(Math.max(0, Math.min(1, t / dur)) * 1000) / 1000;
    if (fill !== P.fill) { P.fill = fill; e.partyFill.style.transform = `scaleX(${fill})`; }
    const sec = Math.min(Math.floor(t), Math.floor(dur));
    if (sec !== P.sec) { P.sec = sec; e.partyTime.textContent = `${fmtTime(sec)} / ${fmtTime(dur)}`; }
  }

  _partyShow(on) {
    const P = this._party, e = this.el;
    P.on = on;
    e.party.hidden = !on;
    if (on) {
      P.k = -1; P.step = null; P.sec = -1; P.fill = -1; P.splash = -1; P.ly.fill(0);
      for (const l of P.letters) l.style.transform = '';
      e.partySplash.style.transform = ''; e.partySplash.style.opacity = '';
      // phones: toasts sit at the bottom there, keep them above the banner (tasks are closed during a party)
      if (!this.touch && this._narrow.matches && !this.task) requestAnimationFrame(() => { if (P.on && !this.task) { e.toasts.style.bottom = `${e.party.offsetHeight + 90}px`; P.lifted = true; } });
    } else {
      P.hot = 0; e.hotbar.style.transform = '';
      if (this.hearts) this.hearts.hop(-1);
      if (P.lifted && !this.task) e.toasts.style.bottom = '';
      P.lifted = false;
    }
  }

  // narrow screens keep toasts low (touch portrait: just above the dot), so an open task panel pushes them up
  _liftToasts() { return this.touch ? this._portrait.matches : this._narrow.matches; }
  _above(el) { return `${Math.round(innerHeight - el.getBoundingClientRect().top + 8)}px`; }

  // ---------- toasts ----------
  /** { text, kind: 'meme' | 'lore' | 'info', ms } */
  toast(d) {
    if (!d || !d.text) return;
    if (this.touch) d = { ...d, text: touchText(d.text) };
    const e = this.el;
    if (d.kind === 'meme') {
      const m = e.memeToast;
      m.textContent = d.text;
      m.classList.remove('out');
      this._meme.t = (d.ms || 2200) / 1000;
      if (this.touch) { this._meme.t = Math.min(this._meme.t, 1.8); this._fitMeme(); this._touchFit(); }
      return;
    }
    const el = document.createElement('div');
    el.className = `toast px-panel ${d.kind === 'lore' ? 'lore' : 'info'} out`;
    el.textContent = d.text;
    e.toasts.append(el);
    // next frame so the entrance is a transition (retargetable), not a keyframe
    requestAnimationFrame(() => el.classList.remove('out'));
    this._toasts.push({ el, t: (d.ms || (d.kind === 'lore' ? 4200 : 2800)) / 1000, dead: false });
    while (this._toasts.length > TOAST_MAX) this._dropToast(this._toasts.shift());
    this._touchFit();
  }

  // touch: the meme caption steps its size down until it fits two lines
  _fitMeme() {
    const m = this.el.memeToast;
    const sizes = this._portrait.matches ? [28, 24, 21, 18, 16] : [24, 21, 18, 16];
    for (const px of sizes) {
      m.style.fontSize = `${px}px`;
      if (m.scrollHeight <= px * 1.05 * 2 + 6) break;
    }
  }

  // touch: floating text never lands on the hud, the prompt, a panel or the thumbs' controls. portrait: the caption
  // sits under the top hud; both: toasts keep the newest two and drop the older one while the stack collides.
  _touchFit() {
    if (!this.touch || this.state !== 'playing') return;
    const e = this.el, land = !this._portrait.matches;
    const live = this._toasts.filter((t) => !t.dead);
    live.forEach((t, i) => t.el.classList.toggle('gone', i < live.length - 2));
    const shown = live.slice(-2);
    const R = (el) => el.getBoundingClientRect();
    const on = (el) => el && !el.hidden && el.offsetParent !== null;
    const m = e.memeToast, memeOn = this._meme.t > 0;
    if (land) {
      m.style.top = '';
      const lim = R($('t-light')).top - 8;
      while (shown.length > 1 && R(e.toasts).bottom > lim) shown.shift().el.classList.add('gone');
      return;
    }
    let hud = 0;
    for (const el of [e.objectives, e.compass, $('t-pause'), this.hearts && this.hearts.canvas]) if (on(el)) hud = Math.max(hud, R(el).bottom);
    m.style.top = `${Math.round(hud + 8)}px`;
    const top = () => (memeOn && !m.classList.contains('out') ? R(m).bottom : hud) + 6;
    while (shown.length > 1 && R(e.toasts).top < top()) shown.shift().el.classList.add('gone');
    // one toast still in the way: the caption (the shortest-lived thing) gives way
    if (memeOn && R(e.toasts).top < top()) { this._meme.t = 0; m.classList.add('out'); }
  }

  _dropToast(t) {
    t.dead = true;
    t.el.classList.add('out');
    setTimeout(() => t.el.remove(), 240);
  }

  _updateToasts(dt) {
    const m = this._meme;
    if (m.t > 0) { m.t -= dt; if (m.t <= 0) this.el.memeToast.classList.add('out'); }
    for (let i = this._toasts.length - 1; i >= 0; i--) {
      const t = this._toasts[i];
      t.t -= dt;
      if (t.t <= 0) { this._toasts.splice(i, 1); this._dropToast(t); }
    }
  }

  _clearToasts() {
    for (const t of this._toasts) t.el.remove();
    this._toasts.length = 0;
    this._meme.t = 0;
    this.el.memeToast.classList.add('out');
  }

  // ---------- task mini-games (render only; gameplay owns input) ----------
  _taskOpen(d) {
    if (!d) return;
    const e = this.el, data = d.data || {};
    const ui = data.ui || TASK_UI[d.kind] || 'hold';
    const T = (this.task = { id: d.id, kind: d.kind, ui, data, t: -1, step: -1, total: data.total || (ui === 'press' ? 3 : 4), window: data.window || [0.62, 0.8], closeT: 0, resultT: 0 });
    e.task.classList.remove('ok', 'fail', 'hide', 'flash');
    e.taskTitle.textContent = d.title || d.kind || 'Task';
    e.taskMsg.replaceChildren();
    e.taskHint.replaceChildren();
    if (d.hint) this._keycapText(e.taskHint, this._tt(d.hint));
    const body = document.createDocumentFragment();
    if (ui === 'swipe') {
      T.lcd = document.createElement('div'); T.lcd.className = 'reader-lcd'; T.lcd.textContent = data.lcd || 'Please swipe card';
      const track = document.createElement('div'); track.className = 'slot-track';
      T.card = document.createElement('div'); T.card.className = 'id-card'; track.append(T.card);
      T.track = track;
      const bar = document.createElement('div'); bar.className = 'bar';
      T.win = document.createElement('b'); T.win.className = 'win';
      T.mark = document.createElement('b'); T.mark.className = 'mark';
      bar.append(T.win, T.mark);
      body.append(T.lcd, track, bar);
      this._taskWindow(T.window);
    } else if (ui === 'wires') {
      body.append(this._wiresSvg(T), this._wireKeys(T));
    } else if (ui === 'press') {
      const pips = document.createElement('div'); pips.className = 'pips';
      T.pips = [];
      for (let i = 0; i < T.total; i++) { const b = document.createElement('b'); pips.append(b); T.pips.push(b); }
      T.count = document.createElement('span'); pips.append(T.count);
      body.append(pips);
    } else {
      const bar = document.createElement('div'); bar.className = 'bar';
      T.fill = document.createElement('i'); bar.append(T.fill);
      body.append(bar);
    }
    e.taskBody.replaceChildren(body);
    e.task.hidden = false;
    this._prompt(null);
    // phones keep toasts above the hotbar: lift them over the panel while it is up
    if (this._liftToasts()) requestAnimationFrame(() => { if (this.task) { e.toasts.style.bottom = this.touch ? this._above(e.task) : `${e.task.offsetHeight + 84}px`; this._touchFit(); } });
    this._taskProgress({ id: d.id, t: 0, step: 0, total: T.total });
  }

  _taskProgress(d) {
    const T = this.task;
    if (!T || !d || (d.id != null && T.id != null && d.id !== T.id)) return;
    if (d.total && d.total !== T.total && T.ui === 'press') { this._taskOpen({ id: T.id, kind: T.kind, title: this.el.taskTitle.textContent, data: { ...T.data, total: d.total } }); }
    if (d.window && (d.window[0] !== T.window[0] || d.window[1] !== T.window[1])) { T.window = d.window; this._taskWindow(d.window); }
    if (d.t != null) {
      const t = d.t < 0 ? 0 : d.t > 1 ? 1 : d.t;
      if (Math.abs(t - T.t) > 0.002) {
        T.t = t;
        if (T.ui === 'swipe') {
          T.mark.style.left = `${t * 100}%`;
          // the card slides across the slot; its width is 64 + 4 px
          T.card.style.transform = `translateX(${Math.round(t * (T.track.clientWidth - 68))}px)`;
        } else if (T.fill) T.fill.style.transform = `scaleX(${t})`;
      }
    }
    if (d.step != null && d.step !== T.step) {
      T.step = d.step;
      if (T.ui === 'press') {
        for (let i = 0; i < T.pips.length; i++) T.pips[i].classList.toggle('on', i < d.step);
        T.count.textContent = `${Math.min(d.step, T.total)}/${T.total}`;
      } else if (T.ui === 'wires') this._wiresDraw(T);
    }
    if (d.wrong) this._taskFlash();
  }

  _taskResult(d) {
    const T = this.task, e = this.el;
    if (!T || !d || (d.id != null && T.id != null && d.id !== T.id)) return;
    e.task.classList.toggle('ok', !!d.ok);
    e.task.classList.toggle('fail', !d.ok);
    const msg = d.msg || (d.ok ? 'Task complete.' : 'Try again.');
    e.taskMsg.replaceChildren();
    if (d.ok) { const i = document.createElement('i'); i.className = 'ico'; i.setAttribute('aria-hidden', 'true'); e.taskMsg.append(i); }
    e.taskMsg.append(msg);
    if (T.lcd) T.lcd.textContent = d.ok ? 'Accepted. Thank you.' : msg.replace(/\.$/, '');
    if (d.ok && T.ui === 'wires') { T.step = T.total; this._wiresDraw(T); }
    if (d.ok && T.fill) T.fill.style.transform = 'scaleX(1)';
    if (d.ok && T.ui === 'press') this._taskProgress({ id: T.id, step: T.total });
    if (!d.ok) this._taskFlash();
    T.resultT = performance.now();
  }

  _taskClose(d) {
    const T = this.task;
    if (!T || (d && d.id != null && T.id != null && d.id !== T.id)) return;
    // keep a fresh result readable for a moment
    const age = (performance.now() - T.resultT) / 1000;
    if (T.resultT && age < TASK_LINGER) { T.closeT = TASK_LINGER - age; this.el.task.classList.add('hide'); this.el.task.style.transitionDelay = `${Math.round(T.closeT * 800)}ms`; }
    else this._taskHide();
  }

  _taskHide() {
    if (!this.task) return;
    this.task = null;
    const e = this.el;
    e.task.hidden = true;
    e.task.style.transitionDelay = '';
    e.toasts.style.bottom = '';
    e.task.classList.remove('hide', 'ok', 'fail', 'flash');
  }

  _taskFlash() {
    const el = this.el.task;
    el.classList.remove('flash');
    void el.offsetWidth; // restart: a wrong press should always blink
    el.classList.add('flash');
  }

  _taskWindow(w) {
    const T = this.task;
    if (!T || !T.win) return;
    T.win.style.left = `${w[0] * 100}%`;
    T.win.style.width = `${Math.max(0, w[1] - w[0]) * 100}%`;
  }

  // "Hold [E] until it beeps" -> text with keycaps for bracketed keys
  _keycapText(el, text) {
    const parts = String(text).split(/\[([^\]]{1,6})\]/);
    parts.forEach((p, i) => { if (i % 2) { const k = document.createElement('kbd'); k.textContent = p; el.append(k); } else if (p) el.append(p); });
  }

  _wiresSvg(T) {
    const d = T.data;
    const left = (d.left || d.colors || ['red', 'blue', 'yellow', 'pink']).slice(0, 4);
    const right = (d.right || [left[2], left[0], left[3], left[1]]).slice(0, 4);
    T.left = left; T.right = right; T.total = left.length;
    const W = 420, H = 160, row = (i) => 22 + i * 38;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    const box = document.createElementNS(SVGNS, 'rect');
    Object.entries({ x: 0, y: 0, width: W, height: H, fill: '#1a170f' }).forEach(([k, v]) => box.setAttribute(k, v));
    svg.append(box);
    T.links = document.createElementNS(SVGNS, 'g');
    svg.append(T.links);
    const col = (c) => WIRE_COLORS[c] || c;
    const rect = (x, y, w, h, fill) => { const r = document.createElementNS(SVGNS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('fill', fill); r.setAttribute('stroke', '#0b0906'); r.setAttribute('stroke-width', 2); return r; };
    T.leftEls = [];
    left.forEach((c, i) => {
      svg.append(rect(0, row(i) - 7, 44, 14, col(c)));
      const cap = rect(44, row(i) - 9, 12, 18, '#b9b09a');
      svg.append(cap);
      T.leftEls.push(cap);
    });
    right.forEach((c, i) => {
      // terminal cap, then the key label, then the coloured stub: wires end at the cap and never cross a label
      svg.append(rect(W - 80, row(i) - 9, 12, 18, '#b9b09a'));
      svg.append(rect(W - 44, row(i) - 7, 44, 14, col(c)));
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', W - 62); t.setAttribute('y', row(i) + 6);
      t.textContent = String(i + 1);
      svg.append(t);
    });
    svg.setAttribute('aria-label', `Connect ${left.join(', ')} to terminals 1 to ${right.length}`);
    const wrap = document.createElement('div');
    wrap.className = 'wires';
    wrap.append(svg);
    T.svg = svg; T.W = W; T.row = row;
    return wrap;
  }

  // touch: one tappable key per right-hand terminal, in its wire colour (keys 1-4 do the same)
  _wireKeys(T) {
    const row = document.createElement('div');
    row.className = 'wire-keys touch-only';
    T.right.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wire-key';
      b.tabIndex = -1;
      b.setAttribute('aria-label', `Terminal ${i + 1}, ${c}`);
      const chip = document.createElement('b');
      chip.style.background = WIRE_COLORS[c] || c;
      chip.setAttribute('aria-hidden', 'true');
      b.append(chip, String(i + 1));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._touchT = performance.now();
        if (this.game) this.game.input.press(`wire${i + 1}`);
      });
      row.append(b);
    });
    return row;
  }

  _wiresDraw(T) {
    const g = T.links;
    g.replaceChildren();
    const col = (c) => WIRE_COLORS[c] || c;
    for (let i = 0; i < Math.min(T.step, T.left.length); i++) {
      const j = T.right.indexOf(T.left[i]);
      if (j < 0) continue;
      // pixel wire: horizontal, vertical, horizontal (no diagonal anti-aliasing)
      const x0 = 56, x1 = T.W - 80, mx = Math.round(140 + i * 36), y0 = T.row(i), y1 = T.row(j);
      const pts = `${x0},${y0} ${mx},${y0} ${mx},${y1} ${x1},${y1}`;
      for (const [w, c] of [[12, '#0b0906'], [8, col(T.left[i])]]) {
        const pl = document.createElementNS(SVGNS, 'polyline');
        pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', c); pl.setAttribute('stroke-width', w);
        pl.setAttribute('stroke-linejoin', 'miter'); pl.setAttribute('stroke-linecap', 'square');
        g.append(pl);
      }
    }
    // the next wire to connect gets a bright cap
    T.leftEls.forEach((el, i) => el.setAttribute('fill', i === T.step ? '#f2dd84' : '#b9b09a'));
  }

  // ---------- lore reader + intro transmission ----------
  _openReader(kind, d) {
    d = d || {};
    const e = this.el;
    this.overlay = kind;
    this.readerT = 0;
    this._prompt(null);
    if (kind === 'intro') {
      $('intro-title').textContent = d.title || 'M.E.G. // Base Alpha';
      const body = $('intro-body');
      body.replaceChildren();
      for (const para of String(this._tt(d.body || '')).split(/\n{2,}/)) {
        const p = document.createElement('p');
        p.textContent = para;
        body.append(p);
      }
      // paragraphs arrive one by one (opacity only); any key or click shows the rest first
      this._introT = 0; this._introNext = 0;
      this._updateIntro(0);
      body.scrollTop = 0;
    } else {
      $('lore-title').textContent = d.title || '';
      const body = $('lore-body');
      body.textContent = this._tt(d.body || '');
      body.scrollTop = 0;
    }
    e.lore.hidden = !(this.state === 'playing' && kind === 'lore');
    e.intro.hidden = !(this.state === 'playing' && kind === 'intro');
    const card = kind === 'intro' ? e.intro : e.lore;
    if (!card.hidden) card.querySelector('.reader-body').focus({ preventScroll: true });
  }

  _updateIntro(dt) {
    const ps = $('intro-body').children;
    this._introT += dt;
    const reduce = this._reduceMotion.matches;
    while (this._introNext < ps.length && (reduce || this._introT >= this._introNext * 0.55)) ps[this._introNext++].classList.add('on');
  }

  _introRevealed() {
    const ps = $('intro-body').children;
    if (this._introNext >= ps.length) return true;
    while (this._introNext < ps.length) ps[this._introNext++].classList.add('on');
    return false;
  }

  /** fromUser: the ui closed it (asks the game); false: the game already closed it (lore:close) */
  _closeReader(fromUser) {
    if (!this.overlay) return;
    this.overlay = null;
    this.el.lore.hidden = true;
    this.el.intro.hidden = true;
    if (fromUser && this.game && this.game.closeLore) this.game.closeLore();
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.reader')) document.activeElement.blur();
  }

  // capture phase, so the same press never reaches the game as a swing / interaction
  _readerInput(e, isKey) {
    if (!this.overlay || this.state !== 'playing') return;
    if (isKey) {
      const close = e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space';
      if (!close || e.repeat) return;
      // the game dismisses on E / Enter / Space itself while it is reading; the ui handles the rest
      const gameOwns = this.game && this.game.reading && e.code !== 'Escape';
      if (this.overlay === 'intro' && !this._introRevealed()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (gameOwns) return;
      e.preventDefault(); e.stopImmediatePropagation();
    } else {
      e.preventDefault(); e.stopImmediatePropagation();
      // the mouse events a tap leaves behind: the touch path already handled it
      if (e.type === 'mousedown' && performance.now() - this._touchT < 900) return;
      if (this.overlay === 'intro' && !this._introRevealed()) return;
    }
    if (this.readerT < READER_GUARD) return;
    this._closeReader(true);
  }

  _fillDeath(d) {
    const e = this.el;
    d = d || {};
    e.deathLine.textContent = d.line || FALLBACK_LINES[(d.distance || 0) % FALLBACK_LINES.length];
    e.deathDistance.textContent = `${Math.round(d.distance || 0)} m`;
    e.deathEscapes.textContent = String(d.escapes || 0);
    e.deathBest.textContent = `${Math.round(d.best || 0)} m`;
    const face = $('death-face');
    if (face) {
      face.hidden = !d.charId;
      if (d.charId) face.src = `./assets/img/${d.charId}.webp`;
    }
  }

  _prompt(text) {
    const p = this.el.prompt;
    if (!text) { if (!p.hidden) { p.hidden = true; p.textContent = ''; } return; }
    text = this._tt(text);
    // "E  Open door" -> keycap + label
    const m = /^([A-Z0-9]{1,5})\s{2,}(.+)$/.exec(text);
    p.textContent = '';
    if (m) {
      const k = document.createElement('kbd');
      k.textContent = m[1];
      p.append(k, m[2]);
    } else p.textContent = text;
    p.hidden = this.state !== 'playing' || !!this.task;
  }

  _openSettings(from) {
    this.settingsFrom = from;
    this._sync();
    this._show('settings');
    this.el.form.querySelector('select, input').focus({ preventScroll: true });
  }

  _closeSettings() {
    const from = this.settingsFrom || 'start';
    this.settingsFrom = null;
    if (from === 'pause') { this._show('pause'); $('btn-pause-settings').focus({ preventScroll: true }); }
    else { this._show('start'); $('btn-start-settings').focus({ preventScroll: true }); }
  }

  _restart() {
    if (!this.game) return;
    this.game.restart();
  }

  // ---------- wiring ----------
  _bind() {
    const start = () => { if (this.onStart) this.onStart(); };
    $('btn-start').addEventListener('click', start);
    $('btn-start-settings').addEventListener('click', () => this._openSettings('start'));
    $('btn-resume').addEventListener('click', () => { if (this.game) this.game.resume(); });
    $('btn-pause-settings').addEventListener('click', () => this._openSettings('pause'));
    $('btn-restart').addEventListener('click', () => this._restart());
    $('btn-back').addEventListener('click', () => this._closeSettings());
    $('btn-reset').addEventListener('click', () => { this.settings.reset(); this._sync(); });
    $('btn-win-again').addEventListener('click', () => this._restart());
    $('btn-rotate-ok').addEventListener('click', () => { $('rotate-hint').hidden = true; $('btn-start').focus({ preventScroll: true }); });
    // death: click anywhere on the screen, R or Space
    this.el.death.addEventListener('click', () => { if (this.deathT >= DEATH_GUARD) this._restart(); });
    addEventListener('keydown', (e) => this._readerInput(e, true), true);
    addEventListener('mousedown', (e) => this._readerInput(e, false), true);
    // touch readers close on a tap (a drag scrolls the card instead and ends in pointercancel)
    let tap = null;
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this._touchT = performance.now();
      tap = this.overlay && this.state === 'playing' && e.target.closest && e.target.closest('.reader') ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    }, true);
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return;
      this._touchT = performance.now();
      if (!tap || tap.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      tap = null;
      if (moved < 12) this._readerInput(e, false);
    }, true);
    addEventListener('keydown', (e) => {
      if (this.state === 'dead' || this.state === 'win') {
        if ((e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
          e.preventDefault();
          if (this.deathT >= DEATH_GUARD) this._restart();
        }
      } else if (this.state === 'settings' && e.code === 'Escape') {
        e.preventDefault();
        this._closeSettings();
      } else if (this.state === 'pause' && e.code === 'Escape' && !e.repeat && performance.now() - (this._pausedAt || 0) > 250) {
        // esc toggles pause. browsers won't re-lock the mouse from the esc key itself, so if the lock
        // doesn't come back, one click on the view grabs it (Input's mousedown handler)
        e.preventDefault();
        e.stopImmediatePropagation(); // the game's own esc handler must not see this press and pause again
        const g = this.game;
        if (!g) return;
        g.resume();
        if (!this.touch) setTimeout(() => { if (g.state === 'playing' && g.input && !g.input.locked) this.toast({ text: 'Click to look around', kind: 'info', ms: 2200 }); }, 180);
      }
    });
    this.settings.on((k) => { if (this.state === 'settings') this._syncKey(k); });
  }

  _buildSettings() {
    const form = this.el.form;
    // picture on the left, controls + sound on the right
    const colA = document.createElement('div');
    const colB = document.createElement('div');
    form.append(colA, colB);
    SCHEMA.forEach((group, gi) => {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = group.legend;
      fs.append(lg);
      for (const r of group.rows) fs.append(this._row(r));
      (gi === 0 ? colA : colB).append(fs);
    });
  }

  _row(r) {
    const id = `set-${r.key}`;
    const row = document.createElement('div');
    row.className = r.type === 'check' ? 'row check' : 'row';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = r.label;
    let input, out = null;
    if (r.type === 'select') {
      input = document.createElement('select');
      for (const [v, t] of r.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; input.append(o); }
      input.addEventListener('change', () => this.settings.set(r.key, input.value));
    } else if (r.type === 'check') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => this.settings.set(r.key, input.checked));
    } else {
      input = document.createElement('input');
      input.type = 'range';
      input.min = r.min; input.max = r.max; input.step = r.step;
      out = document.createElement('output');
      out.htmlFor = id;
      input.addEventListener('input', () => {
        const v = +input.value;
        out.textContent = r.fmt(v);
        input.setAttribute('aria-valuetext', r.fmt(v));
        this.settings.set(r.key, v);
      });
    }
    input.id = id;
    input.name = r.key;
    row.append(label, input);
    if (out) row.append(out);
    this._controls.set(r.key, { r, input, out });
    return row;
  }

  _sync() { for (const k of this._controls.keys()) this._syncKey(k); }

  _syncKey(k) {
    const c = this._controls.get(k);
    if (!c) return;
    const v = this.settings.get(k);
    if (c.r.type === 'check') c.input.checked = !!v;
    else if (c.r.type === 'select') c.input.value = v;
    else {
      c.input.value = v;
      c.out.textContent = c.r.fmt(+v);
      c.input.setAttribute('aria-valuetext', c.r.fmt(+v));
    }
  }
}
