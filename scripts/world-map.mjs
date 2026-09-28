// top-down map of a world region, for eyeballing layout variety.
// usage: node scripts/world-map.mjs [--seed=1] [--cx=-4] [--cz=-4] [--w=10] [--h=10] [--px=3] [--ascii] [--lights=0]
//        [--reserve=breaker@3,2+exit@-4,1] [--out=name]
// colours: walls brown, columns near-black, doors rust, prop footprints orange, lights white (flicker pink, off grey);
// marks: poster hot pink, vending deep blue, tv mint, radio lime, table brown, breaker magenta (big), exitDoor green (big),
// recovery green outline, cooler blue, phone red, vent cyan, sign purple, exitSign green, darkTile black,
// v3: task red-orange (big), meme violet (big), counter/fridge/sink grey-blue. v4: jukebox gold (big).
// writes shots/world/map-<seed>.png (no deps: png via node:zlib)
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World.js';
import { CHUNK_CELLS, CELL, CELL_TYPE, ZONE } from '../src/world/constants.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const seed = Number(args.seed ?? 1);
const W = Number(args.w ?? 10), H = Number(args.h ?? 10);
const cx0 = Number(args.cx ?? -Math.floor(W / 2) + 1), cz0 = Number(args.cz ?? -Math.floor(H / 2));
const PX = Number(args.px ?? 3);
const world = new World(seed);
for (const r of (args.reserve || '').split('+').filter(Boolean)) {
  const [type, at] = r.split('@');
  const [rx, rz] = at.split(',').map(Number);
  console.log(`reserve ${type} @ ${rx},${rz}: ${world.reserveLandmark(rx, rz, type)}`);
}

const ZC = { [ZONE.OFFICE]: [222, 206, 120], [ZONE.MAINT]: [170, 172, 168], [ZONE.WET]: [176, 196, 150], [ZONE.DARK]: [120, 110, 60] };
const C = { wall: [70, 52, 30], column: [30, 22, 12], door: [180, 70, 30], prop: [210, 120, 40], light: [255, 255, 255], lightOff: [90, 90, 90], flicker: [255, 80, 200], seam: [0, 0, 0] };
const FC = {
  recovery: [40, 200, 90], cooler: [40, 120, 255], phone: [255, 0, 0], vent: [0, 200, 200], sign: [150, 0, 200], exitSign: [0, 255, 0], darkTile: [0, 0, 0], puddle: [60, 140, 220], stain: [120, 90, 40],
  poster: [255, 40, 160], vending: [0, 50, 210], tv: [0, 255, 170], radio: [190, 255, 0], table: [150, 70, 10], breaker: [255, 0, 255], exitDoor: [0, 230, 0],
  task: [255, 50, 0], meme: [120, 0, 255], counter: [90, 110, 150], fridge: [90, 110, 150], sink: [90, 110, 150], jukebox: [255, 200, 0],
};
const BIG = { breaker: 3, exitDoor: 4, vending: 2, task: 2, meme: 2, jukebox: 3 };

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const cw = W * CHUNK_CELLS, ch = H * CHUNK_CELLS;
const iw = cw * PX, ih = ch * PX;
const img = Buffer.alloc(iw * ih * 3);
const put = (x, y, c) => { if (x < 0 || y < 0 || x >= iw || y >= ih) return; const o = (y * iw + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
const fillCell = (gx, gz, c) => { for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) put(gx * PX + x, gz * PX + y, c); };
const ascii = [];
const count = { chunks: 0, zones: [0, 0, 0, 0], kinds: {}, features: {}, doors: 0, fixtures: 0 };

for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const c = world.getChunk(cx0 + i, cz0 + j);
    count.chunks++;
    count.zones[c.zone[0]]++;
    count.kinds[c.kind] = (count.kinds[c.kind] || 0) + 1;
    count.doors += c.doors.length;
    count.fixtures += c.fixtures.length;
    for (const f of c.features) {
      const k = f.type === 'task' || f.type === 'meme' ? `${f.type}:${f.data.kind}` : f.type;
      count.features[k] = (count.features[k] || 0) + 1;
    }
    for (let lz = 0; lz < CHUNK_CELLS; lz++) {
      for (let lx = 0; lx < CHUNK_CELLS; lx++) {
        const k = lz * CHUNK_CELLS + lx, t = c.cells[k];
        const col = t === CELL_TYPE.WALL ? C.wall : t === CELL_TYPE.COLUMN ? C.column : t === CELL_TYPE.DOOR ? C.door : c.prop[k] ? C.prop : ZC[c.zone[k]];
        fillCell(i * CHUNK_CELLS + lx, j * CHUNK_CELLS + lz, col);
      }
    }
  }
}
// overlays: fixtures and features as small marks, seams as dots
const toPx = (x, z) => [Math.round((x / CELL - cx0 * CHUNK_CELLS) * PX), Math.round((z / CELL - cz0 * CHUNK_CELLS) * PX)];
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const c = world.getChunk(cx0 + i, cz0 + j);
  if (args.lights !== '0') for (const f of c.fixtures) {
    const [a, b] = toPx(f.x - f.sx / 2, f.z - f.sz / 2), [e, d] = toPx(f.x + f.sx / 2, f.z + f.sz / 2);
    for (let y = b; y < Math.max(d, b + 1); y++) for (let x = a; x < Math.max(e, a + 1); x++) put(x, y, f.flicker ? C.flicker : f.on ? C.light : C.lightOff);
  }
  for (const f of c.features) {
    const col = FC[f.type];
    if (!col) continue;
    if (f.type === 'recovery') {
      const [a, b] = toPx(f.data.x0, f.data.z0), [e, d] = toPx(f.data.x1, f.data.z1);
      for (let x = a; x < e; x++) { put(x, b, col); put(x, d - 1, col); }
      for (let y = b; y < d; y++) { put(a, y, col); put(e - 1, y, col); }
      continue;
    }
    const [x, y] = toPx(f.x, f.z);
    const r = BIG[f.type] || 1;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) put(x + ox, y + oy, col);
  }
  for (let k = 0; k < CHUNK_CELLS * PX; k += 4) { put(i * CHUNK_CELLS * PX + k, j * CHUNK_CELLS * PX, C.seam); put(i * CHUNK_CELLS * PX, j * CHUNK_CELLS * PX + k, C.seam); }
}
// spawn marker
const sp = world.spawnPoint();
{
  const [x, y] = toPx(sp.x, sp.z);
  for (let k = -3; k <= 3; k++) { put(x + k, y, [255, 0, 0]); put(x, y + k, [255, 0, 0]); }
}

const dir = join(root, 'shots', 'world');
mkdirSync(dir, { recursive: true });
const out = join(dir, `${args.out || `map-${seed}`}.png`);
writeFileSync(out, png(iw, ih, img));

if (args.ascii) {
  for (let gz = 0; gz < ch; gz++) {
    let row = '';
    for (let gx = 0; gx < cw; gx++) {
      const ix = cx0 * CHUNK_CELLS + gx, iz = cz0 * CHUNK_CELLS + gz;
      const t = world.cell(ix, iz);
      row += t === CELL_TYPE.WALL ? '#' : t === CELL_TYPE.COLUMN ? 'o' : t === CELL_TYPE.DOOR ? 'D' : world.blocksMove(ix, iz) ? '%' : '.';
    }
    ascii.push(row);
  }
  writeFileSync(join(dir, `${args.out || `map-${seed}`}.txt`), ascii.join('\n') + '\n');
}
console.log(out);
console.log(JSON.stringify(count));
