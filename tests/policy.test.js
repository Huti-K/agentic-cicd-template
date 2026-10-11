import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

const workflows = Object.fromEntries(await Promise.all((await readdir('.github/workflows'))
  .filter((file) => file.endsWith('.yml')).map(async file => [file, parse(await readFile('.github/workflows/' + file, 'utf8'))])));
test('workflow actions are immutable and jobs have time limits', () => {
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.equal(workflow.permissions.contents, 'read', file);
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 15, file + ':' + name);
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[\w/-]+@[a-f0-9]{40}$/, step.uses);
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
      }
    }
  }
});
test('CI aggregate fails unless every required job succeeds', async () => {
  const job = workflows['ci.yml'].jobs.verify;
  assert.equal(job.if, 'always()');
  assert.deepEqual(job.needs, ['unit', 'automation', 'browser']);
  const run = job.steps[0].run;
  const script = run.split("node <<'NODE'\n")[1].split('\nNODE')[0];
  for (const outcome of ['success', 'failure', 'cancelled', 'skipped']) {
    let exit = 0;
    const results = { unit: { result: 'success' }, automation: { result: outcome }, browser: { result: 'success' } };
    new Function('require', 'process', script)(
      () => ({ appendFileSync() {} }),
      { env: { RESULTS: JSON.stringify(results), GITHUB_STEP_SUMMARY: 'unused' }, exit: value => { exit = value; } },
    );
    assert.equal(exit, outcome === 'success' ? 0 : 1);
  }
});
test('candidate verification gets no API secret and publishing does not execute candidate code', () => {
  const ci = workflows['ci.yml'];
  assert.doesNotMatch(JSON.stringify(ci), /secrets\./);
  const fix = workflows['agent-fix.yml'].jobs;
  assert.equal(fix.implement.permissions.contents, 'read');
  assert.equal(fix['verify-patch'].permissions.contents, 'read');
  assert.doesNotMatch(JSON.stringify(fix['verify-patch']), /secrets\./);
  const commands = fix.publish.steps.map(step => step.run || step.with?.script || '').join('\n');
  assert.doesNotMatch(commands, /npm run|npm test|npm ci/);
  assert.match(JSON.stringify(fix['verify-patch']), /verify-regression\.mjs/);
});
test('deployment waits for all checks and reviews are gated to same-repository non-draft PRs', () => {
  assert.ok(workflows['ci.yml'].jobs.deploy.needs.includes('verify'));
  const condition = workflows['agent-review.yml'].jobs.prepare.if;
  assert.match(condition, /head\.repo\.full_name == github\.repository/);
  assert.match(condition, /!github\.event\.pull_request\.draft/);
  assert.match(condition, /dependabot/);
});

