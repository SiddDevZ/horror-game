// the one shared surface shader for chunk geometry and door leaves.
// lighting = baked atlas (direct + bounce + ao, see bake.js) * fixture colour + flashlight + tiny ambient.
// all pattern uvs are derived from render-space position; periods divide the 384 m origin step.
import * as THREE from 'three';

const vertex = /* glsl */ `
attribute vec4 aInfo;
varying vec3 vPos;
varying vec3 vN;
varying vec4 vInfo;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
  vec4 wp = modelMatrix * p;
  vPos = wp.xyz;
  vN = mat3(modelMatrix) * n;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uLA;
uniform sampler2D uLB;
uniform sampler2D uNoise;
uniform sampler2DArray uAlb;
uniform float uFlick;
uniform float uBounce;
uniform vec3 uBounceCol;
uniform float uCeilK;
uniform float uAOStr;
uniform vec3 uAmb;
uniform vec3 uLightCol;
uniform vec3 uPanelCol;
uniform float uPanel;
uniform vec3 uFogCol;
uniform float uFogD;
uniform vec3 uCamPos;
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform vec3 uFlashCol;
uniform float uFlash;
uniform float uHdrScale;
uniform sampler2D uLabels;
uniform sampler2D uPosters;
uniform vec3 uPosterGrid;
uniform vec4 uHL;
uniform float uHLk;
uniform vec4 uDLP[8];
uniform vec4 uDLC[8];
uniform vec4 uDLD[8];
uniform int uDLN;
uniform vec2 uFar;
uniform vec3 uFarCol;
// v4 party: disco ball (render xyz, spot range), (party k, idle sparkle k, beat, beat pulse),
// (ball spin cos, sin, pixel angle, time), polar visibility map around the ball (r = wall distance / 40 m)
uniform vec4 uPB;
uniform vec4 uPK;
uniform vec4 uPR;
uniform sampler2D uPVis;
varying vec3 vPos;
varying vec3 vN;
varying vec4 vInfo;

uniform float uTime;
// PAINT palette (materials-ids.js PAINT order) and per-colour gloss
const vec3 PAL[32] = vec3[32](
  vec3(0.02, 0.04, 0.1), vec3(0.042, 0.042, 0.047), vec3(0.3, 0.32, 0.31), vec3(0.56, 0.52, 0.43),
  vec3(0.19, 0.08, 0.032), vec3(0.48, 0.03, 0.02), vec3(0.02, 0.02, 0.022), vec3(0.28, 0.3, 0.32),
  vec3(0.7, 0.48, 0.02), vec3(0.72, 0.69, 0.6), vec3(0.028, 0.03, 0.033), vec3(0.014, 0.014, 0.016),
  vec3(0.03, 0.2, 0.07), vec3(0.8, 0.8, 0.77), vec3(0.3, 0.48, 0.66), vec3(0.03, 0.03, 0.03),
  vec3(0.2, 0.05, 0.36), vec3(0.62, 0.035, 0.03), vec3(0.35, 0.62, 0.78), vec3(0.3, 0.62, 0.56),
  vec3(0.3, 0.17, 0.07), vec3(0.12, 0.38, 0.05), vec3(0.07, 0.045, 0.025), vec3(0.86, 0.86, 0.83),
  vec3(0.72, 0.71, 0.68), vec3(0.78, 0.52, 0.36), vec3(0.8, 0.8, 0.76), vec3(0.5, 0.5, 0.48),
  vec3(0.018, 0.018, 0.02), vec3(0.85, 0.3, 0.5), vec3(0.05, 0.2, 0.7), vec3(0.8, 0.32, 0.03)
);
const float GLS[32] = float[32](0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.4, 0.5, 0.45, 0.35, 0.2, 0.5, 0.4, 0.45, 0.6, 0.05,
  0.5, 0.25, 0.95, 0.6, 0.15, 0.05, 0.0, 0.85, 0.7, 0.2, 0.55, 0.3, 0.35, 0.5, 0.5, 0.5);
vec3 wallAlbedo(vec3 P, vec3 N, bool block) {
  float along = dot(P.xz, vec2(N.z, -N.x));
  vec2 uv = vec2(along, P.y);
  vec2 nuv = vec2(along, P.y * 0.6);
  vec3 a;
  if (!block) {
    a = texture(uAlb, vec3(uv, 0.0)).rgb;
    a *= 0.93 + 0.12 * texture(uNoise, nuv / 12.0).r;
    a *= 0.97 + 0.05 * texture(uNoise, nuv / 32.0).g;
    float blot = smoothstep(0.66, 0.8, texture(uNoise, nuv / 24.0 + 0.31).g);
    a *= 1.0 - 0.08 * blot;
  } else {
    a = texture(uAlb, vec3(uv / 1.6, 3.0)).rgb;
    a *= 0.92 + 0.14 * texture(uNoise, nuv / 12.0).r;
  }
  return a * (1.0 - 0.08 * (1.0 - smoothstep(0.0, 0.7, P.y)));
}
// damp stain rising from the floor with a tide line (wet-zone walls)
vec3 dampWall(vec3 a, vec3 P, float along) {
  float h = 0.22 + 0.55 * texture(uNoise, vec2(along * 0.35, 0.5) / 12.0).g;
  float damp = smoothstep(h, h - 0.3, P.y);
  float tide = exp(-pow((P.y - h) / 0.018, 2.0));
  a *= mix(vec3(1.0), vec3(0.74, 0.68, 0.52), damp * 0.8);
  return a * (1.0 - 0.18 * tide);
}
const vec3 LEDC[4] = vec3[4](vec3(1.0, 0.05, 0.02), vec3(0.1, 1.0, 0.25), vec3(1.0, 0.5, 0.06), vec3(1.0, 0.97, 0.9));

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bit(float flags, float b) { return mod(floor(flags / b), 2.0); }
vec3 hue3(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// party colour of the fixture owning lattice cell c (fixtures sit at 3k + 1.5): hue steps on every beat
vec3 fixHue(vec2 c) { return mix(hue3(hash12(mod(c, 640.0) + 0.37) + floor(uPK.z) * 0.23), vec3(1.0), 0.12); }

void main() {
  float code = floor(vInfo.x + 0.5);
  float flags = floor(code / 32.0);
  float mat = code - flags * 32.0;
  vec3 N = normalize(vN);
  vec3 P = vPos;
  vec3 V = uCamPos - P;
  float dist = length(V);
  V /= max(dist, 1e-4);
  bool vert = abs(N.y) < 0.5;
  vec2 sp = P.xz + (vert ? N.xz * 0.125 : vec2(0.0));
  vec4 LA = texture(uLA, sp * (1.0 / 192.0));
  vec4 LB = texture(uLB, sp * (1.0 / 192.0));
  float flk = 1.0 - LB.g * (1.0 - uFlick);
  float ao = mix(1.0, LB.r, uAOStr);
  float wallT = clamp((P.y - 0.7) / 1.4, -0.35, 1.25);
  float wallD = max(mix(LA.b, LA.g, wallT), 0.0);
  // vertical contact darkening at the floor and ceiling junctions
  float cH = (1.0 - 0.3 * exp(-P.y / 0.09)) * (1.0 - 0.16 * exp(-(2.8 - P.y) / 0.07));
  float wallLight = (wallD * flk + LA.a * uBounce * 1.35) * ao * cH;
  float floorLight = (LA.r * flk + LA.a * uBounce) * ao;
  float ceilLight = (LA.a * uCeilK + LA.r * 0.05 * flk) * mix(1.0, LB.r, 0.8);

  vec3 albedo = vec3(0.5);
  float light = floorLight;
  vec3 emit = vec3(0.0);
  float sheen = 0.0;
  float gloss = 0.0;
  float hlMask = 1.0;

  if (mat < 1.5) {
    // walls: wallpaper (0) or grey block paint (1)
    float along = dot(P.xz, vec2(N.z, -N.x));
    albedo = wallAlbedo(P, N, mat > 0.5);
    // damp walls in wet zones: stain rising from the floor with a tide line
    if (bit(flags, 4.0) > 0.5) albedo = dampWall(albedo, P, along);
    // modest painted baseboard with a lit top lip
    float fw = max(fwidth(P.y), 1e-4);
    float base = 1.0 - smoothstep(0.085 - fw, 0.085 + fw, P.y);
    float lip = smoothstep(0.07 - fw, 0.07 + fw, P.y) * base;
    albedo = mix(albedo, albedo * 0.8 * (1.0 + 0.25 * lip), base);
    // bevel highlight on convex edges (columns, wall ends)
    float u = vInfo.z, len = vInfo.w;
    float fu = max(fwidth(u), 1e-4);
    float bw = max(0.016, fu * 1.5);
    float e0 = bit(flags, 1.0) * (1.0 - smoothstep(0.0, bw, u));
    float e1 = bit(flags, 2.0) * (1.0 - smoothstep(0.0, bw, len - u));
    albedo *= 1.0 + 0.12 * max(e0, e1) * clamp(0.02 / fu, 0.0, 1.0);
    light = wallLight;
  } else if (mat < 2.5) {
    // floor: carpet, concrete in maint zones, wet/stain mask with a faint puddle sheen
    vec2 uv = P.xz;
    vec3 carpet = texture(uAlb, vec3(uv * 0.5, 1.0)).rgb;
    float lf = texture(uNoise, uv / 12.0).r;
    float lf2 = texture(uNoise, uv / 32.0).g;
    carpet *= (0.9 + 0.17 * lf) * (0.95 + 0.1 * lf2);
    vec3 conc = texture(uAlb, vec3(uv * 0.5, 4.0)).rgb * (0.88 + 0.2 * lf);
    float maint = smoothstep(0.35, 0.65, LB.a);
    albedo = mix(carpet, conc, maint);
    // wet zones: evenly damp carpet; stains and puddles: darker blobs with ragged edges
    float nb = texture(uNoise, uv / 4.0).b - 0.5;
    float damp = clamp(LB.b / 0.42, 0.0, 1.0) * (0.75 + 0.5 * lf);
    albedo *= mix(vec3(1.0), vec3(0.82, 0.8, 0.72), damp);
    float spot = smoothstep(0.48, 0.62, LB.b + nb * 0.3);
    albedo *= mix(vec3(1.0), vec3(0.66, 0.6, 0.48), spot);
    sheen = smoothstep(0.86, 0.95, LB.b + nb * 0.15);
    light = floorLight;
  } else if (mat < 3.5) {
    // ceiling tiles: 0.6 m grid, per-tile tone, the odd water-stained tile
    albedo = texture(uAlb, vec3(P.xz / 1.2, 2.0)).rgb;
    vec2 tid = mod(floor(P.xz / 0.6), 640.0);
    float th = hash12(tid);
    albedo *= 0.965 + 0.06 * th;
    if (th > 0.988) {
      vec2 lp = fract(P.xz / 0.6) - 0.5;
      float s = smoothstep(0.42, 0.12, length(lp + (th - 0.986) * 8.0) + (texture(uNoise, P.xz / 2.4).b - 0.5) * 0.35);
      albedo *= mix(vec3(1.0), vec3(0.88, 0.8, 0.62), s);
    }
    light = ceilLight;
  } else if (mat < 4.5) {
    // fluorescent panel: blown-out diffuser with a slightly darker rim
    float I = vInfo.y * (bit(flags, 8.0) > 0.5 ? uFlick : 1.0);
    vec2 q = abs(vInfo.zw - 0.5) * 2.0;
    float rim = smoothstep(0.86, 0.98, max(q.x, q.y));
    emit = uPanelCol * uPanel * I * (1.0 - 0.45 * rim) * (0.97 + 0.03 * sin(vInfo.w * 60.0));
    if (uPK.x > 0.0) emit = mix(emit, fixHue(floor(P.xz / 3.0)) * uPanel * I * (0.75 + 0.7 * uPK.w) * (1.0 - 0.3 * rim), uPK.x);
    albedo = vec3(0.55, 0.56, 0.55);
    light = ceilLight * 0.8;
  } else if (mat < 5.5) {
    albedo = vec3(0.72, 0.71, 0.66);
    light = ceilLight + LA.r * 0.08 * flk;
  } else if (mat == 7.0 || mat == 20.0) {
    // door leaf and casings: lit like walls
    vec3 w = texture(uAlb, vec3(vInfo.zw * vec2(1.0, 0.5), 5.0)).rgb;
    albedo = mat == 7.0 ? w * vec3(0.5, 0.4, 0.34) : w * vec3(1.45, 1.05, 0.78);
    light = wallLight;
  } else if (mat == 13.0) {
    albedo = vec3(0.09, 0.085, 0.06);
    light = ceilLight;
  } else if (mat == 22.0) {
    // poster: atlas cell decoded from uv.x = local u + 2 * variant; paper tone, worn edges, wall lighting
    float u = vInfo.z;
    float variant = floor(u * 0.5);
    vec2 luv = vec2(u - variant * 2.0, vInfo.w);
    float n = max(uPosterGrid.z, 1.0);
    float cell = variant >= 4096.0 ? floor((variant - 4096.0) / 2048.0 * n) : mod(variant, n);
    float ccx = mod(cell, uPosterGrid.x), ccy = floor(cell / uPosterGrid.x);
    vec2 q = clamp(luv, 0.003, 0.997);
    albedo = texture(uPosters, vec2((ccx + q.x) / uPosterGrid.x, 1.0 - (ccy + 1.0 - q.y) / uPosterGrid.y)).rgb;
    albedo *= vec3(1.0, 0.985, 0.935) * (0.95 + 0.08 * texture(uNoise, luv * 1.3 + variant * 0.37).r);
    vec2 e = min(luv, 1.0 - luv);
    albedo *= mix(0.84, 1.0, smoothstep(0.0, 0.02, min(e.x, e.y)));
    light = wallLight;
    gloss = 0.5;
  } else if (mat == 30.0) {
    // wall decal (graffiti): paint over the matching wallpaper / block, lit like the wall
    vec4 d = texture(uLabels, vInfo.zw);
    vec3 wa = wallAlbedo(P, N, LB.a > 0.5);
    if (LB.b > 0.3) wa = dampWall(wa, P, dot(P.xz, vec2(N.z, -N.x)));
    albedo = mix(wa, d.rgb * 0.92, d.a * 0.94);
    light = wallLight;
    gloss = 0.12 * d.a;
    hlMask = d.a;
  } else if (mat == 14.0) {
    // exit sign face: glowing green with a darker lettering band
    float band = step(0.3, fract(vInfo.z * 14.0)) * step(0.025, vInfo.w) * step(vInfo.w, 0.075);
    emit = vec3(0.08, 1.0, 0.25) * (2.4 - band * 1.6);
    albedo = vec3(0.1);
  } else {
    // generic props
    if (mat == 6.0) albedo = texture(uAlb, vec3(vInfo.zw * 2.0, 5.0)).rgb * vec3(1.35, 0.95, 0.62);
    else if (mat == 8.0) albedo = vec3(0.07, 0.16, 0.11) * (0.85 + 0.3 * texture(uNoise, vInfo.zw * 3.0).b);
    else if (mat == 9.0) albedo = vec3(0.34, 0.35, 0.35);
    else if (mat == 10.0) albedo = vec3(0.7, 0.69, 0.64);
    else if (mat == 11.0) albedo = vec3(0.42, 0.29, 0.15) * (0.9 + 0.2 * texture(uNoise, vInfo.zw * 2.0).b);
    else if (mat == 12.0) { albedo = vec3(0.22, 0.4, 0.62); emit = vec3(0.01, 0.025, 0.05); }
    else if (mat == 15.0) {
      float row = fract(vInfo.w * 16.0);
      float ink = step(0.45, row) * step(row, 0.75) * step(0.06, vInfo.z) * step(vInfo.z, 0.5) * step(0.05, vInfo.w) * step(vInfo.w, 0.26);
      albedo = mix(vec3(0.75, 0.74, 0.7), vec3(0.06), ink * step(0.35, texture(uNoise, vInfo.zw * vec2(3.0, 0.5)).a));
    }
    else if (mat == 16.0) albedo = vec3(0.56, 0.5, 0.4);
    else if (mat == 17.0) albedo = vec3(0.38, 0.37, 0.34) * mix(vec3(1.0), vec3(0.8, 0.55, 0.35), smoothstep(0.55, 0.8, texture(uNoise, vInfo.zw * 0.7).g));
    else if (mat == 18.0) albedo = vec3(0.03);
    else if (mat == 19.0) albedo = vec3(0.4, 0.4, 0.39) * (0.55 + 0.45 * step(0.4, fract(vInfo.w * 25.0)));
    else if (mat == 21.0) { albedo = vec3(0.55, 0.4, 0.14); gloss = 0.7; }
    else if (mat == 23.0) {
      // printed label from the canvas atlas; flags = backlight level
      albedo = texture(uLabels, vInfo.zw).rgb;
      emit = albedo * flags * 0.32;
      gloss = 0.25;
    }
    else if (mat == 24.0) { int pi = int(flags); albedo = PAL[pi]; gloss = GLS[pi]; }
    else if (mat == 25.0) { albedo = vec3(0.02); gloss = 1.0; }
    else if (mat == 26.0) { albedo = vec3(0.8, 0.74, 0.57) * (0.9 + 0.12 * texture(uNoise, vInfo.zw * 4.0).b); gloss = 0.15; }
    else if (mat == 27.0) {
      // brushed steel
      albedo = vec3(0.46, 0.47, 0.48) * (0.86 + 0.18 * texture(uNoise, vec2(vInfo.z * 0.25, vInfo.w * 9.0)).r);
      gloss = 0.8;
    }
    else if (mat == 28.0) {
      // milky almond water bottle, glowing when backlit in a vending machine
      albedo = vec3(0.86, 0.83, 0.74);
      emit = albedo * 0.5 * flags;
      gloss = 0.6;
    }
    else if (mat == 29.0) {
      // status leds; the blink bit (flags >= 4) gives each led its own rate and phase from its position
      float bl = step(3.5, flags);
      float hh = hash12(floor(P.xz * 50.0) + floor(P.y * 50.0) * 7.13);
      float on = mix(1.0, 0.08 + 0.92 * step(0.4, fract(uTime * (0.6 + 2.6 * hh) + hh * 11.0)), bl);
      albedo = vec3(0.05);
      emit = LEDC[int(flags - 4.0 * bl)] * 3.2 * on;
    }
    float up = N.y;
    float shape = up >= 0.0 ? mix(0.55, 1.0, up) : mix(0.55, 0.12, -up);
    light = (LA.r * flk * shape + LA.a * uBounce) * vInfo.y * mix(1.0, LB.r, 0.5);
  }

  float flash = 0.0;
  if (uFlash > 0.0) {
    vec3 L = uFlashPos - P;
    float d2 = dot(L, L);
    vec3 l = L * inversesqrt(d2);
    float cs = dot(-l, uFlashDir);
    float spot = smoothstep(0.88, 0.985, cs) * 0.8 + smoothstep(0.72, 0.92, cs) * 0.2;
    flash = uFlash * spot * max(dot(N, l), 0.0) / (d2 + 1.0);
  }
  // bounce off yellow walls tints indirect light; direct keeps the fixture colour
  float ind = mat < 2.5 || mat == 30.0 || mat == 22.0 ? LA.a * uBounce * ao : mat < 5.5 || mat == 13.0 ? LA.a * uCeilK : LA.a * uBounce;
  vec3 lcol = mix(uLightCol, uBounceCol, clamp(ind / max(light, 1e-3), 0.0, 1.0));
  if (uPK.x > 0.0) {
    // party: each fixture's pool of light takes its (beat-cycled) hue, blended across the lattice; lights pump on the beat
    vec2 g = P.xz / 3.0 - 0.5;
    vec2 gi = floor(g), gf = smoothstep(0.15, 0.85, fract(g));
    vec3 pc = mix(mix(fixHue(gi), fixHue(gi + vec2(1.0, 0.0)), gf.x), mix(fixHue(gi + vec2(0.0, 1.0)), fixHue(gi + 1.0), gf.x), gf.y);
    lcol = mix(lcol, pc * 1.15, 0.72 * uPK.x);
    light *= mix(1.0, 0.52 + 0.42 * uPK.w, uPK.x);
  }
  vec3 col = albedo * (light * lcol + uAmb + flash * uFlashCol) + emit;
  if (sheen > 0.0) {
    float fr = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col += sheen * (0.04 + 0.5 * fr) * (LA.a + 0.3 * LA.r) * uLightCol * 0.5;
  }
  if (gloss > 0.0) {
    // broad reflection of the lit ceiling: fresnel weighted, stronger when the reflection points up
    float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);
    float env = LA.r * flk * 0.8 + LA.a * uBounce * 0.7;
    col += gloss * (0.035 + 0.6 * fr) * env * (0.3 + 0.7 * smoothstep(0.1, 0.9, R.y)) * uLightCol;
  }
  // dynamic emitters (tv, vending, exit, lamps, pickups): short range, facing hemisphere so walls behind stay dark
  vec3 dyn = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uDLN) break;
    vec3 L = uDLP[i].xyz - P;
    float d2 = dot(L, L);
    float r2 = uDLP[i].w * uDLP[i].w;
    if (d2 >= r2) continue;
    vec3 l = L * inversesqrt(max(d2, 1e-4));
    float win = 1.0 - d2 / r2;
    float face = mix(1.0, smoothstep(-0.15, 0.4, -dot(l, uDLD[i].xyz)), uDLD[i].w);
    dyn += uDLC[i].rgb * (win * win * face * max(dot(N, l), 0.0) / (d2 + 0.35));
  }
  col += albedo * dyn;
  // disco ball: a rotating lat-long spot pattern projected from the ball, masked by a polar visibility map
  if (uPK.x + uPK.y > 0.0 && mat != 4.0) {
    vec3 L = P - uPB.xyz;
    float bd = length(L);
    vec3 d = L / max(bd, 1e-3);
    vec2 hv = P.xz + (vert ? N.xz * 0.12 : vec2(0.0)) - uPB.xz;
    float hd = length(hv);
    float wall = texture(uPVis, vec2(atan(hv.y, hv.x) * 0.15915494 + 0.5, 0.5)).r * 40.0;
    float m = (1.0 - smoothstep(wall + 0.02, wall + 0.3, hd)) * (1.0 - smoothstep(uPB.w * 0.55, uPB.w, bd));
    m *= mix(1.0, max(dot(N, -d), 0.0), 0.8);
    if (m > 0.0) {
      vec3 q = vec3(uPR.x * d.x - uPR.y * d.z, d.y, uPR.y * d.x + uPR.x * d.z);
      const float ROWS = 18.0;
      float rr = min(floor((asin(clamp(q.y, -1.0, 1.0)) / 3.14159265 + 0.5) * ROWS), ROWS - 1.0);
      float latC = ((rr + 0.5) / ROWS - 0.5) * 3.14159265;
      float cols = max(3.0, floor(ROWS * 2.0 * cos(latC) + 0.5));
      float cc = floor((atan(q.z, q.x) / 6.2831853 + 0.5) * cols);
      float lonC = ((cc + 0.5) / cols - 0.5) * 6.2831853;
      vec3 sc = vec3(cos(latC) * cos(lonC), sin(latC), cos(latC) * sin(lonC));
      float h = hash12(vec2(rr, cc) + 3.7);
      float ang = length(q - sc);
      // idle: a few small specks of the ceiling light; party: dense coloured spots
      float rad = (0.034 + 0.02 * h) * mix(0.55, 1.0, uPK.x);
      // pixel footprint seen from the ball: soften and dim spots that shrink below a pixel (no shimmer)
      float aa = uPR.z * dist / max(bd, 0.3);
      float sp = (1.0 - smoothstep(rad - aa - 0.008, rad + aa, ang)) * step(mix(0.62, 0.22, uPK.x), h) * min(1.0, rad * rad / (aa * aa + 1e-6));
      float idle = uPK.y * (1.0 - smoothstep(1.0, 3.6, bd));
      vec3 sCol = mix(vec3(1.0, 0.95, 0.84) * idle * 0.7, hue3(h * 1.7 + floor(uPK.z) * 0.125) * (1.9 + 1.4 * uPK.w) / (1.0 + bd * bd * 0.012), uPK.x);
      col += (albedo * 1.5 + 0.08) * sCol * sp * m;
    }
  }
  // interaction highlight: lift props near the target, soft fresnel edge, no halo
  if (uHLk > 0.0 && mat >= 6.0 && mat != 7.0 && mat != 13.0) {
    float hd = length(P - uHL.xyz);
    float hm = uHLk * hlMask * (1.0 - smoothstep(uHL.w, uHL.w * 1.2 + 0.06, hd));
    float hf = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col = col * (1.0 + 0.3 * hm) + albedo * hm * 0.28 + hm * hf * 0.22 * vec3(1.0, 0.96, 0.86);
  }
  // depth cue without any haze: a slight same-hue darkening with distance (never lightens, never whitens)
  float f = 1.0 - exp(-dist * dist * uFogD * uFogD);
  col *= 1.0 - 0.3 * f;
  // only the last metres before the streaming edge blend into a yellow wall tone (reads as a far wall)
  col = mix(col, uFarCol, smoothstep(uFar.x, uFar.y, dist));
  gl_FragColor = vec4(col * uHdrScale, 1.0);
}
`;

