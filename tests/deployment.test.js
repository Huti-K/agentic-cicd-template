import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';
import { verifyDeployment } from '../scripts/verify-deployment.mjs';

test('clean builds remove obsolete assets and omit hidden files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'build-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'demo'), destination = join(root, 'dist');
  await mkdir(source); await mkdir(destination);
  await writeFile(join(source, 'index.html'), '<h1>Demo</h1>');
  await writeFile(join(source, '.env'), 'fixture only');
  await writeFile(join(destination, 'obsolete.js'), 'stale');
  await build({ source, destination, metadata: { sha: 'a'.repeat(40) } });
  await assert.rejects(access(join(destination, 'obsolete.js')));
  await assert.rejects(access(join(destination, '.env')));
  assert.equal(JSON.parse(await readFile(join(destination, 'build.json'))).sha, 'a'.repeat(40));
});
test('deployment verification waits for the expected commit at the repository subpath', async () => {
  const sha = 'a'.repeat(40), urls = [];
  let manifests = 0;
  await verifyDeployment({ url: 'https://example.com/lab/', sha, attempts: 2, sleep: async () => {},
    fetcher: async (url) => {
      urls.push(url.href);
      if (url.pathname.endsWith('build.json')) return { ok: true, json: async () => ({ sha: ++manifests === 1 ? 'old' : sha }) };
      return { ok: true, text: async () => 'asset' };
    },
  });
  assert.equal(manifests, 2);
  assert.ok(urls.every((url) => url.startsWith('https://example.com/lab/')));
});
test('stale deployments and missing assets fail verification', async () => {
  await assert.rejects(verifyDeployment({ url: 'https://example.com/lab/', sha: 'a'.repeat(40), attempts: 1,
    fetcher: async () => ({ ok: true, json: async () => ({ sha: 'old' }) }),
  }), /different commit/);
  await assert.rejects(verifyDeployment({ url: 'https://example.com/lab/', sha: 'a'.repeat(40), attempts: 1,
    fetcher: async (url) => url.pathname.endsWith('build.json')
      ? { ok: true, json: async () => ({ sha: 'a'.repeat(40) }) }
      : { ok: false },
  }), /Missing deployed asset/);
});

