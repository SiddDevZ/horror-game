// v3 static props merged into chunk geometry: task stations, meme props, break-room / restroom furniture.
// local frame: front faces -z; wall-mounted kinds have x, z on the wall face, floor kinds are centred on their
// footprint. ctx.state(id) gives the latest feature:state so done tasks rebuild into their fixed look.
import { CEIL_H } from '../config.js';
import { MAT, PAINT, paint, label, led } from './materials-ids.js';
import { LBL, subRect } from './labels.js';
import { bottle, vending, posterVariant, h01, at } from './props.js';

const done = (ctx, id) => !!ctx && ctx.state(id) === 'done';

// ---------------------------------------------------------------- furniture

function counter(b, f) {
  const w = f.w || 1.8, d = f.d || 0.6;
  b.box(0, 0.44, 0.02, w - 0.02, 0.8, d - 0.06, paint(PAINT.CREAM));
  b.box(0, 0.05, 0.05, w - 0.06, 0.1, d - 0.14, paint(PAINT.BLACK));
  b.box(0, 0.885, 0, w, 0.03, d, MAT.LAMINATE);
  const n = Math.max(2, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (i + 0.5) * (w / n);
    b.box(cx, 0.47, -d / 2 + 0.035, w / n - 0.02, 0.72, 0.02, paint(PAINT.CREAM));
    b.box(cx + (i % 2 ? -1 : 1) * (w / n / 2 - 0.06), 0.72, -d / 2 + 0.02, 0.015, 0.12, 0.02, MAT.CHROME);
  }
}

function fridge(b, f) {
  const w = Math.min(f.w || 0.8, 0.9), d = Math.min(f.d || 0.75, 0.8), H = 1.78;
  const fr = paint(PAINT.FRIDGE);
  b.box(0, H / 2 + 0.02, 0.02, w, H - 0.04, d - 0.04, fr);
  b.box(0, 0.02, 0.05, w - 0.06, 0.04, d - 0.1, paint(PAINT.BLACK));
  // freezer on top, fridge below, seam and long handles
  // doors end flush with the footprint face so notes (fanumTax) sit on them
  b.box(0, 1.28, -d / 2 + 0.03, w - 0.01, 0.006, 0.012, paint(PAINT.STEEL));
  b.box(0, 1.53, -d / 2 + 0.025, w - 0.02, 0.48, 0.03, fr);
  b.box(0, 0.66, -d / 2 + 0.025, w - 0.02, 1.2, 0.03, fr);
  b.box(w / 2 - 0.07, 1.45, -d / 2 - 0.035, 0.025, 0.24, 0.025, MAT.CHROME);
  b.box(w / 2 - 0.07, 0.95, -d / 2 - 0.035, 0.025, 0.42, 0.025, MAT.CHROME);
  for (const y of [1.45 + 0.1, 1.45 - 0.1, 0.95 + 0.19, 0.95 - 0.19]) b.box(w / 2 - 0.07, y, -d / 2 - 0.012, 0.02, 0.02, 0.02, MAT.CHROME);
}

function sink(b, f) {
  const w = f.w || 0.6, d = f.d || 0.45;
  const pc = paint(PAINT.PORCELAIN);
  b.cyl(0, 0.4, 0.06, 0.07, 0.8, 10, 'y', pc, false, null, 0.09);
  b.box(0, 0.83, 0, w, 0.08, d, pc);
  b.box(0, 0.872, -0.02, w - 0.12, 0.004, d - 0.16, paint(PAINT.STEEL));
  b.cyl(0, 0.93, d / 2 - 0.08, 0.018, 0.12, 8, 'y', MAT.CHROME);
  at(b, b._fx, b._fz, b._fyaw, 0, 0.98, d / 2 - 0.13, Math.PI / 2);
  b.cyl(0, 0, 0, 0.012, 0.1, 8, 'y', MAT.CHROME);
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  for (const sx of [-1, 1]) b.cyl(sx * 0.09, 0.9, d / 2 - 0.08, 0.018, 0.03, 8, 'y', MAT.CHROME);
  // mirror above (dark glass in a chrome frame), mounted on the wall behind
  b.box(0, 1.55, d / 2 - 0.012, 0.52, 0.72, 0.02, MAT.CHROME);
  b.panel(0, 1.55, d / 2 - 0.0225, 0.48, 0.68, label(1), LBL.MIRROR);
}

