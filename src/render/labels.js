// printed graphics for props, drawn once at boot into one 1024x1024 srgb canvas atlas (exit sign, bottle and
// airhorn labels, vending front, vhs labels, danger sticker, radio dial, note paper, hazard stripes), plus
// placeholder poster / tv atlases used until the real ones from the manifest load.
import * as THREE from 'three';

const S = 1024;
const SH = 2048;
// pixel rects [x, y, w, h] (canvas space, y down)
const PX = {
  EXIT: [0, 0, 512, 176],
  ALMOND: [512, 0, 320, 128],
  AIRHORN: [512, 128, 320, 128],
  VHS_SPINE: [832, 0, 192, 64],
  VHS_FRONT: [832, 64, 192, 112],
  VEND_HEAD: [0, 176, 512, 112],
  RADIO_DIAL: [0, 288, 384, 64],
  VCR_CLOCK: [384, 288, 128, 64],
  DANGER: [0, 352, 224, 160],
  CALL: [224, 352, 96, 160],
  NOTE: [320, 352, 128, 160],
  TAG: [448, 352, 64, 64],
  WHITE: [448, 448, 64, 64],
  HAZARD: [0, 512, 512, 64],
  VEND_PANEL: [832, 176, 160, 384],
  VEND_BACK: [992, 176, 32, 384],
  TV_STRIP: [512, 256, 320, 48],
  KNOB: [512, 304, 64, 64],
  // v3
  ELEVATOR: [512, 576, 256, 320],
  PRYME_HEAD: [0, 576, 512, 112],
  PRYME_LABEL: [0, 688, 320, 128],
  PRYME_PANEL: [320, 688, 192, 128],
  SUS: [768, 576, 256, 160],
  NERD: [768, 736, 256, 256],
  OHIO: [0, 816, 512, 208],
  FANUM: [512, 896, 128, 128],
  WET: [640, 896, 128, 128],
  CHILL: [0, 1024, 200, 512],
  CHUNGUS: [200, 1024, 336, 512],
  TROLL: [536, 1024, 420, 320],
  SWAMP: [0, 1536, 320, 384],
  TIMESHEET: [320, 1536, 160, 208],
  TIMESHEET_SIGNED: [480, 1536, 160, 208],
  CARD: [640, 1536, 96, 160],
  COPIER: [736, 1536, 256, 96],
  MICRO: [736, 1632, 256, 128],
  RACKU: [736, 1760, 256, 64],
  GRASS_TOP: [0, 1920, 128, 128],
  GRASS_SIDE: [128, 1920, 128, 128],
  DIRT: [256, 1920, 128, 128],
  TOUCH: [384, 1920, 256, 96],
  PLAQUE: [640, 1920, 192, 64],
  MIRROR: [832, 1920, 96, 128],
  // v4 (sigma boy jukebox)
  JUKE_FRONT: [576, 304, 256, 272],
  JUKE_DOME: [536, 1344, 420, 192],
};
/** uv rects [u0, v0, u1, v1] (v up, half-texel inset) */
export const LBL = {};
for (const k in PX) {
  const [x, y, w, h] = PX[k];
  LBL[k] = [(x + 0.5) / S, 1 - (y + h - 0.5) / SH, (x + w - 0.5) / S, 1 - (y + 0.5) / SH];
}
/** sub-rect of a label rect in its own 0..1 space */
export function subRect(r, a, b, c, d) {
  const du = r[2] - r[0], dv = r[3] - r[1];
  return [r[0] + du * a, r[1] + dv * b, r[0] + du * c, r[1] + dv * d];
}

const SANS = 'Helvetica, Arial, sans-serif';
const HAND = '"Marker Felt", "Bradley Hand", "Comic Sans MS", "Segoe Print", cursive';

function fit(g, text, font, size, maxW) {
  let s = size;
  g.font = `${font.replace('{s}', s)}`;
  while (g.measureText(text).width > maxW && s > 6) { s -= 2; g.font = font.replace('{s}', s); }
}

