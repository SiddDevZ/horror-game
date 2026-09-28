// material ids packed into the aInfo.x vertex attribute (id + flag bits * 32). shared with shaders.
export const MAT = {
  WALLPAPER: 0,
  BLOCK: 1,
  FLOOR: 2,
  CEIL: 3,
  PANEL: 4,
  FRAME: 5,
  WOOD: 6,
  TRIM: 7,
  FABRIC: 8,
  METAL: 9,
  PLASTIC: 10,
  CARDBOARD: 11,
  WATER: 12,
  DARKTILE: 13,
  EXIT: 14,
  SIGN: 15,
  LAMINATE: 16,
  PIPE: 17,
  BLACK: 18,
  VENT: 19,
  DOOR: 20,
  BRASS: 21,
  // v2 (flags on these are a parameter, not bit flags)
  POSTER: 22, // uv.x = local u + 2 * variant (atlas cell picked in the shader)
  LABEL: 23, // uv = labels atlas uv; flags = emissive level 0..15
  PAINT: 24, // flags = PAINT palette index
  GLASS: 25,
  TAPE: 26,
  CHROME: 27,
  BOTTLE: 28, // flags 1 = backlit (vending)
  LED: 29, // flags = LED colour (0 red, 1 green, 2 amber, 3 white) + 4 to blink
  DECAL: 30, // wall decal: labels atlas rgb blended over the wallpaper by alpha
};
export const FLAG = { CONVEX_START: 32, CONVEX_END: 64, WET: 128, FLICKER: 256 };

// PAINT palette indices (albedos live in worldMaterial.js)
export const PAINT = {
  NAVY: 0, CHARCOAL: 1, ENAMEL: 2, BEIGE: 3, WALNUT: 4, RED: 5, BLACK: 6, STEEL: 7, YELLOW: 8, CREAM: 9, CART: 10, VHS: 11, GREEN: 12, WHITE: 13, CAPBLUE: 14, RUBBER: 15,
  PURPLE: 16, CREW: 17, VISOR: 18, TEAL: 19, PLANTER: 20, GRASS: 21, SOIL: 22, PORCELAIN: 23, MARBLE: 24, SKIN: 25, FRIDGE: 26, COPIER: 27, RACK: 28, PINK: 29, WIREBLUE: 30, ORANGE: 31,
};
export const paint = (i) => MAT.PAINT + i * 32;
export const label = (level) => MAT.LABEL + Math.max(0, Math.min(15, level | 0)) * 32;
export const led = (c, blink = false) => MAT.LED + (c + (blink ? 4 : 0)) * 32;