// ---------------------------------------------------------------- tasks

function cardReader(b, y) {
  b.box(0, y, -0.016, 0.1, 0.17, 0.032, paint(PAINT.BLACK));
  b.panel(0, y, -0.0325, 0.09, 0.15, label(1), LBL.CARD);
}

/** wiring panel on the wall; done = the four wires run straight across to their matching terminals */
export function wiresPanel(b, yc, isDone, w = 0.5, h = 0.42, D = 0.12) {
  const en = paint(PAINT.ENAMEL);
  b.box(0, yc, -D / 2, w, h, D, en);
  // open cavity: dark back plate, then a frame around it
  b.box(0, yc, -D - 0.004, w - 0.06, h - 0.06, 0.006, MAT.BLACK);
  b.box(0, yc + h / 2 - 0.015, -D - 0.01, w, 0.03, 0.02, en);
  b.box(0, yc - h / 2 + 0.015, -D - 0.01, w, 0.03, 0.02, en);
  b.box(w / 2 - 0.015, yc, -D - 0.01, 0.03, h, 0.02, en);
  b.box(-w / 2 + 0.015, yc, -D - 0.01, 0.03, h, 0.02, en);
  // swung-open door against the wall on the left
  at(b, b._fx, b._fz, b._fyaw, w / 2 + 0.005, yc, -D - 0.005, 0, 0, Math.PI / 2 + 0.25);
  b.box(-(w - 0.02) / 2, 0, 0, w - 0.02, h - 0.02, 0.012, en);
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  // terminals and wires: red, blue, yellow, pink (among us panel)
  const cols = [PAINT.RED, PAINT.WIREBLUE, PAINT.YELLOW, PAINT.PINK];
  const order = [2, 0, 3, 1];
  const xl = w / 2 - 0.06, xr = -w / 2 + 0.06, z = -D - 0.012;
  for (let i = 0; i < 4; i++) {
    const yl = yc + 0.12 - i * 0.08;
    b.box(xl, yl, z, 0.035, 0.03, 0.02, paint(cols[i]));
    const yr = yc + 0.12 - order.indexOf(i) * 0.08;
    b.box(xr, yr, z, 0.035, 0.03, 0.02, paint(cols[i]));
    if (isDone) {
      // straight run across (tilted between the two terminals)
      const dy = yr - yl, len = Math.hypot(xl - xr, dy);
      at(b, b._fx, b._fz, b._fyaw, (xl + xr) / 2, (yl + yr) / 2, z - 0.004, 0, Math.atan2(-dy, xl - xr));
      b.box(0, 0, 0, len, 0.012, 0.012, paint(cols[i]));
      b.setXform(b._fx, 0, b._fz, b._fyaw);
    } else {
      // loose end hanging from the left terminal
      at(b, b._fx, b._fz, b._fyaw, xl - 0.03, yl - 0.045, z - 0.004, 0, 0.35 - i * 0.12);
      b.box(0, 0, 0, 0.012, 0.09, 0.012, paint(cols[i]));
      b.setXform(b._fx, 0, b._fz, b._fyaw);
    }
  }
}

