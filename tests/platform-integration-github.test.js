import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../worker/github.js';
import { githubFixture, REPO, PR_SHA, BASE_SHA } from './helpers/platform-harness.js';

function client() {
  const fixture = githubFixture();
  const github = new GitHub({ GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'fixture-github-token', AGENT_REF: 'main' }, fixture.fetcher);
  const evidence = { id: 'evidence-1', kind: 'evidence', status: 'succeeded', headSha: PR_SHA, evidence: [{ title: 'Browser report', url: `https://github.com/${REPO}/actions/runs/456/artifacts/789`, headSha: PR_SHA }] };
  return { fixture, github, evidence };
}

test('GitHub fetch preserves the Worker global receiver', async () => {
  const github = new GitHub({ GITHUB_TOKEN: 'fixture-token' }, function () {
    assert.equal(this, globalThis, 'Worker fetch requires the global receiver');
    return Promise.resolve(new Response(JSON.stringify({ sha: BASE_SHA })));
  });
  assert.equal(await github.base(), BASE_SHA);
});

test('merge readiness requires both verification and independent review on the current revision', async () => {
  const { fixture, github, evidence } = client();
  assert.equal((await github.pull(71, [evidence])).canMerge, true);
  fixture.checks = fixture.checks.filter(check => check.name !== 'AI review');
  assert.equal((await github.pull(71, [evidence])).checksReady, false);
  assert.equal((await github.pull(71, [evidence])).canMerge, false);
});
test('GitHub merge restrictions block approval even with green checks and current evidence', async () => {
  const { fixture, github, evidence } = client();
  for (const state of ['blocked', 'behind', 'dirty', 'unknown', undefined]) {
    fixture.pull.mergeable_state = state;
    const pr = await github.pull(71, [evidence]);
    assert.equal(pr.checksReady, true);
    assert.equal(pr.evidenceReady, true);
    assert.equal(pr.canMerge, false, String(state));
    assert.ok(pr.mergeBlockReason);
  }
  fixture.pull.mergeable_state = 'clean';
  assert.equal((await github.pull(71, [evidence])).canMerge, true);
});

test('pending or failed checks block merging even when required checks are green', async () => {
  const { fixture, github, evidence } = client();
  fixture.checks.push({ name: 'extra security scan', status: 'in_progress', conclusion: null, head_sha: PR_SHA });
  assert.equal((await github.pull(71, [evidence])).canMerge, false);
  fixture.checks.at(-1).status = 'completed'; fixture.checks.at(-1).conclusion = 'failure';
  assert.equal((await github.pull(71, [evidence])).canMerge, false);
});

test('truncated check or status lists cannot establish merge readiness', async () => {
  const { fixture, github, evidence } = client();
  fixture.checksTotal = 101;
  assert.equal((await github.pull(71, [evidence])).canMerge, false, 'unseen check runs may contain failures');
  fixture.checksTotal = fixture.checks.length; fixture.statusesTotal = 101;
  assert.equal((await github.pull(71, [evidence])).canMerge, false, 'unseen commit statuses may contain failures');
});

test('old evidence and a newer failing evidence job never satisfy current revision evidence', async () => {
  const { github, evidence } = client();
  assert.equal((await github.pull(71, [{ ...evidence, headSha: BASE_SHA }])).evidenceReady, false);
  assert.equal((await github.pull(71, [{ ...evidence, status: 'failed' }, evidence])).evidenceReady, false);
  assert.equal((await github.pull(71, [{ ...evidence, evidence: [] }])).evidenceReady, false);
});

test('forked, draft or non-main PRs cannot be merged through the ticket platform', async () => {
  const { fixture, github, evidence } = client();
  fixture.pull.head.repo.full_name = 'attacker/fork';
  assert.equal((await github.pull(71, [evidence])).canMerge, false);
  fixture.pull.head.repo.full_name = REPO; fixture.pull.draft = true;
  assert.equal((await github.pull(71, [evidence])).canMerge, false);
  fixture.pull.draft = false; fixture.pull.base.ref = 'preview';
  assert.equal((await github.pull(71, [evidence])).canMerge, false);
});
