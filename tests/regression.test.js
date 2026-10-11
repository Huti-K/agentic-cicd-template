import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyRegression } from '../scripts/workflow/verify-regression.mjs';

async function fixture(t, testCode) {
  const cwd = await mkdtemp(join(tmpdir(), 'regression-fixture-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  await mkdir(join(cwd, 'tests/demo'), { recursive: true });
  await mkdir(join(cwd, 'demo'), { recursive: true });
  await writeFile(join(cwd, 'package.json'), '{"type":"module"}');
  await writeFile(join(cwd, 'demo/value.js'), 'export const value = 0;');
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
  await writeFile(join(cwd, 'tests/demo/value.test.js'), testCode);
  git('add', '.');
  return cwd;
}
test('regression gate accepts an assertion that fails on the original code', async (t) => {
  const cwd = await fixture(t, "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../../demo/value.js'; test('value is correct', () => assert.equal(value, 1));");
  const evidence = await verifyRegression({ cwd });
  assert.equal(evidence.assertions, 1);
});
test('regression gate rejects tests that already pass', async (t) => {
  const cwd = await fixture(t, "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('nothing changed', () => assert.equal(1, 1));");
  await assert.rejects(verifyRegression({ cwd }), /Regression not proved/);
});
test('syntax and missing-import errors do not count as regression evidence', async (t) => {
  for (const code of ['this is not JavaScript!', "import './missing.js';"]) {
    const cwd = await fixture(t, code);
    await assert.rejects(verifyRegression({ cwd }), /Regression not proved/);
  }
});
test('agent fixes without changed tests are rejected', async (t) => {
  const cwd = await fixture(t, '');
  execFileSync('git', ['restore', '--staged', 'tests/demo/value.test.js'], { cwd });
  await assert.rejects(verifyRegression({ cwd }), /regression test/);
});

