import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { allowedPath, assertCurrentPr, evidenceSummary, validateEntries, validatePatch, validateSnapshot, validateTestSource, validateTriage } from '../scripts/relay/policy.mjs';
import { clients, jsonRequest } from '../scripts/relay/client.mjs';
import { currentJob, prepare, publish, recoverPublication, validateCandidate } from '../scripts/relay/run.mjs';

const sha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const fixture = (kind = 'implement') => ({ repository: 'owner/relay', branch: 'relay/ticket-RLY-1', baseSha: sha, baseBranch: 'main', sourceSha: sha,
  job: { id: 'job-1', ticketId: 'RLY-1', kind, status: 'running', headSha: null },
  ticket: { id: 'RLY-1', title: 'Ticket keyboard navigation', description: 'Support keyboard focus.', type: 'feature', status: 'implementing', issueNumber: 10, prNumber: null, headSha: null, triage: { ready: true } }, comments: [] });
const expected = (kind = 'implement') => ({ repository: 'owner/relay', jobId: 'job-1', ticketId: 'RLY-1', kind });
const linked = kind => { const value = fixture(kind); value.ticket.prNumber = 42; value.ticket.headSha = sha; value.job.headSha = sha; return value; };
const prFixture = () => ({ number: 42, state: 'open', draft: false, changed_files: 1, head: { sha, ref: 'relay/ticket-RLY-1', repo: { full_name: 'owner/relay' } }, base: { ref: 'main' } });