function planter(b, f, id) {
  const w = Math.min(f.w || 1, 1.1), d = Math.min(f.d || 1, 1.1);
  const wood = paint(PAINT.PLANTER);
  const H = 0.38;
  b.box(0, H / 2, -d / 2 + 0.03, w, H, 0.06, wood);
  b.box(0, H / 2, d / 2 - 0.03, w, H, 0.06, wood);
  b.box(-w / 2 + 0.03, H / 2, 0, 0.06, H, d - 0.12, wood);
  b.box(w / 2 - 0.03, H / 2, 0, 0.06, H, d - 0.12, wood);
  b.box(0, H - 0.04, 0, w - 0.12, 0.02, d - 0.12, paint(PAINT.SOIL));
  // grass blades: tapered, leaning, two greens
  const n = 90;
  for (let i = 0; i < n; i++) {
    const r = (s) => h01(id, i * 7 + s);
    const bx = (r(1) - 0.5) * (w - 0.18), bz = (r(2) - 0.5) * (d - 0.18);
    const len = 0.1 + r(3) * 0.14;
    at(b, b._fx, b._fz, b._fyaw, bx, H - 0.03 + len / 2, bz, (r(4) - 0.5) * 0.7, (r(5) - 0.5) * 0.7, r(6) * 3);
    b.cyl(0, 0, 0, 0.008, len, 3, 'y', paint(r(8) < 0.6 ? PAINT.GRASS : PAINT.GREEN), false, null, 0.0015);
  }
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  // stake sign
  b.box(w / 2 - 0.12, 0.55, -d / 2 + 0.08, 0.02, 0.4, 0.02, MAT.WOOD);
  b.panel(w / 2 - 0.12, 0.72, -d / 2 + 0.068, 0.26, 0.1, label(0), LBL.TOUCH);
  b.box(w / 2 - 0.12, 0.72, -d / 2 + 0.075, 0.27, 0.11, 0.01, MAT.WOOD);
}

function ladder(b) {
  // A-frame step ladder, orange fibreglass rails, aluminium treads
  const H = 1.75, spread = 0.36, W = 0.44;
  const tilt = Math.atan2(spread / 2, H);
  const len = H / Math.cos(tilt);
  const rail = paint(PAINT.ORANGE);
  for (const side of [-1, 1]) {
    at(b, b._fx, b._fz, b._fyaw, 0, H / 2, side * spread / 4, side * tilt, 0);
    for (const sx of [-1, 1]) b.box(sx * W / 2, 0, 0, 0.035, len, 0.07, rail);
    if (side < 0) for (let k = 1; k <= 4; k++) b.box(0, -len / 2 + k * (len / 5), 0, W, 0.025, 0.09, MAT.CHROME);
    else for (let k = 1; k <= 3; k++) b.box(0, -len / 2 + k * (len / 4), 0.02, W, 0.02, 0.02, rail);
  }
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  b.box(0, H + 0.02, 0, W + 0.06, 0.05, 0.2, paint(PAINT.BLACK));
  b.box(0, H * 0.55, 0, 0.02, 0.01, spread * 0.5, MAT.METAL);
}

function mopBucket(b, id) {
  const y = paint(PAINT.YELLOW);
  b.box(0, 0.2, 0, 0.36, 0.3, 0.3, y);
  b.box(0, 0.36, 0, 0.36, 0.03, 0.3, y);
  b.box(0, 0.37, 0.01, 0.3, 0.004, 0.24, paint(PAINT.SOIL));
  b.box(0, 0.44, 0.08, 0.26, 0.14, 0.12, paint(PAINT.STEEL));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.15, 0.03, sz * 0.12, 0.03, 0.03, 8, 'x', paint(PAINT.RUBBER));
  at(b, b._fx, b._fz, b._fyaw, 0.02, 0.72, 0.02, 0.18, -0.12);
  b.cyl(0, 0, 0, 0.012, 1.3, 6, 'y', MAT.WOOD, false);
  b.cyl(0, -0.63, 0, 0.05, 0.12, 8, 'y', paint(PAINT.CREAM));
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  // folded wet floor sign next to it
  const sx = 0.42;
  for (const s of [-1, 1]) {
    at(b, b._fx, b._fz, b._fyaw, sx, 0.3, s * 0.06, s * -0.2, 0, s > 0 ? Math.PI : 0);
    b.box(0, 0, 0, 0.3, 0.6, 0.012, paint(PAINT.YELLOW));
    b.panel(0, 0.05, -0.0065, 0.26, 0.26, label(0), LBL.WET);
  }
  b.setXform(b._fx, 0, b._fz, b._fyaw);
}

