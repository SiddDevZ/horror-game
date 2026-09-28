// render agent. api per ARCHITECTURE.md "Render".
// lighting: per-chunk cpu bake (bake.js) into two toroidal half-float atlases (8x8 chunk slots, 0.25 m texels)
// sampled by one shared surface shader. chunk builds are time-sliced generators, nearest first, under a
// per-frame ms budget. everything is drawn relative to a render origin (multiple of 384 m) for precision.
import * as THREE from 'three';
import { CHUNK, CELL, CAMERA, QUALITY, keyCx, keyCz, chunkKey } from '../config.js';
import { events } from '../core/events.js';
import { settings } from '../settings.js';
import { bakeChunk, TPC, TEX, RELIGHT_REACH, doorBlocksLight } from './bake.js';
import { buildChunkGeometry, DOOR_H } from './chunkMesh.js';
import { GeoBuilder } from './geometry.js';
import { createSurfaceTextures } from './textures.js';
import { createWorldMaterial } from './worldMaterial.js';
import { Post } from './post.js';
import { Viewmodel } from './viewmodel.js';
import { EnemySprite } from './enemy.js';
import { detectTier, gpuInfo } from './quality.js';
import { MAT } from './materials-ids.js';
import { createLabelTexture, createPosterPlaceholder, createTvPlaceholder, upgradeLabels, upgradeMemeTextures } from './labels.js';
import { FeatureFX } from './features.js';
import { PartyFX, createVisTexture } from './party.js';

// light atlas: 12 x 12 chunk slots (192 m period divides the 384 m origin step); holds a radius-4 ring + hysteresis
const TORUS = 12;
const ATLAS = TORUS * TPC;
const ORIGIN_STEP = 384;
const REBASE_DIST = 256;
const MAX_DOORS = 160;
const RING = 240;
const TIERS = ['low', 'medium', 'high'];
const mod = (a, n) => ((a % n) + n) % n;
const half = THREE.DataUtils.fromHalfFloat;

