// E interactions. a look-at cone (reach ITEMS.reach) picks the best target under the crosshair among doors,
// world features (phones, switches, posters, tvs, radios, vending, coolers, breakers, exit) and pickups.
// recovery alcoves are area based. scanned at 10 hz; breakers are held, everything else is a press.
import { CELL, CHUNK, CELL_TYPE, EYE_H } from '../world/constants.js';
import { DIRECTOR as D, PLAYER, ENEMY, ITEMS } from './tuning.js';
import { PHONE_QUIPS, POSTER_CAPTIONS, TV_CHANNELS, RADIO_LINES, TASK_TEXT, MEME_PROPS } from './lore.js';
import { TASK_KINDS } from './Tasks.js';

// interaction height (m) and target radius for the cone, per feature type
const FEAT = {
  phone: [0.8, 0.25], switch: [1.25, 0.2], lightSwitch: [1.25, 0.2], poster: [1.55, 0.5], tv: [1.2, 0.45],
  radio: [0.9, 0.25], vending: [1.1, 0.6], cooler: [0.9, 0.3], breaker: [1.35, 0.35], exitDoor: [1.1, 0.9],
  task: [1.1, 0.4], meme: [1.0, 0.45], jukebox: [1.0, 0.55],
};
// task prop height (m) and radius by kind, when the feature has no data.y
const TASK_AT = {
  cardSwipe: [1.2, 0.25], wires: [1.3, 0.35], touchGrass: [0.5, 0.5], fixLight: [1.2, 0.45], mop: [0.3, 0.55],
  straighten: [1.55, 0.5], router: [1.0, 0.35], copier: [0.95, 0.5], microwave: [1.1, 0.35], vendingStuck: [1.0, 0.6],
  timesheet: [0.8, 0.35], skibidi: [0.45, 0.4],
};
const ITEM_Y = 0.12, ITEM_R = 0.3;

export class Interactions {
  constructor(game) {
    this.g = game;
    this.kind = null; // 'door' | 'recovery' | 'item' | feature type ('phone', 'switch', 'poster', ...)
    this.door = null;
    this.feature = null;
    this.item = null;
    this.hx = 0; this.hy = 0; this.hz = 0; this.hr = 0;
    this.best = Infinity;
    this.promptText = null;
    this.msg = null;
    this.msgT = 0;
    this.scanT = 0;
    this.used = new Set();
    this.alcoveUses = 0;
    this.phoneN = 0;
    this.tv = new Map();
    this.radio = new Map();
    this.memeT = 0;
    this.linked = new Set(); // props an unfinished task sits on (a crooked poster is the straighten task, not a poster)
  }

  reset() {
    this.used.clear();
    this.alcoveUses = 0;
    this.msg = null;
    this.msgT = 0;
    this.kind = null;
    this.tv.clear();
    this.radio.clear();
    this._emit(null);
  }

  say(text, t = 3.2) {
    this.msg = text;
    this.msgT = t;
    this._emit(text);
  }

  _emit(text) {
    if (text === this.promptText) return;
    this.promptText = text;
    this.g.events.emit('game:prompt', text ? { text } : null);
  }

