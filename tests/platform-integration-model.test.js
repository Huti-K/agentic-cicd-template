import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, ticketInput, ticketNumber, mentions, triageResult, evidenceResult, allowedAgentPath, equalSecret } from '../worker/model.js';

const validTicket = () => ({ title: 'A support ticket', description: 'A complete reproduction with expected behavior.', type: 'bug', priority: 'high', assigneeId: 'huti', contributorIds: ['davidmikan'], tags: ['support'] });
const validTriage = () => ({ description: 'Enriched reproduction and implementation context.', summary: 'Preserve the composer while refreshing ticket metadata.', ready: true, acceptanceCriteria: ['The unsent text survives a refresh.'], files: [{ path: 'demo/src/platform.js', reason: 'Renders the ticket and comment editor.' }], documentation: [{ path: 'docs/ARCHITECTURE.md', reason: 'Explains the rendering lifecycle.' }] });
const badRequest = error => error instanceof HttpError && error.status === 400;

test('ticket input retains only editable properties, normalizes contributors and never mutates input', () => {
  const input = { ...validTicket(), status: 'deployed', headSha: 'fake', issueUrl: 'javascript:alert(1)', tags: ['support', 'support'] };
  const before = structuredClone(input);
  const result = ticketInput(input);
  assert.deepEqual(result.contributorIds, ['davidmikan', 'huti']);
  assert.deepEqual(result.tags, ['support']);
  assert.equal(result.status, undefined);
  assert.equal(result.issueUrl, undefined);
  assert.deepEqual(input, before);
});

test('invalid ticket properties are clean 400 errors, including malformed contributor structures', () => {
  for (const properties of [{ title: '' }, { description: '' }, { title: 'x'.repeat(161) }, { type: 'unknown' }, { priority: 'critical' }, { tags: 'support' }, { tags: [null] }, { assigneeId: 'ai' }, { assigneeId: 'unknown' }, { contributorIds: {} }, { contributorIds: 'huti' }, { contributorIds: [null] }]) {
    assert.throws(() => ticketInput({ ...validTicket(), ...properties }), badRequest, JSON.stringify(properties));
  }
  for (const field of ['type', 'priority', 'assigneeId']) for (const value of [null, false, 0]) {
    const previous = validTicket(), before = structuredClone(previous);
    assert.throws(() => ticketInput({ [field]: value }, previous), badRequest);
    assert.deepEqual(previous, before);
  }
});

test('ticket identifiers cannot escape storage queries or alias numeric identifiers', () => {
  assert.equal(ticketNumber('RLY-12'), 12);
  for (const id of ['RLY-0', 'RLY-01', 'RLY--1', 'RLY-1 OR 1=1', '../RLY-1', 'RLY-999999999', 'rly-1']) assert.throws(() => ticketNumber(id), badRequest);
});

test('mentions are bounded, case-insensitive, deduplicated and never inferred from email addresses', () => {
  assert.deepEqual(mentions('Hi @DavidMikan and (@AI), also @davidmikan!'), ['davidmikan', 'ai']);
  assert.deepEqual(mentions('huti@example.test, user@huti, @ai-helper, @unknown, @@ai'), []);
  assert.deepEqual(mentions('@huti\n@ai\n@davidmikan'), ['huti', 'ai', 'davidmikan']);
});

test('triage requires a genuine description, decision, criteria and safe repository references', () => {
  assert.deepEqual(triageResult(validTriage()), validTriage());
  for (const changes of [{ ready: 'yes' }, { acceptanceCriteria: [] }, { files: [{ path: '../worker/index.js', reason: 'Escape' }] }, { files: [null] }, { documentation: [{}] }, { documentation: [{ path: 'docs/help.md?token=secret', reason: 'Unsafe URL' }] }]) {
    assert.throws(() => triageResult({ ...validTriage(), ...changes }), badRequest, JSON.stringify(changes));
  }
});

test('evidence must match the exact PR head and artifact run in the configured repository', () => {
  const sha = 'a'.repeat(40), repo = 'Huti-K/agentic-cicd-template', run = 123;
  const entry = { title: 'Browser video and report', kind: 'artifact', headSha: sha, url: `https://github.com/${repo}/actions/runs/${run}/artifacts/456` };
  assert.equal(evidenceResult([entry], repo, sha, run)[0].url, entry.url);
  for (const changes of [{ headSha: 'b'.repeat(40) }, { kind: 'unknown' }, { url: 'javascript:alert(1)' }, { url: 'not a URL' }, { url: `https://github.com/other/repository/actions/runs/${run}/artifacts/456` }, { url: `https://github.com/${repo}/actions/runs/999/artifacts/456` }, { url: `https://user:password@github.com/${repo}/actions/runs/${run}/artifacts/456` }]) {
    assert.throws(() => evidenceResult([{ ...entry, ...changes }], repo, sha, run), badRequest, JSON.stringify(changes));
  }
  assert.throws(() => evidenceResult([null], repo, sha, run), badRequest);
  for (const suffix of ['', 'not-an-artifact', '0', '456/extra']) {
    assert.throws(() => evidenceResult([{ ...entry, url: `https://github.com/${repo}/actions/runs/${run}/artifacts/${suffix}` }], repo, sha, run), badRequest);
  }
});

test('agent patch paths cannot edit automation, secrets, dependencies or escape allowed folders', () => {
  for (const path of ['demo/src/platform.js', 'tests/demo/draft.test.js', 'e2e/agent/draft.spec.js']) assert.equal(allowedAgentPath(path), true, path);
  for (const path of ['worker/index.js', '.github/workflows/ci.yml', 'package.json', 'demo/../worker/index.js', 'demo/.secret.js', 'demo/nested/.hidden/file.js', '/demo/index.html', 'demo\\src\\app.js', 'AGENTS.md']) assert.equal(allowedAgentPath(path), false, path);
});

test('secret comparisons reject missing and different credentials', async () => {
  assert.equal(await equalSecret('same fixture', 'same fixture'), true);
  assert.equal(await equalSecret('wrong fixture', 'same fixture'), false);
  assert.equal(await equalSecret('', ''), false);
  assert.equal(await equalSecret(undefined, 'fixture'), false);
});
