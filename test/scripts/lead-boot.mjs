// frame-time spikes over the first 12 s (spawn streaming + first reveal)
export default async function ({ evalJs, delay }) {
  await evalJs(`(() => { const a = window.__ft = []; let l = performance.now(); const f = () => { const n = performance.now(); a.push(n - l); l = n; if (a.length < 100000) requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()`);
  await delay(12000);
  const r = await evalJs(`(() => { const a = window.__ft.slice(5); const s = [...a].sort((x, y) => x - y); return { n: a.length, p50: s[Math.floor(s.length * 0.5)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1], over20: a.filter((x) => x > 20).length, dir: __br.game.director.state }; })()`);
  console.log('frames', JSON.stringify(r));
}