  update(dt) {
    const g = this.g;
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msg = null;
    }
    if (this.memeT > 0) this.memeT -= dt;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.1;
      this._scan();
    }
    // the open task panel runs its mechanic (hold fill, card swipe clock) and closes if you walk off
    g.tasks.update(dt, g.input.useHeld());
    this._emit(this.msg || this._label());
  }

  _label() {
    const g = this.g, o = g.objectives, ta = g.tasks.busy ? g.tasks.active : null;
    if (ta) {
      const tx = TASK_TEXT[ta.kind] || {};
      return `${ta.breaker ? TASK_TEXT.breakerTitle : tx.title}: ${tx.hint || ''}`;
    }
    switch (this.kind) {
      case null: return null;
      case 'task': {
        const f = this.feature;
        if (o.isBreaker(f)) return o.label(f);
        const k = g.tasks.kindOf(f), tx = TASK_TEXT[k] || {};
        if (g.tasks.isDone(f)) return `${tx.title}: done`;
        const ui = TASK_KINDS[k].ui;
        return ui === 'hold' || ui === 'swipe' ? `Hold E  ${tx.title}` : `E  ${tx.title}`;
      }
      case 'meme': return 'E  Look closer';
      case 'jukebox': return g.party.label();
      case 'door': return this.door.target > 0.5 ? 'E  Close door' : 'E  Open door';
      case 'recovery': return 'E  Catch your breath';
      case 'item': return o.itemLabel(this.item);
      case 'phone': return o.label(this.feature) || 'E  Answer phone';
      case 'switch': return 'E  Flip switch';
      case 'poster': return 'E  Read poster';
      case 'tv': return 'E  Change channel';
      case 'radio': return this.radio.get(this.feature.id) ? 'E  Turn radio off' : 'E  Turn radio on';
      default: return o.label(this.feature);
    }
  }

  // score a candidate against the look direction; keeps the best in this.kind / this.h*
  _consider(kind, ref, x, y, z, r, losX, losZ, fx, fy, fz) {
    const p = this.g.player;
    const dx = x - p.x, dy = y - EYE_H, dz = z - p.z;
    const hd = Math.sqrt(dx * dx + dz * dz);
    if (hd > ITEMS.reach) return;
    const d3 = Math.sqrt(hd * hd + dy * dy);
    let ang = 0;
    if (d3 > 1e-3) {
      const c = (dx * fx + dy * fy + dz * fz) / d3;
      ang = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
    }
    const lim = ITEMS.cone + Math.atan(r / Math.max(d3, 0.3));
    if (ang > lim) return;
    const score = ang / lim + d3 * 0.12;
    if (score >= this.best) return;
    if (losX === losX && !this.g.world.lineOfSight(p.x, p.z, losX, losZ)) return;
    this.best = score;
    this.kind = kind;
    this.door = kind === 'door' ? ref : null;
    this.item = kind === 'item' ? ref : null;
    this.feature = kind !== 'door' && kind !== 'item' ? ref : null;
    this.hx = x; this.hy = y; this.hz = z; this.hr = r;
  }

  _scan() {
    const g = this.g, w = g.world, p = g.player, o = g.objectives;
    this.kind = null; this.door = null; this.feature = null; this.item = null;
    this.best = Infinity;
    if (g.lb > 0.5) return; // looking behind
    const cp = Math.cos(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;
    const hx = -Math.sin(p.yaw), hz = -Math.cos(p.yaw);

    // doors along the horizontal look ray
    for (let s = 0.35; s <= ITEMS.reach; s += 0.2) {
      const ix = Math.floor((p.x + hx * s) / CELL), iz = Math.floor((p.z + hz * s) / CELL);
      const t = w.cell(ix, iz);
      if (t === CELL_TYPE.DOOR) {
        const d = w.doorAt(ix, iz);
        if (d) {
          const cx = (d.ix + (d.axis === 'x' ? 1 : 0.5)) * CELL, cz = (d.iz + (d.axis === 'x' ? 0.5 : 1)) * CELL;
          this._consider('door', d, cx, 1.2, cz, 0.6, NaN, 0, fx, fy, fz);
        }
        break;
      }
      if (t === CELL_TYPE.WALL || t === CELL_TYPE.COLUMN) break;
    }

    // pickups
    for (const it of o.items) {
      if (it.taken) continue;
      if (Math.abs(it.x - p.x) > ITEMS.reach || Math.abs(it.z - p.z) > ITEMS.reach) continue;
      this._consider('item', it, it.x, ITEM_Y, it.z, ITEM_R, it.x, it.z, fx, fy, fz);
    }

    // world features in the 3x3 chunks around the player, plus objective stand-ins
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK);
    let alcove = null;
    const linked = this.linked;
    linked.clear();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const f of w.getChunk(pcx + dx, pcz + dz).features || []) {
        if (f.type !== 'task' || !f.data || g.tasks.isDone(f)) continue;
        const d = f.data;
        if (d.posterId) linked.add(d.posterId);
      }
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const feats = w.getChunk(pcx + dx, pcz + dz).features;
        if (!feats) continue;
        for (let i = 0; i < feats.length; i++) {
          const f = feats[i];
          if (f.type === 'recovery') { if (!alcove && this._inAlcove(f)) alcove = f; continue; }
          if (linked.has(f.id)) continue;
          this._feature(f, fx, fy, fz);
        }
      }
    }
    for (const f of o.virtual) this._feature(f, fx, fy, fz);

    // alcoves are area based: inside one with nothing else targeted, E catches your breath
    if (!this.kind && alcove) { this.kind = 'recovery'; this.feature = alcove; this.hr = 0; }
  }

  _feature(f, fx, fy, fz) {
    const spec = FEAT[f.type];
    if (!spec) return;
    if (f.type === 'phone' && f.answered) return;
    const p = this.g.player;
    if (Math.abs(f.x - p.x) > ITEMS.reach + 0.5 || Math.abs(f.z - p.z) > ITEMS.reach + 0.5) return;
    if (f.type === 'task' && !this.g.tasks.kindOf(f)) return;
    const at = f.type === 'task' ? TASK_AT[f.data.kind] || spec : spec;
    const y = (f.data && Number.isFinite(f.data.y) ? f.data.y : at[0]);
    let r = at[1];
    if (f.type === 'poster' && f.data && Number.isFinite(f.data.h)) r = Math.max(r, f.data.h / 2);
    // test sight to a point just in front of the feature (wall-mounted ones sit on the wall face)
    const ox = -Math.sin(f.yaw || 0) * 0.3, oz = -Math.cos(f.yaw || 0) * 0.3;
    this._consider(f.type === 'lightSwitch' ? 'switch' : f.type, f, f.x, y, f.z, r, f.x + ox, f.z + oz, fx, fy, fz);
  }

  _inAlcove(f) {
    const g = this.g, p = g.player;
    if (this.used.has(f.id) || this.alcoveUses >= D.alcoveLimit || g.enemy.active) return false;
    const r = f.data;
    if (r && Number.isFinite(r.x0)) {
      // alcove interior rectangle in world metres (plus a little doorway slack)
      return !(p.x < Math.min(r.x0, r.x1) - 0.3 || p.x > Math.max(r.x0, r.x1) + 0.3 || p.z < Math.min(r.z0, r.z1) - 0.3 || p.z > Math.max(r.z0, r.z1) + 0.3);
    }
    return Math.hypot(f.x - p.x, f.z - p.z) <= Math.max(f.w || 2, f.d || 2) / 2 + 0.5;
  }

  // true if a body overlaps any cell belonging to this door
  _doorBlocked(door, x, z, r) {
    const w = this.g.world;
    const ix0 = Math.floor((x - r) / CELL), ix1 = Math.floor((x + r) / CELL);
    const iz0 = Math.floor((z - r) / CELL), iz1 = Math.floor((z + r) / CELL);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) if (w.doorAt(ix, iz) === door) return true;
    return false;
  }

  setDoor(door, open, x, z) {
    const g = this.g, w = g.world, p = g.player, e = g.enemy;
    if (!open) {
      if (this._doorBlocked(door, p.x, p.z, PLAYER.radius + 0.12)) return false;
      if (e.active && this._doorBlocked(door, e.x, e.z, ENEMY.radius + 0.12)) return false;
    }
    w.setDoorTarget(door, open ? 1 : 0);
    g.audio.sfx(open ? 'doorOpen' : 'doorClose', { x, z, gain: 1 });
    return true;
  }

  _caption(table, v, fallback) {
    const cells = table && Array.isArray(table.cells) ? table.cells : null;
    if (cells && cells.length) return { text: cells[((v % cells.length) + cells.length) % cells.length].caption || fallback[v % fallback.length], n: cells.length };
    return { text: fallback[((v % fallback.length) + fallback.length) % fallback.length], n: fallback.length };
  }

  _meme(cat, f, gain = 1) {
    // posters/tvs can be spammed; the sound gets a short cooldown, the caption does not
    if (this.memeT > 0) return;
    this.memeT = 0.8;
    this.g.meme(cat, f, gain);
  }

  use() {
    const g = this.g, w = g.world, p = g.player, o = g.objectives;
    if (g.state !== 'playing' || g.reading || g.loreGuard > 0) return;
    if (this.scanT > 0.05) this._scan();
    switch (this.kind) {
      case 'door': {
        const d = this.door;
        const ok = this.setDoor(d, d.target <= 0.5, (d.ix + 0.5) * CELL, (d.iz + 0.5) * CELL);
        if (!ok) this.say('Something is in the way.', 1.4);
        break;
      }
      case 'item': o.pick(this.item, false); break;
      case 'task': {
        const f = this.feature;
        if (o.isBreaker(f)) { o.useFeature(f); break; }
        if (g.tasks.isDone(f)) { g.toast(TASK_TEXT.already, 'info', 1400); break; }
        // E opens the panel and counts as the first press / starts the hold or swipe
        if (g.tasks.open(f)) g.tasks.down();
        break;
      }
      case 'jukebox': g.party.use(this.feature); break;
      case 'meme': {
        const f = this.feature;
        const k = f.data && f.data.kind;
        g.toast(MEME_PROPS[k] || 'It is a meme. You have seen it before. Everyone has.', 'meme', 3000);
        if (this.memeT <= 0) { this.memeT = 0.8; g.meme(`meme:${k}`, f, 1); }
        break;
      }
      case 'phone': {
        const f = this.feature;
        if (o.useFeature(f)) break;
        f.answered = true;
        f.ringing = false;
        if (f.data && typeof f.data === 'object') f.data.ringing = false;
        g.events.emit('game:phone', { feature: f });
        g.meme('phone', f, 0.9);
        g.toast(PHONE_QUIPS[this.phoneN++ % PHONE_QUIPS.length], 'meme', 4000);
        break;
      }
      case 'switch': {
        const f = this.feature;
        const c = w.getChunk(Math.floor(f.x / CHUNK), Math.floor(f.z / CHUNK));
        const ids = f.data && Array.isArray(f.data.fixtures) ? f.data.fixtures : null;
        let any = false;
        for (const fx of c.fixtures) {
          const near = ids ? ids.includes(fx.id) : (fx.x - f.x) ** 2 + (fx.z - f.z) ** 2 < 49;
          if (!near) continue;
          w.setFixture(fx, !fx.on);
          any = true;
        }
        g.audio.sfx('switch', { x: f.x, z: f.z, gain: 1 });
        if (!any) this.say('Nothing happens. Classic.', 1.8);
        break;
      }
      case 'poster': {
        const f = this.feature;
        const v = f.data && Number.isFinite(f.data.v) ? f.data.v : 0;
        g.toast(this._caption(g.manifest?.posters, v, POSTER_CAPTIONS).text, 'meme', 2800);
        this._meme('poster', f, 0.9);
        break;
      }
      case 'tv': {
        const f = this.feature;
        const cur = this.tv.has(f.id) ? this.tv.get(f.id) : f.data && Number.isFinite(f.data.v) ? f.data.v : 0;
        const cap = this._caption(g.manifest?.tv, cur + 1, TV_CHANNELS);
        const ch = (cur + 1) % cap.n;
        this.tv.set(f.id, ch);
        g.events.emit('feature:state', { id: f.id, type: 'tv', state: ch });
        g.toast(cap.text, 'meme', 2800);
        this._meme('tv', f, 0.9);
        break;
      }
      case 'radio': {
        const f = this.feature;
        const on = !this.radio.get(f.id);
        this.radio.set(f.id, on);
        g.events.emit('feature:state', { id: f.id, type: 'radio', state: on ? 'on' : 'off' });
        g.audio.sfx('switch', { x: f.x, z: f.z, gain: 0.7 });
        if (on) {
          g.meme('radio', f, 0.8);
          g.toast(RADIO_LINES[this.phoneN++ % RADIO_LINES.length], 'meme', 2800);
        }
        break;
      }
      case 'recovery': {
        const f = this.feature;
        this.used.add(f.id);
        this.alcoveUses++;
        g.protectedT = D.alcoveProtect;
        g.audio.sfx('recover', { x: f.x, z: f.z, gain: 1 });
        if (p.hp < D.maxHp) {
          const heal = Math.min(D.alcoveHeal, D.maxHp - p.hp);
          p.hp += heal;
          g.events.emit('game:recover', { source: 'alcove' });
          g.events.emit('game:hearts', { hp: p.hp, max: D.maxHp, delta: heal });
          this.say(`You catch your breath. +${heal / 2} hearts.`, 3);
        } else this.say('You catch your breath. The hum gets quieter.', 3);
        break;
      }
      default:
        if (this.feature) o.useFeature(this.feature);
    }
    this.scanT = 0;
  }
}
