// light-leak validator: recompute direct floor light for every baked texel of the meshed chunks using the
// world's own lineOfSight (independent of the baker's DDA) and compare with the baked value.
// a leak = baked light where the world says no fixture is visible. also checks chunk-seam continuity.
export default async function ({ evalJs, delay }) {
  await delay(2500);
  const res = await evalJs(`(() => {
    const W = __br.world, R = __br.renderer;
    const CH = 16, TEX = 0.25, FH = 2.78, K = FH * FH, LR = 7;
    const fixt = [];
    const seen = new Set();
    for (const k of W.active) {
      const kx = Math.floor(k / 65536) - 32768, kz = (k % 65536) - 32768;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const key = (kx + dx) * 100000 + (kz + dz);
        if (seen.has(key)) continue; seen.add(key);
        for (const f of W.getChunk(kx + dx, kz + dz).fixtures) if (f.on && f.intensity > 0) fixt.push(f);
      }
    }
    const leakList = [];
    // include one ring beyond the active set (lights near the border)
    let innerMax = 0, checked = 0, dark = 0, leaks = 0, maxLeak = 0, worst = null, errSum = 0, errN = 0, seamMax = 0;
    for (const rec of R.chunks.values()) {
      if (!rec.ready) continue;
      for (let tz = 0; tz < 64; tz += 1) for (let tx = 0; tx < 64; tx += 1) {
        const x = rec.cx * CH + (tx + 0.5) * TEX, z = rec.cz * CH + (tz + 0.5) * TEX;
        const t = W.cell(Math.floor(x / 0.5), Math.floor(z / 0.5));
        if (t !== 0) continue;
        const d = R.debugLightAt(x, z);
        let expect = 0, anyVis = false;
        for (const f of fixt) {
          const dx = f.x - x, dz = f.z - z, d2 = dx * dx + dz * dz;
          if (d2 >= LR * LR) continue;
          const ax = (f.sx || 0.6) >= (f.sz || 1.2) ? (f.sx || 0.6) * 0.3 : 0, az = ax ? 0 : (f.sz || 1.2) * 0.3;
          const v = (W.lineOfSight(x, z, f.x + ax, f.z + az) ? 0.5 : 0) + (W.lineOfSight(x, z, f.x - ax, f.z - az) ? 0.5 : 0);
          if (v > 0) anyVis = true;
          const win = (1 - d2 / (LR * LR)) ** 2, r2 = d2 + FH * FH;
          expect += (K * f.intensity * ((f.sx * f.sz) / 0.72) * v * win * FH * FH) / (r2 * r2);
        }
        checked++;
        if (!anyVis) {
          dark++;
          if (d.floor > 1e-3) { leaks++; if (leakList.length < 12) leakList.push([x, z, +d.floor.toFixed(3)]); if (d.floor > maxLeak) { maxLeak = d.floor; worst = { x, z, baked: d.floor }; } }
        } else if (expect > 0.05) {
          // relative error (variation hash and door state make small differences expected)
          errSum += Math.abs(d.floor - expect) / expect; errN++;
        }
      }
      // seam: baked floor light along the +x edge vs neighbour's first column
      const nb = R.chunks.get((rec.cx + 1 + 32768) * 65536 + (rec.cz + 32768));
      if (nb && nb.ready) for (let tz = 0; tz < 64; tz++) {
        const z = rec.cz * CH + (tz + 0.5) * TEX;
        const a = R.debugLightAt(rec.cx * CH + 15.875, z), b = R.debugLightAt(rec.cx * CH + 16.125, z);
        if (W.cell(Math.floor((rec.cx * CH + 15.875) / 0.5), Math.floor(z / 0.5)) === 0 && W.cell(Math.floor((rec.cx * CH + 16.125) / 0.5), Math.floor(z / 0.5)) === 0)
          seamMax = Math.max(seamMax, Math.abs(a.bounce - b.bounce));
      }
      // baseline: the same step measured across an interior texel boundary
      for (let tz = 0; tz < 64; tz++) {
        const z = rec.cz * CH + (tz + 0.5) * TEX, x0 = rec.cx * CH + 7.875, x1 = rec.cx * CH + 8.125;
        if (W.cell(Math.floor(x0 / 0.5), Math.floor(z / 0.5)) !== 0 || W.cell(Math.floor(x1 / 0.5), Math.floor(z / 0.5)) !== 0) continue;
        innerMax = Math.max(innerMax, Math.abs(R.debugLightAt(x0, z).bounce - R.debugLightAt(x1, z).bounce));
      }
    }
    return { checked, darkTexels: dark, leaks, maxLeak, worst, leakList, meanRelErrLit: errN ? errSum / errN : 0, litSamples: errN, seamBounceMaxStep: seamMax, interiorBounceMaxStep: innerMax };
  })()`);
  console.log('LEAKS', JSON.stringify(res));
  return res.leaks === 0;
}
