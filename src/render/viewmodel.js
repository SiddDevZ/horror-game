// first-person black tactical hatchet + hand, drawn in its own pass after clearing depth (never clips walls).
// lit by the baked light level at the camera so it darkens with the room. v2: the left hand brings up the
// airhorn (raise, blast with a shake, lower) or an almond water bottle (raise to the mouth, glug, lower).
import * as THREE from 'three';
import { LBL } from './labels.js';

const vert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vL = position;
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`;
const frag = /* glsl */ `
uniform vec3 uAlbedo;
uniform float uSpec;
uniform float uGloss;
uniform float uGrip;
uniform float uEnv;
uniform float uFlash;
uniform vec3 uUp;
uniform vec3 uLightCol;
uniform float uHdrScale;
uniform sampler2D uMap;
uniform vec4 uRect;
uniform float uUseMap;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV);
  vec3 L = normalize(uUp + vec3(0.25, 0.0, 0.35));
  float ndl = max(dot(N, L), 0.0);
  float wrap = max(dot(N, uUp) * 0.5 + 0.5, 0.0);
  vec3 alb = uAlbedo;
  if (uGrip > 0.0) alb *= 0.7 + 0.3 * step(0.5, fract(vL.y * 70.0));
  if (uUseMap > 0.5) alb *= texture(uMap, mix(uRect.xy, uRect.zw, vUv)).rgb;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), uGloss) * uSpec;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uSpec * 0.6;
  float env = uEnv + uFlash;
  vec3 c = alb * (0.25 + 0.45 * wrap + 0.5 * ndl) * env * uLightCol + (spec + rim) * env * uLightCol;
  gl_FragColor = vec4(c * uHdrScale, 1.0);
}
`;

let WHITE = null;
function mat(albedo, spec, gloss, grip = 0, map = null, rect = null) {
  if (!WHITE) { WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true; }
  return new THREE.ShaderMaterial({
    name: 'viewmodel',
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
    uniforms: {
      uAlbedo: { value: new THREE.Color(albedo) }, uSpec: { value: spec }, uGloss: { value: gloss }, uGrip: { value: grip },
      uEnv: { value: 1 }, uFlash: { value: 0 }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      uLightCol: { value: new THREE.Color(0xf4fbe6) }, uHdrScale: { value: 1 },
      uMap: { value: map || WHITE }, uRect: { value: new THREE.Vector4(...(rect || [0, 0, 1, 1])) }, uUseMap: { value: map ? 1 : 0 },
    },
  });
}

function headShape() {
  const s = new THREE.Shape();
  s.moveTo(0.018, 0.035);
  s.lineTo(-0.05, 0.03);
  s.quadraticCurveTo(-0.1, 0.032, -0.128, 0.062);
  s.quadraticCurveTo(-0.108, -0.02, -0.124, -0.118);
  s.quadraticCurveTo(-0.075, -0.082, -0.036, -0.078);
  s.lineTo(-0.018, -0.05);
  s.lineTo(0.018, -0.045);
  s.lineTo(0.028, -0.022);
  s.quadraticCurveTo(0.062, -0.012, 0.102, -0.04);
  s.lineTo(0.106, -0.034);
  s.quadraticCurveTo(0.072, 0.022, 0.03, 0.03);
  s.closePath();
  // skeletonised cut-out like tactical hatchets
  const hole = new THREE.Path();
  hole.moveTo(-0.045, -0.005);
  hole.quadraticCurveTo(-0.07, -0.01, -0.085, -0.045);
  hole.quadraticCurveTo(-0.06, -0.04, -0.04, -0.03);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

export class Viewmodel {
  constructor(labels = null) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.mMetal = mat(0x141517, 0.1, 24);
    this.mGrip = mat(0x080808, 0.03, 10, 1);
    this.mSkin = mat(0xa8765a, 0.03, 8);
    this.materials = [this.mMetal, this.mGrip, this.mSkin];

    const g = new THREE.Group();
    // handle: origin at the grip, head at +y (long handle, compact head, like the reel)
    const HL = 0.6;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, HL, 0.032), this.mMetal);
    handle.position.y = HL / 2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.24, 0.038), this.mGrip);
    grip.position.y = 0.05;
    const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.042), this.mMetal);
    pommel.position.y = -0.08;
    const head = new THREE.Mesh(new THREE.ExtrudeGeometry(headShape(), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8 }), this.mMetal);
    head.position.set(0, HL - 0.03, -0.005);
    head.scale.setScalar(0.85);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 4), this.mMetal);
    spike.position.set(0.004, HL + 0.02, 0);
    g.add(handle, grip, pommel, head, spike);
    // hand: fist wrapped around the grip, thumb over the top, a bit of forearm
    const fist = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), this.mSkin);
    fist.scale.set(0.05, 0.062, 0.048);
    fist.position.set(0.012, 0.02, 0.012);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.04, 4, 8), this.mSkin);
    thumb.position.set(-0.012, 0.055, 0.03);
    thumb.rotation.z = 0.9;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 10), this.mSkin);
    arm.position.set(0.05, -0.06, 0.07);
    arm.rotation.set(1.1, 0, -0.5);
    g.add(fist, thumb, arm);
    this.HL = HL;
    this.baseQ = new THREE.Quaternion();
    this.baseP = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._qa = new THREE.Quaternion();
    this._poseAspect = 0;
    this.hatchet = g;
    this.root.add(g);
    this.t = 0;
    this._up = new THREE.Vector3();
    this._buildItems(labels);
  }

  _buildItems(labels) {
    const mRed = mat(0x8f0c07, 0.4, 70);
    const mCan = mat(0xc9ccd0, 0.55, 80);
    const mCanLabel = mat(0xffffff, 0.25, 40, 0, labels, LBL.AIRHORN);
    const mBlack = mat(0x121212, 0.25, 40);
    const mBottle = mat(0xe9e3d2, 0.5, 60);
    const mBottleLabel = mat(0xffffff, 0.2, 30, 0, labels, LBL.ALMOND);
    const mCap = mat(0xefefec, 0.25, 40);
    const mBlueCap = mat(0x7fa6c8, 0.35, 50);
    this.materials.push(mRed, mCan, mCanLabel, mBlack, mBottle, mBottleLabel, mCap, mBlueCap);
    const fistGeo = new THREE.SphereGeometry(1, 12, 10), thumbGeo = new THREE.CapsuleGeometry(0.013, 0.038, 4, 8);
    const hand = (grp, fx, fy, fz) => {
      // left fist wrapped around the item; the forearm is posed separately in view space
      const fist = new THREE.Mesh(fistGeo, this.mSkin);
      fist.scale.set(0.047, 0.052, 0.044);
      fist.position.set(fx, fy, fz);
      const thumb = new THREE.Mesh(thumbGeo, this.mSkin);
      thumb.position.set(fx + 0.018, fy + 0.022, fz + 0.034);
      thumb.rotation.set(0, 0, -1.1);
      grp.add(fist, thumb);
      grp.userData.fist = new THREE.Vector3(fx, fy, fz);
      return thumb;
    };
    this.lArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.18, 4, 10), this.mSkin);
    this.lArm.visible = false;
    this.root.add(this.lArm);
    this._fw = new THREE.Vector3();
    this._ad = new THREE.Vector3();
    this._yv = new THREE.Vector3(0, 1, 0);
    // airhorn: chrome can with a printed wrap, black valve, red trumpet, origin at the can base
    const horn = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.13, 24), mCan);
    can.position.y = 0.065;
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.0346, 0.0346, 0.085, 24, 1, true), mCanLabel);
    lab.position.y = 0.068; lab.rotation.y = Math.PI;
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.026, 16), mBlack);
    valve.position.y = 0.143;
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12), mCap);
    btn.position.set(0, 0.158, 0);
    const trumpet = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.011, 0), new THREE.Vector2(0.013, 0.03), new THREE.Vector2(0.018, 0.07), new THREE.Vector2(0.028, 0.1),
      new THREE.Vector2(0.044, 0.122), new THREE.Vector2(0.052, 0.13), new THREE.Vector2(0.05, 0.134),
    ], 20), mRed);
    trumpet.position.y = 0.15;
    horn.add(can, lab, valve, btn, trumpet);
    this.hornThumb = hand(horn, -0.01, 0.055, -0.014);
    this.hornThumb.position.set(0.004, 0.17, 0.012);
    this.hornThumb.rotation.set(Math.PI / 2, 0, 0.3);
    this.hornBtn = btn;
    // almond water bottle, origin at the base
    const bottle = new THREE.Group();
    const body = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0, 0), new THREE.Vector2(0.03, 0), new THREE.Vector2(0.034, 0.005), new THREE.Vector2(0.034, 0.15),
      new THREE.Vector2(0.03, 0.168), new THREE.Vector2(0.018, 0.184), new THREE.Vector2(0.015, 0.192),
    ], 24), mBottle);
    const blab = new THREE.Mesh(new THREE.CylinderGeometry(0.0348, 0.0348, 0.08, 24, 1, true), mBottleLabel);
    blab.position.y = 0.085; blab.rotation.y = Math.PI;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.022, 16), mBlueCap);
    cap.position.y = 0.2;
    bottle.add(body, blab, cap);
    hand(bottle, -0.016, 0.1, -0.014);
    this.horn = horn;
    this.bottle = bottle;
    horn.visible = bottle.visible = false;
    this.root.add(horn, bottle);
    this.itemK = 0;
    this._ip = new THREE.Vector3();
    this._iq = new THREE.Quaternion();
    this._iq2 = new THREE.Quaternion();
    this._ie = new THREE.Euler();
    this.poseI = {};
  }

  // item poses in view space (recomputed per aspect): rest (low left, mostly off screen), airhorn aim, drink
  _poseItems(aspect) {
    const ty = Math.tan((this.camera.fov * Math.PI) / 360);
    const at = (nx, ny, d) => new THREE.Vector3(nx * ty * aspect * d, ny * ty * d, -d);
    this.poseI = {
      rest: at(-0.55, -1.3, 0.42),
      aimP: at(-0.36, -0.62, 0.4),
      // horn up and forward, can upright enough to show its wrap
      aimQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0.35, -0.3)),
      restQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.3, 0.35)),
      // bottom tipped up in front of the face, cap toward the mouth
      drinkP: new THREE.Vector3(-0.04, -0.025, -0.41),
      drinkQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(2.13, Math.PI + 0.28, 0.25)),
      bottleRestQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, Math.PI + 0.2, 0.25)),
    };
  }

  _updateItem(dt, vm) {
    const item = vm.item === 'airhorn' || vm.item === 'almond' ? vm.item : null;
    this.itemK += ((item ? 1 : 0) - this.itemK) * Math.min(1, dt * 14);
    this.horn.visible = item === 'airhorn';
    this.bottle.visible = item === 'almond';
    this.lArm.visible = !!item;
    if (!item) return;
    const P = this.poseI, u = Math.max(0, Math.min(1, vm.useT || 0));
    const g = item === 'airhorn' ? this.horn : this.bottle;
    let toP = item === 'airhorn' ? P.aimP : P.drinkP;
    let toQ = item === 'airhorn' ? P.aimQ : P.drinkQ;
    if (this.debugPose) { toP = this.debugPose.p; toQ = this.debugPose.q; } // test hook (render-v2-pose)
    const fromQ = item === 'airhorn' ? P.restQ : P.bottleRestQ;
    const r0 = item === 'airhorn' ? 0.14 : 0.22, r1 = 0.8;
    let k;
    if (u < r0) k = easeOut(u / r0);
    else if (u < r1) k = 1;
    else k = 1 - easeInOut((u - r1) / (1 - r1));
    const ip = this._ip.lerpVectors(P.rest, toP, k);
    const iq = this._iq.slerpQuaternions(fromQ, toQ, k);
    if (item === 'airhorn') {
      // blast: sharp recoil at the press, then a buzzing shake while it sounds
      const blast = u >= r0 && u < r1 ? 1 : 0;
      const since = (u - r0) / (r1 - r0);
      const kick = blast * Math.exp(-since * 9) * 0.035;
      const buzz = blast * (0.0035 + 0.002 * Math.exp(-since * 4));
      ip.x += Math.sin(this.t * 97) * buzz;
      ip.y += Math.sin(this.t * 83 + 1.3) * buzz + kick * 0.4;
      ip.z += kick;
      this._ie.set(-kick * 3, 0, Math.sin(this.t * 71) * buzz * 4);
      iq.multiply(this._iq2.setFromEuler(this._ie));
      this.hornBtn.position.y = 0.158 - blast * 0.004;
      this.hornThumb.position.y = 0.17 - blast * 0.004;
    } else {
      // glug: small tilting pulses while drinking
      const drink = u >= r0 && u < r1 ? 1 : 0;
      const gl = drink * Math.sin(((u - r0) / (r1 - r0)) * Math.PI * 7);
      this._ie.set(gl * 0.05, 0, 0);
      iq.multiply(this._iq2.setFromEuler(this._ie));
      ip.y += gl * 0.004;
    }
    g.position.copy(ip);
    g.quaternion.copy(iq);
    // forearm from the fist to a point below the lower-left edge of the view
    g.updateMatrix();
    const fw = this._fw.copy(g.userData.fist).applyMatrix4(g.matrix);
    const ad = this._ad.set(fw.x - 0.2, fw.y - 0.32, fw.z + 0.1).sub(fw);
    const len = ad.length();
    this.lArm.position.copy(fw).addScaledVector(ad, 0.5);
    this.lArm.quaternion.setFromUnitVectors(this._yv, ad.divideScalar(len));
    this.lArm.scale.set(1, len / 0.24, 1);
  }

  // pose from screen targets (reel 14 s / 18 s): head at the right edge around mid height, partly cut off;
  // near-vertical handle down to a sliver of hand in the bottom-right corner. recomputed per aspect.
  _pose(aspect) {
    this._poseAspect = aspect;
    const ty = Math.tan((this.camera.fov * Math.PI) / 360);
    const at = (nx, ny, d) => new THREE.Vector3(nx * ty * aspect * d, ny * ty * d, -d);
    const T = at(0.9, 0.03, 0.75);
    const H = at(0.93, -1.12, 0.42);
    const up = T.clone().sub(H);
    this.hatchet.scale.setScalar(up.length() / this.HL);
    up.normalize();
    const z = new THREE.Vector3(-0.35, 0, 1).normalize();
    z.addScaledVector(up, -z.dot(up)).normalize();
    const x = new THREE.Vector3().crossVectors(up, z);
    this.baseQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    this.baseP.copy(H);
  }

  update(dt, vm, aspect, cameraWorld, env, flash) {
    this.root.visible = !!(vm && vm.visible !== false);
    if (!this.root.visible) return;
    this.t += dt;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    if (this._poseAspect !== aspect) { this._pose(aspect); this._poseItems(aspect); }
    this._updateItem(dt, vm);
    const bx = cl(vm.bobX, 0.08), by = cl(vm.bobY, 0.08);
    const sx = cl(vm.swayX, 0.3), sy = cl(vm.swayY, 0.3);
    const sp = cl(vm.sprint, 1);
    const sw = Math.max(0, Math.min(1, vm.swing || 0));
    // swing arc: wind-up, fast chop down-left, recover
    let chop = 0, wind = 0;
    if (sw > 0) {
      if (sw < 0.22) wind = easeOut(sw / 0.22);
      else if (sw < 0.45) { wind = 1 - easeOut((sw - 0.22) / 0.23); chop = easeOut((sw - 0.22) / 0.23); }
      else chop = 1 - easeInOut((sw - 0.45) / 0.55);
    }
    const breathe = Math.sin(this.t * 1.3) * 0.003;
    const g = this.hatchet;
    const P = this.baseP;
    g.position.set(P.x + bx - chop * 0.14 + wind * 0.02, P.y + by + breathe - sp * 0.05 - chop * 0.14 + wind * 0.06 - this.itemK * 0.05, P.z - chop * 0.04);
    this._e.set(-sy - sp * 0.2 + wind * 0.5 - chop * 1.0, sx + chop * 0.25, -sp * 0.3 + chop * 0.55, 'XYZ');
    this._qa.setFromEuler(this._e);
    g.quaternion.multiplyQuaternions(this._qa, this.baseQ);
    // world up in view space for the key light
    this._up.set(0, 1, 0).transformDirection(cameraWorld);
    for (const m of this.materials) {
      m.uniforms.uEnv.value = env;
      m.uniforms.uFlash.value = flash;
      m.uniforms.uUp.value.copy(this._up);
    }
  }
}

const cl = (v, m) => (v > m ? m : v < -m ? -m : v || 0);
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
