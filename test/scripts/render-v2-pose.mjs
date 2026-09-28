// tries candidate viewmodel item poses (debug override) and screenshots each
export default async function ({ evalJs, delay, shot, args }) {
  const item = args.item || 'almond';
  const cands = JSON.parse(args.poses || '[]');
  await evalJs(`(() => { const R = __br.renderer; const o = R.render.bind(R); R.render = (dt, f) => { f.viewmodel.item = '${item}'; f.viewmodel.useT = 0.5; return o(dt, f); }; })()`);
  for (let i = 0; i < cands.length; i++) {
    const [p, e] = cands[i];
    await evalJs(`(() => { const T = __br.renderer.viewmodel; const THREE = { V: T._ip.constructor, Q: T._iq.constructor, E: T._ie.constructor }; T.debugPose = { p: new THREE.V(${p.join(',')}), q: new THREE.Q().setFromEuler(new THREE.E(${e.join(',')})) }; })()`);
    await delay(250);
    await shot(`pose-${item}-${i}`);
  }
}