function noise(g, x, y, w, h, amt, seed = 1) {
  const img = g.getImageData(x, y, w, h);
  let st = seed * 9301 + 49297;
  for (let i = 0; i < img.data.length; i += 4) {
    st = (st * 9301 + 49297) % 233280;
    const n = (st / 233280 - 0.5) * amt;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, x, y);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function drawLabels(g) {
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, SH);
  let [x, y, w, h] = PX.EXIT;
  // exit sign face: deep green diffuser, bright near-white letters, running figure + arrow
  let gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#0d7a34'); gr.addColorStop(0.5, '#10903d'); gr.addColorStop(1, '#0b6a2d');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.strokeStyle = '#063d1a'; g.lineWidth = 8; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
  g.fillStyle = '#effff0'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `900 132px ${SANS}`;
  g.fillText('EXIT', x + 36, y + h / 2 + 6);
  // pictogram: figure running into a doorway, then an arrow
  const px = x + 372, py = y + 36;
  g.fillRect(px + 58, py, 58, 104);
  g.fillStyle = '#10903d'; g.fillRect(px + 66, py + 8, 42, 96);
  g.fillStyle = '#effff0';
  g.beginPath(); g.arc(px + 30, py + 14, 11, 0, Math.PI * 2); g.fill();
  g.lineWidth = 11; g.lineCap = 'round'; g.strokeStyle = '#effff0';
  g.beginPath(); g.moveTo(px + 26, py + 30); g.lineTo(px + 18, py + 62); g.lineTo(px + 4, py + 96); g.stroke();
  g.beginPath(); g.moveTo(px + 18, py + 62); g.lineTo(px + 40, py + 78); g.lineTo(px + 44, py + 102); g.stroke();
  g.beginPath(); g.moveTo(px + 6, py + 44); g.lineTo(px + 26, py + 34); g.lineTo(px + 46, py + 48); g.stroke();
  g.beginPath(); g.moveTo(px + 88, py + 124); g.lineTo(px + 128, py + 124); g.stroke();
  g.beginPath(); g.moveTo(px + 116, py + 112); g.lineTo(px + 130, py + 124); g.lineTo(px + 116, py + 136); g.stroke();

  // almond water bottle wrap
  [x, y, w, h] = PX.ALMOND;
  g.fillStyle = '#f1e8d2'; g.fillRect(x, y, w, h);
  g.fillStyle = '#2f5d8c'; g.fillRect(x, y, w, 12); g.fillRect(x, y + h - 12, w, 12);
  g.fillStyle = '#c9a36b'; g.fillRect(x, y + 12, w, 4); g.fillRect(x, y + h - 16, w, 4);
  g.fillStyle = '#6b4424';
  g.beginPath(); g.ellipse(x + 44, y + 64, 16, 26, 0.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f1e8d2'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 34, y + 50); g.quadraticCurveTo(x + 46, y + 64, x + 54, y + 80); g.stroke();
  g.fillStyle = '#4a2e16'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `900 40px ${SANS}`; g.fillText('ALMOND', x + 76, y + 62);
  g.fillStyle = '#2f5d8c'; g.font = `700 28px ${SANS}`; g.fillText('WATER', x + 78, y + 94);
  g.fillStyle = '#6b5a44'; g.font = `600 11px ${SANS}`; g.fillText('500 mL  ·  M.E.G. APPROVED', x + 78, y + 110);
  g.fillText('NATURAL', x + 250, y + 30);

  // airhorn can wrap
  [x, y, w, h] = PX.AIRHORN;
  g.fillStyle = '#e9e9e6'; g.fillRect(x, y, w, h);
  g.fillStyle = '#c21b12'; g.fillRect(x, y + 20, w, 44);
  g.fillStyle = '#ffffff'; g.font = `900 34px ${SANS}`; g.textAlign = 'left'; g.fillText('AIR HORN', x + 26, y + 54);
  g.fillStyle = '#1a1a1a'; g.font = `700 16px ${SANS}`; g.fillText('MARINE SIGNAL  ·  120 dB', x + 26, y + 88);
  g.fillStyle = '#5a5a5a'; g.font = `600 11px ${SANS}`; g.fillText('CAUTION: EXTREMELY LOUD. DO NOT POINT AT EARS.', x + 26, y + 108);
  g.fillStyle = '#f0b400'; g.fillRect(x + 236, y + 70, 60, 26);
  g.fillStyle = '#1a1a1a'; g.font = `800 13px ${SANS}`; g.fillText('LOUD', x + 247, y + 88);

  // vhs spine + front
  [x, y, w, h] = PX.VHS_SPINE;
  g.fillStyle = '#f4f1e6'; g.fillRect(x, y, w, h);
  g.fillStyle = '#c73a2b'; g.fillRect(x, y + 6, w, 6);
  g.fillStyle = '#1f2a6b'; g.font = `24px ${HAND}`; g.textAlign = 'left'; g.fillText('M.E.G.  DO NOT TAPE OVER', x + 10, y + 44);
  [x, y, w, h] = PX.VHS_FRONT;
  g.fillStyle = '#121212'; g.fillRect(x, y, w, h);
  g.fillStyle = '#f4f1e6'; g.fillRect(x + 14, y + 10, w - 28, 50);
  g.fillStyle = '#c73a2b'; g.fillRect(x + 14, y + 16, w - 28, 4);
  g.fillStyle = '#1f2a6b'; g.font = `22px ${HAND}`; g.fillText('LVL 0  #?', x + 24, y + 48);
  g.fillStyle = '#2b2b2b'; g.fillRect(x + 50, y + 70, w - 100, 30);
  g.fillStyle = '#d8d8d8'; g.beginPath(); g.arc(x + 72, y + 85, 11, 0, Math.PI * 2); g.arc(x + w - 72, y + 85, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e6e6e6'; g.font = `800 12px ${SANS}`; g.fillText('VHS', x + 16, y + 102); g.fillText('T-120', x + w - 50, y + 102);

  // vending header: backlit brand banner
  [x, y, w, h] = PX.VEND_HEAD;
  gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#fbf6ea'); gr.addColorStop(1, '#efe4c8');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = '#2f5d8c'; g.fillRect(x, y, w, 10); g.fillRect(x, y + h - 10, w, 10);
  g.fillStyle = '#1d3f66'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 58px ${SANS}`; g.fillText('ALMOND WATER', x + w / 2, y + h / 2 - 6);
  g.fillStyle = '#b8321f'; g.font = `800 17px ${SANS}`; g.fillText('ICE COLD  ·  REFRESHINGLY SAFE', x + w / 2, y + h - 24);

  // radio dial scale
  [x, y, w, h] = PX.RADIO_DIAL;
  gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#e8c27c'); gr.addColorStop(1, '#d19d4d');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = '#2a1a0a'; g.font = `700 12px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const fm = [88, 92, 96, 100, 104, 108];
  fm.forEach((n, i) => g.fillText(String(n), x + 30 + i * 64, y + 22));
  const am = [54, 60, 70, 80, 100, 120, 160];
  am.forEach((n, i) => g.fillText(String(n), x + 26 + i * 55, y + 58));
  for (let i = 0; i <= 64; i++) g.fillRect(x + 20 + i * 5.4, y + 28, 1.5, i % 4 ? 6 : 12);
  g.fillStyle = '#b3190f'; g.fillRect(x + 210, y + 4, 4, h - 8);

  // vcr clock
  [x, y, w, h] = PX.VCR_CLOCK;
  g.fillStyle = '#06110a'; g.fillRect(x, y, w, h);
  g.fillStyle = '#5dff8a'; g.font = `700 40px "Courier New", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('12:00', x + w / 2, y + h / 2 + 2);

  // danger sticker (ansi style)
  [x, y, w, h] = PX.DANGER;
  g.fillStyle = '#f4f2ea'; g.fillRect(x, y, w, h);
  g.fillStyle = '#111'; g.fillRect(x, y, w, 52);
  g.fillStyle = '#d0201a'; roundRect(g, x + 22, y + 8, w - 44, 36, 18); g.fill();
  g.fillStyle = '#fff'; g.font = `900 26px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DANGER', x + w / 2, y + 27);
  g.fillStyle = '#111'; g.font = `900 22px ${SANS}`; g.fillText('HIGH VOLTAGE', x + w / 2, y + 80);
  g.font = `700 14px ${SANS}`; g.fillText('MAIN BREAKER · 480V', x + w / 2, y + 106);
  g.fillText('RESTORE POWER TO EXIT', x + w / 2, y + 128);
  g.fillStyle = '#f0b400'; g.beginPath(); g.moveTo(x + 18, y + 150); g.lineTo(x + 34, y + 120); g.lineTo(x + 50, y + 150); g.closePath(); g.fill();
  g.fillStyle = '#111'; g.font = `900 20px ${SANS}`; g.fillText('!', x + 34, y + 141);

  // exit call panel
  [x, y, w, h] = PX.CALL;
  gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#9c9d9c'); gr.addColorStop(0.5, '#c4c5c3'); gr.addColorStop(1, '#8f908f');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  for (let i = 0; i < h; i += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + ((i * 7) % 5) * 0.01})`; g.fillRect(x, y + i, w, 1); }
  g.fillStyle = '#2b2b2b'; g.font = `800 12px ${SANS}`; g.textAlign = 'center'; g.fillText('EXIT', x + w / 2, y + 20);
  for (const [cy, up] of [[y + 70, true], [y + 112, false]]) {
    g.fillStyle = '#6e6f6e'; g.beginPath(); g.arc(x + w / 2, cy, 20, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9dad8'; g.beginPath(); g.arc(x + w / 2, cy, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#333'; g.beginPath();
    if (up) { g.moveTo(x + w / 2, cy - 8); g.lineTo(x + w / 2 + 8, cy + 6); g.lineTo(x + w / 2 - 8, cy + 6); }
    else { g.moveTo(x + w / 2, cy + 8); g.lineTo(x + w / 2 + 8, cy - 6); g.lineTo(x + w / 2 - 8, cy - 6); }
    g.fill();
  }
  g.font = `700 9px ${SANS}`; g.fillText('LEVEL ?', x + w / 2, y + h - 12);

  // note: lined paper with a scrawl
  [x, y, w, h] = PX.NOTE;
  g.fillStyle = '#f3efe2'; g.fillRect(x, y, w, h);
  g.fillStyle = '#9fb7d8'; for (let i = 26; i < h; i += 14) g.fillRect(x, y + i, w, 1);
  g.fillStyle = '#d98f8f'; g.fillRect(x + 16, y, 1.5, h);
  g.fillStyle = '#23305c'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `15px ${HAND}`;
  ['they hear', 'the hum.', 'find 5 tapes', 'fix power', 'then EXIT', '     - M'].forEach((t, i) => g.fillText(t, x + 22, y + 38 + i * 14 + (i > 3 ? 4 : 0)));
  noise(g, x, y, w, h, 10, 3);

  // tag, white
  [x, y, w, h] = PX.TAG;
  g.fillStyle = '#e8e4d6'; g.fillRect(x, y, w, h);
  g.fillStyle = '#111'; g.font = `900 20px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MAIN', x + w / 2, y + 22);
  g.font = `700 13px ${SANS}`; g.fillText('480V', x + w / 2, y + 46);
  [x, y, w, h] = PX.WHITE;
  g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h);

  // hazard stripes
  [x, y, w, h] = PX.HAZARD;
  g.fillStyle = '#e8b400'; g.fillRect(x, y, w, h);
  g.fillStyle = '#161616';
  for (let i = -h; i < w; i += 64) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + 32, y + h); g.lineTo(x + i + 32 + h, y); g.lineTo(x + i + h, y); g.closePath(); g.fill(); }
  g.clearRect(x + w, y, 64, h);
  noise(g, x, y, w, h, 26, 5);

  // vending selection panel
  [x, y, w, h] = PX.VEND_PANEL;
  g.fillStyle = '#10182a'; g.fillRect(x, y, w, h);
  g.fillStyle = '#050608'; g.fillRect(x + 20, y + 22, w - 40, 40);
  g.fillStyle = '#ff4a2a'; g.font = `700 28px "Courier New", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('0.75', x + w / 2, y + 43);
  const keys = ['A', 'B', 'C', 'D', '1', '2', '3', '4', '5', '6', '7', '8'];
  keys.forEach((k, i) => {
    const kx = x + 22 + (i % 3) * 40, ky = y + 84 + Math.floor(i / 3) * 34;
    g.fillStyle = '#d8dadd'; roundRect(g, kx, ky, 34, 26, 4); g.fill();
    g.fillStyle = '#1a1a1a'; g.font = `800 14px ${SANS}`; g.fillText(k, kx + 17, ky + 14);
  });
  g.fillStyle = '#3a4252'; roundRect(g, x + 30, y + 236, w - 60, 44, 6); g.fill();
  g.fillStyle = '#050608'; g.fillRect(x + 44, y + 254, w - 88, 7);
  g.fillStyle = '#35d06a'; g.beginPath(); g.moveTo(x + w / 2 - 8, y + 292); g.lineTo(x + w / 2 + 8, y + 292); g.lineTo(x + w / 2, y + 302); g.fill();
  g.fillStyle = '#f39a2b'; g.font = `800 12px ${SANS}`; g.fillText('EXACT CHANGE ONLY', x + w / 2, y + 322);
  g.fillStyle = '#aeb4c0'; g.font = `600 10px ${SANS}`; g.fillText('NO REFUNDS IN LEVEL 0', x + w / 2, y + 342);
  g.fillStyle = '#050608'; g.fillRect(x + 56, y + 354, 48, 18);

  // vending back light: bright top, warm falloff
  [x, y, w, h] = PX.VEND_BACK;
  gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#f6f2e6'); gr.addColorStop(1, '#d9d1bb');
  g.fillStyle = gr; g.fillRect(x, y, w, h);

  // tv control strip
  [x, y, w, h] = PX.TV_STRIP;
  g.fillStyle = '#1b1b1c'; g.fillRect(x, y, w, h);
  g.fillStyle = '#6a6a6a'; g.font = `700 10px ${SANS}`; g.textAlign = 'center';
  ['POWER', 'CH ▲', 'CH ▼', 'VOL -', 'VOL +'].forEach((t, i) => {
    g.fillStyle = '#2d2d2e'; g.fillRect(x + 150 + i * 34, y + 14, 26, 14);
    g.fillStyle = '#7a7a7a'; g.fillText(t, x + 163 + i * 34, y + 40);
  });
  g.fillStyle = '#c9c9c9'; g.font = `italic 800 16px ${SANS}`; g.textAlign = 'left'; g.fillText('TRINIVISION', x + 14, y + 30);

  // knob face
  [x, y, w, h] = PX.KNOB;
  gr = g.createRadialGradient(x + 32, y + 32, 2, x + 32, y + 32, 32);
  gr.addColorStop(0, '#cfcfcf'); gr.addColorStop(1, '#7a7a7a');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}

export function createLabelTexture() {
  const c = document.createElement('canvas');
  c.width = S; c.height = SH;
  const g = c.getContext('2d', { willReadFrequently: true });
  drawLabels(g);
  drawV3(g);
  drawV4(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** paint the generated label art (public/assets/gen/labels) over the procedural ones once it loads */
export function upgradeLabels(tex, base = './assets/gen/labels/') {
  const g = tex.image.getContext('2d');
  const load = (f) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = base + f; });
  const loadV3 = (f) => load('../v3/' + f);
  const v4 = Promise.all([load('../v4/jukebox_front.webp'), load('../v4/jukebox_dome.webp')]).then(([front, dome]) => {
    if (front) { const [x, y, w, h] = PX.JUKE_FRONT; g.drawImage(front, x, y, w, h); }
    if (dome) { const [x, y, w, h] = PX.JUKE_DOME; g.drawImage(dome, x, y, w, h); }
    return !!(front || dome);
  });
  const v3 = Promise.all([loadV3('standee_chill_guy.webp'), loadV3('standee_chungus.webp'), loadV3('graffiti_trollface.webp')]).then(([chill, chungus, troll]) => {
    const fitIn = (im, r) => {
      const [x, y, w, h] = r;
      g.clearRect(x, y, w, h);
      const k = Math.min(w / im.width, h / im.height);
      g.drawImage(im, x + (w - im.width * k) / 2, y + (h - im.height * k), im.width * k, im.height * k);
    };
    if (chill) fitIn(chill, PX.CHILL);
    if (chungus) fitIn(chungus, PX.CHUNGUS);
    if (troll) fitIn(troll, PX.TROLL);
    return !!(chill || chungus || troll);
  });
  return Promise.all([load('almond_water_label.webp'), load('vhs_label.webp'), v3, v4]).then(([alm, vhs, any3, any4]) => {
    if (alm) {
      // centred 2:1 art with cream margins so the wrap is not stretched around the bottle
      const [x, y, w, h] = PX.ALMOND;
      g.fillStyle = '#fbf6ea'; g.fillRect(x, y, w, h);
      g.drawImage(alm, x + (w - h * 2) / 2, y, h * 2, h);
    }
    if (vhs) {
      let [x, y, w, h] = PX.VHS_FRONT;
      g.fillStyle = '#121212'; g.fillRect(x, y, w, h);
      g.drawImage(vhs, x + 10, y + 6, 116, 65);
      g.fillStyle = '#2b2b2b'; g.fillRect(x + 20, y + 78, 150, 26);
      g.fillStyle = '#d8d8d8'; g.beginPath(); g.arc(x + 48, y + 91, 9, 0, Math.PI * 2); g.arc(x + 142, y + 91, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e6e6e6'; g.font = `800 12px ${SANS}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('VHS', x + 136, y + 30); g.fillText('T-120', x + 134, y + 50);
      [x, y, w, h] = PX.VHS_SPINE;
      g.drawImage(vhs, 0, 0, 512, 170, x, y, w, h);
    }
    if (alm || vhs || any3 || any4) tex.needsUpdate = true;
    return !!(alm || vhs || any3 || any4);
  });
}

/** meme prop textures from the memes/UI agent (manifest.memeTextures) drawn over the matching atlas regions */
export function upgradeMemeTextures(tex, manifest, base = './assets/') {
  const mt = manifest && manifest.memeTextures;
  if (!mt) return Promise.resolve(false);
  const g = tex.image.getContext('2d');
  // key -> [region, background under alpha (null = keep transparent)]
  const MAP = { sign_ohio: ['OHIO', '#0b6b3a'], note_fanum_tax: ['FANUM', '#d9d8d2'], label_hydrate: ['PRYME_LABEL', '#0d2a5c'], sign_nerd: ['NERD', '#f2f0ea'], decal_sus: ['SUS', null] };
  const jobs = Object.entries(MAP).map(([key, [region, bg]]) => new Promise((res) => {
    const m = mt[key];
    if (!m || !m.image) return res(false);
    const im = new Image();
    im.onload = () => {
      const [x, y, w, h] = PX[region];
      g.clearRect(x, y, w, h);
      if (bg) { g.fillStyle = bg; g.fillRect(x, y, w, h); }
      g.drawImage(im, x, y, w, h);
      res(true);
    };
    im.onerror = () => res(false);
    im.src = base + m.image;
  }));
  return Promise.all(jobs).then((r) => { const any = r.some(Boolean); if (any) tex.needsUpdate = true; return any; });
}

// ---------------------------------------------------------------- v3 art

function pixelArt(g, x, y, size, rows, pal) {
  const n = rows.length, p = size / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = pal[rows[j][i]]; g.fillRect(x + i * p, y + j * p, p + 0.5, p + 0.5); }
}

// deterministic 16x16 minecraft-style grass/dirt tiles
function grassTiles() {
  let st = 11;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const top = [], side = [], dirt = [];
  for (let j = 0; j < 16; j++) {
    let t = '', sd = '', d = '';
    for (let i = 0; i < 16; i++) {
      t += 'abcd'[Math.floor(rnd() * 4)];
      d += 'efgh'[Math.floor(rnd() * 4)];
      const fringe = j < 3 || (j === 3 && rnd() < 0.6) || (j === 4 && rnd() < 0.25);
      sd += fringe ? 'abcd'[Math.floor(rnd() * 4)] : 'efgh'[Math.floor(rnd() * 4)];
    }
    top.push(t); side.push(sd); dirt.push(d);
  }
  return { top, side, dirt };
}
const GRASS_PAL = { a: '#5d9c3a', b: '#6aad45', c: '#528a33', d: '#79bb4e', e: '#866043', f: '#79553a', g: '#96704f', h: '#5f432c' };

function drawV3(g) {
  let [x, y, w, h] = PX.ELEVATOR;
  // elevator car seen through open doors: warm lit steel, handrail, light strip, floor
  let gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#b9b5ab'); gr.addColorStop(0.5, '#e9e5da'); gr.addColorStop(1, '#b3afa5');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  for (let i = 0; i < w; i += 3) { g.fillStyle = `rgba(0,0,0,${0.02 + ((i * 13) % 7) * 0.006})`; g.fillRect(x + i, y, 1, h); }
  g.fillStyle = '#fffbee'; g.fillRect(x, y, w, 26);
  g.fillStyle = '#d8d2c2'; g.fillRect(x, y + 26, w, 6);
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.strokeRect(x + 40, y + 60, w - 80, h - 130);
  g.fillStyle = '#8f8a80'; g.fillRect(x + 20, y + 178, w - 40, 10);
  g.fillStyle = '#6e6a62'; g.fillRect(x, y + h - 60, w, 60);
  g.fillStyle = '#58544d'; for (let i = 0; i < w; i += 16) g.fillRect(x + i, y + h - 60, 2, 60);

  // pryme hydration parody
  [x, y, w, h] = PX.PRYME_HEAD;
  gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#16b3ff'); gr.addColorStop(0.5, '#8b3dff'); gr.addColorStop(1, '#ff3d8b');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = '#ffffff'; g.font = `italic 900 64px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('PRYME', x + w / 2 - 60, y + h / 2 - 4);
  g.font = `800 20px ${SANS}`; g.fillText('HYDRATION', x + w / 2 + 130, y + h / 2 - 14); g.fillText('SOLD OUT IRL', x + w / 2 + 130, y + h / 2 + 14);
  [x, y, w, h] = PX.PRYME_LABEL;
  const cols = [['#19a7ff', '#0a4fd6'], ['#ff8a1c', '#ff3d3d'], ['#b93dff', '#ff3d9e'], ['#3dff9e', '#19a7ff']];
  for (let k = 0; k < 4; k++) {
    gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, cols[k][0]); gr.addColorStop(1, cols[k][1]);
    g.fillStyle = gr; g.fillRect(x + k * 80, y, 80, h);
    g.fillStyle = '#fff'; g.font = `italic 900 18px ${SANS}`; g.fillText('PRYME', x + k * 80 + 40, y + h / 2);
  }
  [x, y, w, h] = PX.PRYME_PANEL;
  g.fillStyle = '#141018'; g.fillRect(x, y, w, h);
  g.fillStyle = '#ff3d8b'; g.font = `800 16px ${SANS}`; g.fillText('$9.99 EACH', x + w / 2, y + 30);
  g.fillStyle = '#9ad'; g.font = `600 11px ${SANS}`; g.fillText('limit 1 per influencer', x + w / 2, y + 56);
  g.fillStyle = '#ff3d3d'; g.font = `900 22px ${SANS}`; g.fillText('SOLD OUT', x + w / 2, y + 94);

  // SUS graffiti with a crewmate tag (transparent background)
  [x, y, w, h] = PX.SUS;
  g.clearRect(x, y, w, h);
  g.fillStyle = '#d4161b'; g.font = `900 92px Impact, ${SANS}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.save(); g.translate(x + 14, y + 112); g.rotate(-0.08); g.fillText('SUS', 0, 0); g.restore();
  for (const [dx, len] of [[30, 26], [58, 14], [96, 30], [132, 18], [168, 22]]) { g.fillRect(x + dx, y + 104 + dx * -0.08, 4, len); g.beginPath(); g.arc(x + dx + 2, y + 104 + len + dx * -0.08, 3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#d4161b';
  g.beginPath(); g.ellipse(x + 212, y + 70, 24, 34, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(x + 188, y + 70, 48, 44); g.fillRect(x + 180, y + 58, 12, 36);
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(x + 201, y + 108, 10, 14);
  g.fillStyle = '#8fd3ff'; g.beginPath(); g.ellipse(x + 220, y + 60, 16, 10, 0, 0, Math.PI * 2); g.fill();

  // nerd emoji sign
  [x, y, w, h] = PX.NERD;
  g.fillStyle = '#f2f0ea'; g.fillRect(x, y, w, h);
  g.fillStyle = '#1b1b1b'; g.fillRect(x + 6, y + 6, w - 12, h - 12);
  g.fillStyle = '#f2f0ea'; g.fillRect(x + 12, y + 12, w - 24, h - 24);
  const cx = x + w / 2, cy = y + h / 2 - 10;
  g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(cx, cy, 86, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 9;
  g.beginPath(); g.arc(cx - 34, cy - 12, 26, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx + 34, cy - 12, 26, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - 8, cy - 14); g.lineTo(cx + 8, cy - 14); g.stroke();
  g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(cx - 34, cy - 10, 8, 0, Math.PI * 2); g.arc(cx + 34, cy - 10, 8, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.beginPath(); g.arc(cx, cy + 26, 34, 0.25, Math.PI - 0.25); g.stroke();
  g.fillStyle = '#fff'; g.fillRect(cx - 14, cy + 52, 13, 18); g.fillRect(cx + 1, cy + 52, 13, 18);
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 3; g.strokeRect(cx - 14, cy + 52, 13, 18); g.strokeRect(cx + 1, cy + 52, 13, 18);
  g.fillStyle = '#1b1b1b'; g.font = `900 22px ${SANS}`; g.textAlign = 'center'; g.fillText('ACKCHYUALLY', cx, y + h - 22);

  // ONLY IN OHIO highway sign
  [x, y, w, h] = PX.OHIO;
  g.fillStyle = '#0b6b3a'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#f4f4f0'; g.lineWidth = 8; roundRect(g, x + 10, y + 10, w - 20, h - 20, 18); g.stroke();
  g.fillStyle = '#f4f4f0'; g.font = `700 76px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ONLY IN', x + w / 2, y + 66); g.fillText('OHIO', x + w / 2, y + 144);
  g.font = `700 22px ${SANS}`; g.textAlign = 'right'; g.fillText('EXIT 0  ↗', x + w - 34, y + h - 30);

  // FANUM TAX fridge note
  [x, y, w, h] = PX.FANUM;
  g.fillStyle = '#fff27a'; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x, y, w, 14);
  g.fillStyle = '#1b2a6b'; g.font = `26px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('FANUM', x + w / 2, y + 50); g.fillText('TAX', x + w / 2, y + 80);
  g.font = `14px ${HAND}`; g.fillText('(ate ur lunch)', x + w / 2, y + 108);
  g.fillStyle = '#d4161b'; g.beginPath(); g.arc(x + w / 2, y + 12, 9, 0, Math.PI * 2); g.fill();

  // wet floor sign face
  [x, y, w, h] = PX.WET;
  g.fillStyle = '#f2c500'; g.fillRect(x, y, w, h);
  g.fillStyle = '#141414'; g.beginPath(); g.moveTo(x + 64, y + 12); g.lineTo(x + 104, y + 72); g.lineTo(x + 24, y + 72); g.closePath(); g.fill();
  g.fillStyle = '#f2c500'; g.font = `900 38px ${SANS}`; g.textAlign = 'center'; g.fillText('!', x + 64, y + 66);
  g.fillStyle = '#141414'; g.font = `900 18px ${SANS}`; g.fillText('CAUTION', x + 64, y + 96); g.font = `800 13px ${SANS}`; g.fillText('WET FLOOR', x + 64, y + 116);

  // swamp sign (cutout: rough cardboard with alpha)
  [x, y, w, h] = PX.SWAMP;
  g.clearRect(x, y, w, h);
  g.fillStyle = '#b08a5a';
  g.beginPath(); g.moveTo(x + 10, y + 20); g.lineTo(x + w - 14, y + 8); g.lineTo(x + w - 6, y + 250); g.lineTo(x + w / 2 + 16, y + 262); g.lineTo(x + w / 2 + 12, y + h); g.lineTo(x + w / 2 - 12, y + h); g.lineTo(x + w / 2 - 14, y + 262); g.lineTo(x + 4, y + 256); g.closePath(); g.fill();
  noise(g, x, y, w, 270, 16, 9);
  g.fillStyle = '#2d5a17'; g.font = `42px ${HAND}`; g.textAlign = 'center';
  g.save(); g.translate(x + w / 2, y + 70); g.rotate(-0.04); g.fillText('GET OUT OF', 0, 0); g.fillText('MY SWAMP', 0, 50); g.restore();
  g.fillStyle = '#e9e3c6'; g.beginPath(); g.ellipse(x + w / 2, y + 196, 30, 34, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#9a8a5a'; g.lineWidth = 2; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + w / 2 + k * 8, y + 164); g.quadraticCurveTo(x + w / 2 + k * 14, y + 196, x + w / 2 + k * 8, y + 228); g.stroke(); }
  g.fillStyle = '#4f8a2a'; g.beginPath(); g.moveTo(x + w / 2 - 6, y + 164); g.lineTo(x + w / 2, y + 130); g.lineTo(x + w / 2 + 6, y + 164); g.fill();
  g.fillStyle = '#3a2a18'; g.font = `18px ${HAND}`; g.fillText('onions have layers', x + w / 2, y + 246);

  // timesheets
  for (const [key, signed] of [['TIMESHEET', false], ['TIMESHEET_SIGNED', true]]) {
    [x, y, w, h] = PX[key];
    g.fillStyle = '#f4f2ea'; g.fillRect(x, y, w, h);
    g.fillStyle = '#1b1b1b'; g.font = `800 15px ${SANS}`; g.textAlign = 'left'; g.fillText('TIMESHEET', x + 12, y + 24);
    g.font = `600 9px ${SANS}`; g.fillText('WEEK: FOREVER   HOURS: YES', x + 12, y + 40);
    g.strokeStyle = '#9fb7d8'; g.lineWidth = 1;
    for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(x + 10, y + 56 + k * 16); g.lineTo(x + w - 10, y + 56 + k * 16); g.stroke(); }
    g.fillStyle = '#23305c'; g.font = `12px ${HAND}`;
    ['mon  8h  stared', 'tue  8h  walked', 'wed  8h  hummed', 'thu  ??', 'fri  ????'].forEach((t, i) => g.fillText(t, x + 14, y + 52 + i * 16));
    g.fillStyle = '#1b1b1b'; g.font = `600 9px ${SANS}`; g.fillText('SIGNATURE:', x + 12, y + h - 18);
    if (signed) { g.strokeStyle = '#1b2a8b'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x + 70, y + h - 16); g.bezierCurveTo(x + 84, y + h - 40, x + 92, y + h - 4, x + 104, y + h - 24); g.bezierCurveTo(x + 112, y + h - 34, x + 120, y + h - 10, x + 146, y + h - 22); g.stroke(); }
  }

  // card reader face
  [x, y, w, h] = PX.CARD;
  g.fillStyle = '#1a1b1e'; g.fillRect(x, y, w, h);
  g.fillStyle = '#2b2d33'; roundRect(g, x + 12, y + 14, w - 24, 56, 6); g.fill();
  g.fillStyle = '#c9ccd2'; g.font = `700 10px ${SANS}`; g.textAlign = 'center'; g.fillText('SWIPE', x + w / 2, y + 38); g.fillText('BADGE', x + w / 2, y + 52);
  g.fillStyle = '#050506'; g.fillRect(x + w - 18, y + 8, 6, h - 40);
  for (let k = 0; k < 9; k++) { g.fillStyle = '#3a3c44'; g.fillRect(x + 14 + (k % 3) * 22, y + 84 + Math.floor(k / 3) * 20, 18, 14); }
  g.fillStyle = '#6b6e76'; g.font = `600 8px ${SANS}`; g.fillText('M.E.G. ACCESS', x + w / 2, y + h - 8);

  // copier panel
  [x, y, w, h] = PX.COPIER;
  g.fillStyle = '#3d3f44'; g.fillRect(x, y, w, h);
  g.fillStyle = '#9fd4a8'; g.fillRect(x + 12, y + 14, 96, 44);
  g.fillStyle = '#1d3a22'; g.font = `700 12px "Courier New", monospace`; g.textAlign = 'left'; g.fillText('PC LOAD', x + 20, y + 32); g.fillText('LETTER', x + 20, y + 48);
  for (let k = 0; k < 12; k++) { g.fillStyle = '#d8d9dc'; g.fillRect(x + 124 + (k % 4) * 26, y + 12 + Math.floor(k / 4) * 22, 20, 16); }
  g.fillStyle = '#2fa84f'; roundRect(g, x + 124, y + 78 - 12, 96, 14, 5); g.fill();

  // microwave panel
  [x, y, w, h] = PX.MICRO;
  g.fillStyle = '#26272a'; g.fillRect(x, y, w, h);
  g.fillStyle = '#0a1a10'; g.fillRect(x + 140, y + 12, 104, 30);
  g.fillStyle = '#4dff7a'; g.font = `700 22px "Courier New", monospace`; g.textAlign = 'center'; g.fillText('0:00', x + 192, y + 35);
  for (let k = 0; k < 12; k++) { g.fillStyle = '#5a5c61'; g.fillRect(x + 146 + (k % 3) * 32, y + 50 + Math.floor(k / 3) * 18, 26, 13); }
  g.fillStyle = '#111'; g.fillRect(x + 8, y + 8, 124, h - 16);

  // 1u server faceplate
  [x, y, w, h] = PX.RACKU;
  g.fillStyle = '#1b1c1f'; g.fillRect(x, y, w, h);
  for (let i = 0; i < 40; i++) { g.fillStyle = '#0b0b0c'; g.fillRect(x + 60 + i * 4, y + 10, 2, h - 20); }
  g.fillStyle = '#3a3b40'; g.fillRect(x + 8, y + 12, 40, h - 24);
  g.fillStyle = '#8a8c92'; g.font = `700 9px ${SANS}`; g.textAlign = 'left'; g.fillText('NOCLIP-SRV', x + 10, y + 36);
  for (let k = 0; k < 4; k++) { g.fillStyle = '#26282c'; g.fillRect(x + 222, y + 8 + k * 13, 26, 10); }

  // minecraft grass block tiles
  const t = grassTiles();
  pixelArt(g, ...PX.GRASS_TOP.slice(0, 2), 128, t.top, GRASS_PAL);
  pixelArt(g, ...PX.GRASS_SIDE.slice(0, 2), 128, t.side, GRASS_PAL);
  pixelArt(g, ...PX.DIRT.slice(0, 2), 128, t.dirt, GRASS_PAL);

  // planter sign, statue plaque
  [x, y, w, h] = PX.TOUCH;
  g.fillStyle = '#f4f1e6'; g.fillRect(x, y, w, h);
  g.fillStyle = '#2d6a1f'; g.font = `900 30px ${SANS}`; g.textAlign = 'center'; g.fillText('PLEASE', x + w / 2, y + 38); g.fillText('TOUCH GRASS', x + w / 2, y + 72);
  g.fillStyle = '#6b6b6b'; g.font = `600 11px ${SANS}`; g.fillText('mandatory wellness program', x + w / 2, y + 90);
  [x, y, w, h] = PX.PLAQUE;
  gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#c9a24a'); gr.addColorStop(1, '#8a6a22');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = '#2b1e08'; g.font = `800 18px Georgia, serif`; g.fillText('DOGE', x + w / 2, y + 26); g.font = `italic 13px Georgia, serif`; g.fillText('much statue. very gold.', x + w / 2, y + 48);

  // restroom mirror: soft reflected room (ceiling with a panel, yellow wall, beige floor)
  [x, y, w, h] = PX.MIRROR;
  gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#e9e4c9'); gr.addColorStop(0.28, '#dcd49c'); gr.addColorStop(0.32, '#c9b54a');
  gr.addColorStop(0.8, '#bda846'); gr.addColorStop(0.84, '#b8ad86'); gr.addColorStop(1, '#a89f7c');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,245,0.85)'; g.fillRect(x + 20, y + 6, 50, 14);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x + 10, y + h); g.lineTo(x + 40, y); g.lineTo(x + 56, y); g.lineTo(x + 26, y + h); g.fill();

  // regions filled at load (standees, trollface) start transparent
  for (const k of ['CHILL', 'CHUNGUS', 'TROLL']) g.clearRect(...PX[k]);
}

// ---------------------------------------------------------------- placeholder atlases

const POSTERS = [
  { bg: '#e9e4d4', ink: '#222', title: 'HANG IN THERE', sub: 'only 600 million sq mi to go', art: 'cat' },
  { bg: '#f2c230', ink: '#141414', title: 'NOCLIP', sub: 'RESPONSIBLY', art: 'fall' },
  { bg: '#eae8e2', ink: '#1a2a55', title: 'EMPLOYEE OF THE MONTH', sub: 'every month since 1996', art: 'face' },
  { bg: '#2f5d8c', ink: '#f4efe0', title: 'STAY HYDRATED', sub: 'almond water: probably fine', art: 'bottle' },
  { bg: '#f4f1e8', ink: '#b3261e', title: 'HAVE YOU SEEN THIS HUM?', sub: 'last heard: everywhere', art: 'wave' },
  { bg: '#b3261e', ink: '#f4efe0', title: 'M.E.G. WANTS YOU', sub: 'to stop touching the walls', art: 'point' },
  { bg: '#f0d23a', ink: '#141414', title: 'CAUTION', sub: 'wet carpet. do not ask why.', art: 'sign' },
  { bg: '#1d1d1f', ink: '#f2f2f2', title: 'IT IS FINE', sub: 'this is fine. you are fine.', art: 'dog' },
];

function drawPosterArt(g, p, x, y, w, h) {
  g.save();
  g.fillStyle = p.ink; g.strokeStyle = p.ink; g.lineWidth = 6; g.lineCap = 'round';
  const cx = x + w / 2, cy = y + h * 0.45;
  if (p.art === 'cat') {
    g.beginPath(); g.moveTo(x + 20, y + 40); g.lineTo(x + w - 20, y + 40); g.stroke();
    g.beginPath(); g.moveTo(cx - 10, y + 40); g.lineTo(cx - 14, cy - 30); g.moveTo(cx + 10, y + 40); g.lineTo(cx + 14, cy - 30); g.stroke();
    g.beginPath(); g.ellipse(cx, cy + 20, 40, 60, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy - 40, 30, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx - 28, cy - 52); g.lineTo(cx - 20, cy - 84); g.lineTo(cx - 6, cy - 64); g.moveTo(cx + 28, cy - 52); g.lineTo(cx + 20, cy - 84); g.lineTo(cx + 6, cy - 64); g.fill();
  } else if (p.art === 'fall') {
    for (let i = 0; i < 5; i++) g.fillRect(x + 20, cy + 30 + i * 14, w - 40, 5);
    g.beginPath(); g.arc(cx, cy - 60, 16, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx, cy - 44); g.lineTo(cx, cy + 10); g.moveTo(cx - 34, cy - 50); g.lineTo(cx, cy - 26); g.lineTo(cx + 34, cy - 50);
    g.moveTo(cx, cy + 10); g.lineTo(cx - 22, cy + 50); g.moveTo(cx, cy + 10); g.lineTo(cx + 22, cy + 50); g.stroke();
  } else if (p.art === 'face' || p.art === 'dog') {
    g.fillStyle = p.art === 'dog' ? '#c98b3c' : '#d9d2c2'; g.fillRect(cx - 70, cy - 90, 140, 160);
    g.fillStyle = p.ink; g.beginPath(); g.arc(cx - 26, cy - 20, 9, 0, Math.PI * 2); g.arc(cx + 26, cy - 20, 9, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy + 16, 30, 0.2, Math.PI - 0.2); g.stroke();
    if (p.art === 'dog') { g.fillStyle = '#e8541c'; g.beginPath(); g.moveTo(cx - 90, cy + 90); g.quadraticCurveTo(cx - 60, cy + 10, cx - 30, cy + 90); g.quadraticCurveTo(cx, cy + 20, cx + 40, cy + 90); g.quadraticCurveTo(cx + 70, cy + 30, cx + 90, cy + 90); g.fill(); }
  } else if (p.art === 'bottle') {
    g.fillStyle = '#f1e8d2'; g.fillRect(cx - 34, cy - 50, 68, 130); g.fillRect(cx - 14, cy - 80, 28, 30);
    g.fillStyle = '#e9e4d4'; g.fillRect(cx - 16, cy - 96, 32, 18);
    g.fillStyle = '#6b4424'; g.beginPath(); g.ellipse(cx, cy + 14, 14, 22, 0.4, 0, Math.PI * 2); g.fill();
  } else if (p.art === 'wave') {
    g.beginPath();
    for (let i = 0; i <= 60; i++) { const px = x + 20 + (i / 60) * (w - 40); const py = cy + Math.sin(i * 0.9) * (20 + (i % 7) * 5); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
  } else if (p.art === 'point') {
    g.beginPath(); g.arc(cx, cy - 40, 34, 0, Math.PI * 2); g.fill();
    g.fillRect(cx - 50, cy, 100, 110);
    g.fillRect(cx - 12, cy + 20, 24, 60);
    g.beginPath(); g.arc(cx, cy + 10, 22, 0, Math.PI * 2); g.fill();
  } else {
    g.beginPath(); g.moveTo(cx, cy - 90); g.lineTo(cx + 70, cy + 60); g.lineTo(cx - 70, cy + 60); g.closePath(); g.lineWidth = 10; g.stroke();
    g.font = `900 90px ${SANS}`; g.textAlign = 'center'; g.fillText('!', cx, cy + 46);
  }
  g.restore();
}

export function createPosterPlaceholder() {
  const cols = 4, rows = 2, cw = 256, ch = 384;
  const c = document.createElement('canvas');
  c.width = cols * cw; c.height = rows * ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  POSTERS.forEach((p, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    g.fillStyle = p.bg; g.fillRect(x, y, cw, ch);
    g.strokeStyle = p.ink; g.lineWidth = 4; g.strokeRect(x + 12, y + 12, cw - 24, ch - 24);
    drawPosterArt(g, p, x + 12, y + 30, cw - 24, ch - 150);
    g.fillStyle = p.ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    fit(g, p.title, `900 {s}px ${SANS}`, 36, cw - 44);
    g.fillText(p.title, x + cw / 2, y + ch - 76);
    fit(g, p.sub, `600 {s}px ${SANS}`, 16, cw - 44);
    g.fillText(p.sub, x + cw / 2, y + ch - 44);
    noise(g, x, y, cw, ch, 14, i + 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return { tex: t, cols, rows, n: POSTERS.length };
}

export function createTvPlaceholder() {
  const cols = 4, rows = 2, cw = 256, ch = 192;
  const c = document.createElement('canvas');
  c.width = cols * cw; c.height = rows * ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  const cell = (i) => [(i % cols) * cw, Math.floor(i / cols) * ch];
  let [x, y] = cell(0);
  ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { g.fillStyle = col; g.fillRect(x + (i * cw) / 7, y, cw / 7 + 1, ch * 0.72); });
  g.fillStyle = '#101010'; g.fillRect(x, y + ch * 0.72, cw, ch * 0.28);
  g.fillStyle = '#f0f0f0'; g.fillRect(x + 20, y + ch * 0.78, 60, 30);
  [x, y] = cell(1);
  g.fillStyle = '#1834b8'; g.fillRect(x, y, cw, ch);
  g.fillStyle = '#e8ecff'; g.font = `700 26px "Courier New", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NO SIGNAL', x + cw / 2, y + ch / 2);
  g.textAlign = 'left'; g.font = `700 16px "Courier New", monospace`; g.fillText('AV 1', x + 14, y + 20);
  [x, y] = cell(2);
  g.fillStyle = '#222'; g.fillRect(x, y, cw, ch);
  g.fillStyle = '#e8e3c9'; g.beginPath(); g.arc(x + cw / 2, y + ch / 2, 70, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#222'; g.font = `800 20px ${SANS}`; g.textAlign = 'center'; g.fillText('PLEASE', x + cw / 2, y + ch / 2 - 12); g.fillText('STAND BY', x + cw / 2, y + ch / 2 + 14);
  [x, y] = cell(3);
  g.fillStyle = '#7a0d0d'; g.fillRect(x, y, cw, ch);
  g.fillStyle = '#fff'; g.font = `900 22px ${SANS}`; g.fillText('M.E.G.', x + cw / 2, y + 50);
  g.font = `800 15px ${SANS}`; g.fillText('EMERGENCY BROADCAST', x + cw / 2, y + 84);
  g.font = `600 12px ${SANS}`; g.fillText('find the tapes. restore power.', x + cw / 2, y + 120); g.fillText('do not respond to the hum.', x + cw / 2, y + 140);
  [x, y] = cell(4);
  g.fillStyle = '#0c0c0c'; g.fillRect(x, y, cw, ch);
  g.fillStyle = '#f2f2f2'; g.font = `800 18px ${SANS}`; g.fillText("DON'T LOOK", x + cw / 2, y + ch / 2 - 12); g.fillText('BEHIND YOU', x + cw / 2, y + ch / 2 + 14);
  [x, y] = cell(5);
  const img = g.createImageData(cw, ch);
  let st = 7;
  for (let i = 0; i < img.data.length; i += 4) { st = (st * 9301 + 49297) % 233280; const v = (st / 233280) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, x, y);
  [x, y] = cell(6);
  g.fillStyle = '#2a6b3a'; g.fillRect(x, y, cw, ch);
  g.fillStyle = '#e8f5e9'; g.font = `800 16px ${SANS}`; g.fillText('LEVEL 0 WEATHER', x + cw / 2, y + 40);
  g.font = `900 42px ${SANS}`; g.fillText('23°C', x + cw / 2, y + 96);
  g.font = `600 14px ${SANS}`; g.fillText('humid. buzzing. forever.', x + cw / 2, y + 140);
  [x, y] = cell(7);
  g.fillStyle = '#e8d96a'; g.fillRect(x, y, cw, ch);
  g.fillStyle = '#1a1a1a'; g.font = `900 30px ${SANS}`; g.fillText('WE ARE', x + cw / 2, y + 70); g.fillText('LIVE', x + cw / 2, y + 110);
  g.fillStyle = '#d0201a'; g.beginPath(); g.arc(x + 30, y + 30, 8, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return { tex: t, cols, rows, n: 8 };
}

// ---------------------------------------------------------------- v4 art (stand-ins until the generated art loads)

function drawV4(g) {
  let [x, y, w, h] = PX.JUKE_FRONT;
  g.fillStyle = '#2a0c36'; g.fillRect(x, y, w, h);
  g.fillStyle = '#c9cdd3'; g.fillRect(x + 8, y + 8, w - 16, 64);
  g.fillStyle = '#3b0f52'; g.fillRect(x + 14, y + 14, w - 28, 52);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 34px ${SANS}`;
  g.fillStyle = '#ff5fc8'; g.fillText('SIGMA', x + w * 0.34, y + 41);
  g.fillStyle = '#5ff4ff'; g.fillText('BOY', x + w * 0.76, y + 41);
  for (let i = 0; i < 8; i++) { g.fillStyle = '#efe6cf'; g.fillRect(x + 20 + i * 28, y + 84, 22, 26); g.fillStyle = '#b3122e'; g.fillRect(x + 24 + i * 28, y + 87, 14, 6); }
  const gx = x + 16, gy = y + 124, gw = w - 32, gh = h - 140;
  g.fillStyle = '#b0206f'; g.fillRect(gx, gy, gw, gh);
  g.fillStyle = '#138a8a'; for (let i = 0; i < 6; i += 2) g.fillRect(gx + (i * gw) / 6, gy, gw / 6, gh);
  g.strokeStyle = '#d9dde2'; g.lineWidth = 4;
  for (let i = -gh; i < gw; i += 26) { g.beginPath(); g.moveTo(gx + i, gy); g.lineTo(gx + i + gh, gy + gh); g.moveTo(gx + i + gh, gy); g.lineTo(gx + i, gy + gh); g.stroke(); }
  g.strokeRect(gx, gy, gw, gh);
  [x, y, w, h] = PX.JUKE_DOME;
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#ffcf6a'); gr.addColorStop(1, '#8a4a10');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  const labels = ['#ff3b3b', '#2ec4d6', '#ffd23b', '#ff66b3', '#44d15a', '#ff8a2a'];
  for (let i = 0; i < 11; i++) {
    const cx = x + 30 + i * 36, cy = y + h * 0.45;
    g.fillStyle = '#101010'; g.beginPath(); g.ellipse(cx, cy, 16, 60, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = labels[i % labels.length]; g.beginPath(); g.ellipse(cx, cy, 6, 20, 0, 0, Math.PI * 2); g.fill();
  }
  const tubes = ['#ff3355', '#ff9a2a', '#ffe23a', '#43e06a', '#4a8cff', '#b36bff'];
  for (let i = 0; i < 12; i++) { g.fillStyle = tubes[i % 6]; g.fillRect(x + 6 + i * 34.5, y + h - 42, 28, 38); }
}
