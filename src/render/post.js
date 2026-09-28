// lean post chain: hdr scene target (msaa) -> optional 2-level bloom -> one composite pass
// (exposure, neutral tone mapping, vignette, fx, optional vhs, grain, srgb output, dither).
import * as THREE from 'three';

const fsVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const brightFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uScale;
uniform float uThr;
varying vec2 vUv;
vec3 pick(vec2 uv) { vec3 c = texture(tSrc, uv).rgb * uScale; return max(c - uThr, 0.0); }
void main() {
  vec2 o = uTexel;
  vec3 c = pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(min(c * 0.25, vec3(8.0)), 1.0);
}
`;

const downFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 c = texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture(tSrc, vUv + vec2(o.x, -o.y)).rgb + texture(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture(tSrc, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const blurFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.227027;
  c += texture(tSrc, vUv + uDir * 1.384615).rgb * 0.316216;
  c += texture(tSrc, vUv - uDir * 1.384615).rgb * 0.316216;
  c += texture(tSrc, vUv + uDir * 3.230769).rgb * 0.070270;
  c += texture(tSrc, vUv - uDir * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const compFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float uScale;
uniform float uBloom;
uniform float uTime;
uniform float uGrain;
uniform float uVhs;
uniform float uImpact;
uniform float uChase;
uniform float uDeath;
uniform float uProtect;
uniform vec2 uRes;
uniform vec4 uParty; // k, time, beat pulse, beat
varying vec2 vUv;
vec3 hue3(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 sceneAt(vec2 uv) {
  vec3 c = texture(tScene, uv).rgb * uScale;
  c += (texture(tBloomA, uv).rgb * 0.55 + texture(tBloomB, uv).rgb * 0.45) * uBloom;
  return c;
}
void main() {
  vec2 uv = vUv;
  float band = 0.0;
  if (uVhs > 0.0) {
    float line = floor(uv.y * uRes.y * 0.5);
    float tf = floor(uTime * 30.0);
    band = smoothstep(0.455, 0.49, abs(fract(uv.y * 0.6 - uTime * 0.05) - 0.5));
    uv.x += (sin(uv.y * 11.0 + uTime * 1.3) * 0.0012 + (hash12(vec2(line, tf)) - 0.5) * 0.0009 + band * (hash12(vec2(tf, line)) - 0.5) * 0.012) * uVhs;
  }
  vec3 c;
  if (uVhs > 0.0) {
    float o = 0.0022 * uVhs;
    c = vec3(sceneAt(uv + vec2(o, 0.0)).r, sceneAt(uv).g, sceneAt(uv - vec2(o, 0.0)).b);
  } else {
    c = sceneAt(uv);
  }
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(lum), uImpact * 0.75) + uImpact * 0.6;
  vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = smoothstep(0.45, 1.15, length(d));
  if (uParty.x > 0.0) {
    // party grade: a slowly turning rainbow wash that is strongest at the frame edges, a saturation lift and a
    // small exposure kick on each beat; the vignette turns coloured instead of dark
    float ang = atan(d.y, d.x) * 0.15915494;
    vec3 rb = hue3(ang + uParty.y * 0.12 + uParty.w * 0.03);
    float edge = smoothstep(0.2, 0.95, length(d));
    float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l0), c, 1.0 + 0.3 * uParty.x);
    c = mix(c, c * (0.45 + 1.1 * rb), uParty.x * (0.1 + 0.3 * edge));
    c += rb * vig * 0.12 * uParty.x * (0.6 + 0.4 * uParty.z);
    c *= 1.0 + 0.1 * uParty.z * uParty.x;
    vig *= 1.0 - 0.6 * uParty.x;
  }
  c = neutral(max(c, 0.0));
  c *= 1.0 - vig * (0.2 + 0.45 * uChase);
  c = mix(c, c * vec3(0.95, 1.01, 1.03) + 0.025, uProtect * 0.6);
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l2) * 0.12, clamp(uDeath, 0.0, 1.0));
  if (uVhs > 0.0) {
    c *= 1.0 - uVhs * 0.07 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5708));
    c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), 0.18 * uVhs);
    c += (hash12(vUv * uRes + uTime * 91.0) - 0.5) * 0.35 * uVhs * band;
  }
  c = srgb(clamp(c, 0.0, 1.0));
  float g = hash12(floor(vUv * uRes) + fract(uTime * 7.31) * 517.0) - 0.5;
  float ll = dot(c, vec3(0.3333));
  // film grain: lighter and darkening-biased so bright areas never sparkle with white specks
  c += (g - 0.2) * uGrain * 0.05 * (1.0 - 0.7 * ll);
  c += (hash12(floor(vUv * uRes) + 71.3) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.w = 1;
    this.h = 1;
    this.msaa = 0;
    this.bloomOn = true;
    this.hdrType = THREE.HalfFloatType;
    this.hdrScale = 1;
    const ext = renderer.extensions;
    if (!(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))) {
      // no float colour buffers: store scaled hdr in rgba8
      this.hdrType = THREE.UnsignedByteType;
      this.hdrScale = 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.mBright = mk(brightFrag, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 1 }, uThr: { value: 1.3 } });
    this.mDown = mk(downFrag, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mBlur = mk(blurFrag, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mComp = mk(compFrag, {
      tScene: { value: null }, tBloomA: { value: this.black }, tBloomB: { value: this.black },
      uScale: { value: 1 }, uBloom: { value: 0.5 }, uTime: { value: 0 }, uGrain: { value: 0.35 }, uVhs: { value: 0 },
      uImpact: { value: 0 }, uChase: { value: 0 }, uDeath: { value: 0 }, uProtect: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uParty: { value: new THREE.Vector4() },
    });
    this.exposure = 0.56;
    this.party = null; // { k, pulse, t, beat } from PartyFX
    this.scene = null;
  }

  setup(w, h, msaa, bloom) {
    this.w = w; this.h = h; this.msaa = msaa; this.bloomOn = bloom;
    this.dispose();
    this.scene = new THREE.WebGLRenderTarget(w, h, { type: this.hdrType, samples: msaa, depthBuffer: true, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    if (bloom) {
      const opt = { type: this.hdrType, depthBuffer: false, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false };
      const q = [Math.max(1, w >> 2), Math.max(1, h >> 2)], e = [Math.max(1, w >> 3), Math.max(1, h >> 3)];
      this.qA = new THREE.WebGLRenderTarget(q[0], q[1], opt);
      this.qB = new THREE.WebGLRenderTarget(q[0], q[1], opt);
      this.eA = new THREE.WebGLRenderTarget(e[0], e[1], opt);
      this.eB = new THREE.WebGLRenderTarget(e[0], e[1], opt);
    }
    this.mComp.uniforms.uRes.value.set(w, h);
  }

  dispose() {
    for (const k of ['scene', 'qA', 'qB', 'eA', 'eB']) { this[k]?.dispose(); this[k] = null; }
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  /** called after the scene (and viewmodel) were drawn into this.scene */
  finish(fx, time, grain, vhs) {
    const r = this.renderer;
    const sc = this.exposure / this.hdrScale;
    const c = this.mComp.uniforms;
    const pk = this.party ? this.party.k : 0;
    if (pk > 0) c.uParty.value.set(pk, this.party.t, this.party.pulse, this.party.beat);
    else c.uParty.value.set(0, 0, 0, 0);
    if (this.bloomOn && this.qA) {
      const b = this.mBright.uniforms;
      b.tSrc.value = this.scene.texture; b.uScale.value = sc;
      b.uThr.value = 1.3 - 0.35 * pk;
      b.uTexel.value.set(1 / this.w, 1 / this.h);
      this._pass(this.mBright, this.qA);
      const bl = this.mBlur.uniforms;
      bl.tSrc.value = this.qA.texture; bl.uDir.value.set(1 / this.qA.width, 0); this._pass(this.mBlur, this.qB);
      bl.tSrc.value = this.qB.texture; bl.uDir.value.set(0, 1 / this.qA.height); this._pass(this.mBlur, this.qA);
      const d = this.mDown.uniforms;
      d.tSrc.value = this.qA.texture; d.uTexel.value.set(0.5 / this.qA.width, 0.5 / this.qA.height); this._pass(this.mDown, this.eA);
      bl.tSrc.value = this.eA.texture; bl.uDir.value.set(1 / this.eA.width, 0); this._pass(this.mBlur, this.eB);
      bl.tSrc.value = this.eB.texture; bl.uDir.value.set(0, 1 / this.eA.height); this._pass(this.mBlur, this.eA);
      c.tBloomA.value = this.qA.texture; c.tBloomB.value = this.eA.texture; c.uBloom.value = 0.4 + pk * (0.25 + 0.55 * this.party.pulse);
    } else {
      c.tBloomA.value = this.black; c.tBloomB.value = this.black; c.uBloom.value = 0;
    }
    c.tScene.value = this.scene.texture;
    c.uScale.value = sc;
    c.uTime.value = time;
    c.uGrain.value = grain;
    c.uVhs.value = vhs;
    c.uImpact.value = fx ? fx.impact || 0 : 0;
    c.uChase.value = fx ? fx.chase || 0 : 0;
    c.uDeath.value = fx ? fx.death || 0 : 0;
    c.uProtect.value = fx ? fx.protect || 0 : 0;
    this._pass(this.mComp, null);
  }
}