function rack(b, f, isOff) {
  const w = Math.min(f.w || 0.7, 0.8), d = Math.min(f.d || 0.9, 1), H = 1.95;
  const rk = paint(PAINT.RACK);
  b.box(0, H / 2, 0.02, w, H, d - 0.04, rk);
  for (const sx of [-1, 1]) b.box(sx * (w / 2 - 0.02), H / 2, -d / 2 + 0.01, 0.04, H, 0.03, paint(PAINT.CHARCOAL));
  b.box(0, H - 0.03, -d / 2 + 0.01, w, 0.06, 0.03, paint(PAINT.CHARCOAL));
  const iw = w - 0.1;
  const units = [0.09, 0.09, 0.045, 0.09, 0.045, 0.18, 0.09, 0.045, 0.09, 0.09, 0.18];
  let y = 0.12;
  let u = 0;
  for (const uh of units) {
    const cy = y + uh / 2;
    b.box(0, cy, -d / 2 + 0.03, iw, uh - 0.006, 0.02, paint(PAINT.BLACK));
    b.panel(0, cy, -d / 2 + 0.0195, iw, uh - 0.01, label(0), LBL.RACKU);
    // status leds on the right end of every unit: blinking unless the router is switched off
    const nl = uh > 0.1 ? 4 : 2;
    for (let k = 0; k < nl; k++) {
      const col = k === 0 ? 1 : (h01(`${f.id}`, u * 9 + k) < 0.3 ? 2 : 1);
      b.box(-iw / 2 + 0.03 + k * 0.022, cy + (uh > 0.1 ? 0.02 : 0), -d / 2 + 0.017, 0.012, 0.012, 0.004, isOff ? MAT.BLACK : led(col, k > 0));
    }
    // patch cables drooping out of a few units
    if (h01(`${f.id}`, u + 40) < 0.4) {
      const c = [PAINT.WIREBLUE, PAINT.YELLOW, PAINT.RED, PAINT.GREEN][u % 4];
      b.box(iw / 2 - 0.12, cy - 0.04, -d / 2 + 0.012, 0.01, 0.1, 0.01, paint(c));
    }
    y += uh + 0.012;
    u++;
  }
}

function copier(b, f, id, isDone) {
  const w = Math.min(f.w || 0.9, 1), d = Math.min(f.d || 0.7, 0.8);
  const cg = paint(PAINT.COPIER), lid = paint(PAINT.CREAM);
  b.box(-0.05, 0.45, 0, w - 0.1, 0.9, d, cg);
  for (let k = 0; k < 3; k++) b.box(-0.05, 0.15 + k * 0.22, -d / 2 - 0.005, w - 0.16, 0.012, 0.012, paint(PAINT.CHARCOAL));
  b.box(-0.05, 0.94, 0.02, w - 0.1, 0.08, d - 0.04, lid);
  b.box(-0.05, 0.99, 0.04, w - 0.14, 0.02, d - 0.1, cg);
  // tilted control panel at the front
  at(b, b._fx, b._fz, b._fyaw, -0.05, 0.93, -d / 2 - 0.04, -0.5);
  b.box(0, 0, 0, 0.4, 0.14, 0.02, paint(PAINT.CHARCOAL));
  b.panel(0, 0, -0.0105, 0.38, 0.13, label(2), LBL.COPIER);
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  // output tray on the right (local -x) with a printed meme page once done
  b.box(-w / 2 - 0.06, 0.62, 0, 0.2, 0.02, d - 0.2, lid);
  if (isDone) {
    at(b, b._fx, b._fz, b._fyaw, -w / 2 - 0.06, 0.635, 0, Math.PI / 2, 0, Math.PI / 2 + 0.1);
    const u0 = posterVariant(Math.floor(h01(id, 3) * 4096), id) * 2;
    b.panel(0, 0, 0, 0.21, 0.28, MAT.POSTER, [u0, 0, u0 + 1, 1]);
    b.setXform(b._fx, 0, b._fz, b._fyaw);
  }
}

