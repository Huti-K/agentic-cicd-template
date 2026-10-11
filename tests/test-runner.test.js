import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testFiles } from '../scripts/test.mjs';

test('the unit runner includes nested agent regression tests and excludes browser specs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'test-discovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'demo/nested'), { recursive: true });
  for (const path of ['workflow.test.js', 'demo/nested/regression.test.js', 'browser.spec.js', 'helper.js']) {
    await writeFile(join(directory, path), '');
  }
  assert.deepEqual(await testFiles(directory), [join(directory, 'demo/nested/regression.test.js'), join(directory, 'workflow.test.js')]);
});
