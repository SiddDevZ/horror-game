// minecraft-style pixel hearts, top right. drawn into one small canvas and only redrawn on change
// (or at ~12 hz while low health makes them jiggle).
const PX = 3; // screen pixels per art pixel
const W = 9, H = 8, GAP = 1;

// K outline, R red, D shade, W highlight, . clear
const ART = [
  '.KK...KK.',
  'KWRK.KRRK',
  'KWRRKRRRK',
  'KRRRRRRDK',
  '.KRRRRDK.',
  '..KRRDK..',
  '...KDK...',
  '....K....',
];
const FULL = { K: '#1b0707', R: '#e0231c', D: '#951512', W: '#ffd9d2' };
const EMPTY = { K: '#1b0707', R: '#3b1714', D: '#2c100e', W: '#4a1e1a' };
const FLASH = { K: '#ffffff', R: '#3b1714', D: '#2c100e', W: '#4a1e1a' };

export class HeartsHud {
  constructor(parent, count = 8) {
    this.count = count;
    this.hp = count * 2;
    this.flashT = 0;
    this.healT = 0;
    this.jiggleT = 0;
    this.seed = 1;
    this.hopK = -1; // party: the heart that is up in the regen-style wave (-1 none)
    const c = (this.canvas = document.createElement('canvas'));
    c.className = 'hearts';
    c.width = count * (W + GAP) - GAP;
    c.height = H + 2; // room for the jiggle
    c.style.width = `${c.width * PX}px`;
    c.style.height = `${c.height * PX}px`;
    c.setAttribute('role', 'img');
    this.g = c.getContext('2d');
    parent.appendChild(c);
    this.draw();
  }

  set(hp, delta = 0) {
    this.hp = Math.max(0, Math.min(this.count * 2, hp));
    if (delta < 0) this.flashT = 0.6;
    if (delta > 0) this.healT = 0.5;
    this.canvas.setAttribute('aria-label', `${this.hp / 2} of ${this.count} hearts`);
    this.draw();
  }

  /** party beat wave: heart k pops up one pixel (minecraft regeneration style); redraws only on change */
  hop(k) {
    if (k === this.hopK) return;
    this.hopK = k;
    this.draw();
  }

  update(dt) {
    const low = this.hp > 0 && this.hp <= 4;
    if (this.flashT > 0 || this.healT > 0 || low) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.healT = Math.max(0, this.healT - dt);
      this.jiggleT += dt;
      if (this.jiggleT >= 1 / 12) {
        this.jiggleT = 0;
        this.seed = (this.seed * 16807) % 2147483647;
        this.draw();
      }
    }
  }

  draw() {
    const g = this.g, low = this.hp > 0 && this.hp <= 4;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let s = this.seed;
    for (let i = 0; i < this.count; i++) {
      const units = this.hp - i * 2; // 2 full, 1 half, <=0 empty
      s = (s * 16807) % 2147483647;
      const dy = i === this.hopK || ((low || this.flashT > 0) && s % 3 === 0) ? 0 : 1;
      const ox = i * (W + GAP);
      const flash = this.flashT > 0 && Math.floor(this.flashT * 10) % 2 === 0;
      const heal = this.healT > 0 && Math.floor(this.healT * 10) % 2 === 0;
      for (let y = 0; y < H; y++) {
        const row = ART[y];
        for (let x = 0; x < W; x++) {
          const k = row[x];
          if (k === '.') continue;
          const filled = units >= 2 || (units === 1 && x < 4);
          const pal = filled ? FULL : flash ? FLASH : EMPTY;
          g.fillStyle = heal && k === 'K' ? '#fff3a8' : pal[k];
          g.fillRect(ox + x, y + dy, 1, 1);
        }
      }
    }
  }
}
