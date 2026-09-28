// world-space cylindrical billboard for the active enemy: flat, unlit, alpha-tested cutout with depth write.
// fades with a screen-door dither so it stays opaque for depth (no sorting, no rectangular halos).
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform sampler2D uMap;
uniform float uAlpha;
uniform float uGain;
uniform float uHdrScale;
uniform vec3 uCamPos;
uniform vec3 uFogCol;
uniform float uFogD;
uniform vec2 uFar;
uniform vec3 uFarCol;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vec4 t = texture(uMap, vUv);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (t.a < 0.5 || uAlpha <= ign * 0.999) discard;
  vec3 c = t.rgb * uGain;
  float d = length(uCamPos - vPos);
  float f = 1.0 - exp(-d * d * uFogD * uFogD);
  c *= 1.0 - 0.3 * f;
  c = mix(c, uFarCol, smoothstep(uFar.x, uFar.y, d));
  gl_FragColor = vec4(c * uHdrScale, 1.0);
}
`;

function placeholderTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#b07a55'; g.beginPath(); g.ellipse(64, 70, 48, 62, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#151515'; g.fillRect(8, 128, 112, 32);
  g.fillStyle = '#222'; g.fillRect(40, 60, 12, 8); g.fillRect(76, 60, 12, 8); g.fillRect(48, 100, 32, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: 0.8, heightM: 2.35 };
}

export class EnemySprite {
  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    this.material = new THREE.ShaderMaterial({
      name: 'enemy',
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uMap: { value: null }, uAlpha: { value: 1 }, uGain: { value: 1 }, uHdrScale: { value: 1 },
        uCamPos: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.016 }, uFar: { value: new THREE.Vector2(24, 46) }, uFarCol: { value: new THREE.Vector3() },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = true;
    this.chars = new Map();
    this.placeholder = null;
    this.loader = new THREE.TextureLoader();
    this.pending = new Set();
  }

  async load(manifest, renderer) {
    const chars = manifest?.characters || {};
    const jobs = Object.entries(chars).map(([id, c]) => this._loadOne(id, c.image ? `./assets/${c.image}` : `./assets/img/${id}.webp`, c, renderer));
    await Promise.all(jobs);
  }

  _loadOne(id, url, meta, renderer) {
    if (this.pending.has(id) || this.chars.has(id)) return Promise.resolve();
    this.pending.add(id);
    return this.loader.loadAsync(url).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const img = tex.image;
      const aspect = meta?.aspect || (img && img.height ? img.width / img.height : 0.8);
      this.chars.set(id, { tex, aspect, heightM: meta?.heightM || 2.35 });
      renderer?.initTexture(tex);
    }).catch((e) => {
      console.warn('enemy texture failed', id, e?.message || e);
    }).finally(() => this.pending.delete(id));
  }

  /** camW: frame.cam (world space); party: party visuals on (the blast spin is only read then) */
  update(e, ox, oz, cam, renderer, camW = null, party = false) {
    if (!e || !e.active || !(e.alpha > 0)) { this.mesh.visible = false; return; }
    let c = this.chars.get(e.charId);
    if (!c) {
      if (!this.pending.has(e.charId)) this._loadOne(e.charId, `./assets/img/${e.charId}.webp`, null, renderer);
      c = this.placeholder || (this.placeholder = placeholderTexture());
    }
    const h = c.heightM;
    const m = this.mesh;
    m.visible = true;
    m.position.set(e.x - ox, e.y || 0.05, e.z - oz);
    m.scale.set(h * c.aspect, h, 1);
    // party blast: spin the cutout around y. explicit e.spin wins; else the offset gameplay folds into facingYaw
    let spin = Number.isFinite(e.spin) ? e.spin : 0;
    if (!spin && party && camW && Number.isFinite(e.facingYaw)) {
      spin = e.facingYaw - Math.atan2(-(camW.x - e.x), -(camW.z - e.z));
      spin -= Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
      if (Math.abs(spin) < 1e-3) spin = 0;
    }
    m.rotation.set(0, Math.atan2(cam.x - m.position.x, cam.z - m.position.z) + spin, Number.isFinite(e.roll) ? e.roll : 0);
    this.material.uniforms.uMap.value = c.tex;
    this.material.uniforms.uAlpha.value = Math.min(1, e.alpha);
  }
}
