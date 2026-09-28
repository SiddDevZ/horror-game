// runs every test/unit/*.mjs (except this file) in its own node process
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').sort();
let failed = 0;
for (const f of files) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, ['--expose-gc', join(dir, f)], { stdio: 'inherit' });
  const ms = (performance.now() - t0).toFixed(0);
  if (r.status === 0) console.log(`PASS ${f} (${ms} ms)\n`);
  else { failed++; console.log(`FAIL ${f} (exit ${r.status}, ${ms} ms)\n`); }
}
console.log(`${files.length - failed}/${files.length} unit files passed`);
process.exit(failed ? 1 : 0);