export function createWorldMaterial({ albedo, noise, atlasA, atlasB, labels, posters, pvis }) {
  const lin = (hex) => new THREE.Color(hex);
  return new THREE.ShaderMaterial({
    name: 'world',
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uLA: { value: atlasA },
      uLB: { value: atlasB },
      uNoise: { value: noise },
      uAlb: { value: albedo },
      uFlick: { value: 1 },
      uBounce: { value: 0.5 },
      uBounceCol: { value: lin(0xfff5cc) },
      uCeilK: { value: 1.5 },
      uAOStr: { value: 1 },
      uAmb: { value: new THREE.Vector3(0.012, 0.012, 0.01) },
      uLightCol: { value: lin(0xf7f8ec) },
      uPanelCol: { value: lin(0xf4fbef) },
      uPanel: { value: 4.2 },
      uFogCol: { value: lin(0xd9d3a4) },
      uFogD: { value: 0.016 },
      uCamPos: { value: new THREE.Vector3() },
      uFlashPos: { value: new THREE.Vector3() },
      uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
      uFlashCol: { value: lin(0xfff1dc) },
      uFlash: { value: 0 },
      uHdrScale: { value: 1 },
      uTime: { value: 0 },
      uLabels: { value: labels },
      uPosters: { value: posters },
      uPosterGrid: { value: new THREE.Vector3(4, 2, 8) },
      uHL: { value: new THREE.Vector4(0, -100, 0, 0.5) },
      uHLk: { value: 0 },
      uDLP: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uDLC: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uDLD: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uDLN: { value: 0 },
      uFar: { value: new THREE.Vector2(24, 46) },
      uFarCol: { value: new THREE.Vector3(0.5, 0.48, 0.36) },
      uPB: { value: new THREE.Vector4(0, -100, 0, 1) },
      uPK: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPR: { value: new THREE.Vector4(1, 0, 0.001, 0) },
      uPVis: { value: pvis },
    },
  });
}