function microwave(b, y) {
  const w = 0.5, h = 0.29, d = 0.36;
  b.box(0, y + h / 2, 0, w, h, d, paint(PAINT.CHARCOAL));
  for (const sx of [-1, 1]) b.box(sx * (w / 2 - 0.05), y + 0.005, 0, 0.04, 0.01, d - 0.08, paint(PAINT.RUBBER));
  b.panel(0, y + h / 2, -d / 2 - 0.002, w - 0.02, h - 0.02, label(1), LBL.MICRO);
  // door window over the dark left part of the panel
  b.box(0.08, y + h / 2, -d / 2 - 0.006, 0.26, 0.2, 0.006, MAT.GLASS);
  b.box(-0.03, y + h / 2, -d / 2 - 0.02, 0.02, 0.18, 0.02, MAT.CHROME);
}

function clipboard(b, y, isDone) {
  at(b, b._fx, b._fz, b._fyaw, 0, y + 0.004, 0, Math.PI / 2, 0, 0.12);
  b.box(0, 0, 0.002, 0.23, 0.32, 0.004, paint(PAINT.WALNUT));
  b.panel(0, -0.012, -0.0005, 0.21, 0.27, label(0), isDone ? LBL.TIMESHEET_SIGNED : LBL.TIMESHEET);
  b.box(0, 0.145, -0.006, 0.09, 0.03, 0.01, MAT.CHROME);
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  at(b, b._fx, b._fz, b._fyaw, 0.17, y + 0.008, 0.02, 0, 0, Math.PI / 2 - 0.3);
  b.cyl(0, 0, 0, 0.005, 0.14, 6, 'y', paint(PAINT.WIREBLUE));
  b.setXform(b._fx, 0, b._fz, b._fyaw);
}

// ---------------------------------------------------------------- meme props

function grimace(b, y) {
  b.cyl(0, y + 0.08, 0, 0.034, 0.16, 12, 'y', paint(PAINT.PURPLE), true, null, 0.045);
  b.cyl(0, y + 0.165, 0, 0.047, 0.012, 12, 'y', paint(PAINT.WHITE));
  b.cyl(0, y + 0.18, 0, 0.03, 0.02, 12, 'y', paint(PAINT.WHITE), true, null, 0.012);
  at(b, b._fx, b._fz, b._fyaw, 0.005, y + 0.24, 0, 0, -0.12);
  b.cyl(0, 0, 0, 0.004, 0.14, 6, 'y', paint(PAINT.PINK));
  b.setXform(b._fx, 0, b._fz, b._fyaw);
}

function stanley(b, y) {
  const t = paint(PAINT.TEAL);
  b.cyl(0, y + 0.05, 0, 0.036, 0.1, 14, 'y', t, true, null, 0.036);
  b.cyl(0, y + 0.19, 0, 0.036, 0.18, 14, 'y', t, false, null, 0.047);
  b.cyl(0, y + 0.29, 0, 0.049, 0.025, 14, 'y', MAT.CHROME);
  b.cyl(0, y + 0.305, 0, 0.044, 0.01, 14, 'y', paint(PAINT.WHITE));
  b.box(0.06, y + 0.21, 0, 0.018, 0.14, 0.022, t);
  b.box(0.045, y + 0.28, 0, 0.04, 0.016, 0.022, t);
  b.box(0.045, y + 0.14, 0, 0.04, 0.016, 0.022, t);
  at(b, b._fx, b._fz, b._fyaw, -0.01, y + 0.36, 0, 0, 0.08);
  b.cyl(0, 0, 0, 0.005, 0.12, 6, 'y', paint(PAINT.WHITE));
  b.setXform(b._fx, 0, b._fz, b._fyaw);
}

function crewmate(b) {
  const red = paint(PAINT.CREW);
  b.cyl(0, 0.2, 0, 0.12, 0.16, 12, 'y', red, false);
  b.ellipsoid(0, 0.28, 0, 0.12, 0.1, 0.12, red, 12, 6);
  b.ellipsoid(0, 0.12, 0, 0.12, 0.05, 0.12, red, 12, 5);
  b.ellipsoid(0, 0.27, -0.09, 0.08, 0.045, 0.045, paint(PAINT.VISOR), 12, 6);
  b.ellipsoid(0.03, 0.285, -0.12, 0.018, 0.01, 0.008, paint(PAINT.WHITE), 6, 4);
  b.box(0, 0.2, 0.13, 0.15, 0.16, 0.06, red);
  for (const sx of [-1, 1]) b.cyl(sx * 0.055, 0.05, 0, 0.05, 0.1, 10, 'y', red);
}