test('Relay patches allow browser behavior and test evidence, never protected files or path escapes', () => {
  for (const path of ['demo/src/platform.js', 'demo/styles.css', 'demo/index.html', 'tests/demo/comments.test.js', 'e2e/agent/relay-RLY-1.spec.js']) assert.equal(allowedPath(path), true, path);
  for (const path of ['worker/index.js', 'scripts/relay/run.mjs', '.github/workflows/relay-agent.yml', 'package.json', 'AGENTS.md', 'demo/.codex/config.js', 'demo/../worker/index.js', 'demo//a.js', 'demo/./a.js', 'demo/a\\b.js', 'e2e/platform.spec.js']) assert.equal(allowedPath(path), false, path);
  assert.equal(allowedPath('demo/src/platform.js', 'evidence'), false);
  assert.equal(allowedPath('e2e/agent/relay-RLY-1.spec.js', 'evidence'), true);
});
test('publication rejects oversized, symlink, binary, empty, and untested proposals', () => {
  const entries = [{ path: 'demo/src/a.js', mode: '100644' }, { path: 'tests/demo/a.test.js', mode: '100644' }];
  assert.equal(validateEntries(entries, 'implement', 200), entries);
  for (const [rows, kind, size] of [[[], 'implement', 1], [entries, 'implement', 200001], [[...entries, ...Array(29).fill(entries[0])], 'implement', 1], [[entries[0]], 'implement', 1], [[{ ...entries[1], mode: '120000' }], 'implement', 1], [[{ ...entries[1], binary: true }], 'implement', 1], [entries, 'evidence', 1], [entries, 'unknown', 1]]) assert.throws(() => validateEntries(rows, kind, size));
});
test('triage only attaches actual repository paths and complete measurable outcomes', () => {
  const result = { summary: 'Keyboard support is missing.', description: 'Support the expected keyboard shortcuts.', ready: true, acceptanceCriteria: ['Pressing Escape closes the ticket.'], files: [{ path: 'demo/src/platform.js', reason: 'Ticket interaction handlers.' }], documentation: [{ path: 'README.md', reason: 'Documented product behavior.' }] };
  assert.deepEqual(validateTriage(result, ['demo/src/platform.js', 'README.md']), result);
  for (const value of [{ ...result, files: [{ path: '../../secret', reason: 'Read it.' }] }, { ...result, description: '' }, { ...result, ready: 'true' }, { ...result, acceptanceCriteria: [] }, { ...result, documentation: [{ path: 'missing.md', reason: 'Invented.' }] }]) assert.throws(() => validateTriage(value, ['demo/src/platform.js', 'README.md']));
});
test('snapshots reject stale, cross-repository, mismatched, and arbitrary branch work', () => {
  const value = fixture();
  assert.equal(validateSnapshot(value, expected()), value);
  for (const change of [{ repository: 'attacker/repo' }, { baseSha: 'main' }, { branch: 'main' }, { job: { ...value.job, status: 'succeeded' } }, { job: { ...value.job, id: 'other' } }, { ticket: { ...value.ticket, id: 'RLY-2' } }, { ticket: { ...value.ticket, prNumber: 42, headSha: 'latest' } }]) assert.throws(() => validateSnapshot({ ...value, ...change }, expected()));
  assert.throws(() => validateSnapshot(fixture('evidence'), expected('evidence')));
  const evidence = linked('evidence');
  assert.equal(validateSnapshot(evidence, expected('evidence')), evidence);
  evidence.job.headSha = nextSha;
  assert.throws(() => validateSnapshot(evidence, expected('evidence')));
});
test('PR binding rejects closed, draft, fork, wrong branch and changed head', () => {
  const value = linked('implement');
  assert.equal(assertCurrentPr(prFixture(), value).number, 42);
  for (const change of [{ state: 'closed' }, { draft: true }, { head: { ...prFixture().head, sha: nextSha } }, { head: { ...prFixture().head, ref: 'main' } }, { head: { ...prFixture().head, repo: { full_name: 'fork/relay' } } }]) assert.throws(() => assertCurrentPr({ ...prFixture(), ...change }, value));
});
test('evidence requires real, non-skipped, non-flaky passing scenarios and browser assertions', () => {
  const report = { stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0, duration: 1600 } };
  assert.deepEqual(evidenceSummary(report), { passed: 2, failed: 0, skipped: 0, duration: 1600 });
  for (const change of [{ expected: 0 }, { expected: undefined }, { expected: '2' }, { expected: 1.5 }, { duration: undefined }, { unexpected: 1 }, { skipped: 1 }, { flaky: 1 }]) assert.throws(() => evidenceSummary({ stats: { ...report.stats, ...change } }));
  const path = 'e2e/agent/relay-RLY-1.spec.js';
  assert.doesNotThrow(() => validateTestSource(path, "test('keyboard', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('button')).toBeVisible(); });"));
  for (const source of ["test.skip('test', () => {})", "test.only('test', () => {})", "test('test', {skip:true}, () => {})", "test('test', () => expect(true).toBe(true))"]) assert.throws(() => validateTestSource(path, source));
});
test('API client times out and reports bounded errors without reflecting secret response bodies', async () => {
  let request;
  const value = await jsonRequest('https://example.test/path', { token: 'test-secret', method: 'POST', body: { safe: true }, fetcher: async (url, options) => { request = { url, ...options }; return new Response('{"ok":true}'); } });
  assert.deepEqual(value, { ok: true });
  assert.equal(request.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(request.body), { safe: true });
  assert.ok(request.signal instanceof AbortSignal);
  await assert.rejects(jsonRequest('https://example.test/path', { fetcher: async () => new Response('private response', { status: 401 }) }), error => error.message.includes('401') && !error.message.includes('private response'));
  await assert.rejects(jsonRequest('https://example.test/path', { fetcher: async () => new Response('a'.repeat(2_000_001)) }), /limit/);
  assert.equal(await jsonRequest('https://example.test/path', { fetcher: async () => new Response(null, { status: 204 }) }), null);
  const config = { RELAY_URL: 'https://relay.example', RELAY_CALLBACK_SECRET: 'test', GITHUB_REPOSITORY: 'owner/relay', GITHUB_RUN_ID: '12' };
  assert.doesNotThrow(() => clients(config));
  for (const change of [{ RELAY_URL: 'http://relay.example' }, { RELAY_URL: 'https://user:pass@relay.example' }, { GITHUB_REPOSITORY: '../evil' }, { RELAY_CALLBACK_SECRET: '' }]) assert.throws(() => clients({ ...config, ...change }));
});
test('GitHub repository metadata uses the canonical endpoint without a trailing slash', async () => {
  const originalFetch = globalThis.fetch, urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return Response.json({ default_branch: 'main' }); };
  try {
    const api = clients({ RELAY_URL: 'https://relay.example', RELAY_CALLBACK_SECRET: 'fixture', GITHUB_REPOSITORY: 'owner/relay', GITHUB_RUN_ID: '123', GH_TOKEN: 'fixture' });
    await api.github('');
    await api.github('commits/main');
    assert.deepEqual(urls, ['https://api.github.com/repos/owner/relay', 'https://api.github.com/repos/owner/relay/commits/main']);
  } finally { globalThis.fetch = originalFetch; }
});
test('trusted platform callbacks retry transient failures with identical data, but never stale/auth responses or GitHub writes', async () => {
  const originalFetch = globalThis.fetch;
  const env = { RELAY_URL: 'https://relay.example', RELAY_CALLBACK_SECRET: 'fixture', GITHUB_REPOSITORY: 'owner/relay', GITHUB_RUN_ID: '123' };
  const body = { status: 'succeeded', runId: '123', pullRequest: { number: 42, headSha: sha } };
  try {
    for (const failure of [new TypeError('Connection lost'), new DOMException('Timed out', 'TimeoutError'), 503, 429]) {
      const requests = [], delays = [];
      const fetcher = async (url, options) => { requests.push(options.body); if (requests.length > 1) return Response.json({ ok: true, duplicate: true }); if (failure instanceof Error) throw failure; return new Response(null, { status: failure }); };
      globalThis.fetch = fetcher;
      const api = clients(env, { fetcher, sleep: async ms => delays.push(ms) });
      assert.deepEqual(await api.platform('/api/automation/jobs/job-1', body), { ok: true, duplicate: true });
      assert.deepEqual(requests, [JSON.stringify(body), JSON.stringify(body)]);
      assert.deepEqual(delays, [500]);
    }
    for (const [status, target, attempts] of [[503, 'platform', 3], [409, 'platform', 1], [401, 'platform', 1], [503, 'github', 1]]) {
      let calls = 0; const delays = [];
      const fetcher = async () => { calls++; return new Response(null, { status }); };
      const api = clients(env, { fetcher, sleep: async ms => delays.push(ms) });
      await assert.rejects(api[target]('/api/automation/jobs/job-1', body), error => error.status === status);
      assert.equal(calls, attempts); assert.deepEqual(delays, attempts === 3 ? [500, 1000] : []);
    }
  } finally { globalThis.fetch = originalFetch; }
});

