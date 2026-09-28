export const CELL = 0.5;
export const CHUNK_CELLS = 32;
export const CHUNK = CELL * CHUNK_CELLS;
export const CEIL_H = 2.8;
export const EYE_H = 1.68;
export const ACTIVE_RADIUS = 3;
export const DATA_CACHE_MAX = 320;

export const CELL_TYPE = { EMPTY: 0, WALL: 1, COLUMN: 2, DOOR: 3 };
export const ZONE = { OFFICE: 0, MAINT: 1, WET: 2, DARK: 3 };

// numeric key, valid for |c| < 32768
export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const keyCx = (key) => Math.floor(key / 65536) - 32768;
export const keyCz = (key) => (key % 65536) - 32768;
export const cellOf = (m) => Math.floor(m / CELL);
export const chunkOfCell = (i) => Math.floor(i / CHUNK_CELLS);
