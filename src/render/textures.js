// procedural surface textures generated once at boot into one srgb DataArrayTexture (mipmapped),
// plus a linear tiling noise texture used for world-space low-frequency variation in shaders.
// every layer tiles; world-space periods (metres) are chosen to divide the render-origin step (384 m).
import * as THREE from 'three';

export const S = 512;
export const LAYER = { WALLPAPER: 0, CARPET: 1, CEILING: 2, BLOCK: 3, CONCRETE: 4, WOOD: 5 };
export const LAYER_COUNT = 6;
// metres covered by one texture repeat
export const TILE_M = { WALLPAPER: 1.0, CARPET: 2.0, CEILING: 1.2, BLOCK: 1.6, CONCRETE: 2.0, WOOD: 1.0 };

function hashU(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// tileable value noise field of size n x n, lattice periods px, py (must divide n)
function field(n, octaves, seed) {
  const out = new Float32Array(n * n);
  let amp = 1, total = 0;
  for (const [px, py] of octaves) {
    const lat = new Float32Array(px * py);
    for (let i = 0; i < lat.length; i++) lat[i] = hashU(i % px, (i / px) | 0, seed + px * 131 + py);
    const sx = px / n, sy = py / n;
    for (let y = 0; y < n; y++) {
      const fy = y * sy, yi = fy | 0, ty = fy - yi, uy = ty * ty * (3 - 2 * ty);
      const y0 = yi % py, y1 = (yi + 1) % py;
      for (let x = 0; x < n; x++) {
        const fx = x * sx, xi = fx | 0, tx = fx - xi, ux = tx * tx * (3 - 2 * tx);
        const x0 = xi % px, x1 = (xi + 1) % px;
        const a = lat[y0 * px + x0], b = lat[y0 * px + x1], c = lat[y1 * px + x0], d = lat[y1 * px + x1];
        out[y * n + x] += amp * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy);
      }
    }
    total += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function white(n, seed) {
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = hashU(i % n, (i / n) | 0, seed);
  return out;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v + 0.5) | 0;

function put(data, layer, x, y, r, g, b) {
  const o = (layer * S * S + y * S + x) * 4;
  data[o] = clamp255(r); data[o + 1] = clamp255(g); data[o + 2] = clamp255(b); data[o + 3] = 255;
}

export function createSurfaceTextures() {
  const t0 = performance.now();
  const data = new Uint8Array(S * S * 4 * LAYER_COUNT);
  const W = white(S, 7);
  const W2 = white(S, 19);
  const fine = field(S, [[128, 128], [256, 256]], 3);
  const mid = field(S, [[16, 16], [32, 32], [64, 64]], 11);
  const big = field(S, [[4, 4], [8, 8]], 23);
  const streak = field(S, [[64, 4], [128, 8]], 31); // vertical fibres / grain

  // wallpaper: 1 m, eight 12.5 cm bands with stacked chevrons, roll seams every 0.5 m, paper grain
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / S, v = y / S;
      const band = (u * 8) | 0, lu = u * 8 - band;
      const phase = v * 13 + Math.abs(lu - 0.5) * 0.85 + (band & 1) * 0.5;
      const fp = phase - Math.floor(phase);
      const chev = Math.max(0, 1 - Math.abs(fp - 0.5) / 0.09);
      const chev2 = Math.max(0, 1 - Math.abs(fp - 0.2) / 0.05);
      let tone = 1 - 0.045 * chev * (0.55 + 0.45 * mid[i]) - 0.02 * chev2;
      tone *= band & 1 ? 0.988 : 1.0;
      const edge = Math.min(lu, 1 - lu) * 64;
      tone *= 1 - 0.022 * Math.exp(-edge * edge / 3);
      const sd = Math.min(x % 256, 256 - (x % 256));
      tone *= 1 - 0.06 * Math.exp(-(sd * sd) / 1.2) + 0.018 * Math.exp(-((sd - 2) * (sd - 2)) / 1.0);
      tone *= 1 + (W[i] - 0.5) * 0.035 + (streak[i] - 0.5) * 0.05 + (fine[i] - 0.5) * 0.03 + (big[i] - 0.5) * 0.03;
      put(data, 0, x, y, 236 * tone, 214 * tone, 116 * tone * (1 + (mid[i] - 0.5) * 0.08));
    }
  }
  // carpet: 2 m, tufted fibres with soft mottle
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tuft = W2[((y >> 1) * S + (x >> 1)) % (S * S)];
      let tone = 1 + (W[i] - 0.5) * 0.12 + (tuft - 0.5) * 0.08 + (fine[i] - 0.5) * 0.08 + (mid[i] - 0.5) * 0.07 + (big[i] - 0.5) * 0.05;
      const warm = (mid[(i + 9000) % (S * S)] - 0.5) * 0.05;
      put(data, 1, x, y, 200 * tone * (1 + warm), 188 * tone, 118 * tone * (1 - warm));
    }
  }
  // ceiling: 1.2 m = 2x2 tiles of 0.6 m. flat t-bar, recessed bevel, fissured acoustic surface
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ex = Math.min(x % 256, 256 - (x % 256)), ey = Math.min(y % 256, 256 - (y % 256));
      const e = Math.min(ex, ey);
      let r = 236, g = 229, b = 190;
      let tone = 1 + (W[i] - 0.5) * 0.05 + (fine[i] - 0.5) * 0.06 + (mid[i] - 0.5) * 0.04;
      if (W2[i] > 0.955) tone *= 0.8 + W[i] * 0.1;
      const fis = Math.abs(mid[(i * 7) % (S * S)] - 0.5);
      if (fis < 0.012) tone *= 0.93;
      if (e < 2.5) { r = 222; g = 218; b = 196; tone = 0.96 + (W[i] - 0.5) * 0.02; }
      else if (e < 6) tone *= 0.9 + 0.1 * ((e - 2.5) / 3.5);
      put(data, 2, x, y, r * tone, g * tone, b * tone);
    }
  }
  // grey painted block: 1.6 m, 0.4 x 0.2 m running bond
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const course = (y / 64) | 0;
      const xo = (x + (course & 1 ? 64 : 0)) % S;
      const mx = Math.min(xo % 128, 128 - (xo % 128)), my = Math.min(y % 64, 64 - (y % 64));
      const m = Math.min(mx, my);
      let tone = 1 + (W[i] - 0.5) * 0.06 + (fine[i] - 0.5) * 0.06 + (mid[i] - 0.5) * 0.06;
      if (W2[i] > 0.93) tone *= 0.9;
      if (m < 2.5) tone *= 0.8; else if (m < 5) tone *= 0.93;
      put(data, 3, x, y, 160 * tone, 158 * tone, 149 * tone);
    }
  }
  // concrete floor: 2 m
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let tone = 1 + (W[i] - 0.5) * 0.06 + (fine[i] - 0.5) * 0.08 + (mid[i] - 0.5) * 0.12 + (big[i] - 0.5) * 0.1;
      const ck = Math.abs(mid[(y * S + ((x * 3) & (S - 1)))] - 0.5);
      if (ck < 0.004) tone *= 0.9 + ck * 20;
      put(data, 4, x, y, 148 * tone, 145 * tone, 136 * tone);
    }
  }
  // wood: 1 m, vertical grain
  const grain = field(S, [[16, 2], [64, 4], [128, 8]], 41);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const gv = grain[i];
      const ring = 0.5 + 0.5 * Math.sin(gv * 40);
      const t = 0.35 + 0.4 * ring * gv + (W[i] - 0.5) * 0.08;
      put(data, 5, x, y, 112 + 60 * t, 58 + 38 * t, 28 + 22 * t);
    }
  }
  const tex = new THREE.DataArrayTexture(data, S, S, LAYER_COUNT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  // world-space variation noise: 256 px, r/g smooth fbm at two seeds, b finer, a white
  const n = 256;
  const nd = new Uint8Array(n * n * 4);
  const f1 = field(n, [[4, 4], [8, 8], [16, 16]], 51);
  const f2 = field(n, [[8, 8], [16, 16], [32, 32]], 61);
  const f3 = field(n, [[32, 32], [64, 64]], 71);
  const w = white(n, 81);
  for (let i = 0; i < n * n; i++) {
    nd[i * 4] = clamp255(f1[i] * 255); nd[i * 4 + 1] = clamp255(f2[i] * 255);
    nd[i * 4 + 2] = clamp255(f3[i] * 255); nd[i * 4 + 3] = clamp255(w[i] * 255);
  }
  const noise = new THREE.DataTexture(nd, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;
  return { albedo: tex, noise, ms: performance.now() - t0 };
}