const workflow = parse(await readFile('.github/workflows/relay-agent.yml', 'utf8'));
test('AI/candidate jobs never receive callback/deployment or GitHub write credentials', () => {
  for (const name of ['triage', 'agent', 'verify']) {
    const job = workflow.jobs[name];
    assert.deepEqual(job.permissions, { contents: 'read' });
    assert.doesNotMatch(JSON.stringify(job), /RELAY_CALLBACK_SECRET|CLOUDFLARE|GH_TOKEN/);
  }
  assert.doesNotMatch(JSON.stringify(workflow.jobs.verify), /secrets\./);
  for (const name of ['triage', 'agent']) {
    const action = workflow.jobs[name].steps.find(step => step.uses?.startsWith('openai/codex-action@'));
    assert.equal(action.with['safety-strategy'], 'drop-sudo');
    assert.equal(action.with['allow-bots'], true);
    assert.match(action.with['prompt-file'], /^\.relay-trusted\//);
    assert.doesNotMatch(workflow.jobs[name].steps.map(step => step.run || '').join('\n'), /npm |npx |node .*demo|npm test/);
  }
});
test('publish/report require isolated verification, trusted automation, and exact head evidence', async () => {
  assert.deepEqual(workflow.jobs.publish.needs, ['prepare', 'verify']);
  assert.deepEqual(workflow.jobs['evidence-report'].needs, ['prepare', 'verify']);
  const commands = workflow.jobs.publish.steps.map(step => step.run || '').join('\n');
  assert.doesNotMatch(commands, /npm |npx |node scripts\//);
  assert.match(commands, /node \.relay-trusted\/scripts\/relay\/run\.mjs publish/);
  assert.match(workflow.jobs.prepare.if, /default_branch/);
  assert.match(workflow.jobs['failure-report'].if, /default_branch/);
  const config = await readFile('scripts/relay/playwright.config.mjs', 'utf8');
  assert.match(config, /video: 'on'/);
  assert.match(config, /screenshot: 'on'/);
  assert.match(config, /retries: 0/);
  assert.match(config, /forbidOnly: true/);
});
test('the nested evidence configuration starts its server in the candidate workspace root', async () => {
  const { default: config } = await import('../scripts/relay/playwright.config.mjs');
  assert.equal(config.webServer.cwd, process.cwd());
  assert.equal(config.testDir, join(process.cwd(), 'e2e/agent'));
});

test('trusted preparation and publisher use job freshness checks and an atomic non-force branch update', async () => {
  const originalDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'relay-publisher-'));
  const saved = Object.fromEntries(['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_REF', 'JOB_ID', 'TICKET_ID', 'JOB_KIND', 'GITHUB_OUTPUT'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { GITHUB_REPOSITORY: 'owner/relay', GITHUB_RUN_ID: '100', GITHUB_REF: 'refs/heads/main', JOB_ID: 'job-1', TICKET_ID: 'RLY-1', JOB_KIND: 'implement', GITHUB_OUTPUT: join(directory, 'outputs') });
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  try {
    process.chdir(directory);
    git(['init', '-q']); git(['config', 'user.email', 'test@example.test']); git(['config', 'user.name', 'Relay Test']);
    await mkdir('demo', { recursive: true }); await mkdir('tests/demo', { recursive: true });
    await writeFile('demo/app.js', 'export const count = 0;\n'); await writeFile('tests/demo/app.test.js', "import { test } from 'node:test';\ntest('initial', () => {});\n");
    git(['add', '.']); git(['commit', '-qm', 'base']);
    const source = git(['rev-parse', 'HEAD']);
    const value = fixture(); value.baseSha = source; value.sourceSha = source;
    const writes = [];
    let current = structuredClone(value);
    let dispatches = [];
    const api = {
      platform: async (path, body) => { assert.equal(path, '/api/automation/jobs/job-1'); if (body) { writes.push(body); return {}; } return structuredClone(current); },
      github: async (path, body, method) => {
        if (path === '') return { default_branch: 'main' };
        if (path === 'commits/main') return { sha: source };
        if (path.startsWith('pulls?state=open')) return [];
        if (path === 'git/ref/heads/relay/ticket-RLY-1') { const error = new Error('Missing'); error.status = 404; throw error; }
        if (path === 'git/commits/' + source) return { tree: { sha: 'c'.repeat(40) } };
        if (path === 'git/trees') { assert.equal(body.tree.length, 2); return { sha: 'd'.repeat(40) }; }
        if (path === 'git/commits') { assert.deepEqual(body.parents, [source]); return { sha: nextSha }; }
        if (path === 'git/refs') { assert.deepEqual(body, { ref: 'refs/heads/relay/ticket-RLY-1', sha: nextSha }); return {}; }
        if (path === 'pulls') { assert.match(body.body, /Closes #10/); return { number: 42, head: { sha: nextSha } }; }
        if (path.includes('/dispatches')) { dispatches.push({ path, body }); return null; }
        throw new Error('Unexpected API call: ' + path + ' ' + method);
      },
    };
    await prepare(api);
    assert.equal(writes[0].status, 'running');
    assert.equal(JSON.parse(await readFile('.agent-output/job.json', 'utf8')).sourceSha, source);
    await writeFile('demo/app.js', 'export const count = 1;\n');
    await writeFile('tests/demo/app.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { count } from '../../demo/app.js';\ntest('updated', () => assert.equal(count, 1));\n");
    git(['add', 'demo', 'tests/demo']);
    assert.equal(validatePatch('implement').length, 2);
    await writeFile('.agent-output/summary.json', JSON.stringify({ summary: 'Added the requested behavior and its test.' }));
    await publish(api);
    assert.equal(dispatches.length, 2);
    assert.deepEqual(writes.at(-1).pullRequest, { number: 42, headSha: nextSha });
    assert.equal(writes.at(-1).status, 'succeeded');
    value.ticket.prNumber = 42; value.ticket.headSha = source; value.job.headSha = source;
    current = structuredClone(value);
    await writeFile('.agent-output/job.json', JSON.stringify(value));
    const firstGithub = api.github;
    let leased = false;
    api.github = async (path, body, method) => {
      if (path === 'pulls/42' && !body) return { ...prFixture(), head: { ...prFixture().head, sha: source } };
      if (path === 'pulls/42' && body) return { number: 42, head: { sha: nextSha } };
      if (path === 'git/refs/heads/relay/ticket-RLY-1') { assert.equal(method, 'PATCH'); assert.deepEqual(body, { sha: nextSha, force: false }); leased = true; return {}; }
      return firstGithub(path, body, method);
    };
    await publish(api);
    assert.equal(leased, true);
    current.ticket.status = 'human_edit';
    await assert.rejects(publish(api), /Ticket changed/);
    current = structuredClone(value); current.ticket.description = 'A human refined the feature during the run.';
    await assert.rejects(currentJob(api, value), /Ticket changed/);
    current = structuredClone(value); current.ticket.title = 'A new request title';
    await assert.rejects(currentJob(api, value), /Ticket changed/);
    current = structuredClone(value); current.ticket.requestRevision = 0;
    await assert.doesNotReject(currentJob(api, value));
    for (const requestRevision of [1, 2]) { // Includes edits reverted to identical text and type-only changes.
      current = structuredClone(value); current.ticket.requestRevision = requestRevision;
      await assert.rejects(currentJob(api, value), /Ticket changed/);
    }
    current = structuredClone(value); current.job.status = 'succeeded';
    await assert.rejects(currentJob(api, value), /stale/);
    current = structuredClone(value); current.ticket.headSha = nextSha; current.job.headSha = nextSha;
    await assert.rejects(currentJob(api, value), /Ticket changed/);
    const recovered = fixture(); recovered.baseSha = source; recovered.sourceSha = source; recovered.existingBranch = true; recovered.recoveredPrNumber = 42;
    current = structuredClone(recovered);
    await writeFile('.agent-output/job.json', JSON.stringify(recovered));
    git(['read-tree', 'HEAD']);
    assert.deepEqual(validateCandidate(recovered), []);
    assert.throws(() => validateCandidate(fixture()), /1–30/);
    api.github = async (path, body) => {
      if (path === 'pulls/42') return { ...prFixture(), head: { ...prFixture().head, sha: source } };
      if (path.includes('/dispatches')) return null;
      throw new Error('Recovered unchanged publication must not create commits: ' + path + ' ' + JSON.stringify(body));
    };
    await publish(api);
    assert.deepEqual(writes.at(-1).pullRequest, { number: 42, headSha: source });
  } finally {
    process.chdir(originalDirectory);
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  }
});

test('retries recover an orphan ticket PR/branch but never unrelated or protected changes', async () => {
  const value = fixture();
  const pr = { ...prFixture(), changed_files: 2, head: { ...prFixture().head, sha: nextSha } };
  const files = [{ filename: 'demo/app.js', status: 'modified' }, { filename: 'tests/demo/app.test.js', status: 'added' }];
  const tree = { truncated: false, tree: [{ path: 'demo/app.js', mode: '100644' }, { path: 'tests/demo/app.test.js', mode: '100644' }] };
  const api = { github: async path => {
    if (path.startsWith('pulls?')) return [{ number: 42 }];
    if (path === 'pulls/42') return pr;
    if (path.startsWith('pulls/42/files')) return files;
    if (path.startsWith('git/trees/')) return tree;
    throw new Error('Unexpected recovery API: ' + path);
  } };
  await recoverPublication(api, value);
  assert.equal(value.sourceSha, nextSha);
  assert.equal(value.recoveredPrNumber, 42);
  assert.equal(value.existingBranch, true);
  files[0].filename = '.github/workflows/ci.yml';
  await assert.rejects(recoverPublication(api, fixture()), /protected/);
  files[0].filename = 'demo/app.js'; tree.tree[0].mode = '120000';
  await assert.rejects(recoverPublication(api, fixture()), /unsafe/);
  tree.tree[0].mode = '100644';
  let status = 'ahead';
  const branchApi = { github: async path => {
    if (path.startsWith('pulls?')) return [];
    if (path.startsWith('git/ref/')) return { object: { sha: nextSha, type: 'commit' } };
    if (path.startsWith('compare/')) return { status, files };
    if (path.startsWith('git/trees/')) return tree;
    throw new Error('Unexpected recovery API: ' + path);
  } };
  const orphan = fixture();
  await recoverPublication(branchApi, orphan);
  assert.equal(orphan.sourceSha, nextSha);
  assert.equal(orphan.existingBranch, true);
  assert.equal(orphan.recoveredPrNumber, undefined);
  status = 'diverged';
  await assert.rejects(recoverPublication(branchApi, fixture()), /unrelated/);
});

test('feedback on an existing PR can run after human description edits clear triage, with full head and path guards', async () => {
  const originalDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'relay-feedback-'));
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_REF', 'JOB_ID', 'TICKET_ID', 'JOB_KIND', 'GITHUB_OUTPUT'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { GITHUB_REPOSITORY: 'owner/relay', GITHUB_RUN_ID: '100', GITHUB_REF: 'refs/heads/main', JOB_ID: 'job-1', TICKET_ID: 'RLY-1', JOB_KIND: 'implement', GITHUB_OUTPUT: join(directory, 'outputs') });
  const value = linked('implement');
  value.ticket.triage = null;
  value.ticket.description = 'A human clarified the expected keyboard behavior.';
  let currentHead = sha, changedPath = 'demo/app.js';
  const callbacks = [];
  const api = {
    platform: async (path, body) => { if (body) { callbacks.push(body); return {}; } return structuredClone(value); },
    github: async path => {
      if (path === '') return { default_branch: 'main' };
      if (path === 'commits/main') return { sha };
      if (path === 'pulls/42') return { ...prFixture(), head: { ...prFixture().head, sha: currentHead } };
      if (path.startsWith('pulls/42/files')) return [{ filename: changedPath, status: 'modified' }];
      if (path.startsWith('git/trees/')) return { truncated: false, tree: [{ path: changedPath, mode: '100644' }] };
      throw new Error('Unexpected feedback preparation call: ' + path);
    },
  };
  try {
    process.chdir(directory);
    await prepare(api);
    assert.equal(callbacks[0].status, 'running');
    const prepared = JSON.parse(await readFile('.agent-output/job.json', 'utf8'));
    assert.equal(prepared.sourceSha, sha);
    assert.equal(prepared.ticket.description, value.ticket.description);
    currentHead = nextSha;
    await assert.rejects(prepare(api), /PR changed/);
    currentHead = sha; changedPath = '.github/workflows/ci.yml';
    await assert.rejects(prepare(api), /protected files/);
    assert.equal(callbacks.length, 1);
  } finally {
    process.chdir(originalDirectory);
    for (const [key, entry] of Object.entries(saved)) entry === undefined ? delete process.env[key] : process.env[key] = entry;
    await rm(directory, { recursive: true, force: true });
  }
});
