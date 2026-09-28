// headless chrome harness for the backrooms game.
// usage: node test/harness.mjs <script> [--quality=low|medium|high]
//        [--size=1920x1080] [--views=spawn,ford] [--tag=name] [--timeout=240] [--time=17.5] [--query=k:v,k2:v2]
// runs test/scripts/<script>.mjs (or test/smoke/<script>.mjs) with helpers. only one chrome may run at a
// time on this machine, so the harness takes a global lock shared with the sibling projects
// (/tmp/luma-browser.lock) and waits its turn. chrome always runs muted.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(3).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const script = process.argv[2] || 'boot';
const PORT = process.env.BR_PORT || 5230;
const [W, H] = (args.size || '1920x1080').split('x').map(Number);
const LOCK = '/tmp/luma-browser.lock';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const hardTimeout = (Number(args.timeout) || 240) * 1000;

async function acquireLock() {
  const started = Date.now();
  let warned = false;
  for (;;) {
    try {
      await mkdir(LOCK);
      await writeFile(join(LOCK, 'owner'), JSON.stringify({ pid: process.pid, script, at: Date.now() }));
      return;
    } catch {
      let stale = false;
      try {
        const o = JSON.parse(await readFile(join(LOCK, 'owner'), 'utf8'));
        let alive = true;
        try { process.kill(o.pid, 0); } catch { alive = false; }
        if (!alive || Date.now() - o.at > 6 * 60 * 1000) stale = true;
      } catch {
        try { const s = await stat(LOCK); if (Date.now() - s.mtimeMs > 20000) stale = true; } catch {}
      }
      if (stale) { await rm(LOCK, { recursive: true, force: true }); continue; }
      if (!warned) { console.log('waiting for browser lock...'); warned = true; }
      if (Date.now() - started > 20 * 60 * 1000) throw new Error('browser lock wait exceeded 20 minutes');
      await delay(1000);
    }
  }
}

async function releaseLock() {
  try {
    const o = JSON.parse(await readFile(join(LOCK, 'owner'), 'utf8'));
    if (o.pid === process.pid) await rm(LOCK, { recursive: true, force: true });
  } catch {}
}

try { await fetch(`http://127.0.0.1:${PORT}/`); } catch { console.error(`dev server not reachable on :${PORT}. start it: npm run dev (in horror-fun-game)`); process.exit(2); }

await acquireLock();
const CDP = 9400 + Math.floor(Math.random() * 400);
const profile = await mkdtemp(tmpdir() + '/br-cdp-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { stdio: 'ignore' });

const killer = setTimeout(() => { console.error('HARNESS TIMEOUT'); cleanup(3); }, hardTimeout);
let ws, id = 0; const pending = new Map(); const logs = []; const errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error');
  return r.result.value;
};
const outDir = join(root, 'shots', args.tag || '');
await mkdir(outDir, { recursive: true });
const shot = async (name, opts = {}) => {
  const r = await send('Page.captureScreenshot', { format: opts.format || 'png', ...(opts.quality ? { quality: opts.quality } : {}) });
  const file = join(outDir, `${name}.${opts.format || 'png'}`);
  await writeFile(file, Buffer.from(r.data, 'base64'));
  console.log('shot', file);
  return file;
};
/** set a debug view, let the frame settle, screenshot */
const viewShot = async (view, name = view, settleMs = 1800) => {
  const ok = await evalJs(`__br.view(${JSON.stringify(view)})`);
  if (!ok) console.log('view not available:', view);
  await delay(settleMs);
  return shot(name);
};
const stats = () => evalJs('__br.stats()');

let cleaned = false;
async function cleanup(code = 0) {
  if (cleaned) return; cleaned = true;
  clearTimeout(killer);
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  await delay(200);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await releaseLock();
  process.exit(code);
}
process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));

let exitCode = 0;
try {
  let tabs;
  for (let i = 0; i < 100; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); break; } catch { await delay(150); } }
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) { const p = pending.get(j.id); pending.delete(j.id); j.error ? p.rej(new Error(j.error.message)) : p.res(j.result); }
    else if (j.method === 'Runtime.consoleAPICalled') {
      const t = j.params.args.map((a) => a.value ?? a.description).join(' ');
      logs.push(`[${j.params.type}] ${t}`);
      if (j.params.type === 'error') { errors.push(t); console.log('console.error', t.slice(0, 600)); }
      else if (j.params.type === 'warning' && !args.quiet) console.log('console.warn', t.slice(0, 300));
      else if (args.verbose) console.log('console', t.slice(0, 300));
    } else if (j.method === 'Runtime.exceptionThrown') {
      const t = j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text;
      errors.push(t); console.log('EXCEPTION', t?.slice(0, 800));
    }
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // headless parks rAF; pump frames with a timer. pointer lock is unavailable headless.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__rafPump = true;
    window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 4);
    Element.prototype.requestPointerLock = function(){ return Promise.resolve(); };
  ` });
  // other agents edit files during runs; ignore vite hmr so the page never reloads mid-script (--hmr keeps it)
  if (!args.hmr) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const WS = window.WebSocket;
    function Guarded(url, protocols) {
      const ws = new WS(url, protocols);
      if (String(protocols).includes('vite')) {
        const add = ws.addEventListener.bind(ws);
        ws.addEventListener = (type, fn, o) => (type === 'message' || type === 'close' ? undefined : add(type, fn, o));
      }
      return ws;
    }
    Guarded.prototype = WS.prototype;
    Object.assign(Guarded, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Guarded;
  })();` });
  const q = new URLSearchParams();
  if (args.quality) q.set('quality', args.quality);
  if (!args.menu) q.set('autostart', '1');
  if (args.query) for (const kv of args.query.split(',')) { const [k, v] = kv.split(':'); q.set(k, v ?? '1'); }
  const url = `http://127.0.0.1:${PORT}${args.path || "/"}?${q}`; // --path=/sub/ to test a subpath deploy
  console.log('open', url, `${W}x${H}`);
  const t0 = Date.now();
  await send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 240; i++) { await delay(500); try { if (await evalJs('!!window.__br.ready')) { ready = true; break; } } catch {} }
  console.log('ready:', ready, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!ready) { exitCode = 1; await shot('boot-failed'); throw new Error('game did not become ready'); }
  const s = await stats();
  console.log('stats', JSON.stringify(s));
  if (s.failed?.length) console.log('FAILED MODULES:', s.failed.join(', '));
  const g = { evalJs, shot, viewShot, stats, delay, send, logs, errors, args, W, H, br: (expr) => evalJs(`(async () => { const B = window.__br; return (${expr}); })()`) };
  let scriptPath = join(root, 'test/scripts', `${script}.mjs`);
  if (!existsSync(scriptPath)) scriptPath = join(root, 'test/smoke', `${script}.mjs`);
  if (!existsSync(scriptPath)) throw new Error(`no script ${scriptPath}`);
  const res = await (await import(scriptPath)).default(g);
  if (res === false) exitCode = 1;
  if (errors.length) {
    console.log(`${errors.length} console errors/exceptions`);
    exitCode = 1;
  }
} catch (e) {
  console.error('harness error:', e?.message || e);
  exitCode = exitCode || 1;
} finally {
  await cleanup(exitCode);
}
