// dynamic parts of v2 features and pickups, all instanced and pooled (swap-remove slots):
//   breaker levers + lamps, exit elevator leaves + state lamp, tv screens (channel from feature:state),
//   radio dial glow, pickups (tape / almond / airhorn / note) with bob, spin and a soft halo.
// also picks the nearest emitters each frame and feeds them to the world shader as short-range lights.
import * as THREE from 'three';
import { GeoBuilder } from './geometry.js';
import { buildLever, buildLeaf, buildItem, tvLayout, breakerLayout, exitLayout } from './props.js';
import { toiletGeo, skibidiHeadGeo, jukeLayout } from './props3.js';
import { LBL } from './labels.js';
import { createFxMaterials } from './fxMaterials.js';

const ITEM_TYPES = ['tape', 'almond', 'airhorn', 'note'];
const MAXL = 8;

function h01(s) {
  s = String(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
// saturated hue -> rgb (0..1) into out[0..2]
function hue(h, out) {
  h = h - Math.floor(h);
  for (let i = 0; i < 3; i++) {
    let x = h + (i === 0 ? 0 : i === 1 ? 2 / 3 : 1 / 3);
    x = Math.abs((x - Math.floor(x)) * 6 - 3) - 1;
    out[i] = x < 0 ? 0 : x > 1 ? 1 : x;
  }
  return out;
}
// jukebox neon: outer arch segments, then the two pilasters, the record-window bar and the kick bar
const ARCH = 10;
const NEON = ARCH + 4;

// which dynamic entry (if any) a world feature needs
function fxType(f) {
  const t = f.type, k = f.data && f.data.kind;
  if (t === 'breaker' || t === 'exitDoor' || t === 'tv' || t === 'radio' || t === 'vending' || t === 'jukebox') return t;
  if (t === 'task') {
    if (k === 'vendingStuck') return 'vending';
    if (k === 'cardSwipe') return 'card';
    if (k === 'wires') return 'wires';
    if (k === 'microwave') return 'micro';
    if (k === 'copier') return 'copier';
    if (k === 'skibidi') return 'toilet';
  } else if (t === 'meme') {
    if (k === 'prime') return 'vending';
    if (k === 'skibidi') return 'skibidi';
    if (k === 'chillGuy' || k === 'chungus' || k === 'shrek') return 'standee';
  }
  return null;
}
// standee cutouts: atlas rect and height / width of the art
const STANDEE = { chillGuy: ['CHILL', 512 / 200, 1], chungus: ['CHUNGUS', 512 / 336, 1], shrek: ['SWAMP', 384 / 320, 1.3] };

class Pool {
  constructor(mesh, cap, attrs = []) {
    this.mesh = mesh;
    this.cap = cap;
    this.parts = new Array(cap).fill(null);
    this.attrs = attrs; // [bufferAttribute, itemSize]
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  add(part) {
    const m = this.mesh;
    if (m.count >= this.cap) { part.i = -1; return false; }
    part.i = m.count++;
    part.pool = this;
    this.parts[part.i] = part;
    m.visible = true;
    return true;
  }
  remove(part) {
    const m = this.mesh, i = part.i, last = m.count - 1;
    if (i < 0 || part.pool !== this) return;
    if (i !== last) {
      const lp = this.parts[last];
      this.parts[i] = lp;
      lp.i = i;
      m.instanceMatrix.array.copyWithin(i * 16, last * 16, last * 16 + 16);
      if (m.instanceColor) { m.instanceColor.array.copyWithin(i * 3, last * 3, last * 3 + 3); m.instanceColor.needsUpdate = true; }
      for (const [a, n] of this.attrs) { a.array.copyWithin(i * n, last * n, last * n + n); a.needsUpdate = true; }
    }
    this.parts[last] = null;
    m.count--;
    part.i = -1;
    m.instanceMatrix.needsUpdate = true;
    if (!m.count) m.visible = false;
  }
}

export class FeatureFX {
  /** material: world material (lit parts); U: its uniforms (shared fog / camera / light arrays) */
  constructor(scene, material, U, tvTex) {
    this.U = U;
    this.mats = createFxMaterials(U, tvTex);
    const b = new GeoBuilder();
    const mk = (geo, mat, cap, color = false) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    };
    this.lever = new Pool(mk(buildLever(b), material, 24), 24);
    this.leaf = new Pool(mk(buildLeaf(b), material, 24), 24);
    const sg = new THREE.PlaneGeometry(1, 1, 8, 6);
    const pa = sg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i);
      pa.setZ(i, 0.016 * (1 - 2 * (x * x + y * y)));
    }
    sg.rotateY(Math.PI);
    sg.computeVertexNormals();
    this.scrAttr = new THREE.InstancedBufferAttribute(new Float32Array(16 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aScr', this.scrAttr);
    this.screen = new Pool(mk(sg, this.mats.screen, 16), 16, [[this.scrAttr, 4]]);
    this.lamp = new Pool(mk(new THREE.IcosahedronGeometry(1, 1), this.mats.lamp, 128, true), 128);
    this.ball = new Pool(mk(new THREE.SphereGeometry(1, 28, 18), this.mats.disco, 4), 4);
    const hg = new THREE.PlaneGeometry(1, 1);
    this.halo = new Pool(mk(hg, this.mats.halo, 96, true), 96);
    b.reset(); toiletGeo(b);
    this.toilet = new Pool(mk(b.finish(), material, 48), 48);
    b.reset(); const hy = skibidiHeadGeo(b);
    const headGeo = b.finish(); headGeo.translate(0, -hy, 0);
    this.head = new Pool(mk(headGeo, material, 32), 32);
    const cg = new THREE.PlaneGeometry(1, 1);
    cg.translate(0, 0.5, 0); cg.rotateY(Math.PI);
    this.rectAttr = new THREE.InstancedBufferAttribute(new Float32Array(32 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('aRect', this.rectAttr);
    this.standee = new Pool(mk(cg, this.mats.cutout, 32), 32, [[this.rectAttr, 4]]);
    this.progress = new Map(); // task id -> { t, at }
    this.halo.mesh.renderOrder = 2;
    this.items = {};
    for (const t of ITEM_TYPES) this.items[t] = new Pool(mk(buildItem(b, t), material, 24), 24);

    this.list = []; // active feature entries
    this.byId = new Map();
    this.states = new Map(); // id -> state from feature:state
    this.anims = new Map(); // id -> anim value kept across rebuilds
    this.itemList = [];
    this.itemById = new Map();
    this.time = 0;
    this.ox = 0;
    this.oz = 0;
    this.maxLights = 6;
    this.hl = { x: 0, y: -100, z: 0, r: 0.5, item: null };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    // party state written by PartyFX each frame (k 0..1, beat, beat pulse, disco ball spin angle)
    this.party = { k: 0, beat: 0, pulse: 0, spin: 0 };
    this._rgb = [0, 0, 0];
    this._bd = new Float32Array(MAXL);
    this._be = new Array(MAXL).fill(null);
  }

  get meshes() {
    return [this.lever.mesh, this.leaf.mesh, this.screen.mesh, this.lamp.mesh, this.halo.mesh, this.toilet.mesh, this.head.mesh, this.standee.mesh, this.ball.mesh, ...ITEM_TYPES.map((t) => this.items[t].mesh)];
  }

  setTvAtlas(tex, cols, rows, n) {
    const u = this.mats.screen.uniforms;
    u.uTv.value = tex;
    u.uGrid.value.set(cols, rows, n);
  }

  // ------------------------------------------------------------ transforms

  _set(pool, i, wx, y, wz, yaw, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
    if (i < 0) return;
    this._e.set(pitch, yaw, roll, 'YXZ');
    this._q.setFromEuler(this._e);
    this._p.set(wx - this.ox, y, wz - this.oz);
    this._s.set(sx, sy, sz);
    this._m.compose(this._p, this._q, this._s);
    pool.mesh.setMatrixAt(i, this._m);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  _color(pool, i, r, g, b) {
    if (i < 0) return;
    const a = pool.mesh.instanceColor.array;
    a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b;
    pool.mesh.instanceColor.needsUpdate = true;
  }

  // feature-local offset -> world x/z into e.wx/e.wz
  _lw(e, lx, lz) {
    const c = e.c, s = e.s;
    e.wx = e.f.x + lx * c + lz * s;
    e.wz = e.f.z - lx * s + lz * c;
  }

  // ------------------------------------------------------------ features

  addChunk(rec, chunk) {
    this.removeChunk(rec);
    for (const f of chunk.features) {
      const t = fxType(f);
      if (!t) continue;
      const id = f.id || `${t},${f.x},${f.z}`;
      if (this.byId.has(id)) continue;
      const yaw = f.yaw || 0;
      const e = { id, f, type: t, c: Math.cos(yaw), s: Math.sin(yaw), yaw, parts: [], anim: 0, target: 0, hold: 0, wx: 0, wz: 0, li: -1, light: null, seed: h01(id), change: -10 };
      this._build(e);
      e.li = this.list.length;
      this.list.push(e);
      this.byId.set(id, e);
      rec.fx.push(e);
    }
  }

  removeChunk(rec) {
    if (!rec.fx) { rec.fx = []; return; }
    for (const e of rec.fx) {
      for (const p of e.parts) p.pool.remove(p);
      e.parts.length = 0;
      this.anims.set(e.id, e.anim);
      const last = this.list[this.list.length - 1];
      this.list[e.li] = last;
      last.li = e.li;
      this.list.pop();
      this.byId.delete(e.id);
    }
    rec.fx.length = 0;
  }

  _part(pool, e) {
    const p = { i: -1, pool: null };
    if (pool.add(p)) e.parts.push(p);
    return p;
  }

  _build(e) {
    const f = e.f, data = f.data || {};
    const st = this.states.get(e.id);
    const saved = this.anims.get(e.id);
    // light: world pos (x, y, z), facing dir (dx, dz), dirW 0 omni / 1 hemisphere, radius, colour
    e.light = { x: 0, y: 0, z: 0, dx: -e.s, dz: -e.c, dirW: 1, r: 2, cr: 0, cg: 0, cb: 0, on: true };
    const L = e.light;
    if (e.type === 'breaker') {
      const B = breakerLayout(f);
      e.B = B;
      // v3 wiring-task breakers have no handle, only the lamp
      e.lever = data.task === 'wires' ? { i: -1, pool: null } : this._part(this.lever, e);
      e.lamp = this._part(this.lamp, e);
      e.target = st === 'on' ? 1 : 0;
      e.anim = saved ?? e.target;
      this._lw(e, B.lamp[0], B.lamp[2]);
      this._set(this.lamp, e.lamp.i, e.wx, B.lamp[1], e.wz, e.yaw, 0, 0, 0.034, 0.034, 0.034);
      L.x = e.wx; L.y = B.lamp[1]; L.z = e.wz; L.r = 1.8;
      this._pose(e);
    } else if (e.type === 'exitDoor') {
      const X = exitLayout(f);
      e.X = X;
      e.leafL = this._part(this.leaf, e);
      e.leafR = this._part(this.leaf, e);
      e.lamp = this._part(this.lamp, e);
      e.target = st === 'open' ? 1 : 0;
      e.anim = saved ?? e.target;
      this._lw(e, X.lamp[0], X.lamp[2]);
      this._set(this.lamp, e.lamp.i, e.wx, X.lamp[1], e.wz, e.yaw, 0, 0, 0.062, 0.062, 0.035);
      this._lw(e, 0, -0.55);
      L.x = e.wx; L.y = 1.35; L.z = e.wz;
      // the EXIT sign itself also lights the wall around it
      e.sign = { x: 0, y: 2.4, z: 0, dx: -e.s, dz: -e.c, dirW: 1, r: 3.2, cr: 0.16, cg: 0.9, cb: 0.3, on: true };
      this._lw(e, 0, -0.35);
      e.sign.x = e.wx; e.sign.z = e.wz;
      this._pose(e);
    } else if (e.type === 'tv') {
      const T = tvLayout(f);
      e.T = T;
      e.scr = this._part(this.screen, e);
      this._lw(e, 0, T.zs);
      this._set(this.screen, e.scr.i, e.wx, T.sy, e.wz, e.yaw, 0, 0, T.sw, T.sh, 1);
      const ch = typeof st === 'number' ? st : Number.isFinite(data.channel) ? data.channel : Math.floor((Number.isFinite(data.v) ? (data.v < 1 ? data.v * 64 : data.v) : e.seed * 64));
      this._screen(e, ch, -10, data.off ? 0 : 1);
      this._lw(e, 0, T.zs - 0.35);
      L.x = e.wx; L.y = T.sy; L.z = e.wz; L.r = 3.4;
      L.cr = 0.5; L.cg = 0.62; L.cb = 1.0;
    } else if (e.type === 'radio') {
      const y0 = data.y || 0;
      e.glow = this._part(this.halo, e);
      this._lw(e, -0.08, -0.1);
      this._set(this.halo, e.glow.i, e.wx, y0 + 0.145, e.wz, 0, 0, 0, 0.28, 0.28, 0.28);
      L.x = e.wx; L.y = y0 + 0.2; L.z = e.wz; L.r = 1.3; L.cr = 1.0; L.cg = 0.55; L.cb = 0.15;
      this._radio(e, st ?? (data.on || data.state === 'on' ? 'on' : 'off'));
    } else if (e.type === 'vending') {
      const W = Math.min(Math.max(f.w || 0.95, 0.85), 1.1), D = Math.min(Math.max(f.d || 0.8, 0.6), 0.9);
      // stock LED beside the coin slot: green while bottles are left, red when sold out
      e.lamp = this._part(this.lamp, e);
      this._lw(e, -W / 2 + 0.15 + 0.07, -D / 2 - 0.008);
      this._set(this.lamp, e.lamp.i, e.wx, 1.5, e.wz, e.yaw, 0, 0, 0.009, 0.009, 0.005);
      this._lw(e, 0.05, -D / 2 - 0.35);
      L.x = e.wx; L.y = 1.15; L.z = e.wz; L.r = 3.0; L.cr = 1.0; L.cg = 0.95; L.cb = 0.84;
      if (data.kind === 'prime') { L.cr = 0.7; L.cg = 0.6; L.cb = 1.0; }
    } else if (e.type === 'card' || e.type === 'wires') {
      const y = data.y || (e.type === 'card' ? 1.15 : 1.35);
      e.lamp = this._part(this.lamp, e);
      if (e.type === 'card') this._lw(e, -0.03, -0.034); else this._lw(e, -0.2, -0.125);
      const ly = e.type === 'card' ? y + 0.068 : y + 0.19;
      this._set(this.lamp, e.lamp.i, e.wx, ly, e.wz, e.yaw, 0, 0, 0.007, 0.007, 0.004);
      L.on = false;
    } else if (e.type === 'micro' || e.type === 'copier') {
      e.glow = this._part(this.halo, e);
      const y = e.type === 'micro' ? (data.y ?? 0.9) + 0.145 : 0.95;
      if (e.type === 'micro') this._lw(e, 0.08, -0.2); else this._lw(e, -0.05, -Math.min(f.d || 0.7, 0.8) / 2 - 0.05);
      this._set(this.halo, e.glow.i, e.wx, y, e.wz, 0, 0, 0, 0.45, 0.45, 0.45);
      this._color(this.halo, e.glow.i, 0, 0, 0);
      L.x = e.wx; L.y = y; L.z = e.wz; L.r = 1.6; L.on = false;
      if (e.type === 'micro') { L.cr = 1.2; L.cg = 0.8; L.cb = 0.35; } else { L.cr = 0.6; L.cg = 1.1; L.cb = 0.8; }
    } else if (e.type === 'toilet' || e.type === 'skibidi') {
      e.bowl = this._part(this.toilet, e);
      this._set(this.toilet, e.bowl.i, f.x, 0, f.z, e.yaw);
      if (e.type === 'skibidi') e.headP = this._part(this.head, e);
      e.wob = -10;
      L.on = false;
    } else if (e.type === 'jukebox') {
      const J = jukeLayout(f);
      e.J = J;
      e.neon = [];
      e.neonIdle = new Float32Array(NEON * 3);
      const zn = J.zf - 0.03, ro = J.R + 0.025, h = 0.019;
      for (let i = 0; i < NEON; i++) {
        const p = this._part(this.lamp, e);
        e.neon.push(p);
        let lx, ly, lz = zn, roll, len;
        if (i < ARCH) {
          const a = ((i + 0.5) / ARCH) * Math.PI;
          lx = Math.cos(a) * ro; ly = J.T + Math.sin(a) * ro; roll = a + Math.PI / 2; len = 2 * ro * Math.sin(Math.PI / ARCH / 2);
          e.neonIdle.set([4.6, 0.42, 2.3], i * 3);
        } else if (i < ARCH + 2) {
          lx = (i === ARCH ? -1 : 1) * (J.W / 2 - 0.03); ly = (0.12 + J.T) / 2; roll = Math.PI / 2; len = J.T - 0.12;
          e.neonIdle.set([0.4, 3.2, 4.0], i * 3);
        } else if (i === ARCH + 2) {
          lx = 0; ly = J.T + 0.005; lz = J.zf + 0.005; roll = 0; len = 0.74;
          e.neonIdle.set([1.9, 0.55, 3.4], i * 3);
        } else {
          lx = 0; ly = 0.125; roll = 0; len = J.W - 0.12;
          e.neonIdle.set([1.9, 0.55, 3.4], i * 3);
        }
        this._lw(e, lx, lz);
        this._set(this.lamp, p.i, e.wx, ly, e.wz, e.yaw, 0, roll, len / 2 * 1.12, h, h);
      }
      e.ballP = this._part(this.ball, e);
      this._lw(e, J.ball[0], J.ball[2]);
      e.bx = e.wx; e.by = J.ball[1]; e.bz = e.wz;
      e.glow = this._part(this.halo, e);
      e.ballGlow = this._part(this.halo, e);
      // warm-pink spill on the wall and floor in front of it
      this._lw(e, 0, J.zf - 0.6);
      L.x = e.wx; L.y = 0.9; L.z = e.wz; L.r = 4.2; L.cr = 1.7; L.cg = 0.45; L.cb = 1.3;
      // the ball lights the room only while partying
      e.sign = { x: e.bx, y: e.by - 0.2, z: e.bz, dx: 0, dz: 0, dirW: 0, r: 6.5, cr: 0, cg: 0, cb: 0, on: false };
      e.jt = -1;
      this._juke(e, 0);
    } else if (e.type === 'standee') {
      const [key, ar, sc] = STANDEE[data.kind];
      const w = (f.w || 0.8) * sc;
      e.cut = this._part(this.standee, e);
      this._lw(e, 0, -0.012);
      this._set(this.standee, e.cut.i, e.wx, 0, e.wz, e.yaw, 0, 0, w, w * ar, 1);
      if (e.cut.i >= 0) { this.rectAttr.array.set(LBL[key], e.cut.i * 4); this.rectAttr.needsUpdate = true; }
      L.on = false;
    }
    this._stateLight(e, st);
  }

  _screen(e, channel, change, power) {
    const i = e.scr.i;
    if (i < 0) return;
    const a = this.scrAttr.array;
    a[i * 4] = channel; a[i * 4 + 1] = change; a[i * 4 + 2] = e.seed; a[i * 4 + 3] = power;
    this.scrAttr.needsUpdate = true;
    e.power = power;
  }

  _radio(e, st) {
    e.on = st === 'on';
    const k = e.on ? 1 : 0;
    this._color(this.halo, e.glow.i, 0.5 * k, 0.26 * k, 0.06 * k);
    e.light.on = e.on;
  }

  // state colours for lamps and emitter lights
  _stateLight(e, st) {
    const L = e.light;
    if (e.type === 'breaker') {
      const on = st === 'on';
      if (on) { this._color(this.lamp, e.lamp.i, 0.35, 3.2, 0.7); L.cr = 0.2; L.cg = 1.4; L.cb = 0.35; }
      else { this._color(this.lamp, e.lamp.i, 3.0, 0.16, 0.06); L.cr = 1.0; L.cg = 0.06; L.cb = 0.03; }
    } else if (e.type === 'exitDoor') {
      e.st = st === 'open' || st === 'powered' ? st : 'locked';
      if (e.st === 'open') { this._color(this.lamp, e.lamp.i, 0.5, 3.0, 1.0); L.cr = 1.9; L.cg = 1.8; L.cb = 1.55; L.r = 6; }
      else if (e.st === 'powered') { this._color(this.lamp, e.lamp.i, 0.3, 3.4, 0.8); L.cr = 0.4; L.cg = 2.6; L.cb = 0.8; L.r = 5; }
      else { this._color(this.lamp, e.lamp.i, 3.2, 0.14, 0.05); L.cr = 1.8; L.cg = 0.1; L.cb = 0.04; L.r = 3.4; }
    } else if (e.type === 'card' || e.type === 'wires') {
      if (st === 'done') this._color(this.lamp, e.lamp.i, 0.2, 2.8, 0.5);
      else this._color(this.lamp, e.lamp.i, 2.8, 0.12, 0.05);
    } else if (e.type === 'vending') {
      if (e.f.type !== 'vending' && e.f.data?.kind !== 'prime') { this._color(this.lamp, e.lamp.i, st === 'done' ? 0.2 : 2.8, st === 'done' ? 2.6 : 0.6, 0.05); return; }
      const out = st !== undefined && Number(st) <= 0;
      if (out) this._color(this.lamp, e.lamp.i, 3.0, 0.1, 0.04);
      else this._color(this.lamp, e.lamp.i, 0.2, 2.6, 0.5);
      L.cr = out ? 0.75 : 1.0; L.cg = out ? 0.7 : 0.95; L.cb = out ? 0.62 : 0.84;
    }
  }

  _pose(e) {
    const k = smooth(Math.min(1, Math.max(0, e.anim)));
    if (e.type === 'breaker') {
      const [lx, ly, lz] = e.B.lever;
      this._lw(e, lx, lz);
      this._set(this.lever, e.lever.i, e.wx, ly, e.wz, e.yaw, -0.85 + 1.7 * k);
    } else if (e.type === 'exitDoor') {
      const { Wo, leafZ } = e.X;
      const outer = Wo / 2 + 0.04;
      const w = Math.max(0.02, outer - k * Wo / 2);
      this._lw(e, outer, leafZ);
      this._set(this.leaf, e.leafL.i, e.wx, 0, e.wz, e.yaw, 0, 0, w, 1, 1);
      this._lw(e, -outer, leafZ);
      this._set(this.leaf, e.leafR.i, e.wx, 0, e.wz, e.yaw + Math.PI, 0, 0, w, 1, 1);
    }
  }

  /** breaker hold progress (0..1) from frame.highlight: the handle creeps up and the lamp stutters amber */
  setHold(p, x, z) {
    for (const e of this.list) {
      if (e.type !== 'breaker') continue;
      const near = p > 0 && Math.abs(e.f.x - x) < 1.2 && Math.abs(e.f.z - z) < 1.2;
      e.hold = near ? p : 0;
    }
  }

  /** task:progress (t 0..1); null clears it */
  setProgress(id, t) {
    if (t == null) this.progress.delete(id);
    else {
      const p = this.progress.get(id);
      if (p) { p.t = t; p.at = this.time; } else this.progress.set(id, { t, at: this.time });
    }
  }

  /** flush / hit feedback without a state change (task:result) */
  poke(id) {
    const e = this.byId.get(id);
    if (e && (e.type === 'toilet' || e.type === 'skibidi')) e.wob = this.time;
  }

  setState(id, state) {
    this.states.set(id, state);
    const e = this.byId.get(id);
    if (!e) return;
    if (e.type === 'breaker') e.target = state === 'on' ? 1 : 0;
    else if (e.type === 'exitDoor') e.target = state === 'open' ? 1 : 0;
    else if (e.type === 'tv') {
      if (state === 'off') this._screen(e, this.scrAttr.array[e.scr.i * 4], this.time, 0);
      else this._screen(e, Number(state) || 0, this.time, 1);
    } else if (e.type === 'radio') this._radio(e, state);
    else if (e.type === 'toilet' || e.type === 'skibidi') e.wob = this.time;
    this._stateLight(e, state);
  }

  // ------------------------------------------------------------ pickups

  spawnItem(it) {
    if (!it || it.id == null) return;
    let e = this.itemById.get(it.id);
    if (!e) {
      const type = ITEM_TYPES.includes(it.type) ? it.type : 'note';
      e = { id: it.id, type, x: 0, y: 0, z: 0, yaw: 0, phase: h01(it.id) * 6.283, li: this.itemList.length, part: { i: -1, pool: null }, halo: { i: -1, pool: null }, rx: 0, ry: 0, rz: 0, light: null };
      this.items[type].add(e.part);
      if (this.halo.add(e.halo)) this._color(this.halo, e.halo.i, 0.5, 0.4, 0.24);
      e.light = { x: 0, y: 0, z: 0, dx: 0, dz: 0, dirW: 0, r: 1.25, cr: 0.42, cg: 0.34, cb: 0.2, on: true };
      this.itemList.push(e);
      this.itemById.set(it.id, e);
    }
    e.x = +it.x || 0; e.z = +it.z || 0; e.y = +it.y || 0; e.yaw = +it.yaw || 0;
    this._itemPose(e);
  }

  removeItem(it) {
    const e = it && this.itemById.get(it.id);
    if (!e) return;
    e.part.pool?.remove(e.part);
    e.halo.pool?.remove(e.halo);
    const last = this.itemList[this.itemList.length - 1];
    this.itemList[e.li] = last;
    last.li = e.li;
    this.itemList.pop();
    this.itemById.delete(e.id);
  }

  clearItems() {
    while (this.itemList.length) this.removeItem(this.itemList[this.itemList.length - 1]);
  }

  _itemPose(e) {
    const t = this.time;
    const hover = e.y + (e.y < 0.1 ? 0.36 : 0.14);
    e.rx = e.x; e.rz = e.z;
    e.ry = hover + Math.sin(t * 1.7 + e.phase) * 0.035;
    const spin = e.yaw + t * 0.75 + e.phase;
    const tilt = e.type === 'tape' ? 0.14 : e.type === 'note' ? 0.35 : 0.08;
    this._set(e.part.pool, e.part.i, e.rx, e.ry, e.rz, spin, tilt * Math.sin(t * 0.9 + e.phase), 0, 1.3, 1.3, 1.3);
    this._set(this.halo, e.halo.i, e.rx, e.ry, e.rz, 0, 0, 0, 0.78, 0.78, 0.78);
    e.light.x = e.rx; e.light.y = e.ry; e.light.z = e.rz;
  }

  // ------------------------------------------------------------ frame

  rebase(ox, oz) {
    this.ox = ox; this.oz = oz;
    for (const e of this.list) {
      const ids = this.states.get(e.id);
      for (const p of e.parts) p.pool.remove(p);
      e.parts.length = 0;
      this.anims.set(e.id, e.anim);
      this._build(e);
      if (ids !== undefined) this._stateLight(e, ids);
    }
    for (const e of this.itemList) this._itemPose(e);
  }

  /** hl: frame.highlight; returns the highlight centre snapped to a pickup when one is targeted */
  resolveHighlight(h) {
    const o = this.hl;
    o.x = h.x; o.y = h.y ?? 1; o.z = h.z; o.r = h.r || 0.5; o.item = null;
    let best = 0.8 * 0.8;
    for (const e of this.itemList) {
      const dx = e.rx - h.x, dz = e.rz - h.z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; o.item = e; }
    }
    if (o.item) { o.x = o.item.rx; o.y = o.item.ry; o.z = o.item.rz; o.r = Math.max(0.24, Math.min(o.r, 0.4)); }
    return o;
  }

  update(dt, camX, camY, camZ) {
    this.time += dt;
    const t = this.time;
    this.mats.screen.uniforms.uTime.value = t;
    for (const e of this.list) {
      const goal = e.type === 'breaker' ? Math.max(e.target, e.hold * 0.7) : e.target;
      if (e.anim !== goal) {
        const sp = e.type === 'exitDoor' ? 0.55 : e.hold > 0 ? 6 : 3.2;
        e.anim = goal > e.anim ? Math.min(goal, e.anim + dt * sp) : Math.max(goal, e.anim - dt * sp);
        this._pose(e);
      }
      if (e.type === 'breaker' && e.target === 0) {
        if (e.hold > 0) {
          const fl = Math.sin(t * 43) * Math.sin(t * 17.3) > -0.2 ? 1 : 0.25;
          const k = e.hold * fl;
          this._color(this.lamp, e.lamp.i, 3.0, 0.16 + 1.6 * k, 0.06);
          e.held = true;
        } else if (e.held) { e.held = false; this._stateLight(e, 'off'); }
      }
      if (e.type === 'exitDoor' && e.st === 'powered') {
        // powered: slow breathing pulse on the state lamp so it reads as "ready"
        const k = 0.65 + 0.35 * Math.sin(t * 3.2);
        this._color(this.lamp, e.lamp.i, 0.3 * k, 3.4 * k, 0.8 * k);
      }
    }
    for (const e of this.list) {
      const ty = e.type;
      if (ty === 'toilet' || ty === 'skibidi') {
        // flush wobble: a short damped rock; the skibidi head bobs out of the bowl
        const a = t - e.wob;
        if (a >= 0 && a < 1.6) this._set(this.toilet, e.bowl.i, e.f.x, 0, e.f.z, e.yaw, 0.04 * Math.sin(a * 23) * Math.exp(-a * 2.6), 0.05 * Math.sin(a * 29) * Math.exp(-a * 2.6));
        else if (a >= 1.6 && a < 1.7) this._set(this.toilet, e.bowl.i, e.f.x, 0, e.f.z, e.yaw);
        if (ty === 'skibidi' && e.headP.i >= 0 && Math.abs(camX - e.f.x) + Math.abs(camZ - e.f.z) < 40) {
          const up = Math.max(0, Math.sin(t * 1.4 + e.seed * 20)) ** 0.6;
          this._lw(e, 0, -0.1);
          this._set(this.head, e.headP.i, e.wx, 0.44 + up * 0.14 + (a >= 0 && a < 1.2 ? 0.1 * Math.exp(-a * 3) : 0), e.wz, e.yaw + Math.sin(t * 2.2 + e.seed * 9) * 0.35, 0, Math.sin(t * 3.1) * 0.08);
        }
      } else if (ty === 'card' || ty === 'micro' || ty === 'copier') {
        const p = this.progress.get(e.id);
        const act = p && t - p.at < 0.6 && p.t > 0 && p.t < 1 ? 1 : 0;
        if (act !== (e.act || 0) || act) {
          e.act = act;
          if (ty === 'card') {
            if (act) this._color(this.lamp, e.lamp.i, 2.8, 1.4 * (0.5 + 0.5 * Math.sin(t * 20)), 0.05);
            else this._stateLight(e, this.states.get(e.id));
          } else {
            const k = act * (0.85 + 0.15 * Math.sin(t * (ty === 'micro' ? 5 : 11)));
            if (ty === 'micro') this._color(this.halo, e.glow.i, 0.9 * k, 0.6 * k, 0.25 * k);
            else this._color(this.halo, e.glow.i, 0.4 * k, 0.8 * k, 0.55 * k);
            e.light.on = !!act;
          }
        }
      }
    }
    for (const e of this.itemList) this._itemPose(e);
    for (const e of this.list) if (e.type === 'jukebox' && Math.abs(camX - e.f.x) + Math.abs(camZ - e.f.z) < 60) this._juke(e, t);
    this._lights(camX, camY, camZ, t);
  }

  // jukebox: neon colour chase (idle: pink/cyan/violet breathing; party: rainbow chase pumping on the beat),
  // spinning disco ball, glows and the ball light
  _juke(e, t) {
    const P = this.party, k = P.k, rgb = this._rgb, J = e.J;
    for (let i = 0; i < NEON; i++) {
      const p = e.neon[i];
      if (p.i < 0) continue;
      const wave = 0.78 + 0.22 * Math.sin(t * 1.7 - i * 0.55);
      let r = e.neonIdle[i * 3] * wave, g = e.neonIdle[i * 3 + 1] * wave, b = e.neonIdle[i * 3 + 2] * wave;
      if (k > 0) {
        hue(i / NEON + P.beat * 0.125, rgb);
        const br = 2.2 + 2.6 * P.pulse;
        r += (rgb[0] * br + 0.25 - r) * k; g += (rgb[1] * br + 0.25 - g) * k; b += (rgb[2] * br + 0.25 - b) * k;
      }
      this._color(this.lamp, p.i, r, g, b);
    }
    const s = J.ballR * (1 + 0.3 * k);
    this._set(this.ball, e.ballP.i, e.bx, e.by, e.bz, P.spin, 0.12, 0, s, s, s);
    this._lw(e, 0, J.zf - 0.12);
    this._set(this.halo, e.glow.i, e.wx, J.T + 0.1, e.wz, 0, 0, 0, 1.25 + 0.5 * k, 1.25 + 0.5 * k, 1.25);
    hue(P.beat * 0.125 + 0.5, rgb);
    const ib = 0.55 + 0.12 * Math.sin(t * 1.3);
    this._color(this.halo, e.glow.i, 0.3 * ib + k * (rgb[0] * 0.25 * (0.6 + P.pulse) - 0.3 * ib), 0.07 * ib + k * (rgb[1] * 0.25 * (0.6 + P.pulse) - 0.07 * ib), 0.26 * ib + k * (rgb[2] * 0.25 * (0.6 + P.pulse) - 0.26 * ib));
    this._set(this.halo, e.ballGlow.i, e.bx, e.by, e.bz, 0, 0, 0, 0.55 + 0.6 * k, 0.55, 0.55);
    const gb = 0.05 + k * (0.12 + 0.3 * P.pulse);
    this._color(this.halo, e.ballGlow.i, gb, gb * 0.95, gb * 0.9);
    const L = e.light, S = e.sign;
    hue(P.beat * 0.125 + 0.9, rgb);
    L.cr = 1.7 + k * (rgb[0] * 2.2 - 1.7); L.cg = 0.45 + k * (rgb[1] * 2.2 - 0.45); L.cb = 1.3 + k * (rgb[2] * 2.2 - 1.3);
    S.on = k > 0;
    hue(P.beat * 0.25 + 0.33, rgb);
    const sb = k * (1.2 + 2.2 * P.pulse);
    S.cr = rgb[0] * sb; S.cg = rgb[1] * sb; S.cb = rgb[2] * sb;
  }

  _consider(L, camX, camY, camZ, n) {
    if (!L || !L.on) return n;
    const dx = L.x - camX, dy = L.y - camY, dz = L.z - camZ;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - L.r;
    if (d > 26) return n;
    const bd = this._bd, be = this._be, max = this.maxLights;
    let k = n < max ? n++ : max;
    if (k === max) { if (d >= bd[max - 1]) return n; k = max - 1; }
    while (k > 0 && bd[k - 1] > d) { bd[k] = bd[k - 1]; be[k] = be[k - 1]; k--; }
    bd[k] = d; be[k] = L;
    return n;
  }

  _lights(camX, camY, camZ, t) {
    let n = 0;
    for (const e of this.list) {
      if (e.type === 'tv') {
        // tv spill flickers with the picture; off tvs cast nothing
        e.light.on = e.power > 0;
        const fl = 0.8 + 0.2 * Math.sin(t * 7.3 + e.seed * 40) * Math.sin(t * 2.1 + e.seed * 9);
        const burst = Math.max(0, 1 - (t - this.scrAttr.array[e.scr.i * 4 + 1]) / 0.5);
        e.light.cr = (0.45 + burst * 0.4) * fl; e.light.cg = (0.56 + burst * 0.4) * fl; e.light.cb = (0.95 + burst * 0.3) * fl;
      }
      n = this._consider(e.light, camX, camY, camZ, n);
      if (e.sign) n = this._consider(e.sign, camX, camY, camZ, n);
    }
    for (const e of this.itemList) n = this._consider(e.light, camX, camY, camZ, n);
    const U = this.U;
    for (let i = 0; i < n; i++) {
      const L = this._be[i];
      U.uDLP.value[i].set(L.x - this.ox, L.y, L.z - this.oz, L.r);
      U.uDLC.value[i].set(L.cr, L.cg, L.cb, 0);
      U.uDLD.value[i].set(L.dx, 0, L.dz, L.dirW);
      this._be[i] = null;
    }
    U.uDLN.value = n;
  }

  /** make every pool visible with one instance so programs compile at init */
  compileMode(on) {
    for (const m of this.meshes) {
      if (on) { m.userData.c = m.count; m.userData.v = m.visible; m.count = Math.max(1, m.count); m.visible = true; }
      else { m.count = m.userData.c; m.visible = m.userData.v; }
    }
  }
}