function strHash(s) {
  s = String(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function makeAtlas() {
  const t = new THREE.DataTexture(new Uint16Array(ATLAS * ATLAS * 4), ATLAS, ATLAS, THREE.RGBAFormat, THREE.HalfFloatType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export class GameRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.chunks = new Map();
    this.queue = [];
    this.job = null;
    this.meshPool = [];
    this.origin = { x: 0, z: 0 };
    this.ccx = NaN;
    this.ccz = NaN;
    this.doorBlocked = new Map();
    this.doorLeaves = new Map();
    this.doorSlots = [];
    this.qualityName = 'medium';
    this.q = QUALITY.medium;
    this.auto = false;
    this.autoTier = 'medium';
    this.ring = new Float32Array(RING);
    this.sorted = new Float32Array(RING);
    this.ringN = 0;
    this.ringI = 0;
    this.lastNow = 0;
    this.time = 0;
    this.renderMs = 0;
    this.lastCalls = 0;
    this.lastTris = 0;
    this.autoFrames = 0;
    this.autoAcc = 0;
    this.build = { chunks: 0, totalMs: 0, maxChunkMs: 0, maxSliceMs: 0, maxFrameMs: 0, lastFrameMs: 0 };
    this.flick = { level: 1, next: 3 + Math.random() * 6, burst: 0, t: 0 };
    this.builder = new GeoBuilder();
    this._v2 = new THREE.Vector2();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._camPos = new THREE.Vector3();
    this.flashOn = 0;
    this.hlK = 0;
    // render-side view of v3 task outcomes (read by chunk geometry and the bake)
    this.ctx = { state: (id) => this.fx.states.get(id), straight: new Set(), steady: new Set(), hidden: new Set() };
  }

  async init() {
    if (typeof WebGL2RenderingContext === 'undefined') throw new Error('WebGL2 is not supported by this browser');
    let r;
    try {
      r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new Error('WebGL2 could not be started (it may be disabled, or hardware acceleration is off)');
    }
    if (!r.capabilities.isWebGL2) throw new Error('WebGL2 is not available');
    this.renderer = r;
    r.autoClear = false;
    r.info.autoReset = false;
    const gl = r.getContext();
    this.gpu = gpuInfo(gl);
    this.autoTier = detectTier(gl);
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    const tex = createSurfaceTextures();
    this.textures = tex;
    this.texMs = tex.ms;
    this.atlasA = makeAtlas();
    this.atlasB = makeAtlas();
    r.initTexture(tex.albedo);
    r.initTexture(tex.noise);
    r.initTexture(this.atlasA);
    r.initTexture(this.atlasB);
    this.labels = createLabelTexture();
    this.posterPh = createPosterPlaceholder();
    this.tvPh = createTvPlaceholder();
    r.initTexture(this.labels);
    r.initTexture(this.posterPh.tex);
    r.initTexture(this.tvPh.tex);
    upgradeLabels(this.labels).then((ok) => { if (ok) r.initTexture(this.labels); }).catch(() => {});
    this.srcA = new THREE.DataTexture(new Uint16Array(TPC * TPC * 4), TPC, TPC, THREE.RGBAFormat, THREE.HalfFloatType);
    this.srcB = new THREE.DataTexture(new Uint16Array(TPC * TPC * 4), TPC, TPC, THREE.RGBAFormat, THREE.HalfFloatType);
    this.partyVis = createVisTexture();
    r.initTexture(this.partyVis);
    this.material = createWorldMaterial({ albedo: tex.albedo, noise: tex.noise, atlasA: this.atlasA, atlasB: this.atlasB, labels: this.labels, posters: this.posterPh.tex, pvis: this.partyVis });
    this.U = this.material.uniforms;
    this.U.uPosterGrid.value.set(this.posterPh.cols, this.posterPh.rows, this.posterPh.n);

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.rotation.order = 'YXZ';

    // door leaves: one instanced mesh for every door in range
    const b = this.builder;
    b.reset();
    b.box(0.5, (DOOR_H - 0.012) / 2 + 0.004, 0, 1, DOOR_H - 0.012, 0.042, MAT.DOOR);
    b.box(0.9, 1.0, 0.035, 0.05, 0.05, 0.028, MAT.BRASS);
    b.box(0.9, 1.0, -0.035, 0.05, 0.05, 0.028, MAT.BRASS);
    b.box(0.9, 1.0, 0.0, 0.07, 0.07, 0.048, MAT.BRASS);
    this.doorMesh = new THREE.InstancedMesh(b.finish(), this.material, MAX_DOORS);
    this.doorMesh.count = 0;
    this.doorMesh.frustumCulled = false;
    this.doorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.doorMesh);

    this.fx = new FeatureFX(this.scene, this.material, this.U, this.tvPh.tex);
    this.party = new PartyFX(this.scene, this.U, this.fx, this.world, this.partyVis);
    this.enemy = new EnemySprite();
    this.scene.add(this.enemy.mesh);
    this.viewmodel = new Viewmodel(this.labels);
    this.post = new Post(r);
    this.post.party = this.party.post;
    const hs = this.post.hdrScale;
    this.U.uHdrScale.value = hs;
    this.enemy.material.uniforms.uHdrScale.value = hs;
    this.enemy.material.uniforms.uFogCol.value = this.U.uFogCol.value;
    this.enemy.material.uniforms.uFar = this.U.uFar;
    this.enemy.material.uniforms.uFarCol = this.U.uFarCol;
    for (const m of this.viewmodel.materials) m.uniforms.uHdrScale.value = hs;
    this.clearColor = new THREE.Color();
    this._setFar();

    this.setQuality(settings.get('quality') || 'auto');
    settings.on((k, v) => { if (k === 'quality') this.setQuality(v); });

    events.on('world:chunkActive', (c) => this._onActive(c));
    events.on('world:chunkInactive', (c) => this._onInactive(c));
    events.on('world:fixture', (f) => this._relightAround(f.x, f.z, RELIGHT_REACH));
    events.on('world:door', (d) => this._onDoor(d));
    events.on('feature:state', (e) => { if (e) { this.fx.setState(e.id, e.state); this._onFeatureState(e); } });
    events.on('task:progress', (e) => e && this.fx.setProgress(e.id, e.t));
    events.on('task:close', (e) => e && this.fx.setProgress(e.id, null));
    events.on('task:result', (e) => { if (e) { this.fx.setProgress(e.id, null); if (e.ok) this.fx.poke(e.id); } });
    events.on('item:spawn', (e) => this.fx.spawnItem(e));
    events.on('item:remove', (e) => this.fx.removeItem(e));

    // centre on the active set (world.update already ran for the spawn)
    let sx = 0, sz = 0, n = 0;
    for (const k of this.world.active) { sx += keyCx(k); sz += keyCz(k); n++; }
    const cx = n ? Math.round(sx / n) : 0, cz = n ? Math.round(sz / n) : 0;
    this.origin.x = Math.round(((cx + 0.5) * CHUNK) / ORIGIN_STEP) * ORIGIN_STEP;
    this.origin.z = Math.round(((cz + 0.5) * CHUNK) / ORIGIN_STEP) * ORIGIN_STEP;
    this.fx.ox = this.origin.x;
    this.fx.oz = this.origin.z;
    this.ccx = cx;
    this.ccz = cz;
    this._refreshDesired();
    // build the nearest ring before resolving so the first frame is complete
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      let near = false;
      for (const rec of this.queue) if (Math.max(Math.abs(rec.cx - cx), Math.abs(rec.cz - cz)) <= 1) near = true;
      if (this.job && Math.max(Math.abs(this.job.rec.cx - cx), Math.abs(this.job.rec.cz - cz)) <= 1) near = true;
      if (!near) break;
      this._process(0, true);
    }
    this.bootBuildMs = performance.now() - t0;
    // compile every program now (enemy and viewmodel included) so nothing compiles mid-game
    this.enemy.mesh.visible = true;
    this.enemy.material.uniforms.uMap.value = this.post.black;
    this.camera.position.set(cx * CHUNK + 8 - this.origin.x, 1.68, cz * CHUNK + 8 - this.origin.z);
    this.camera.updateMatrixWorld();
    // compile against the hdr scene target: program keys depend on the bound target's color space
    // v2 pools (screens, lamps, halos, levers, leaves, pickups) and viewmodel items compile here too
    this.fx.compileMode(true);
    this.party.compileMode(true);
    const vmVis = [this.viewmodel.horn, this.viewmodel.bottle, this.viewmodel.lArm].map((o) => o.visible);
    this.viewmodel.horn.visible = this.viewmodel.bottle.visible = this.viewmodel.lArm.visible = true;
    r.setRenderTarget(this.post.scene);
    r.compile(this.scene, this.camera);
    r.compile(this.viewmodel.scene, this.viewmodel.camera);
    r.setRenderTarget(null);
    [this.viewmodel.horn.visible, this.viewmodel.bottle.visible, this.viewmodel.lArm.visible] = vmVis;
    this.fx.compileMode(false);
    this.party.compileMode(false);
    this.enemy.mesh.visible = false;
  }

  async loadEnemyTextures(manifest) {
    await Promise.all([
      this.enemy.load(manifest, this.renderer),
      this._loadAtlases(manifest).catch((e) => console.warn('[render] poster/tv atlas', e?.message || e)),
    ]);
  }

  // posters / tv atlases from the manifest ({ image?, cols, rows, cells }); placeholders stay until they load
  async _loadAtlases(manifest) {
    const load = async (key, path) => {
      const m = manifest && manifest[key];
      if (!m || !(m.cols > 0) || !(m.rows > 0)) return null;
      const url = `./assets/${m.image || m.file || path}`;
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.renderer.initTexture(tex);
      const n = Array.isArray(m.cells) && m.cells.length ? Math.min(m.cells.length, m.cols * m.rows) : m.cols * m.rows;
      return { tex, cols: m.cols, rows: m.rows, n };
    };
    upgradeMemeTextures(this.labels, manifest).then((ok) => { if (ok) this.renderer.initTexture(this.labels); }).catch(() => {});
    const [p, t] = await Promise.all([load('posters', 'img/posters.webp'), load('tv', 'img/tv.webp')]);
    if (p) { this.U.uPosters.value = p.tex; this.U.uPosterGrid.value.set(p.cols, p.rows, p.n); this.posterAtlas = p; }
    if (t) { this.fx.setTvAtlas(t.tex, t.cols, t.rows, t.n); this.tvAtlas = t; }
  }

  _setFar() {
    // only the last few metres before the streaming edge fade (min edge distance = radius * CHUNK)
    const end = this.q.fogEnd ?? Math.min(this.q.renderRadius ?? 3, 4) * CHUNK - 1;
    this.U.uFar.value.set(end - 10, end);
  }

  setQuality(name) {
    if (name === 'auto' || !QUALITY[name]) {
      this.auto = true;
      name = this.autoTier;
    } else {
      this.auto = false;
    }
    this.qualityName = name;
    this.q = QUALITY[name];
    const r = this.renderer;
    const tex = this.textures.albedo;
    const an = Math.min(this.q.aniso, r.capabilities.getMaxAnisotropy());
    if (tex.anisotropy !== an) { tex.anisotropy = an; tex.needsUpdate = true; }
    this.camera.far = this.q.far;
    this.camera.updateProjectionMatrix();
    this.U.uFogD.value = this.q.fog;
    this.enemy.material.uniforms.uFogD.value = this.q.fog;
    this.fx.maxLights = Math.min(8, this.q.dynLights ?? 6);
    this.party.setQuality(this.q);
    this._setFar();
    this.autoFrames = 0;
    this.autoAcc = 0;
    this.resize();
    if (this.ccx === this.ccx) this._refreshDesired();
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    const dpr = window.devicePixelRatio || 1;
    const pr = this.q.pixelRatio < 1 ? this.q.pixelRatio : Math.min(this.q.pixelRatio, dpr);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const bw = Math.max(1, Math.floor(w * pr)), bh = Math.max(1, Math.floor(h * pr));
    const msaa = Math.min(this.q.msaa, this.renderer.capabilities.maxSamples || 0);
    this.post.setup(bw, bh, msaa, !!this.q.bloom);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.aspect = w / h;
    this._partyPix();
  }

  // angle of one drawing-buffer pixel at the screen centre (disco spot / laser anti-aliasing)
  _partyPix() {
    if (!this.party) return;
    const hpx = this.renderer.getContext().drawingBufferHeight || 720;
    this.party.pix = (2 * Math.tan(((this.camera.fov || CAMERA.fov) * Math.PI) / 360)) / hpx;
  }

  // ---------------------------------------------------------------- chunk streaming

  _inRange(cx, cz, extra = 0) {
    const R = Math.min(this.q.renderRadius ?? 3, 4) + extra;
    return Math.max(Math.abs(cx - this.ccx), Math.abs(cz - this.ccz)) <= R;
  }

  _ensure(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    const rec = { key, cx, cz, mesh: null, la: new Uint16Array(TPC * TPC * 4), lb: new Uint16Array(TPC * TPC * 4), ready: false, queued: false, leaves: [], buildMs: 0 };
    this.chunks.set(key, rec);
    this._enqueue(rec);
  }

  _enqueue(rec) {
    if (rec.queued) return;
    rec.queued = true;
    this.queue.push(rec);
  }

  _refreshDesired() {
    // the render ring is independent of world.active (it can reach one ring further for long corridor views);
    // chunk data comes from world.getChunk, which generates deterministically on demand
    const R = Math.min(this.q.renderRadius ?? 3, 4);
    for (let r = 0; r <= R; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r) this._ensure(this.ccx + dx, this.ccz + dz);
    }
    for (const rec of this.chunks.values()) {
      if (!this._inRange(rec.cx, rec.cz, 1)) this._dispose(rec);
    }
  }

  _onActive(c) {
    if (this.ccx === this.ccx && this._inRange(c.cx, c.cz)) this._ensure(c.cx, c.cz);
  }

  _onInactive(c) {
    // leaving world.active does not matter to the render ring; _refreshDesired disposes by distance
    const rec = c && this.chunks.get(c.key ?? chunkKey(c.cx, c.cz));
    if (rec && !this._inRange(rec.cx, rec.cz, 1)) this._dispose(rec);
  }

  _dispose(rec) {
    this.chunks.delete(rec.key);
    if (this.job && this.job.rec === rec) this.job = null;
    if (rec.queued) {
      const i = this.queue.indexOf(rec);
      if (i >= 0) this.queue.splice(i, 1);
      rec.queued = false;
    }
    if (rec.mesh) {
      this.scene.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      rec.mesh.geometry = null;
      if (this.meshPool.length < 64) this.meshPool.push(rec.mesh);
      rec.mesh = null;
    }
    this._removeLeaves(rec);
    this.fx.removeChunk(rec);
  }

  _relightAround(x, z, reach) {
    for (const rec of this.chunks.values()) {
      const x0 = rec.cx * CHUNK, z0 = rec.cz * CHUNK;
      if (x + reach < x0 || x - reach > x0 + CHUNK || z + reach < z0 || z - reach > z0 + CHUNK) continue;
      if (this.job && this.job.rec === rec) this.job = null;
      rec.geoOnly = false;
      this._enqueue(rec);
    }
  }

  /** find a feature in the meshed chunks by id -> { f, rec } */
  _findFeature(id) {
    if (id == null) return null;
    for (const rec of this.chunks.values()) {
      const ch = this.world.getChunk(rec.cx, rec.cz);
      for (const f of ch.features) if (f.id === id) return { f, rec };
    }
    return null;
  }

  /** geometry-only rebuild (no re-bake) of the chunk holding a feature */
  _regeo(rec) {
    if (!rec || rec.queued) return;
    rec.geoOnly = true;
    this._enqueue(rec);
  }

  // v3 task outcomes that change static geometry or baked light
  _onFeatureState(e) {
    const hit = this._findFeature(e.id);
    if (!hit) return;
    const { f, rec } = hit;
    const d = f.data || {};
    const isDone = e.state === 'done';
    if (f.type === 'breaker' && d.task === 'wires') return this._regeo(rec);
    if (f.type !== 'task') return;
    switch (d.kind) {
      case 'mop': {
        if (isDone === this.ctx.hidden.has(d.puddleId)) return;
        if (isDone) this.ctx.hidden.add(d.puddleId); else this.ctx.hidden.delete(d.puddleId);
        const p = this._findFeature(d.puddleId);
        this._relightAround(p ? p.f.x : f.x, p ? p.f.z : f.z, 2);
        return;
      }
      case 'fixLight': {
        if (!d.fixtureId || isDone === this.ctx.steady.has(d.fixtureId)) return;
        if (isDone) this.ctx.steady.add(d.fixtureId); else this.ctx.steady.delete(d.fixtureId);
        let fx = f.x, fz = f.z;
        for (const r of this.chunks.values()) for (const q of this.world.getChunk(r.cx, r.cz).fixtures) if (q.id === d.fixtureId) { fx = q.x; fz = q.z; }
        this._relightAround(fx, fz, RELIGHT_REACH);
        return;
      }
      case 'straighten': {
        if (isDone === this.ctx.straight.has(d.posterId)) return;
        if (isDone) this.ctx.straight.add(d.posterId); else this.ctx.straight.delete(d.posterId);
        const p = this._findFeature(d.posterId);
        this._regeo(p ? p.rec : rec);
        return;
      }
      case 'wires': case 'copier': case 'timesheet': case 'vendingStuck': case 'router':
        this._regeo(rec);
        return;
      default:
    }
  }

  _next() {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const r = this.queue[i];
      const dx = r.cx - this.ccx, dz = r.cz - this.ccz;
      // rebuilds of already visible chunks first, then nearest
      const d = dx * dx + dz * dz + (r.ready ? -0.5 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const rec = this.queue[best];
    this.queue[best] = this.queue[this.queue.length - 1];
    this.queue.pop();
    rec.queued = false;
    return rec;
  }

  _process(budgetMs, boot = false) {
    const t0 = performance.now();
    let spent = 0;
    for (;;) {
      if (!this.job) {
        const rec = this._next();
        if (!rec) break;
        this.job = { rec, gen: this._buildJob(rec), ms: 0 };
      }
      const job = this.job;
      const s = performance.now();
      const res = job.gen.next();
      const d = performance.now() - s;
      job.ms += d;
      if (!boot && d > this.build.maxSliceMs) this.build.maxSliceMs = d;
      if (res.done && this.job === job) {
        this.job = null;
        this.build.chunks++;
        this.build.totalMs += job.ms;
        if (job.ms > this.build.maxChunkMs) this.build.maxChunkMs = job.ms;
        job.rec.buildMs = job.ms;
      }
      spent = performance.now() - t0;
      // stop before a slice that would likely overrun the frame budget
      if (spent + d >= budgetMs) break;
    }
    if (!boot) {
      this.build.lastFrameMs = spent;
      if (spent > this.build.maxFrameMs) this.build.maxFrameMs = spent;
    }
  }

  *_buildJob(rec) {
    const geoOnly = rec.geoOnly && rec.ready;
    rec.geoOnly = false;
    if (!geoOnly) {
      yield* bakeChunk(this.world, rec.cx, rec.cz, rec.la, rec.lb, this.doorBlocked, this.ctx);
      this._uploadLight(rec);
      yield;
    }
    const chunk = this.world.getChunk(rec.cx, rec.cz);
    const { geometry, leaves } = buildChunkGeometry(this.builder, this.world, chunk, this.ctx);
    this._swapMesh(rec, geometry, leaves);
    this.fx.addChunk(rec, chunk);
  }

  _uploadLight(rec) {
    const x = mod(rec.cx, TORUS) * TPC, y = mod(rec.cz, TORUS) * TPC;
    this._v2.set(x, y);
    this.srcA.image.data = rec.la;
    this.renderer.copyTextureToTexture(this.srcA, this.atlasA, null, this._v2);
    this.srcB.image.data = rec.lb;
    this.renderer.copyTextureToTexture(this.srcB, this.atlasB, null, this._v2);
  }

  _swapMesh(rec, geometry, leaves) {
    if (rec.mesh) {
      rec.mesh.geometry.dispose();
      rec.mesh.geometry = geometry;
    } else {
      const m = this.meshPool.pop() || new THREE.Mesh(geometry, this.material);
      m.geometry = geometry;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
      rec.mesh = m;
    }
    rec.mesh.position.set(rec.cx * CHUNK - this.origin.x, 0, rec.cz * CHUNK - this.origin.z);
    rec.mesh.updateMatrix();
    this._removeLeaves(rec);
    for (const l of leaves) this._addLeaf(rec, l);
    rec.ready = true;
  }

  // ---------------------------------------------------------------- doors

  _addLeaf(rec, l) {
    if (this.doorLeaves.has(l.door.id) || this.doorMesh.count >= MAX_DOORS) return;
    const leaf = { door: l.door, span: l.span, slot: this.doorMesh.count++, swing: strHash(l.door.id) & 1 ? 1 : -1 };
    this.doorSlots[leaf.slot] = leaf;
    this.doorLeaves.set(l.door.id, leaf);
    rec.leaves.push(leaf);
    this._leafMatrix(leaf);
  }

  _removeLeaves(rec) {
    for (const leaf of rec.leaves) {
      const last = this.doorSlots[this.doorMesh.count - 1];
      if (last !== leaf) {
        last.slot = leaf.slot;
        this.doorSlots[leaf.slot] = last;
        this._leafMatrix(last);
      }
      this.doorSlots[this.doorMesh.count - 1] = null;
      this.doorMesh.count--;
      this.doorLeaves.delete(leaf.door.id);
    }
    rec.leaves.length = 0;
    this.doorMesh.instanceMatrix.needsUpdate = true;
  }

  _leafMatrix(leaf) {
    const d = leaf.door;
    const w = leaf.span * CELL - 0.02;
    let hx, hz, base;
    if (d.axis === 'x') {
      const x0 = d.ix * CELL + 0.01;
      hz = (d.iz + 0.5) * CELL;
      if (d.hinge > 0) { hx = x0 + w; base = Math.PI; } else { hx = x0; base = 0; }
    } else {
      const z0 = d.iz * CELL + 0.01;
      hx = (d.ix + 0.5) * CELL;
      if (d.hinge > 0) { hz = z0 + w; base = Math.PI / 2; } else { hz = z0; base = -Math.PI / 2; }
    }
    // world swing (+-1) is the side the leaf opens toward; convert to a rotation sign for this hinge
    const sw = d.swing === 1 || d.swing === -1 ? d.swing : leaf.swing;
    const sign = d.axis === 'x' ? (d.hinge > 0 ? sw : -sw) : (d.hinge > 0 ? -sw : sw);
    const ang = base + sign * Math.min(1, Math.max(0, d.openT || 0)) * 1.5;
    this._q.setFromAxisAngle(this._yAxis, ang);
    this._p.set(hx - this.origin.x, 0, hz - this.origin.z);
    this._s.set(w, 1, 1);
    this._m.compose(this._p, this._q, this._s);
    this.doorMesh.setMatrixAt(leaf.slot, this._m);
    this.doorMesh.instanceMatrix.needsUpdate = true;
  }

  _onDoor(d) {
    const leaf = this.doorLeaves.get(d.id);
    if (leaf) { leaf.door = d; this._leafMatrix(leaf); }
    const b = doorBlocksLight(d);
    const prev = this.doorBlocked.get(d.id);
    this.doorBlocked.set(d.id, b);
    if (prev !== undefined && prev !== b) this._relightAround((d.ix + 0.5) * CELL, (d.iz + 0.5) * CELL, RELIGHT_REACH);
  }

  // ---------------------------------------------------------------- frame

  _rebase(x, z) {
    this.origin.x = Math.round(x / ORIGIN_STEP) * ORIGIN_STEP;
    this.origin.z = Math.round(z / ORIGIN_STEP) * ORIGIN_STEP;
    for (const rec of this.chunks.values()) {
      if (!rec.mesh) continue;
      rec.mesh.position.set(rec.cx * CHUNK - this.origin.x, 0, rec.cz * CHUNK - this.origin.z);
      rec.mesh.updateMatrix();
    }
    for (let i = 0; i < this.doorMesh.count; i++) this._leafMatrix(this.doorSlots[i]);
    this.fx.rebase(this.origin.x, this.origin.z);
  }

  _updateFlicker(dt) {
    const f = this.flick;
    const amt = settings.get('flicker');
    const k = typeof amt === 'number' ? amt : amt ? 1 : 0;
    if (f.burst > 0) {
      f.burst -= dt;
      f.t -= dt;
      if (f.t <= 0) {
        f.level = Math.random() < 0.55 ? 0.12 + Math.random() * 0.35 : 1;
        f.t = 0.025 + Math.random() * 0.1;
      }
      if (f.burst <= 0) { f.level = 1; f.next = 4 + Math.random() * 12; }
    } else {
      f.next -= dt;
      if (f.next <= 0) { f.burst = 0.25 + Math.random() * 1.0; f.t = 0; }
    }
    return 1 - (1 - f.level) * Math.max(0, Math.min(1, k));
  }

  /** baked light at a world position (cpu copy), in shader light units */
  _lightAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const rec = this.chunks.get(chunkKey(cx, cz));
    if (!rec || !rec.ready) return -1;
    const tx = Math.min(TPC - 1, Math.max(0, Math.floor((x - cx * CHUNK) / TEX)));
    const tz = Math.min(TPC - 1, Math.max(0, Math.floor((z - cz * CHUNK) / TEX)));
    const o = (tz * TPC + tx) * 4;
    const flk = 1 - half(rec.lb[o + 1]) * (1 - this.U.uFlick.value);
    return half(rec.la[o]) * flk * 0.7 + half(rec.la[o + 3]) * this.U.uBounce.value;
  }

  render(dt, frame) {
    const now = performance.now();
    if (this.lastNow) {
      const iv = now - this.lastNow;
      this.ring[this.ringI] = iv;
      this.ringI = (this.ringI + 1) % RING;
      if (this.ringN < RING) this.ringN++;
      if (this.auto && !frame.paused) this._autoQuality(iv);
    }
    this.lastNow = now;
    this.time += dt;
    const r = this.renderer;
    r.info.reset();
    const cam = frame.cam;

    if (Math.abs(cam.x - this.origin.x) > REBASE_DIST || Math.abs(cam.z - this.origin.z) > REBASE_DIST) this._rebase(cam.x, cam.z);
    const ccx = Math.floor(cam.x / CHUNK), ccz = Math.floor(cam.z / CHUNK);
    if (ccx !== this.ccx || ccz !== this.ccz) {
      this.ccx = ccx;
      this.ccz = ccz;
      this._refreshDesired();
    }
    this._process(this.q.buildMs);

    const c = this.camera;
    c.position.set(cam.x - this.origin.x, cam.y, cam.z - this.origin.z);
    c.rotation.set(cam.pitch || 0, cam.yaw || 0, cam.roll || 0, 'YXZ');
    const fov = cam.fov || CAMERA.fov;
    if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); this._partyPix(); }
    c.updateMatrixWorld();

    const U = this.U;
    U.uCamPos.value.copy(c.position);
    U.uFlick.value = this._updateFlicker(dt);
    this.party.update(dt, frame, cam, this.origin.x, this.origin.z);
    this.fx.update(dt, cam.x, cam.y, cam.z);
    U.uTime.value = this.time % 600;
    // interaction highlight: eased in fast, out faster; snaps to a pickup's rendered (bobbing) position
    const h = frame.highlight;
    const want = h && h.active ? 1 : 0;
    if (want) {
      const o = this.fx.resolveHighlight(h);
      U.uHL.value.set(o.x - this.origin.x, o.y, o.z - this.origin.z, o.r);
    }
    this.fx.setHold(want && h.kind === 'breaker' ? h.progress || 0 : 0, h ? h.x : 0, h ? h.z : 0);
    this.hlK += (want - this.hlK) * Math.min(1, dt * (want ? 18 : 26));
    U.uHLk.value = this.hlK < 0.01 ? 0 : this.hlK;
    // flashlight: held slightly right and below the eye, aimed along the view
    const target = frame.flashlight ? 1 : 0;
    this.flashOn += (target - this.flashOn) * Math.min(1, dt * 30);
    c.getWorldDirection(this._dir);
    this._right.crossVectors(this._dir, this._yAxis).normalize();
    this._up.crossVectors(this._right, this._dir);
    U.uFlashPos.value.copy(c.position).addScaledVector(this._right, 0.18).addScaledVector(this._up, -0.22);
    U.uFlashDir.value.copy(this._dir);
    U.uFlash.value = this.flashOn * 26;

    this.enemy.material.uniforms.uCamPos.value.copy(c.position);
    this.enemy.material.uniforms.uGain.value = 0.95 / this.post.exposure;
    this.enemy.update(frame.enemy, this.origin.x, this.origin.z, c.position, r, cam, this.party.k > 0 || !!(frame.party && frame.party.active));

    const la = this._lightAt(cam.x, cam.z);
    this.envLevel = la < 0 ? (this.envLevel ?? 1.5) : this.envLevel === undefined ? la : this.envLevel + (la - this.envLevel) * Math.min(1, dt * 6);
    // streaming-edge tone: a lit yellow wall at the local light level (no pale haze); also the clear colour
    const fk = Math.min(2.2, Math.max(0.5, this.envLevel));
    this.farK = this.farK === undefined ? fk : this.farK + (fk - this.farK) * Math.min(1, dt * 2);
    U.uFarCol.value.set(0.6 * this.farK, 0.48 * this.farK, 0.07 * this.farK);
    this.clearColor.setRGB(U.uFarCol.value.x * this.post.hdrScale, U.uFarCol.value.y * this.post.hdrScale, U.uFarCol.value.z * this.post.hdrScale);
    this.viewmodel.update(dt, frame.viewmodel, this.aspect, c.matrixWorldInverse, Math.max(0.03, this.envLevel), this.flashOn * 0.6);

    r.setRenderTarget(this.post.scene);
    r.setClearColor(this.clearColor, 1);
    r.clear(true, true, false);
    r.render(this.scene, c);
    if (this.viewmodel.root.visible) {
      r.clearDepth();
      r.render(this.viewmodel.scene, this.viewmodel.camera);
    }
    this.post.finish(frame.fx, this.time, settings.get('grain') ?? 0.35, settings.get('vhs') ?? 0);
    this.lastCalls = r.info.render.calls;
    this.lastTris = r.info.render.triangles;
    this.renderMs = performance.now() - now;
  }

  _autoQuality(iv) {
    // ignore the first frames after a change, then average ~2 s of frames
    this.autoFrames++;
    if (this.autoFrames < 90) return;
    this.autoAcc += Math.min(iv, 100);
    if (this.autoFrames < 90 + 120) return;
    const avg = this.autoAcc / 120;
    this.autoFrames = 0;
    this.autoAcc = 0;
    const i = TIERS.indexOf(this.qualityName);
    const down = this.qualityName === 'mobile' ? 'low' : i > 0 ? TIERS[i - 1] : null;
    if (avg > 22 && down) {
      this.autoTier = down;
      console.warn(`[render] auto quality: ${avg.toFixed(1)} ms/frame, stepping down to ${this.autoTier}`);
      this.setQuality('auto');
    }
  }

  stats() {
    const n = this.ringN;
    let sum = 0;
    for (let i = 0; i < n; i++) { this.sorted[i] = this.ring[i]; sum += this.ring[i]; }
    const s = this.sorted.subarray(0, n);
    s.sort();
    const avg = n ? sum / n : 0;
    const p99 = n ? s[Math.min(n - 1, Math.floor(n * 0.99))] : 0;
    const info = this.renderer?.info;
    let meshed = 0;
    for (const rec of this.chunks.values()) if (rec.ready) meshed++;
    const b = this.build;
    return {
      fps: avg ? Math.round(10000 / avg) / 10 : 0,
      frameMs: Math.round(avg * 100) / 100,
      p99Ms: Math.round(p99 * 100) / 100,
      calls: this.lastCalls,
      tris: this.lastTris,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      programs: info?.programs?.length ?? 0,
      chunksMeshed: meshed,
      pendingBuilds: this.queue.length + (this.job ? 1 : 0),
      quality: this.qualityName,
      auto: this.auto,
      renderMs: Math.round(this.renderMs * 100) / 100,
      doors: this.doorMesh?.count ?? 0,
      fxFeatures: this.fx?.list.length ?? 0,
      fxItems: this.fx?.itemList.length ?? 0,
      fxLights: this.U?.uDLN.value ?? 0,
      partyK: Math.round((this.party?.k ?? 0) * 1000) / 1000,
      partyConfetti: this.party?.confetti.visible ? this.party.confetti.geometry.instanceCount : 0,
      partyLasers: this.party?.lasers.visible ? this.party.lasers.geometry.instanceCount : 0,
      buildAvgMs: b.chunks ? Math.round((b.totalMs / b.chunks) * 100) / 100 : 0,
      buildMaxChunkMs: Math.round(b.maxChunkMs * 100) / 100,
      buildMaxSliceMs: Math.round(b.maxSliceMs * 100) / 100,
      buildMaxFrameMs: Math.round(b.maxFrameMs * 100) / 100,
      chunksBuilt: b.chunks,
      bootBuildMs: Math.round(this.bootBuildMs || 0),
      texGenMs: Math.round(this.texMs || 0),
      gpu: this.gpu,
    };
  }

  // ---------------------------------------------------------------- debug helpers (tests)

  debugLightAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const rec = this.chunks.get(chunkKey(cx, cz));
    if (!rec || !rec.ready) return null;
    const tx = Math.min(TPC - 1, Math.max(0, Math.floor((x - cx * CHUNK) / TEX)));
    const tz = Math.min(TPC - 1, Math.max(0, Math.floor((z - cz * CHUNK) / TEX)));
    const o = (tz * TPC + tx) * 4;
    const A = rec.la, B = rec.lb;
    return { floor: half(A[o]), wallHi: half(A[o + 1]), wallLo: half(A[o + 2]), bounce: half(A[o + 3]), ao: half(B[o]), flicker: half(B[o + 1]), wet: half(B[o + 2]), maint: half(B[o + 3]) };
  }

  debugRebuild() {
    for (const rec of [...this.chunks.values()]) this._dispose(rec);
    this.doorBlocked.clear();
    this._refreshDesired();
    const t0 = performance.now();
    while ((this.queue.length || this.job) && performance.now() - t0 < 20000) this._process(1000, true);
    return this.stats();
  }

  debugResetBuildStats() {
    this.build = { chunks: 0, totalMs: 0, maxChunkMs: 0, maxSliceMs: 0, maxFrameMs: 0, lastFrameMs: 0 };
    this.ringN = 0;
    this.ringI = 0;
  }
}