function grassBlock(b) {
  const s = 0.5, h = s / 2;
  for (let k = 0; k < 4; k++) {
    b.setXform(b._fx, 0, b._fz, b._fyaw + (k * Math.PI) / 2);
    b.panel(0, h, -h, s, s, label(0), LBL.GRASS_SIDE, -1);
  }
  b.setXform(b._fx, 0, b._fz, b._fyaw);
  b.hpanel(0, s, 0, s, s, label(0), LBL.GRASS_TOP);
}

function ohioSign(b) {
  b.cyl(0, 1.1, 0.022, 0.022, 2.2, 8, 'y', MAT.METAL);
  // panel aspect follows the sign art (1.51:1)
  b.box(0, 2.12, -0.02, 0.94, 0.63, 0.03, MAT.CHROME);
  b.panel(0, 2.12, -0.0355, 0.9, 0.595, label(0), LBL.OHIO);
}

function dogeStatue(b) {
  const g = MAT.BRASS, mb = paint(PAINT.MARBLE);
  b.box(0, 0.35, 0, 0.62, 0.7, 0.62, mb);
  b.box(0, 0.72, 0, 0.68, 0.04, 0.68, mb);
  b.box(0, 0.02, 0, 0.7, 0.04, 0.7, mb);
  b.panel(0, 0.45, -0.3105, 0.36, 0.12, label(0), LBL.PLAQUE);
  const y = 0.74, K = 1.4;
  // sitting shiba in gold: haunches, chest, head, snout, ears, curled tail, front legs (scaled K above the plinth)
  const E = (cx, cy, cz, rx, ry, rz, m, sg, rg) => b.ellipsoid(cx * K, y + cy * K, cz * K, rx * K, ry * K, rz * K, m, sg, rg);
  E(0, 0.14, 0.06, 0.13, 0.13, 0.16, g, 12, 8);
  E(0, 0.27, -0.04, 0.1, 0.16, 0.1, g, 12, 8);
  E(0, 0.47, -0.07, 0.1, 0.09, 0.09, g, 12, 8);
  E(0, 0.44, -0.16, 0.05, 0.04, 0.06, g, 10, 6);
  E(0, 0.455, -0.215, 0.018, 0.014, 0.012, paint(PAINT.BLACK), 6, 4);
  for (const sx of [-1, 1]) {
    E(sx * 0.04, 0.49, -0.145, 0.012, 0.012, 0.008, paint(PAINT.BLACK), 6, 4);
    at(b, b._fx, b._fz, b._fyaw, sx * 0.055 * K, y + 0.57 * K, -0.06 * K, 0.1, sx * -0.25);
    b.cyl(0, 0, 0, 0.035 * K, 0.08 * K, 6, 'y', g, true, null, 0.002);
    b.setXform(b._fx, 0, b._fz, b._fyaw);
    b.cyl(sx * 0.05 * K, y + 0.1 * K, -0.1 * K, 0.022 * K, 0.2 * K, 8, 'y', g);
  }
  for (let k = 0; k < 5; k++) {
    const a = k * 0.7;
    E(Math.sin(a) * 0.06, 0.18 + Math.cos(a) * 0.06, 0.21 + Math.cos(a) * 0.02, 0.035, 0.035, 0.035, g, 8, 5);
  }
}

function standeeEasel(b, w) {
  b.box(0, 0.02, 0, w * 0.5, 0.04, 0.05, MAT.CARDBOARD);
  at(b, b._fx, b._fz, b._fyaw, 0, 0.45, 0.02, -0.06);
  b.box(0, 0, 0, 0.08, 0.9, 0.008, MAT.CARDBOARD);
  b.setXform(b._fx, 0, b._fz, b._fyaw);
}

