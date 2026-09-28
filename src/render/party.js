// v4 party mode visuals. reads frame.party ({ active, t, beat, bpm, intensity, x, z }) and drives:
//   world shader disco spots (uPB/uPK/uPR + a polar visibility map around the disco ball, swept a few rays per frame),
//   fixture hue cycling + light pump (world shader, same uniforms), jukebox neon/ball (features.js via fx.party),
//   gpu-animated confetti (one instanced draw), laser beams from the ball with wall-clipped lengths and hit glows,
//   post bloom pulse + rainbow grade (post.party). k eases to exactly 0 and everything is hidden / zeroed at 0.
import * as THREE from 'three';
import { CELL, CEIL_H } from '../config.js';

const VIS_N = 512;
const VIS_MAX = 40;
const MAX_CONFETTI = 900;
const MAX_LASERS = 8;
const TAU = Math.PI * 2;

export function createVisTexture() {
  const t = new THREE.DataTexture(new Uint8Array(VIS_N * 4), VIS_N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const HUE = /* glsl */ `vec3 hue3(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }`;

// confetti: every flake's position is a function of time and its seed, wrapped into a box around the camera
const confVert = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam;
uniform float uTime;
uniform float uK;
uniform float uBox;
varying vec3 vCol;
varying float vShade;
${HUE}
void main() {
  float fall = 0.32 + 0.4 * aSeed.w;
  float y = ${CEIL_H.toFixed(2)} - 0.04 - mod(uTime * fall + aSeed.y * 29.0, ${(CEIL_H - 0.06).toFixed(2)});
  vec2 xz = aSeed.xz * uBox + vec2(sin(uTime * (0.8 + aSeed.w) + aSeed.w * 40.0), cos(uTime * (0.6 + aSeed.x) + aSeed.z * 30.0)) * 0.28;
  vec2 rel = mod(xz - uCam.xz + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 c = vec3(uCam.x + rel.x, y, uCam.z + rel.y);
  // tumble around a per-flake axis
  float a = uTime * (2.5 + 5.0 * aSeed.w) + aSeed.x * 50.0;
  vec3 ax = normalize(vec3(aSeed.z - 0.5, 0.45, aSeed.x - 0.5));
  float ca = cos(a), sa = sin(a);
  vec3 p = position * (0.036 * smoothstep(0.0, 0.35, uK) * smoothstep(0.12, 0.5, length(c - uCam)));
  p = p * ca + cross(ax, p) * sa + ax * dot(ax, p) * (1.0 - ca);
  vec3 n = vec3(0.0, 0.0, 1.0);
  n = n * ca + cross(ax, n) * sa + ax * dot(ax, n) * (1.0 - ca);
  vec3 v = normalize(uCam - c);
  vShade = 0.35 + 0.65 * abs(dot(n, v)) + 1.4 * pow(abs(dot(n, v)), 24.0);
  float hh = fract(aSeed.w * 7.13 + aSeed.x * 3.1);
  vCol = mix(hue3(hh), vec3(1.0, 0.92, 0.55), step(0.86, hh) * 0.9);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + p, 1.0);
}
`;
const confFrag = /* glsl */ `
uniform float uHdrScale;
uniform float uK;
uniform float uPulse;
varying vec3 vCol;
varying float vShade;
void main() {
  gl_FragColor = vec4(vCol * vShade * (1.35 + 0.5 * uPulse) * uHdrScale, 1.0);
}
`;

// laser beams: camera-facing ribbons along (start, dir, length); soft core + glow, additive
const laserVert = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
uniform vec3 uCamPos;
uniform float uPix;
varying float vX;
varying float vY;
varying float vE;
varying vec3 vCol;
${HUE}
void main() {
  vec3 p = aA.xyz + aB.xyz * aA.w * position.y;
  vec3 tc = uCamPos - p;
  float d = length(tc);
  vec3 side = normalize(cross(aB.xyz, tc / max(d, 1e-4)));
  // at least ~3 px wide; energy kept constant as it widens
  float w = max(0.05, d * uPix * 3.0);
  vE = 0.05 / w;
  p += side * position.x * w;
  vX = position.x * 2.0;
  vY = position.y;
  vCol = hue3(aB.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const laserFrag = /* glsl */ `
uniform float uHdrScale;
uniform float uK;
varying float vX;
varying float vY;
varying float vE;
varying vec3 vCol;
void main() {
  float x2 = vX * vX;
  float core = exp(-x2 * 22.0), glow = exp(-x2 * 3.5) * 0.3;
  float ends = smoothstep(0.0, 0.03, vY);
  vec3 c = (vCol * (core * 4.5 + glow * 2.0) + vec3(core * 1.3)) * vE * ends * uK;
  gl_FragColor = vec4(c * uHdrScale, 1.0);
}
`;

let _st = 0x9e3779b9;
const rnd = () => ((_st = (Math.imul(_st, 1664525) + 1013904223) >>> 0) / 4294967296);

export class PartyFX {
  /** U: world uniforms (shared uPB/uPK/uPR/uPVis/uCamPos/uHdrScale); fx: FeatureFX (jukebox entries, halo material) */
  constructor(scene, U, fx, world, vis) {
    this.U = U;
    this.fx = fx;
    this.world = world;
    this.vis = vis;
    this.visData = vis.image.data;
    this.visI = 0;
    this.visX = NaN;
    this.visZ = NaN;
    this.visReady = false;
    this.k = 0;
    this.idle = 0;
    this.beat = 0;
    this.pulse = 0;
    this.spin = 0;
    this.t = 0;
    this.pix = 0.001;
    this.nConf = 480;
    this.nLas = 6;
    this.ball = { x: 0, y: 2.3, z: 0, ok: false };
    this.post = { k: 0, pulse: 0, t: 0, beat: 0 };
    this._rgb = [0, 0, 0];
    this._m = new THREE.Matrix4();

    // confetti
    const pg = new THREE.PlaneGeometry(1, 0.62);
    const cg = new THREE.InstancedBufferGeometry();
    cg.index = pg.index;
    cg.setAttribute('position', pg.attributes.position);
    const seeds = new Float32Array(MAX_CONFETTI * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    cg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    cg.instanceCount = 0;
    this.confMat = new THREE.ShaderMaterial({
      name: 'confetti',
      vertexShader: confVert,
      fragmentShader: confFrag,
      side: THREE.DoubleSide,
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uK: { value: 0 }, uBox: { value: 14 }, uPulse: { value: 0 },
        uHdrScale: U.uHdrScale,
      },
    });
    this.confetti = new THREE.Mesh(cg, this.confMat);
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    scene.add(this.confetti);

    // lasers
    const lg0 = new THREE.PlaneGeometry(1, 1);
    lg0.translate(0, 0.5, 0);
    const lg = new THREE.InstancedBufferGeometry();
    lg.index = lg0.index;
    lg.setAttribute('position', lg0.attributes.position);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LASERS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LASERS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('aA', this.aA);
    lg.setAttribute('aB', this.aB);
    lg.instanceCount = 0;
    this.laserMat = new THREE.ShaderMaterial({
      name: 'laser',
      vertexShader: laserVert,
      fragmentShader: laserFrag,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uCamPos: U.uCamPos, uPix: { value: 0.001 }, uK: { value: 0 }, uHdrScale: U.uHdrScale },
    });
    this.lasers = new THREE.Mesh(lg, this.laserMat);
    this.lasers.frustumCulled = false;
    this.lasers.visible = false;
    this.lasers.renderOrder = 3;
    scene.add(this.lasers);
    // glow where each beam lands (shares the halo program)
    this.dots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), fx.mats.halo, MAX_LASERS);
    this.dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LASERS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    this.dots.renderOrder = 3;
    scene.add(this.dots);
  }

  setQuality(q) {
    this.nConf = Math.min(MAX_CONFETTI, q.partyConfetti ?? 480);
    this.nLas = Math.min(MAX_LASERS, q.partyLasers ?? 6);
  }

  /** every party program compiles at init */
  compileMode(on) {
    this.confetti.visible = this.lasers.visible = this.dots.visible = on;
    this.confetti.geometry.instanceCount = this.lasers.geometry.instanceCount = on ? 1 : 0;
    this.dots.count = on ? 1 : 0;
  }

  // 2d grid dda over blocksSight from (x, z) along unit (dx, dz); distance to the first blocking cell, capped
  _ray(x, z, dx, dz, maxD) {
    const W = this.world;
    let ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tx = dx > 0 ? ((ix + 1) * CELL - x) / dx : dx < 0 ? (ix * CELL - x) / dx : Infinity;
    let tz = dz > 0 ? ((iz + 1) * CELL - z) / dz : dz < 0 ? (iz * CELL - z) / dz : Infinity;
    for (;;) {
      let t;
      if (tx < tz) { t = tx; tx += tdx; ix += sx; } else { t = tz; tz += tdz; iz += sz; }
      if (t >= maxD) return maxD;
      if (W.blocksSight(ix, iz)) return t;
    }
  }

  _sweep(n) {
    const b = this.ball, d = this.visData;
    for (let j = 0; j < n; j++) {
      const i = this.visI;
      const a = ((i + 0.5) / VIS_N) * TAU - Math.PI;
      const r = this._ray(b.x, b.z, Math.cos(a), Math.sin(a), VIS_MAX);
      d[i * 4] = Math.min(255, Math.round((r / VIS_MAX) * 255));
      this.visI = (i + 1) % VIS_N;
      if (this.visI === 0) { this.vis.needsUpdate = true; this.visReady = true; }
    }
  }

  // nearest jukebox (to the party origin while partying, else to the camera) -> this.ball
  _findBall(frame, cx, cz) {
    const p = frame.party;
    const on = p && p.active && Number.isFinite(p.x) && Number.isFinite(p.z) && (p.x !== 0 || p.z !== 0);
    const qx = on ? p.x : cx, qz = on ? p.z : cz;
    let best = null, bd = Infinity;
    for (const e of this.fx.list) {
      if (e.type !== 'jukebox') continue;
      const d = (e.f.x - qx) ** 2 + (e.f.z - qz) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    const b = this.ball;
    if (best && (!on || bd < 36)) { b.x = best.bx; b.y = best.by; b.z = best.bz; b.ok = true; }
    else if (on) { b.x = p.x; b.y = 2.3; b.z = p.z; b.ok = true; }
    else b.ok = false;
  }

  /** before fx.update. cam: frame.cam (world); ox/oz: render origin */
  update(dt, frame, cam, ox, oz) {
    const p = frame.party;
    const want = p && p.active ? Math.min(1, Math.max(0, Number.isFinite(p.intensity) ? p.intensity : 1)) : 0;
    this.k = Math.max(want, this.k - dt * 2.5);
    if (this.k < 1e-3) this.k = 0;
    const k = this.k;
    this.t += dt;
    if (k > 0 && p && p.active && Number.isFinite(p.beat)) this.beat = p.beat;
    else if (k > 0) this.beat += dt * 2;
    else this.beat = 0;
    const fb = this.beat - Math.floor(this.beat);
    this.pulse = k > 0 ? Math.exp(-fb * 5) : 0;
    this.spin = (this.spin + dt * (0.3 + 1.5 * k)) % TAU;

    this._findBall(frame, cam.x, cam.z);
    const b = this.ball;
    const near = b.ok ? Math.hypot(cam.x - b.x, cam.z - b.z) : Infinity;
    const idleWant = b.ok && near < 30 ? 1 : 0;
    this.idle += (idleWant - this.idle) * Math.min(1, dt * 3);
    if (this.idle < 1e-3) this.idle = 0;
    if (b.ok && (Math.abs(b.x - this.visX) > 0.01 || Math.abs(b.z - this.visZ) > 0.01)) {
      this.visX = b.x; this.visZ = b.z; this.visI = 0; this.visReady = false;
      this.visData.fill(0);
      this.vis.needsUpdate = true;
    }
    if (b.ok && (k > 0 || this.idle > 0)) this._sweep(k > 0 || !this.visReady ? 64 : 16);

    const U = this.U;
    U.uPB.value.set(b.x - ox, b.y, b.z - oz, 3.8 + 20 * k);
    U.uPK.value.set(k, b.ok ? this.idle * (1 - k) : 0, this.beat, this.pulse);
    U.uPR.value.set(Math.cos(this.spin), Math.sin(this.spin), this.pix, this.t % 600);

    const fp = this.fx.party;
    fp.k = k; fp.beat = this.beat; fp.pulse = this.pulse; fp.spin = this.spin;
    const po = this.post;
    po.k = k; po.pulse = this.pulse; po.t = this.t % 600; po.beat = this.beat;

    // confetti around the camera
    const cf = this.confetti;
    cf.visible = k > 0 && this.nConf > 0;
    if (cf.visible) {
      const u = this.confMat.uniforms;
      u.uCam.value.set(cam.x - ox, cam.y, cam.z - oz);
      u.uTime.value = this.t % 600;
      u.uK.value = k;
      u.uPulse.value = this.pulse;
      cf.geometry.instanceCount = this.nConf;
    }
    this._lasers(k, b, ox, oz);
  }

  _lasers(k, b, ox, oz) {
    const n = k > 0 && b.ok ? this.nLas : 0;
    this.lasers.visible = this.dots.visible = n > 0;
    this.lasers.geometry.instanceCount = n;
    this.dots.count = n;
    if (!n) return;
    const A = this.aA.array, B = this.aB.array, t = this.t, rgb = this._rgb;
    const by = b.y - 0.02;
    for (let i = 0; i < n; i++) {
      const dir = i & 1 ? 1 : -1;
      const yaw = this.spin * 0.7 * dir + (i / n) * TAU + 0.45 * Math.sin(t * 0.9 + i * 1.3);
      const el = -0.1 - 0.22 * (0.5 + 0.5 * Math.sin(t * 1.15 + i * 1.9));
      const ce = Math.cos(el), dx = Math.cos(yaw), dz = Math.sin(yaw), dy = Math.sin(el);
      const hz = this._ray(b.x, b.z, dx, dz, 30);
      let len = hz / ce;
      if (dy < 0) len = Math.min(len, by / -dy);
      else if (dy > 0) len = Math.min(len, (CEIL_H - by) / dy);
      len = Math.max(0.1, len - 0.02);
      const o = i * 4;
      A[o] = b.x - ox; A[o + 1] = by; A[o + 2] = b.z - oz; A[o + 3] = len;
      B[o] = dx * ce; B[o + 1] = dy; B[o + 2] = dz * ce;
      const h = (i / n + this.beat * 0.0625) % 1;
      B[o + 3] = h;
      // hit glow, pulled slightly back toward the ball
      const hl = Math.max(0, len - 0.06);
      this._m.makeScale(0.2, 0.2, 0.2).setPosition(b.x - ox + B[o] * hl, by + dy * hl, b.z - oz + B[o + 2] * hl);
      this.dots.setMatrixAt(i, this._m);
      const c = hue(h, rgb), g = k * (0.9 + 0.8 * this.pulse);
      this.dots.instanceColor.array[i * 3] = c[0] * g; this.dots.instanceColor.array[i * 3 + 1] = c[1] * g; this.dots.instanceColor.array[i * 3 + 2] = c[2] * g;
    }
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.instanceColor.needsUpdate = true;
    this.laserMat.uniforms.uK.value = k * (0.75 + 0.25 * this.pulse);
    this.laserMat.uniforms.uPix.value = this.pix;
  }
}

function hue(h, out) {
  h -= Math.floor(h);
  for (let i = 0; i < 3; i++) {
    let x = h + (i === 0 ? 0 : i === 1 ? 2 / 3 : 1 / 3);
    x = Math.abs((x - Math.floor(x)) * 6 - 3) - 1;
    out[i] = x < 0 ? 0 : x > 1 ? 1 : x;
  }
  return out;
}
