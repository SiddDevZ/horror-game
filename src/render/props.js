// low-poly procedural props merged into chunk geometry. local frame: front faces -z (yaw 0 looks -z).
import { CEIL_H } from '../config.js';
import { MAT, PAINT, paint, label, led } from './materials-ids.js';
import { LBL, subRect } from './labels.js';
import { buildV3, wiresPanel } from './props3.js';

export function h01(id, salt) {
  const s = `${id}:${salt}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// office chair like the reel: orange-brown bentwood frame, green seat
function chair(b) {
  const W = MAT.WOOD, L = 0.034;
  for (const sx of [-1, 1]) {
    b.box(sx * 0.19, 0.23, -0.18, L, 0.46, L, W);
    b.box(sx * 0.19, 0.45, 0.19, L, 0.9, L, W); // rear leg continues into back post
  }
  b.box(0, 0.43, 0, 0.42, 0.035, 0.42, W);
  b.box(0, 0.47, -0.01, 0.4, 0.05, 0.4, MAT.FABRIC);
  b.box(0, 0.7, 0.2, 0.38, 0.07, 0.022, W);
  b.box(0, 0.84, 0.2, 0.38, 0.09, 0.024, MAT.FABRIC);
  b.box(0, 0.14, -0.18, 0.36, 0.022, 0.022, W);
  b.box(0, 0.14, 0.19, 0.36, 0.022, 0.022, W);
}

function desk(b, w, d) {
  w = w || 1.4; d = d || 0.7;
  b.box(0, 0.735, 0, w, 0.035, d, MAT.LAMINATE);
  for (const sx of [-1, 1]) b.box(sx * (w / 2 - 0.03), 0.36, 0, 0.03, 0.72, d - 0.04, MAT.METAL);
  b.box(0, 0.45, d / 2 - 0.05, w - 0.08, 0.45, 0.02, MAT.METAL);
  // drawer pedestal
  b.box(w / 2 - 0.25, 0.36, -0.02, 0.4, 0.7, d - 0.12, MAT.METAL);
  b.box(w / 2 - 0.25, 0.55, -d / 2 + 0.05, 0.3, 0.02, 0.012, MAT.BLACK);
  b.box(w / 2 - 0.25, 0.3, -d / 2 + 0.05, 0.3, 0.02, 0.012, MAT.BLACK);
}

function cooler(b) {
  b.box(0, 0.5, 0, 0.32, 1.0, 0.32, MAT.PLASTIC);
  b.box(0, 0.62, -0.17, 0.22, 0.2, 0.03, MAT.PLASTIC);
  b.box(-0.05, 0.66, -0.2, 0.03, 0.05, 0.04, MAT.PIPE);
  b.box(0.05, 0.66, -0.2, 0.03, 0.05, 0.04, MAT.EXIT);
  b.box(0, 0.47, -0.19, 0.18, 0.02, 0.08, MAT.BLACK);
  b.cyl(0, 1.05, 0, 0.05, 0.1, 8, 'y', MAT.WATER, false);
  b.cyl(0, 1.3, 0, 0.14, 0.42, 10, 'y', MAT.WATER);
}

function phone(b) {
  // small side table with a beige desk phone
  b.box(0, 0.68, 0, 0.5, 0.03, 0.4, MAT.LAMINATE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.22, 0.335, sz * 0.17, 0.03, 0.67, 0.03, MAT.METAL);
  b.box(0, 0.72, 0, 0.22, 0.05, 0.2, MAT.PLASTIC);
  b.box(0, 0.765, 0.03, 0.2, 0.04, 0.06, MAT.PLASTIC);
  b.box(0, 0.75, -0.05, 0.12, 0.012, 0.07, MAT.BLACK);
}

function shelf(b, w, d, id) {
  w = w || 1.2; d = d || 0.45;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.02), 0.9, sz * (d / 2 - 0.02), 0.035, 1.8, 0.035, MAT.METAL);
  for (let i = 0; i < 4; i++) {
    const y = 0.12 + i * 0.52;
    b.box(0, y, 0, w, 0.025, d, MAT.METAL);
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.2 && i < 3) {
      const bw = 0.2 + h01(id, i * 10 + x * 7) * 0.2;
      if (h01(id, i * 13 + x * 3) < 0.7 && x + bw < w / 2 - 0.04) {
        const bh = 0.16 + h01(id, i + x) * 0.18;
        b.box(x + bw / 2, y + 0.0125 + bh / 2, 0, bw, bh, d * 0.8, MAT.CARDBOARD);
      }
      x += bw + 0.04;
    }
  }
}

function boxes(b, id) {
  const n = 2 + Math.floor(h01(id, 1) * 4);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = 0.35 + h01(id, i * 3) * 0.2;
    const hgt = 0.25 + h01(id, i * 5) * 0.2;
    const ox = (h01(id, i * 7) - 0.5) * 0.3, oz = (h01(id, i * 11) - 0.5) * 0.3;
    if (i > 0 && h01(id, i * 17) < 0.45) y = 0;
    b.box(ox + (y === 0 ? (i % 2 ? 0.35 : -0.1) : 0), y + hgt / 2, oz, s, hgt, s * 0.85, MAT.CARDBOARD);
    y += hgt;
  }
}

function pipes(b, w) {
  const len = w || 4;
  b.cyl(0, CEIL_H - 0.14, 0, 0.06, len, 8, 'x', MAT.PIPE, false);
  b.cyl(0, CEIL_H - 0.3, -0.16, 0.035, len, 6, 'x', MAT.PIPE, false);
  for (let x = -len / 2 + 0.6; x < len / 2; x += 1.6) b.box(x, CEIL_H - 0.07, -0.08, 0.04, 0.14, 0.3, MAT.METAL);
}

function exitSign(b) {
  b.box(0, CEIL_H - 0.03, 0, 0.05, 0.06, 0.02, MAT.METAL);
  b.box(0, CEIL_H - 0.2, 0, 0.36, 0.16, 0.05, MAT.PLASTIC);
  b.box(0, CEIL_H - 0.2, -0.026, 0.3, 0.1, 0.004, MAT.EXIT);
  b.box(0, CEIL_H - 0.2, 0.026, 0.3, 0.1, 0.004, MAT.EXIT);
}

function bench(b) {
  b.box(0, 0.44, 0, 1.2, 0.04, 0.36, MAT.WOOD);
  for (const sx of [-1, 1]) b.box(sx * 0.52, 0.21, 0, 0.05, 0.42, 0.3, MAT.METAL);
}

// ---------------------------------------------------------------- v2 props

// transform for a local offset (lx, ly, lz) inside a feature frame at (x, z, yaw)
export function at(b, x, z, yaw, lx, ly, lz, pitch = 0, roll = 0, dyaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  b.setXform(x + lx * c + lz * s, ly, z - lx * s + lz * c, yaw + dyaw, pitch, roll);
}

/** poster atlas variant from data.v: integers index cells directly, [0,1) floats scale to the cell count */
export function posterVariant(v, id) {
  if (Number.isFinite(v) && Number.isInteger(v)) return ((v % 4096) + 4096) % 4096;
  if (Number.isFinite(v) && v >= 0 && v < 1) return 4096 + Math.floor(v * 2048);
  return Math.floor(h01(id, 77) * 4096);
}

const GP = new Float64Array(12), GN = new Float64Array(12), GUV = new Float32Array(8);
// poster sheet as a small grid so one bottom corner can peel off the wall
function posterSheet(b, w, h, yc, u0, zb, curl, sc, R) {
  const NX = curl ? 4 : 1, NY = curl ? 5 : 1;
  const zAt = (s, t) => {
    if (!curl) return zb;
    const d = Math.hypot((s - sc) * w, t * h) / R;
    const k = Math.max(0, 1 - d);
    return zb - curl * k * k - 0.0012 * Math.sin(Math.PI * s) * Math.sin(Math.PI * t);
  };
  const e = 0.002;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      for (let k = 0; k < 4; k++) {
        const s = (i + (k === 1 || k === 2 ? 1 : 0)) / NX, t = (j + (k >= 2 ? 1 : 0)) / NY;
        const lx = w / 2 - s * w, ly = yc - h / 2 + t * h;
        GP[k * 3] = lx; GP[k * 3 + 1] = ly; GP[k * 3 + 2] = zAt(s, t);
        // surface z = g(x, y); front normal = (dg/dx, dg/dy, -1)
        const gx = (zAt(s - e / w, t) - zAt(s + e / w, t)) / (2 * e) * -1;
        const gy = (zAt(s, t + e / h) - zAt(s, t - e / h)) / (2 * e);
        const l = Math.hypot(gx, gy, 1);
        GN[k * 3] = -gx / l; GN[k * 3 + 1] = gy / l; GN[k * 3 + 2] = -1 / l;
        GUV[k * 2] = u0 + s; GUV[k * 2 + 1] = t;
      }
      b.lquad(GP, GN, MAT.POSTER, GUV, 1);
    }
  }
}

function poster(b, f, x, z, yaw, id, data, ctx) {
  const w = f.w || 0.5, h = data.h || 0.7, yc = data.y || 1.5;
  const u0 = posterVariant(data.v, id) * 2;
  const tilt = data.crooked && !(ctx && ctx.straight.has(id)) ? data.crooked : 0;
  if (tilt) {
    // crooked poster (straighten task): hung from one pin, whole sheet rolled about its centre
    at(b, x, z, yaw, 0, yc, 0, 0, tilt);
    posterSheet(b, w, h, 0, u0, -0.003, 0, 0, 1);
    const px = (w / 2 - 0.02) * (tilt > 0 ? -1 : 1);
    b.cyl(px, h / 2 - 0.02, -0.006, 0.008, 0.008, 8, 'z', paint(PAINT.RED));
    return;
  }
  b.setXform(x, 0, z, yaw);
  if (h01(id, 3) < 0.24) {
    // framed print: thin black or wood frame, sheet flat behind it
    const t = 0.026, dz = 0.024, fm = h01(id, 4) < 0.6 ? paint(PAINT.BLACK) : MAT.WOOD;
    b.box(0, yc + h / 2 + t / 2, -dz / 2, w + 2 * t, t, dz, fm);
    b.box(0, yc - h / 2 - t / 2, -dz / 2, w + 2 * t, t, dz, fm);
    b.box(w / 2 + t / 2, yc, -dz / 2, t, h, dz, fm);
    b.box(-w / 2 - t / 2, yc, -dz / 2, t, h, dz, fm);
    posterSheet(b, w, h, yc, u0, -0.006, 0, 0, 1);
    return;
  }
  const sc = h01(id, 5) < 0.5 ? 0 : 1;
  const curl = 0.012 + h01(id, 6) * 0.03;
  posterSheet(b, w, h, yc, u0, -0.0025, curl, sc, 0.16 + h01(id, 7) * 0.12);
  // masking tape on the corners that still hold
  const T = [0, 0, 1, 1];
  for (const [s, t] of [[0, 1], [1, 1], [1 - sc, 0]]) {
    const lx = w / 2 - s * w + (s ? 0.012 : -0.012), ly = yc - h / 2 + t * h + (t ? -0.012 : 0.012);
    const roll = (s === t ? -1 : 1) * (0.72 + (h01(id, 10 + s * 2 + t) - 0.5) * 0.4);
    at(b, x, z, yaw, lx, ly, -0.0045, 0, roll);
    b.panel(0, 0, 0, 0.078, 0.026, MAT.TAPE, T);
  }
  if (h01(id, 8) < 0.5) {
    const s = 1 - sc;
    const lx = w / 2 - s * w + (s ? 0.012 : -0.012), ly = yc - h / 2 + 0.012;
    at(b, x, z, yaw, lx, ly, -0.0045, 0, (s === 0 ? 1 : -1) * 0.7);
    b.panel(0, 0, 0, 0.078, 0.026, MAT.TAPE, T);
  }
}

// small almond water bottle; s = scale, by = base y
export function bottle(b, cx, by, cz, s, bodyMat, labelMat, sides = 6) {
  b.cyl(cx, by + 0.075 * s, cz, 0.033 * s, 0.15 * s, sides, 'y', bodyMat, true);
  b.cyl(cx, by + 0.165 * s, cz, 0.033 * s, 0.03 * s, sides, 'y', bodyMat, false, null, 0.015 * s);
  b.cyl(cx, by + 0.191 * s, cz, 0.017 * s, 0.024 * s, sides, 'y', paint(PAINT.CAPBLUE), true);
  b.cyl(cx, by + 0.082 * s, cz, 0.0338 * s, 0.078 * s, sides, 'y', labelMat, false, LBL.ALMOND);
}

export function vending(b, f, x, z, yaw, opt = {}) {
  const W = Math.min(Math.max(f.w || 0.95, 0.85), 1.1), D = Math.min(Math.max(f.d || 0.8, 0.6), 0.9), H = 1.86;
  b.setXform(x, 0, z, yaw);
  const body = paint(opt.prime ? PAINT.BLACK : PAINT.NAVY);
  const zf = -D / 2, cav = 0.2, colW = 0.3;
  const wx0 = -W / 2 + colW, wx1 = W / 2 - 0.06, wy0 = 0.62, wy1 = 1.6;
  const ww = wx1 - wx0, wc = (wx0 + wx1) / 2;
  b.box(0, (0.06 + H) / 2, zf + cav + (D - cav) / 2, W, H - 0.06, D - cav, body);
  b.box(0, 0.03, 0.02, W - 0.06, 0.06, D - 0.08, paint(PAINT.BLACK));
  const fz = zf + cav / 2;
  b.box((wx1 + W / 2) / 2, (0.06 + H) / 2, fz, W / 2 - wx1, H - 0.06, cav, body);
  b.box((-W / 2 + wx0) / 2, (0.06 + H) / 2, fz, wx0 + W / 2, H - 0.06, cav, body);
  b.box(wc, (wy1 + H) / 2, fz, ww, H - wy1, cav, body);
  b.box(wc, (0.06 + wy0) / 2, fz, ww, wy0 - 0.06, cav, body);
  b.box(0, H + 0.012, 0, W + 0.016, 0.024, D + 0.016, paint(PAINT.CHARCOAL));
  // lit cavity: backlight, shelves with price strips, rows of almond water
  b.panel(wc, (wy0 + wy1) / 2, zf + cav - 0.002, ww, wy1 - wy0, label(6), LBL.VEND_BACK);
  const rows = 4, sh = (wy1 - wy0) / rows, n = 5;
  for (let r = 0; r < rows; r++) {
    const y = wy0 + r * sh;
    b.box(wc, y + 0.012, zf + cav / 2 + 0.005, ww, 0.024, cav - 0.01, paint(PAINT.CHARCOAL));
    b.box(wc, y + 0.012, zf + 0.012, ww, 0.026, 0.004, paint(PAINT.WHITE));
    for (let k = 0; k < n; k++) {
      const bx = wx1 - 0.07 - k * ((ww - 0.14) / (n - 1));
      if (opt.stuck && r === 2 && k === 2) continue;
      if (opt.prime) {
        const cap = [PAINT.WIREBLUE, PAINT.ORANGE, PAINT.PURPLE, PAINT.GREEN][(k + r) % 4];
        b.cyl(bx, y + 0.024 + 0.075, zf + cav * 0.55, 0.032, 0.15, 6, 'y', label(3), true, LBL.PRYME_LABEL);
        b.cyl(bx, y + 0.024 + 0.165, zf + cav * 0.55, 0.032, 0.03, 6, 'y', paint(cap), false, null, 0.015);
        b.cyl(bx, y + 0.024 + 0.19, zf + cav * 0.55, 0.017, 0.022, 6, 'y', paint(cap));
      } else bottle(b, bx, y + 0.024, zf + cav * 0.55, 0.95, MAT.BOTTLE + 32, label(3));
    }
  }
  if (opt.stuck) {
    // one bottle wedged against the glass, hanging off the spiral
    const y = wy0 + 2 * sh, bx = wx1 - 0.07 - 2 * ((ww - 0.14) / (n - 1));
    at(b, x, z, yaw, bx, y - 0.02, zf + 0.06, 0.55, 0.35);
    bottle(b, 0, 0, 0, 0.95, MAT.BOTTLE + 32, label(3));
    b.setXform(x, 0, z, yaw);
  } else if (opt.stuck === false) {
    // freed: it dropped into the pickup bin
    at(b, x, z, yaw, wc, 0.27, zf - 0.03, 0, Math.PI / 2 - 0.2);
    bottle(b, 0, 0, 0, 0.95, MAT.BOTTLE, label(0));
    b.setXform(x, 0, z, yaw);
  }
  // chrome window trim
  const t = 0.016, tz = zf - 0.004;
  b.box(wc, wy1 + t / 2, tz, ww + 2 * t, t, 0.012, MAT.CHROME);
  b.box(wc, wy0 - t / 2, tz, ww + 2 * t, t, 0.012, MAT.CHROME);
  b.box(wx1 + t / 2, (wy0 + wy1) / 2, tz, t, wy1 - wy0, 0.012, MAT.CHROME);
  b.box(wx0 - t / 2, (wy0 + wy1) / 2, tz, t, wy1 - wy0, 0.012, MAT.CHROME);
  // backlit brand header, selection panel, coin return, pickup flap
  b.panel(0, 1.73, zf - 0.002, W - 0.08, 0.17, label(7), opt.prime ? LBL.PRYME_HEAD : LBL.VEND_HEAD);
  b.panel(-W / 2 + colW / 2, 1.16, zf - 0.002, colW - 0.07, 0.62, label(2), LBL.VEND_PANEL);
  if (opt.prime) b.panel(-W / 2 + colW / 2, 1.3, zf - 0.004, colW - 0.08, 0.16, label(3), LBL.PRYME_PANEL);
  b.box(-W / 2 + colW / 2, 0.78, zf - 0.012, 0.09, 0.05, 0.024, MAT.CHROME);
  b.box(-W / 2 + colW / 2 + 0.07, 1.5, zf - 0.006, 0.012, 0.012, 0.012, led(2));
  b.box(wc, 0.3, zf - 0.008, ww - 0.04, 0.2, 0.016, MAT.CHROME);
  b.box(wc, 0.3, zf - 0.018, ww - 0.1, 0.15, 0.012, paint(PAINT.CHARCOAL));
}

/** tv layout in feature-local metres: screen centre (0, sy, zs), size sw x sh */
export function tvLayout(f) {
  const data = f.data || {};
  const wall = data.mount === 'wall';
  const raised = !wall && data.y > 0.05;
  const baseY = wall ? (data.y || 1.85) : raised ? data.y : 0.815;
  const zf = wall ? -0.52 : -0.2;
  return { wall, raised, baseY, zf, sw: 0.47, sh: 0.352, sy: baseY + 0.275, zs: zf + 0.012 };
}

function tv(b, f, x, z, yaw) {
  const L = tvLayout(f);
  const { baseY, zf } = L;
  b.setXform(x, 0, z, yaw);
  const cas = paint(PAINT.CHARCOAL), W = 0.6, H = 0.5, FD = 0.22;
  const hx = 0.215, hy0 = L.sy - 0.16, hy1 = L.sy + 0.16;
  // bezel frame around the screen hole, then the tube bell
  b.box(0, (hy1 + baseY + H) / 2, zf + FD / 2, W, baseY + H - hy1, FD, cas);
  b.box(0, (baseY + hy0) / 2, zf + FD / 2, W, hy0 - baseY, FD, cas);
  b.box((hx + W / 2) / 2, L.sy, zf + FD / 2, W / 2 - hx, hy1 - hy0, FD, cas);
  b.box(-(hx + W / 2) / 2, L.sy, zf + FD / 2, W / 2 - hx, hy1 - hy0, FD, cas);
  b.box(0, baseY + 0.25, zf + FD + 0.13, 0.46, 0.38, 0.26, cas);
  b.box(0, baseY + 0.25, zf + FD + 0.27, 0.3, 0.26, 0.04, cas);
  b.panel(0, baseY + 0.042, zf - 0.001, W - 0.08, 0.056, label(0), LBL.TV_STRIP);
  b.box(W / 2 - 0.07, baseY + 0.05, zf - 0.003, 0.012, 0.012, 0.006, led(0));
  // rabbit ears
  b.box(0, baseY + H + 0.015, zf + 0.2, 0.09, 0.03, 0.07, paint(PAINT.BLACK));
  for (const sgn of [-1, 1]) {
    const roll = sgn * 0.5, len = 0.46;
    at(b, x, z, yaw, -Math.sin(roll) * len / 2, baseY + H + 0.03 + Math.cos(roll) * len / 2, zf + 0.2, 0.18, roll);
    b.cyl(0, 0, 0, 0.004, len, 5, 'y', MAT.CHROME, false);
  }
  b.setXform(x, 0, z, yaw);
  if (L.wall) {
    // wall bracket shelf
    b.box(0, baseY - 0.012, -0.26, 0.5, 0.024, 0.5, MAT.METAL);
    b.box(0, baseY - 0.2, -0.015, 0.14, 0.36, 0.03, MAT.METAL);
    at(b, x, z, yaw, 0, baseY - 0.14, -0.2, 0.75);
    b.box(0, 0, 0, 0.04, 0.03, 0.34, MAT.METAL);
    return;
  }
  if (L.raised) return;
  // av cart with a vcr blinking 12:00
  const black = paint(PAINT.CART);
  for (const y of [0.8, 0.46, 0.12]) b.box(0, y, 0.02, 0.68, 0.03, 0.5, black);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl(sx * 0.31, 0.44, 0.02 + sz * 0.22, 0.013, 0.76, 6, 'y', MAT.METAL, false);
    b.cyl(sx * 0.29, 0.03, 0.02 + sz * 0.2, 0.028, 0.03, 8, 'x', paint(PAINT.RUBBER));
  }
  b.box(0, 0.52, -0.06, 0.42, 0.085, 0.3, cas);
  b.panel(-0.12, 0.525, -0.211, 0.07, 0.03, label(4), LBL.VCR_CLOCK);
  b.box(0.06, 0.53, -0.212, 0.2, 0.012, 0.004, MAT.BLACK);
}

function radio(b, f, x, z, yaw, data) {
  const y0 = data.y || 0, W = 0.34, H = 0.19, D = 0.14;
  b.setXform(x, 0, z, yaw);
  const wal = paint(PAINT.WALNUT);
  b.box(0, y0 + 0.012 + H / 2, 0, W, H, D, wal);
  b.cyl(0, y0 + 0.012 + H, 0, D / 2, W, 12, 'x', wal, true);
  for (const sx of [-1, 1]) b.box(sx * 0.13, y0 + 0.006, 0, 0.05, 0.012, D - 0.02, paint(PAINT.BLACK));
  b.box(0.075, y0 + 0.1, -D / 2 - 0.003, 0.15, 0.13, 0.006, MAT.VENT);
  b.box(-0.08, y0 + 0.145, -D / 2 - 0.002, 0.14, 0.06, 0.004, MAT.CHROME);
  b.panel(-0.08, y0 + 0.145, -D / 2 - 0.0045, 0.128, 0.048, label(0), LBL.RADIO_DIAL);
  for (const kx of [-0.045, -0.115]) b.cyl(kx, y0 + 0.065, -D / 2 - 0.012, 0.018, 0.024, 10, 'z', paint(PAINT.CREAM));
  at(b, x, z, yaw, -0.13 + 0.12, y0 + H + 0.18, 0.04, -0.25, -0.55);
  b.cyl(0, 0, 0, 0.0035, 0.42, 5, 'y', MAT.CHROME, false);
}

export const BRK = { W: 0.44, H: 0.6, D: 0.14 };
export function breakerLayout(f) {
  const yc = (f.data && f.data.y) || 1.35;
  return { yc, lever: [-BRK.W / 2 - 0.065, yc, -BRK.D * 0.55], lamp: [0, yc + BRK.H / 2 + 0.13, -0.11] };
}

function breaker(b, f, x, z, yaw, ctx) {
  const { W, H, D } = BRK;
  const L = breakerLayout(f), yc = L.yc;
  b.setXform(x, 0, z, yaw);
  const en = paint(PAINT.ENAMEL);
  if (f.data && f.data.task === 'wires') {
    // v3: the breaker is a wiring task: open panel, wires straight once power is restored
    b._fx = x; b._fz = z; b._fyaw = yaw;
    wiresPanel(b, yc, !!ctx && ctx.state(f.id || '') === 'on', W, H, D);
    const top = yc + H / 2;
    b.cyl(0.12, (top + CEIL_H) / 2, -0.06, 0.026, CEIL_H - top, 8, 'y', MAT.PIPE, false);
    b.panel(0.0, yc - H / 2 - 0.08, -0.002, 0.2, 0.14, label(0), LBL.DANGER);
    const [, ly, lz] = L.lamp;
    b.box(-0.02, ly, -0.025, 0.1, 0.12, 0.05, paint(PAINT.STEEL));
    b.cyl(-0.02, ly, -0.06, 0.04, 0.025, 10, 'z', paint(PAINT.STEEL));
    return;
  }
  b.box(0, yc, -D / 2, W, H, D, en);
  b.box(0, yc, -D - 0.005, W - 0.04, H - 0.04, 0.01, en);
  for (const sy of [-1, 1]) b.box(W / 2 - 0.03, yc + sy * 0.2, -D - 0.012, 0.018, 0.07, 0.014, MAT.CHROME);
  b.box(-W / 2 + 0.05, yc, -D - 0.018, 0.022, 0.09, 0.016, MAT.CHROME);
  b.panel(0.03, yc + 0.11, -D - 0.0105, 0.25, 0.18, label(0), LBL.DANGER);
  b.panel(0.03, yc - 0.15, -D - 0.0105, 0.08, 0.08, label(0), LBL.TAG);
  // side housing for the disconnect handle
  b.box(-W / 2 - 0.03, yc, -D * 0.55, 0.06, 0.24, 0.11, en);
  // conduit to the ceiling
  const top = yc + H / 2;
  b.cyl(0.12, (top + CEIL_H) / 2, -0.06, 0.026, CEIL_H - top, 8, 'y', MAT.PIPE, false);
  b.box(0.12, top + 0.03, -0.06, 0.07, 0.06, 0.07, MAT.METAL);
  // caged indicator lamp above the box
  const [, ly, lz] = L.lamp;
  b.box(-0.02, ly, -0.025, 0.1, 0.12, 0.05, paint(PAINT.STEEL));
  b.cyl(-0.02, ly, -0.06, 0.04, 0.025, 10, 'z', paint(PAINT.STEEL));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    b.box(-0.02 + Math.cos(a) * 0.05, ly, lz + Math.sin(a) * 0.035, 0.006, 0.12, 0.006, MAT.CHROME);
  }
  b.box(-0.02, ly + 0.06, lz, 0.1, 0.006, 0.08, MAT.CHROME);
  b.box(-0.02, ly - 0.06, lz, 0.1, 0.006, 0.08, MAT.CHROME);
}

/** exit elevator layout in feature-local metres (x, z on the wall face, front toward local -z) */
export function exitLayout(f) {
  const Wo = Math.min(1.4, Math.max(1.0, (f.w || 2) - 0.5));
  const Ho = 2.2, J = 0.16, Dp = 0.26;
  return { Wo, Ho, J, Dp, leafZ: -0.075, lamp: [0, Ho + J / 2, -Dp - 0.045], glow: [0, 1.25, -0.9] };
}

function exitDoor(b, f, x, z, yaw) {
  const { Wo, Ho, J, Dp } = exitLayout(f);
  b.setXform(x, 0, z, yaw);
  const st = MAT.CHROME, fr = paint(PAINT.STEEL);
  for (const sx of [-1, 1]) b.box(sx * (Wo / 2 + J / 2), (Ho + J) / 2, -Dp / 2, J, Ho + J, Dp, fr);
  b.box(0, Ho + J / 2, -Dp / 2, Wo + 2 * J, J, Dp, fr);
  // car interior: blown-out light, only seen when the leaves part
  b.panel(0, Ho / 2, -0.004, Wo, Ho, label(5), LBL.ELEVATOR);
  b.box(0, 0.006, -Dp / 2, Wo + 0.06, 0.012, Dp, st);
  b.hpanel(0, 0.004, -Dp - 0.32, Wo + 2 * J, 0.5, label(0), LBL.HAZARD);
  // big lit EXIT sign above
  b.box(0, 2.555, -0.05, 1.06, 0.36, 0.1, paint(PAINT.CHARCOAL));
  b.panel(0, 2.555, -0.1015, 1.0, 0.31, label(10), LBL.EXIT);
  // call panel on the right, lamp housing on the header
  const cx = -(Wo / 2 + J + 0.16);
  b.box(cx, 1.2, -0.008, 0.13, 0.28, 0.016, st);
  b.panel(cx, 1.2, -0.0165, 0.11, 0.22, label(0), LBL.CALL);
  b.box(0, Ho + J / 2, -Dp - 0.012, 0.24, 0.12, 0.024, paint(PAINT.BLACK));
}

function table(b, f) {
  const w = f.w || 1.2, d = f.d || 0.75;
  if (Math.abs(w - d) < 0.15) {
    const r = Math.min(w, d) / 2;
    b.cyl(0, 0.735, 0, r, 0.03, 18, 'y', MAT.LAMINATE);
    b.cyl(0, 0.735, 0, r + 0.006, 0.026, 18, 'y', MAT.CHROME, false);
    b.cyl(0, 0.37, 0, 0.035, 0.72, 8, 'y', MAT.METAL, false);
    b.cyl(0, 0.015, 0, 0.26, 0.03, 12, 'y', MAT.METAL);
    return;
  }
  b.box(0, 0.735, 0, w, 0.03, d, MAT.LAMINATE);
  b.box(0, 0.733, -d / 2 - 0.003, w + 0.012, 0.026, 0.006, MAT.CHROME);
  b.box(0, 0.733, d / 2 + 0.003, w + 0.012, 0.026, 0.006, MAT.CHROME);
  b.box(-w / 2 - 0.003, 0.733, 0, 0.006, 0.026, d, MAT.CHROME);
  b.box(w / 2 + 0.003, 0.733, 0, 0.006, 0.026, d, MAT.CHROME);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cyl(sx * (w / 2 - 0.07), 0.36, sz * (d / 2 - 0.07), 0.017, 0.72, 8, 'y', MAT.METAL, false);
    b.box(sx * (w / 2 - 0.07), 0.12, 0, 0.02, 0.02, d - 0.14, MAT.METAL);
  }
}

// ---------------------------------------------------------------- dynamic part geometry (instanced, world material)

/** breaker disconnect handle, pivot at origin, arm along -z (pitch rotates it up/down) */
export function buildLever(b) {
  b.reset();
  b.setXform(0, 1, 0);
  b.cyl(0, 0, 0, 0.03, 0.05, 10, 'x', MAT.CHROME);
  b.box(0, 0, -0.11, 0.022, 0.022, 0.2, paint(PAINT.STEEL));
  b.box(0, 0, -0.235, 0.036, 0.036, 0.085, paint(PAINT.RED));
  b.identity();
  const g = b.finish();
  g.translate(0, -1, 0);
  return g;
}

/** elevator leaf of unit width spanning x in [-1, 0] (outer edge at 0), scaled in x per instance */
export function buildLeaf(b, Ho = 2.2) {
  b.reset();
  b.setXform(0, 0, 0);
  b.box(-0.5, Ho / 2, 0, 1, Ho, 0.035, MAT.CHROME, 1);
  b.box(-0.985, Ho / 2, 0, 0.03, Ho, 0.04, paint(PAINT.RUBBER), 1);
  b.box(-0.5, 1.05, -0.019, 0.98, 0.012, 0.003, MAT.BLACK);
  b.identity();
  return b.finish();
}

/** pickup meshes, centred on their bob point, built lifted so the floor ao never darkens them */
export function buildItem(b, type) {
  b.reset();
  const Y = 1;
  b.setXform(0, Y, 0);
  if (type === 'tape') {
    const W = 0.188, Hh = 0.104, T = 0.025;
    b.box(0, 0, 0, W, Hh, T, paint(PAINT.VHS));
    b.panel(0, 0.012, -T / 2 - 0.001, W - 0.02, Hh - 0.03, label(0), LBL.VHS_FRONT);
    b.setXform(0, Y + Hh / 2 + 0.0005, 0, 0, Math.PI / 2);
    b.panel(0, 0, 0, W - 0.01, T - 0.004, label(0), LBL.VHS_SPINE);
  } else if (type === 'almond') {
    b.setXform(0, Y - 0.1, 0);
    bottle(b, 0, 0, 0, 1, MAT.BOTTLE, label(0), 12);
  } else if (type === 'airhorn') {
    b.setXform(0, Y - 0.12, 0);
    b.cyl(0, 0.065, 0, 0.033, 0.13, 12, 'y', MAT.CHROME);
    b.cyl(0, 0.068, 0, 0.0336, 0.085, 12, 'y', label(0), false, LBL.AIRHORN);
    b.cyl(0, 0.14, 0, 0.018, 0.022, 10, 'y', paint(PAINT.BLACK));
    b.cyl(0, 0.157, 0, 0.012, 0.012, 8, 'y', paint(PAINT.WHITE));
    b.cyl(0, 0.2, 0, 0.012, 0.09, 12, 'y', paint(PAINT.RED), false, null, 0.03);
    b.cyl(0, 0.26, 0, 0.03, 0.03, 12, 'y', paint(PAINT.RED), false, null, 0.047);
    b.cyl(0, 0.2765, 0, 0.047, 0.003, 12, 'y', paint(PAINT.BLACK), true);
  } else {
    // folded note: two leaves with a soft crease
    const n = LBL.NOTE;
    b.setXform(0, Y, 0, 0, 0.12);
    b.panel(0, 0.04, 0, 0.12, 0.08, label(0), subRect(n, 0, 0.5, 1, 1));
    b.setXform(0, Y, 0, 0, -0.18);
    b.panel(0, -0.04, 0, 0.12, 0.08, label(0), subRect(n, 0, 0, 1, 0.5));
    b.setXform(0, Y, 0.0015, Math.PI, 0.12);
    b.panel(0, 0.04, 0, 0.12, 0.08, label(0), LBL.WHITE);
    b.setXform(0, Y, 0.0015, Math.PI, -0.18);
    b.panel(0, -0.04, 0, 0.12, 0.08, label(0), LBL.WHITE);
  }
  b.identity();
  const g = b.finish();
  g.translate(0, -Y, 0);
  return g;
}

/** append one feature to builder b (chunk-local origin ox, oz); ctx: render-side state (may be null) */
export function buildFeature(b, f, ox, oz, ctx = null) {
  const x = f.x - ox, z = f.z - oz, yaw = f.yaw || 0;
  const id = f.id || `${f.type},${f.x},${f.z}`;
  const data = f.data || {};
  switch (f.type) {
    case 'chair':
      b.setXform(x, 0, z, yaw, 0, data.tipped ? Math.PI / 2 : 0);
      if (data.tipped) b.setXform(x, 0.21, z, yaw, 0, Math.PI / 2);
      chair(b);
      break;
    case 'chairStack': {
      // a careless pile, deterministic per feature
      const n = data.count || 4 + Math.floor(h01(id, 0) * 3);
      for (let i = 0; i < n; i++) {
        const r = (s) => h01(id, i * 31 + s) - 0.5;
        const layer = Math.floor(i / 2);
        b.setXform(x + r(1) * 0.8, layer * 0.34 + Math.abs(r(2)) * 0.1, z + r(3) * 0.8, yaw + r(4) * 1.6, layer ? r(5) * 0.9 : r(5) * 0.2, layer ? r(6) * 1.2 : 0);
        chair(b);
      }
      break;
    }
    case 'desk':
      b.setXform(x, 0, z, yaw);
      desk(b, f.w, f.d);
      break;
    case 'cooler':
      b.setXform(x, 0, z, yaw);
      cooler(b);
      break;
    case 'phone':
      b.setXform(x, 0, z, yaw);
      phone(b);
      break;
    case 'shelf':
      b.setXform(x, 0, z, yaw);
      shelf(b, f.w, f.d, id);
      break;
    case 'boxes':
      b.setXform(x, 0, z, yaw);
      boxes(b, id);
      break;
    case 'pipes':
      b.setXform(x, 0, z, yaw);
      pipes(b, f.w || f.d);
      break;
    case 'sign':
      b.setXform(x, 0, z, yaw);
      b.box(0, data.y || 1.62, 0, f.w || 0.56, 0.3, 0.015, MAT.SIGN);
      break;
    case 'vent':
      b.setXform(x, 0, z, yaw);
      if (data.ceiling) b.box(0, CEIL_H - 0.006, 0, f.w || 0.6, 0.012, f.d || 0.6, MAT.VENT);
      else b.box(0, data.y || 2.35, 0, f.w || 0.5, 0.3, 0.02, MAT.VENT);
      break;
    case 'exitSign':
      if (data.mount === 'wall') {
        b.setXform(x, (data.y || 2.2) - (CEIL_H - 0.2), z, yaw);
        b.box(0, CEIL_H - 0.2, -0.03, 0.36, 0.16, 0.05, MAT.PLASTIC);
        b.box(0, CEIL_H - 0.2, -0.056, 0.3, 0.1, 0.004, MAT.EXIT);
      } else {
        b.setXform(x, 0, z, yaw);
        exitSign(b);
      }
      break;
    case 'pile': {
      // furniture pile: tipped desk under a heap of chairs
      b.setXform(x, 0.35, z, yaw + (h01(id, 9) - 0.5) * 0.5, 0, 1.35);
      desk(b, 1.2, 0.6);
      const n = 5 + Math.floor(h01(id, 2) * 4);
      for (let i = 0; i < n; i++) {
        const r = (s) => h01(id, i * 29 + s) - 0.5;
        const layer = Math.floor(i / 3);
        b.setXform(x + r(1) * 1.5, layer * 0.38 + Math.abs(r(2)) * 0.12, z + r(3) * 1.1, yaw + r(4) * 3, r(5) * (layer ? 1.4 : 0.3), r(6) * (layer ? 1.6 : 0.2));
        chair(b);
      }
      break;
    }
    case 'recovery':
      b.setXform(x, 0, z, yaw);
      bench(b);
      break;
    case 'poster':
      poster(b, f, x, z, yaw, id, data, ctx);
      break;
    case 'vending':
      vending(b, f, x, z, yaw);
      break;
    case 'tv':
      tv(b, f, x, z, yaw);
      break;
    case 'radio':
      radio(b, f, x, z, yaw, data);
      break;
    case 'breaker':
      breaker(b, f, x, z, yaw, ctx);
      break;
    case 'exitDoor':
      exitDoor(b, f, x, z, yaw);
      break;
    case 'table':
      b.setXform(x, 0, z, yaw);
      table(b, f);
      break;
    case 'darkTile':
      b.setXform(x, 0, z, yaw);
      b.box(0, CEIL_H - 0.005, 0, f.w || 0.6, 0.01, f.d || 0.6, MAT.DARKTILE, 2);
      break;
    default:
      // v3 tasks, meme props, counter / fridge / sink; puddle/stain are baked into the light atlas
      b.setXform(x, 0, z, yaw);
      buildV3(b, f, x, z, yaw, id, data, ctx);
      break;
  }
  b.identity();
}