export function toiletGeo(b) {
  const pc = paint(PAINT.PORCELAIN);
  b.cyl(0, 0.19, -0.02, 0.1, 0.38, 12, 'y', pc, false, null, 0.12);
  b.ellipsoid(0, 0.38, -0.1, 0.19, 0.04, 0.24, pc, 14, 6);
  b.cyl(0, 0.41, -0.1, 0.17, 0.02, 14, 'y', paint(PAINT.WHITE));
  b.cyl(0, 0.418, -0.1, 0.12, 0.004, 14, 'y', paint(PAINT.CAPBLUE));
  b.box(0, 0.62, 0.23, 0.44, 0.36, 0.17, pc);
  b.box(0, 0.815, 0.23, 0.46, 0.03, 0.19, pc);
  b.box(0.15, 0.76, 0.14, 0.05, 0.015, 0.012, MAT.CHROME);
  at(b, 0, 0, 0, 0, 0.62, 0.13, -0.15);
  b.box(0, 0, 0, 0.36, 0.44, 0.03, paint(PAINT.WHITE));
  b.identity();
}

/** cartoon head (skibidi) centred at its origin, built lifted so floor ao never touches it */
export function skibidiHeadGeo(b) {
  const Y = 1;
  const sk = paint(PAINT.SKIN);
  b.ellipsoid(0, Y, 0, 0.1, 0.12, 0.1, sk, 12, 8);
  for (const sx of [-1, 1]) {
    b.ellipsoid(sx * 0.038, Y + 0.04, -0.085, 0.024, 0.024, 0.012, paint(PAINT.WHITE), 8, 5);
    b.ellipsoid(sx * 0.038, Y + 0.04, -0.097, 0.011, 0.011, 0.006, paint(PAINT.BLACK), 6, 4);
  }
  b.ellipsoid(0, Y - 0.045, -0.085, 0.04, 0.018, 0.012, paint(PAINT.RED), 8, 5);
  b.ellipsoid(0, Y + 0.1, 0.06, 0.09, 0.03, 0.08, paint(PAINT.WALNUT), 10, 5);
  return Y;
}

// ---------------------------------------------------------------- dispatch

/** returns true when handled. b's transform is already set to the feature frame. */
// ---------------------------------------------------------------- v4: sigma boy jukebox

/** jukebox layout in feature-local metres (front faces -z). neon tubes and the disco ball are dynamic (features.js) */
export function jukeLayout(f) {
  const W = Math.min(Math.max(f.w || 1.0, 0.8), 1.1), D = Math.min(Math.max(f.d || 0.6, 0.5), 0.7);
  const T = 1.12, R = W / 2, zf = -D / 2;
  return { W, D, T, R, zf, ball: [0, 2.3, zf + 0.26], ballR: 0.14 };
}

function jukebox(b, f) {
  const { W, D, T, R, zf, ball, ballR } = jukeLayout(f);
  const wal = paint(PAINT.WALNUT), blk = paint(PAINT.BLACK);
  b.box(0, 0.04, 0.01, W - 0.06, 0.08, D - 0.06, blk);
  b.box(0, (0.08 + T) / 2, 0, W, T - 0.08, D, wal);
  // arch top: its lower half sits inside the body, front cap recessed 2 cm behind the body face
  b.cyl(0, T, 0.01, R, D - 0.02, 28, 'z', wal);
  b.box(0, T + R + 0.025, 0.01, 0.16, 0.05, 0.12, MAT.CHROME);
  // lit front: marquee + selector buttons + speaker grille (generated art), record window in the arch
  b.panel(0, (0.08 + T) / 2 + 0.01, zf - 0.003, W - 0.12, T - 0.14, label(5), LBL.JUKE_FRONT);
  b.panel(0, T + 0.17, zf + 0.017, 0.7, 0.3, label(6), LBL.JUKE_DOME);
  // chrome pilasters the neon runs along, chrome kick plate and feet
  for (const sx of [-1, 1]) {
    b.box(sx * (W / 2 - 0.03), (0.1 + T) / 2, zf - 0.01, 0.05, T - 0.1, 0.02, MAT.CHROME);
    for (const sz of [-1, 1]) b.box(sx * (W / 2 - 0.08), 0.015, sz * (D / 2 - 0.08), 0.07, 0.03, 0.07, MAT.CHROME);
  }
  b.box(0, 0.09, zf - 0.008, W - 0.1, 0.05, 0.016, MAT.CHROME);
  // disco ball chain and ceiling rose (the ball itself spins, see features.js)
  const [bx, by, bz] = ball;
  const top = by + ballR;
  b.cyl(bx, (top + CEIL_H) / 2, bz, 0.005, CEIL_H - top, 5, 'y', MAT.CHROME, false);
  b.cyl(bx, CEIL_H - 0.012, bz, 0.045, 0.024, 10, 'y', MAT.CHROME);
}

