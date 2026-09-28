// circle vs cell-grid collision shared by the player and the enemy. zero allocation.
import { CELL, CELL_TYPE } from '../world/constants.js';

const DOOR = CELL_TYPE.DOOR;

// pushes body {x, z, vx, vz} out of blocking cells and removes velocity into walls.
// faces shared with another blocking cell are treated as interior so flat walls made of
// many cells slide like one surface (no snagging on seams, door frames or column edges).
export function collide(world, b, r, info) {
  info.hit = false;
  info.doorIx = 0;
  info.doorIz = 0;
  info.door = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const ix0 = Math.floor((b.x - r) / CELL), ix1 = Math.floor((b.x + r) / CELL);
    const iz0 = Math.floor((b.z - r) / CELL), iz1 = Math.floor((b.z + r) / CELL);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (!world.blocksMove(ix, iz)) continue;
        const bx0 = ix * CELL, bx1 = bx0 + CELL, bz0 = iz * CELL, bz1 = bz0 + CELL;
        let px = b.x < bx0 ? bx0 : b.x > bx1 ? bx1 : b.x;
        let pz = b.z < bz0 ? bz0 : b.z > bz1 ? bz1 : b.z;
        const outX = b.x < bx0 || b.x > bx1;
        const outZ = b.z < bz0 || b.z > bz1;
        if (outX && outZ) {
          const nbX = world.blocksMove(b.x < bx0 ? ix - 1 : ix + 1, iz);
          const nbZ = world.blocksMove(ix, b.z < bz0 ? iz - 1 : iz + 1);
          if (nbX && nbZ) continue;
          if (nbX) px = b.x;
          else if (nbZ) pz = b.z;
        } else if (outX) {
          if (world.blocksMove(b.x < bx0 ? ix - 1 : ix + 1, iz)) continue;
        } else if (outZ) {
          if (world.blocksMove(ix, b.z < bz0 ? iz - 1 : iz + 1)) continue;
        }
        let dx = b.x - px, dz = b.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        dx /= d; dz /= d;
        const push = r - d;
        b.x += dx * push;
        b.z += dz * push;
        const vn = b.vx * dx + b.vz * dz;
        if (vn < 0) { b.vx -= vn * dx; b.vz -= vn * dz; }
        info.hit = true;
        moved = true;
        if (world.cell(ix, iz) === DOOR) { info.door = true; info.doorIx = ix; info.doorIz = iz; }
      }
    }
    if (!moved) break;
  }
}

// if the centre ended up inside a blocking cell (door closed on it, teleport), hop to the nearest clear cell
export function untrap(world, b, r) {
  const ix = Math.floor(b.x / CELL), iz = Math.floor(b.z / CELL);
  if (!world.blocksMove(ix, iz)) return false;
  let best = -1, bx = 0, bz = 0;
  for (let rad = 1; rad <= 8; rad++) {
    for (let dz = -rad; dz <= rad; dz++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
        const cx = ix + dx, cz = iz + dz;
        if (world.blocksMove(cx, cz)) continue;
        // prefer cells with open orthogonal neighbours so the body fits
        let open = 0;
        if (!world.blocksMove(cx + 1, cz)) open++;
        if (!world.blocksMove(cx - 1, cz)) open++;
        if (!world.blocksMove(cx, cz + 1)) open++;
        if (!world.blocksMove(cx, cz - 1)) open++;
        if (open < 3) continue;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        const d = (x - b.x) * (x - b.x) + (z - b.z) * (z - b.z);
        if (best < 0 || d < best) { best = d; bx = x; bz = z; }
      }
    }
    if (best >= 0) break;
  }
  if (best < 0) return false;
  b.x = bx; b.z = bz; b.vx = 0; b.vz = 0;
  return true;
}
