import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function testFiles(directory = 'tests') {
  return (await readdir(directory, { recursive: true }))
    .filter(file => file.endsWith('.test.js')).sort().map(file => join(directory, file));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const files = await testFiles();
  if (!files.length) throw new Error('No unit tests found.');
  const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
