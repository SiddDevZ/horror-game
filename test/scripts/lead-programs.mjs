// logs shader program names at boot and after the first reveal to find mid-game compiles
export default async function ({ evalJs, delay }) {
  const names = `(() => window.__br.renderer.renderer.info.programs.map((p) => p.name + '#' + p.id))()`;
  const a = await evalJs(names);
  console.log('boot', a.length, JSON.stringify(a));
  for (let i = 0; i < 30; i++) {
    await delay(500);
    const b = await evalJs(names);
    if (b.length !== a.length) { console.log('t', (i + 1) * 0.5, 'dir', await evalJs('__br.game.director.state'), 'new', JSON.stringify(b.filter((x) => !a.includes(x)))); break; }
  }
}
