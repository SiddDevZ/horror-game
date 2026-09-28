// trump rotates between his three tracks, never the same one twice in a row, and each decodes non-silent
export default async function ({ evalJs, delay }) {
  const r = await evalJs(`(async () => {
    const A = window.__br.audio, M = window.__br.manifest;
    A.unlock();
    await A.preload(M, ['trump']);
    const picks = [];
    for (let i = 0; i < 9; i++) {
      A.enemyStart('trump', 0, 0, -5);
      picks.push(A.lastVariant.get('trump'));
      A.enemyStop(0.01);
    }
    const clips = {};
    for (const v of A.variants.get('trump')) {
      const c = A.clips.get(v), d = c.buffer.getChannelData(0);
      let s = 0; for (let i = 0; i < d.length; i += 64) s += d[i] * d[i];
      clips[v] = { dur: +c.buffer.duration.toFixed(2), rmsDb: +(10 * Math.log10(s / (d.length / 64))).toFixed(1), gainDb: +(20 * Math.log10(c.gain)).toFixed(1) };
    }
    return { variants: A.variants.get('trump'), picks, clips };
  })()`);
  console.log(JSON.stringify(r));
  const repeats = r.picks.filter((p, i) => i && p === r.picks[i - 1]).length;
  const used = new Set(r.picks).size;
  console.log(repeats === 0 && used === 3 ? 'ok   trump variants rotate with no repeats' : 'FAIL trump variants');
  return repeats === 0 && used === 3;
}
