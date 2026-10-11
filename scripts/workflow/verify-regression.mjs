import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyRegression({ cwd = process.cwd() } = {}) {
  const git = (args) => execFileSync('git', args, { cwd, maxBuffer: 8_000_000 });
  const tests = git(['diff', '--cached', '--name-only', '--diff-filter=AM', '-z', '--', 'tests/demo'])
    .toString().split('\0').filter((path) => path.endsWith('.test.js'));
  if (!tests.length) throw new Error('Agent fixes must add or update a regression test in tests/demo/.');
  const baseline = await mkdtemp(join(tmpdir(), 'agent-baseline-'));
  try {
    execFileSync('tar', ['-x', '-C', baseline], { input: git(['archive', 'HEAD']) });
    for (const path of tests) {
      await mkdir(dirname(join(baseline, path)), { recursive: true });
      await copyFile(join(cwd, path), join(baseline, path));
    }
    const testFiles = (await readdir(join(baseline, 'tests/demo'), { recursive: true }))
      .filter((path) => path.endsWith('.test.js')).map((path) => join('tests/demo', path));
    const reporter = fileURLToPath(new URL('./regression-reporter.mjs', import.meta.url));
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...testFiles], {
      cwd: baseline, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_TEST_CONTEXT', 'NODE_OPTIONS'].includes(key))),
    });
    let evidence;
    try { evidence = JSON.parse(run.stdout); } catch { throw new Error('The baseline test runner did not produce valid evidence.'); }
    if (run.error || run.signal || run.status !== 1 || evidence.assertions < 1 || evidence.errors > 0) {
      throw new Error(`Regression not proved: expected assertion failure on original code; got ${JSON.stringify(evidence)}.`);
    }
    console.log(`Regression proved: ${evidence.assertions} assertion(s) fail on original code.`);
    return { baseline: 'failed-as-expected', ...evidence };
  } finally { await rm(baseline, { recursive: true, force: true }); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const evidence = await verifyRegression();
  await mkdir('.agent-output', { recursive: true });
  await writeFile('.agent-output/regression.json', JSON.stringify(evidence, null, 2) + '\n');
}

