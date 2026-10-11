import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const workflow = parse(await readFile(new URL('../.github/workflows/agent-review.yml', import.meta.url), 'utf8'));
const script = workflow.jobs.report.steps.find((step) => step.env?.RESULT).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const head = 'a'.repeat(40), base = 'b'.repeat(40);
async function report(result, overrides = {}) {
  const reviews = [], statuses = [], errors = [];
  const summary = { addRaw() { return this; }, async write() {} };
  const github = { rest: {
    pulls: {
      get: async () => ({ data: { state: 'open', head: { sha: head }, base: { sha: base }, ...overrides.pr } }),
      createReview: async (input) => reviews.push(input),
    },
    repos: { createCommitStatus: async (input) => statuses.push(input) },
  } };
  const core = { notice() {}, setFailed: (error) => errors.push(error), summary };
  const context = { repo: { owner: 'owner', repo: 'lab' }, serverUrl: 'https://github.com', runId: 123 };
  const process = { env: { PR_NUMBER: '1', REVIEWED_HEAD: head, REVIEWED_BASE: base, REVIEW_JOB: overrides.job || 'success', RESULT: JSON.stringify(result) } };
  await new AsyncFunction('github', 'core', 'context', 'process', script)(github, core, context, process);
  return { reviews, statuses, errors };
}
test('valid clean review passes with a readable report', async () => {
  const result = await report({ verdict: 'pass', summary: 'No actionable defects found.', findings: [] });
  assert.equal(result.statuses[0].state, 'success');
  assert.match(result.reviews[0].body, /PASS/);
});
test('actionable findings fail AI review and link to the reviewed source', async () => {
  const result = await report({ verdict: 'needs_changes', summary: 'Stock reaches an invalid state.', findings: [
    { severity: 'P2', path: 'demo/src/workspace.js', line: 16, description: 'Require approval before merging.' },
  ] });
  assert.equal(result.statuses[0].state, 'failure');
  assert.match(result.reviews[0].body, /CHANGES REQUESTED/);
  assert.match(result.reviews[0].body, /blob\//);
});
test('malformed, contradictory, and empty review results never approve', async () => {
  for (const data of [null, {}, { verdict: 'pass', summary: '', findings: [] },
    { verdict: 'needs_changes', summary: 'Issue found.', findings: [] },
    { verdict: 'pass', summary: 'Fine.', findings: [{ severity: 'P3', path: 'a', line: -1, description: '' }] }]) {
    const result = await report(data);
    assert.equal(result.statuses[0].state, 'error');
    assert.equal(result.errors.length, 1);
  }
});
test('review failures produce an error, never a passing status', async () => {
  const result = await report(null, { job: 'failure' });
  assert.equal(result.statuses[0].state, 'error');
});
test('closed PRs and changed heads discard the old review without affecting another revision', async () => {
  for (const pr of [{ state: 'closed' }, { head: { sha: 'c'.repeat(40) } }]) {
    const result = await report({ verdict: 'pass', summary: 'Fine.', findings: [] }, { pr });
    assert.equal(result.statuses.length, 0);
    assert.equal(result.reviews.length, 0);
  }
});
test('review text cannot inject HTML or mention a GitHub user', async () => {
  const result = await report({ verdict: 'pass', summary: '<script>alert(1)</script> @everyone', findings: [] });
  assert.doesNotMatch(result.reviews[0].body, /<script>|@everyone/);
});

test('a changed base completes the pending same-head review with an actionable error', async () => {
  const result = await report({ verdict: 'pass', summary: 'Fine.', findings: [] }, { pr: { base: { sha: 'd'.repeat(40) } } });
  assert.equal(result.reviews.length, 0);
  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].sha, head);
  assert.equal(result.statuses[0].state, 'error');
  assert.equal(result.statuses[0].context, 'AI review');
  assert.match(result.statuses[0].description, /base.*rerun/i);
  assert.equal(result.statuses[0].target_url, 'https://github.com/owner/lab/actions/runs/123');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /rerun/i);
});
