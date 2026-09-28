export * from './world/constants.js';

export const CAMERA = { fov: 74, near: 0.05, far: 90 };

// quality presets; render agent may extend fields but keep the keys
// renderRadius: chunks meshed around the camera (<= ACTIVE_RADIUS). buildMs: per-frame chunk build budget.
// bloomLevels: 0 = off. aniso: max anisotropic filtering for surface textures. fog: exp2 density.
// renderRadius may exceed activeRadius (render ring reads world.getChunk directly, max 4). dynLights: nearest emitters
// (tv, vending, exit, lamps, pickups) lit per pixel (<= 8). fog is subtle depth fog only; the last 10 m before the
// streaming edge (renderRadius * 16 m) fade out so the edge never shows. partyConfetti / partyLasers: party mode
// confetti flakes around the camera and laser beams from the disco ball.
export const QUALITY = {
  // phones and tablets (auto picks it on touch-first or small high-dpr screens): low's settings at 1 css px, never
  // the device's 2-3x, with fewer dynamic lights and party particles. auto steps it down to low if frames stay slow.
  mobile: { pixelRatio: 1, msaa: 0, bloom: false, shadows: false, activeRadius: 2, renderRadius: 3, buildMs: 2, bloomLevels: 0, aniso: 2, far: 70, fog: 0.014, dynLights: 3, partyConfetti: 140, partyLasers: 3 },
  low: { pixelRatio: 0.75, msaa: 0, bloom: false, shadows: false, activeRadius: 2, renderRadius: 3, buildMs: 2.5, bloomLevels: 0, aniso: 2, far: 70, fog: 0.014, dynLights: 4, partyConfetti: 220, partyLasers: 4 },
  medium: { pixelRatio: 1, msaa: 4, bloom: true, shadows: false, activeRadius: 3, renderRadius: 4, buildMs: 3, bloomLevels: 2, aniso: 4, far: 100, fog: 0.009, dynLights: 6, partyConfetti: 480, partyLasers: 6 },
  high: { pixelRatio: 1.5, msaa: 4, bloom: true, shadows: true, activeRadius: 3, renderRadius: 4, buildMs: 4, bloomLevels: 2, aniso: 8, far: 110, fog: 0.008, dynLights: 8, partyConfetti: 700, partyLasers: 8 },
};
