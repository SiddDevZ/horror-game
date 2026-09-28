// small instanced materials for v2 props: crt screen (tv atlas + scanlines + channel snow), emissive lamp bulbs,
// and additive camera-facing halos (pickup glow, radio dial). all fog into the same far haze as the world.
import * as THREE from 'three';

const FOG = /* glsl */ `
uniform vec3 uCamPos;
uniform vec3 uFogCol;
uniform float uFogD;
uniform vec2 uFar;
uniform vec3 uFarCol;
uniform float uHdrScale;
vec3 fogIt(vec3 col, vec3 P, float k) {
  float d = length(uCamPos - P);
  float f = 1.0 - exp(-d * d * uFogD * uFogD);
  col *= 1.0 - 0.3 * f * k;
  return mix(col, uFarCol, smoothstep(uFar.x, uFar.y, d));
}
`;
const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

function fogUniforms(shared) {
  return {
    uCamPos: shared.uCamPos, uFogCol: shared.uFogCol, uFogD: shared.uFogD, uFar: shared.uFar, uFarCol: shared.uFarCol, uHdrScale: shared.uHdrScale,
  };
}

const screenVert = /* glsl */ `
attribute vec4 aScr;
varying vec2 vUv;
varying vec4 vS;
varying vec3 vPos;
varying vec3 vN;
void main() {
  vUv = uv;
  vS = aScr;
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
  vec4 wp = modelMatrix * p;
  vPos = wp.xyz;
  vN = mat3(modelMatrix) * n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const screenFrag = /* glsl */ `
