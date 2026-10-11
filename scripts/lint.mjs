import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const root of ['demo', 'scripts', 'tests', 'e2e']) {
  for (const file of await readdir(root, { recursive: true })) {
    if (!/\.(mjs|cjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${root}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    count++;
  }
}
console.log(`Syntax checked ${count} JavaScript files.`);
