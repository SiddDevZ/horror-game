import { World } from './world/World.js';
import { GameRenderer } from './render/GameRenderer.js';
import { Game } from './game/Game.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { UI } from './ui/UI.js';
import { settings } from './settings.js';
import { events } from './core/events.js';
import { registerDebug, debugRoot } from './core/debug.js';
import { touchPref } from './ui/touch.js';

const q = new URLSearchParams(location.search);
const intParam = (k, d) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) >>> 0 : d);
const params = {
  seed: intParam('seed', 1337),
  encounterSeed: intParam('eseed', (Date.now() ^ (Math.random() * 1e9)) >>> 0),
  autostart: q.get('autostart') === '1',
  quality: q.get('quality') || null,
  noDirector: q.get('nodirector') === '1',
  debug: q.get('debug') === '1',
  intro: q.get('intro') === '1',
  spawn: q.get('spawn') ? q.get('spawn').split(',').map(Number) : null,
  touch: touchPref(location.search), // ?touch=1 forces the on-screen controls, ?touch=0 hides them
};
if (params.quality) settings.set('quality', params.quality);

const canvas = document.getElementById('game');
const manifestPromise = fetch('./assets/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function boot() {
  const ui = new UI({ settings, events, touch: params.touch });
  ui.setLoading(0.1, 'building rooms');

  const world = new World(params.seed);
  const spawn = world.spawnPoint();
  if (params.spawn) Object.assign(spawn, { x: params.spawn[0], z: params.spawn[1], yaw: params.spawn[2] || 0 });
  world.update(spawn.x, spawn.z);

  const renderer = new GameRenderer(canvas, world);
  await renderer.init();
  ui.setLoading(0.7, 'wiring the lights');

  const audio = new AudioSystem(settings, world);
  const game = new Game({ world, renderer, audio, settings, events, params, spawn });
  ui.attach({ game, audio, renderer });

  registerDebug('params', params);
  registerDebug('world', world);
  registerDebug('renderer', renderer);
  registerDebug('audio', audio);
  registerDebug('game', game);
  registerDebug('settings', settings);
  registerDebug('ui', ui);
  registerDebug('events', events);
  registerDebug('stats', () => ({ render: renderer.stats(), world: world.stats(), state: game.state, director: game.director?.state, player: { x: game.player.x, z: game.player.z } }));

  const manifest = await manifestPromise;
  registerDebug('manifest', manifest);
  if (manifest) {
    renderer.loadEnemyTextures(manifest).catch((e) => console.error('enemy textures', e));
    game.setManifest?.(manifest);
    audio.prefetchParty?.(manifest); // the jukebox is right by spawn: fetch its track before Start
  }

  let started = false;
  const start = () => {
    if (started) return game.resume();
    started = true;
    audio.unlock();
    if (manifest) {
      audio.preload(manifest, ['kanye'])
        .then(() => audio.preloadParty?.()) // the jukebox is by spawn: its track goes before the other villains
        .then(() => audio.preload(manifest, ['epstein', 'trump']))
        .catch((e) => console.error('audio preload', e));
    }
    game.start();
  };
  ui.onStart = start;

  addEventListener('resize', () => renderer.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') game.pause();
  });

  let last = performance.now();
  let frames = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    game.update(dt);
    world.update(game.player.x, game.player.z);
    audio.update(dt);
    renderer.render(dt, game.frame);
    ui.update(dt);
    if (++frames === 2) debugRoot.ready = true;
  };
  requestAnimationFrame(loop);

  ui.setLoading(1, '');
  if (params.autostart) start();
  else ui.showStart();
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('fatal');
  if (el) {
    el.hidden = false;
    el.textContent = `Could not start: ${e?.message || e}. This game needs WebGL2.`;
  }
});