uniform sampler2D uTv;
uniform vec3 uGrid;
uniform float uTime;
uniform float uBright;
varying vec2 vUv;
varying vec4 vS;
varying vec3 vPos;
varying vec3 vN;
${FOG}
${HASH}
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  vec2 cc = c * (1.0 + 0.05 * dot(c, c));
  vec2 uv = cc * 0.5 + 0.5;
  float t = uTime + vS.z * 17.0;
  float line = floor(uv.y * 240.0);
  uv.x += (hash12(vec2(line, floor(t * 20.0))) - 0.5) * 0.003 + sin(uv.y * 26.0 + t * 2.7) * 0.0012;
  float n = max(uGrid.z, 1.0);
  float cell = mod(floor(vS.x + 0.5), n);
  float cx = mod(cell, uGrid.x), cy = floor(cell / uGrid.x);
  vec2 q = clamp(uv, 0.003, 0.997);
  vec3 img = texture(uTv, vec2((cx + q.x) / uGrid.x, 1.0 - (cy + 1.0 - q.y) / uGrid.y)).rgb;
  // channel change: snow burst that clears, plus a faint constant grain
  float since = uTime - vS.y;
  float snowK = 1.0 - smoothstep(0.08, 0.55, since);
  float sn = hash12(floor(uv * vec2(160.0, 120.0)) + floor(t * 30.0) * vec2(3.1, 7.7));
  img = mix(img, vec3(sn * 0.9), clamp(snowK + 0.06, 0.0, 1.0));
  // scanlines (fade out when they would alias), rolling bar, frame flicker
  float sa = clamp(1.0 - fwidth(uv.y * 300.0) * 0.6, 0.0, 1.0);
  img *= 1.0 - 0.28 * sa * (0.5 + 0.5 * sin(uv.y * 600.0));
  img *= 0.9 + 0.1 * smoothstep(0.0, 0.22, abs(fract(uv.y * 0.55 - t * 0.08) - 0.5));
  img *= 0.93 + 0.07 * hash12(vec2(floor(t * 24.0), vS.z * 13.0));
  float inside = step(abs(cc.x), 1.0) * step(abs(cc.y), 1.0);
  float vig = 1.0 - smoothstep(0.6, 1.3, length(cc * vec2(0.95, 1.0)));
  vec3 col = img * uBright * vig * inside * vS.w;
  // curved glass: dark tube tint plus a fresnel sheen
  vec3 V = normalize(uCamPos - vPos);
  float fr = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
  col += vec3(0.01, 0.012, 0.012) + fr * 0.05;
  col = fogIt(col, vPos, 0.75);
  gl_FragColor = vec4(col * uHdrScale, 1.0);
}
`;

const lampVert = /* glsl */ `
varying vec3 vC;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  vC = vec3(1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#endif
  vec4 wp = modelMatrix * p;
  vPos = wp.xyz;
  vN = mat3(modelMatrix) * n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const lampFrag = /* glsl */ `
varying vec3 vC;
varying vec3 vN;
varying vec3 vPos;
${FOG}
void main() {
  vec3 V = normalize(uCamPos - vPos);
  float ndv = max(dot(normalize(vN), V), 0.0);
  float peak = max(vC.r, max(vC.g, vC.b));
  // coloured glass with a hotter core facing the viewer
  vec3 col = vC * (0.45 + 0.55 * ndv) + vec3(peak) * 0.3 * pow(ndv, 4.0) + vec3(0.02);
  col = fogIt(col, vPos, 0.5);
  gl_FragColor = vec4(col * uHdrScale, 1.0);
}
`;

const haloVert = /* glsl */ `
varying vec2 vQ;
varying vec3 vC;
varying float vK;
uniform float uFogD;
uniform vec2 uFar;
void main() {
  mat4 im = mat4(1.0);
  vC = vec3(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#endif
  vec4 c = modelViewMatrix * im * vec4(0.0, 0.0, 0.0, 1.0);
  float d = length(c.xyz);
  // grow with distance so a pickup still reads as a soft point of light down a long corridor
  float s = length(im[0].xyz) * (1.0 + d * 0.045);
  vec4 mv = c;
  // sit slightly in front of the object it surrounds so it is not cut by it
  mv.xyz += (-c.xyz / max(d, 1e-3)) * min(s * 0.45, 0.35);
  mv.xy += position.xy * s;
  vQ = position.xy * 2.0;
  vK = exp(-d * d * uFogD * uFogD * 0.7) * (1.0 - smoothstep(uFar.x, uFar.y, d));
  gl_Position = projectionMatrix * mv;
}
`;
const haloFrag = /* glsl */ `
uniform float uHdrScale;
varying vec2 vQ;
varying vec3 vC;
varying float vK;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 5.0) * (1.0 - r2) + exp(-r2 * 26.0) * 0.35;
  gl_FragColor = vec4(vC * a * vK * uHdrScale, 1.0);
}
`;

// cardboard standees: alpha-tested cutout from the labels atlas (per-instance uv rect), lit by the baked atlas
const cutVert = /* glsl */ `
attribute vec4 aRect;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = mix(aRect.xy, aRect.zw, uv);
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  vec4 wp = modelMatrix * p;
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const cutFrag = /* glsl */ `
uniform sampler2D uLabels;
uniform sampler2D uLA;
uniform sampler2D uLB;
uniform float uFlick;
uniform float uBounce;
uniform vec3 uLightCol;
uniform vec3 uAmb;
uniform vec4 uHL;
uniform float uHLk;
varying vec2 vUv;
varying vec3 vPos;
${FOG}
void main() {
  vec4 t = texture(uLabels, vUv);
  if (t.a < 0.5) discard;
  vec3 alb = gl_FrontFacing ? t.rgb : vec3(0.36, 0.25, 0.13);
  vec4 LA = texture(uLA, vPos.xz * (1.0 / 192.0));
  vec4 LB = texture(uLB, vPos.xz * (1.0 / 192.0));
  float flk = 1.0 - LB.g * (1.0 - uFlick);
  float light = (LA.r * flk * 0.6 + LA.a * uBounce * 1.3) * mix(1.0, LB.r, 0.5);
  vec3 col = alb * (light * uLightCol + uAmb);
  float hm = uHLk * (1.0 - smoothstep(uHL.w + 0.3, uHL.w + 0.7, length(vPos.xz - uHL.xz)));
  col = col * (1.0 + 0.3 * hm) + alb * hm * 0.28;
  col = fogIt(col, vPos, 0.6);
  gl_FragColor = vec4(col * uHdrScale, 1.0);
}
`;

// v4 disco ball: mirror tiles quantized in object space (so they turn with the instance), each tile reflects a
// fake room (lit ceiling above, dark floor), random glints; in party mode tiles flash beat-cycled colours.
const discoVert = /* glsl */ `
varying vec3 vON;
varying vec3 vPos;
varying vec3 vM0;
varying vec3 vM1;
varying vec3 vM2;
void main() {
  vON = normal;
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  mat3 r = mat3(m);
  vM0 = normalize(r[0]); vM1 = normalize(r[1]); vM2 = normalize(r[2]);
  vec4 wp = m * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const discoFrag = /* glsl */ `
uniform vec3 uCamPos;
uniform float uHdrScale;
uniform vec4 uPK;
uniform vec4 uPR;
varying vec3 vON;
varying vec3 vPos;
varying vec3 vM0;
varying vec3 vM1;
varying vec3 vM2;
${HASH}
vec3 hue3(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  vec3 n = normalize(vON);
  float lat = asin(clamp(n.y, -1.0, 1.0)), lon = atan(n.z, n.x);
  const float ROWS = 16.0;
  float fr = (lat / 3.14159265 + 0.5) * ROWS;
  float r = min(floor(fr), ROWS - 1.0);
  float latC = ((r + 0.5) / ROWS - 0.5) * 3.14159265;
  float cols = max(4.0, floor(ROWS * 2.0 * cos(latC) + 0.5));
  float fc = (lon / 6.2831853 + 0.5) * cols;
  float c = floor(fc);
  float lonC = ((c + 0.5) / cols - 0.5) * 6.2831853;
  vec3 fn = vec3(cos(latC) * cos(lonC), sin(latC), cos(latC) * sin(lonC));
  vec3 N = normalize(vM0 * fn.x + vM1 * fn.y + vM2 * fn.z);
  vec3 V = normalize(uCamPos - vPos);
  vec3 R = reflect(-V, N);
  float h = hash12(vec2(r, c) + 5.3);
  // dark grout between tiles
  vec2 e = abs(fract(vec2(fr, fc)) - 0.5);
  float grout = smoothstep(0.5, 0.4, max(e.x, e.y));
  // lower hemisphere reflects the lit yellow carpet and walls, upper the white ceiling panels
  vec3 env = mix(vec3(0.42, 0.34, 0.12), vec3(1.6, 1.55, 1.35), smoothstep(-0.3, 0.7, R.y)) * (0.45 + 0.55 * h);
  float glint = step(0.955, hash12(vec2(h * 91.0, floor(uPR.w * 7.0 + h * 13.0))));
  vec3 col = env + glint * vec3(5.0, 4.8, 4.4);
  float k = uPK.x;
  if (k > 0.0) {
    vec3 hc = hue3(h * 2.3 + floor(uPK.z) * 0.19);
    col = mix(col, hc * (1.6 + 3.5 * uPK.w * step(0.5, h)) + glint * 5.0, k * 0.75);
  }
  col *= mix(0.25, 1.0, grout);
  gl_FragColor = vec4(col * uHdrScale, 1.0);
}
`;

/** shared = uniforms object of the world material (fog, camera, far haze, hdr scale are shared by reference) */
export function createFxMaterials(shared, tvTex) {
  const screen = new THREE.ShaderMaterial({
    name: 'screen',
    vertexShader: screenVert,
    fragmentShader: screenFrag,
    uniforms: {
      ...fogUniforms(shared),
      uTv: { value: tvTex },
      uGrid: { value: new THREE.Vector3(4, 2, 8) },
      uTime: { value: 0 },
      uBright: { value: 2.1 },
    },
  });
  const lamp = new THREE.ShaderMaterial({
    name: 'lamp',
    vertexShader: lampVert,
    fragmentShader: lampFrag,
    uniforms: fogUniforms(shared),
  });
  const halo = new THREE.ShaderMaterial({
    name: 'halo',
    vertexShader: haloVert,
    fragmentShader: haloFrag,
    uniforms: { uFogD: shared.uFogD, uFar: shared.uFar, uHdrScale: shared.uHdrScale },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const cutout = new THREE.ShaderMaterial({
    name: 'cutout',
    vertexShader: cutVert,
    fragmentShader: cutFrag,
    side: THREE.DoubleSide,
    uniforms: {
      ...fogUniforms(shared),
      uLabels: shared.uLabels, uLA: shared.uLA, uLB: shared.uLB, uFlick: shared.uFlick, uBounce: shared.uBounce,
      uLightCol: shared.uLightCol, uAmb: shared.uAmb, uHL: shared.uHL, uHLk: shared.uHLk,
    },
  });
  const disco = new THREE.ShaderMaterial({
    name: 'disco',
    vertexShader: discoVert,
    fragmentShader: discoFrag,
    uniforms: { uCamPos: shared.uCamPos, uHdrScale: shared.uHdrScale, uPK: shared.uPK, uPR: shared.uPR },
  });
  return { screen, lamp, halo, cutout, disco };
}