export function buildV3(b, f, x, z, yaw, id, data, ctx) {
  b._fx = x; b._fz = z; b._fyaw = yaw;
  const k = data.kind;
  switch (f.type) {
    case 'counter': counter(b, f); return true;
    case 'fridge': fridge(b, f); return true;
    case 'sink': sink(b, f); return true;
    case 'jukebox': jukebox(b, f); return true;
    case 'task':
      switch (k) {
        case 'cardSwipe': cardReader(b, data.y || 1.15); return true;
        case 'wires': wiresPanel(b, data.y || 1.35, done(ctx, id)); return true;
        case 'touchGrass': planter(b, f, id); return true;
        case 'fixLight': ladder(b); return true;
        case 'mop': mopBucket(b, id); return true;
        case 'router': rack(b, f, ctx && ctx.state(id) === 'off'); return true;
        case 'copier': copier(b, f, id, done(ctx, id)); return true;
        case 'microwave': microwave(b, data.y ?? 0.9); return true;
        case 'vendingStuck': vending(b, f, x, z, yaw, { stuck: !done(ctx, id) }); return true;
        case 'timesheet': clipboard(b, data.y ?? 0.75, done(ctx, id)); return true;
        case 'skibidi': return true; // instanced toilet (flush wobble)
        case 'straighten': return true; // the linked poster is drawn crooked
        default: return false;
      }
    case 'meme':
      switch (k) {
        case 'prime': vending(b, f, x, z, yaw, { prime: true }); return true;
        case 'grimace': grimace(b, data.y ?? 0.75); return true;
        case 'stanley': stanley(b, data.y ?? 0.75); return true;
        case 'crewmate': b.setXform(x, data.y || 0, z, yaw); crewmate(b); return true;
        case 'grassBlock': grassBlock(b); return true;
        case 'ohio': ohioSign(b); return true;
        case 'doge': dogeStatue(b); return true;
        case 'chillGuy': case 'chungus': case 'shrek': standeeEasel(b, f.w || 0.8); return true;
        case 'sus': b.panel(0, data.y || 0.8, -0.002, Math.max(f.w || 0.6, 0.75), Math.max(f.w || 0.6, 0.75) / 1.93, MAT.DECAL, LBL.SUS); return true;
        case 'trollface': b.panel(0, data.y || 0.8, -0.002, f.w || 0.6, (f.w || 0.6) * 0.76, MAT.DECAL, LBL.TROLL); return true;
        case 'nerd': {
          const s = Math.min(f.w || 0.5, 0.6), y = data.y || 1.6;
          b.box(0, y, -0.006, s + 0.02, s + 0.02, 0.012, MAT.CHROME);
          b.panel(0, y, -0.0125, s, s, label(0), LBL.NERD);
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.cyl(sx * (s / 2 - 0.02), y + sy * (s / 2 - 0.02), -0.014, 0.006, 0.004, 6, 'z', MAT.CHROME);
          return true;
        }
        case 'fanumTax': {
          const y = data.y || 1.3;
          at(b, x, z, yaw, 0, y, -0.002, 0, 0, (h01(id, 1) - 0.5) * 0.2);
          b.panel(0, 0, 0, 0.17, 0.17, label(0), LBL.FANUM);
          b.setXform(x, 0, z, yaw);
          b.cyl(0, y + 0.075, -0.006, 0.014, 0.01, 10, 'z', paint(PAINT.RED));
          return true;
        }
        case 'skibidi': return true; // instanced toilet + head
        default: return false;
      }
    default:
      return false;
  }
}
