import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function build({ source = 'demo', destination = 'dist', metadata = {} } = {}) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, filter: (path) => !basename(path).startsWith('.') });
  await writeFile(resolve(destination, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(resolve(destination, '.nojekyll'), '');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await build({ metadata: {
    sha,
    repository: process.env.GITHUB_REPOSITORY || 'Huti-K/agentic-cicd-template',
    runId: process.env.GITHUB_RUN_ID || null,
    builtAt: new Date().toISOString(),
    source: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    dirty: process.env.GITHUB_ACTIONS !== 'true' && execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  } });
  console.log(`Built demo → dist (${sha.slice(0, 7)})`);
}
