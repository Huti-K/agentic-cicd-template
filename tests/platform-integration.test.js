import test from 'node:test';
import assert from 'node:assert/strict';
import { platformHarness, PLATFORM_ORIGIN, PASSWORD, REPO, BASE_SHA, PR_SHA } from './helpers/platform-harness.js';

const success = result => assert.ok(result.status >= 200 && result.status < 300, JSON.stringify({ status: result.status, data: result.data }));
const triage = { description: 'Preserve the unsent composer value and focus when ticket metadata refreshes.', summary: 'Separate the composer lifecycle from background ticket refreshes.', ready: true, acceptanceCriteria: ['An unsent reply and its focus survive background refresh.'], files: [{ path: 'demo/src/platform.js', reason: 'Ticket rendering and polling.' }], documentation: [{ path: 'docs/ARCHITECTURE.md', reason: 'Rendering lifecycle.' }] };

async function signedIn(context) {
  const api = await platformHarness(context);
  success(await api.signIn());
  return api;
}

test('public read APIs expose workspace data without session or integration secrets', async context => {
  const api = await platformHarness(context);
  const session = await api.request('/api/session', { authenticated: false });
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, false);
  assert.equal(session.data.csrfToken, undefined);
  const workspace = await api.request('/api/workspace', { authenticated: false });
  success(workspace);
  assert.equal(workspace.data.repository, REPO);
  assert.ok(Array.isArray(workspace.data.tickets));
  const serialized = JSON.stringify(workspace.data);
  for (const secret of [api.env.GITHUB_TOKEN, api.env.RELAY_CALLBACK_SECRET, api.env.SESSION_SECRET, api.env.MAINTAINER_PASSWORD_HASH]) assert.equal(serialized.includes(secret), false);
  assert.match(workspace.response.headers.get('Cache-Control') ?? '', /no-store/);
});

test('sign-in enforces origin and password, issues a secure cookie, and logout revokes the session', async context => {
  const api = await platformHarness(context);
  assert.equal((await api.request('/api/session', { method: 'POST', origin: 'https://attacker.test', body: { password: PASSWORD } })).status, 403);
  assert.equal((await api.request('/api/session', { method: 'POST', body: { password: 'incorrect' } })).status, 401);
  const login = await api.signIn();
  success(login);
  assert.equal(login.data.authenticated, true);
  assert.ok(login.data.csrfToken.length >= 20);
  const cookie = login.response.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=(Strict|Lax)/i);
  assert.equal((await api.request('/api/session')).data.authenticated, true);
  assert.equal((await api.request('/api/session', { method: 'DELETE', csrf: false })).status, 403);
  success(await api.request('/api/session', { method: 'DELETE' }));
  assert.equal((await api.request('/api/session')).data.authenticated, false);
});

test('all browser mutations require both a session and CSRF proof before contacting GitHub', async context => {
  const api = await signedIn(context);
  const created = await api.createTicket(); success(created);
  const id = created.data.ticket.id;
  const routes = [
    ['/api/tickets', 'POST', { title: 'Unauthorized', description: 'No write should occur.' }],
    [`/api/tickets/${id}`, 'PATCH', { version: created.data.ticket.version, title: 'Unauthorized' }],
    [`/api/tickets/${id}/comments`, 'POST', { body: '@ai triage this' }],
    [`/api/tickets/${id}/actions`, 'POST', { action: 'triage' }],
    ['/api/inbox', 'POST', { senderName: 'Example', senderEmail: 'example@example.test', subject: 'Unauthorized', body: 'No write should occur.', idempotencyKey: 'unauthorized-email-key' }],
  ];
  for (const [path, method, body] of routes) {
    const before = api.github.calls.length;
    assert.equal((await api.request(path, { method, body, authenticated: false })).status, 401, path);
    assert.equal((await api.request(path, { method, body, csrf: false })).status, 403, path);
    assert.equal((await api.request(path, { method, body, origin: 'https://attacker.test' })).status, 403, path);
    assert.equal(api.github.calls.length, before, 'rejected writes must not reach GitHub');
  }
});

test('ticket creation and optimistic editing preserve immutable identifiers and reject stale versions', async context => {
  const api = await signedIn(context);
  const created = await api.createTicket({ assigneeId: 'huti', contributorIds: ['davidmikan'] }); success(created);
  const original = created.data.ticket;
  assert.equal(original.id, 'RLY-1');
  assert.deepEqual(new Set(original.contributorIds), new Set(['huti', 'davidmikan']));
  assert.match(original.issueUrl, /^https:\/\/github.com\/Huti-K\/agentic-cicd-template\/issues\/\d+$/);
  const updated = await api.request('/api/tickets/RLY-1', { method: 'PATCH', body: { version: original.version, title: 'Keep support drafts during refresh', priority: 'urgent', status: 'deployed', issueNumber: 999 } });
  success(updated);
  assert.equal(updated.data.ticket.title, 'Keep support drafts during refresh');
  assert.equal(updated.data.ticket.priority, 'urgent');
  assert.equal(updated.data.ticket.status, original.status);
  assert.equal(updated.data.ticket.issueNumber, original.issueNumber);
  assert.ok(updated.data.ticket.version > original.version);
  const stale = await api.request('/api/tickets/RLY-1', { method: 'PATCH', body: { version: original.version, title: 'Overwrite another edit' } });
  assert.equal(stale.status, 409);
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.title, updated.data.ticket.title);
});

test('invalid ticket payloads are rejected without creating remote issues or local tickets', async context => {
  const api = await signedIn(context);
  for (const invalid of [{ title: '' }, { description: '' }, { type: 'surprise' }, { priority: 'critical' }, { tags: 'support' }, { contributorIds: {} }, { assigneeId: 'unknown' }]) {
    assert.equal((await api.createTicket(invalid)).status, 400, JSON.stringify(invalid));
  }
  assert.equal((await api.request('/api/workspace')).data.tickets.length, 0);
  assert.equal(api.github.calls.filter(call => call.method === 'POST').length, 0);
});

test('mentions add real workspace contributors and duplicate AI requests cannot start parallel paid jobs', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const comment = await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: '@DavidMikan please help. @AI clarify the reproduction.' } });
  success(comment);
  assert.ok(comment.data.ticket.contributorIds.includes('davidmikan'));
  assert.ok(comment.data.ticket.contributorIds.includes('ai'));
  assert.equal(comment.data.ticket.status, 'triaging');
  assert.equal(comment.data.jobs.filter(job => ['queued', 'running'].includes(job.status)).length, 1);
  assert.equal(api.github.dispatches.length, 1);
  const repeated = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } });
  assert.ok([200, 409].includes(repeated.status));
  assert.equal(api.github.dispatches.length, 1);
});

test('email addresses and unknown handles do not summon agents or grant contributors', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const commented = await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: 'Contact user@huti or support@example.test. @ai-helper and @unknown are plain text.' } });
  success(commented);
  assert.equal(commented.data.jobs.length, 0);
  assert.equal(api.github.dispatches.length, 0);
  assert.equal(commented.data.ticket.contributorIds.includes('ai'), false);
});

test('trusted triage callbacks enrich tickets, remain idempotent and reject browser or missing credentials', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const queued = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }); success(queued);
  const job = queued.data.jobs.find(job => job.kind === 'triage');
  const payload = { status: 'succeeded', runId: 456, headSha: BASE_SHA, summary: 'Triage completed.', triage };
  assert.equal((await api.callback(job.id, payload, false)).status, 401);
  success(await api.callback(job.id, { status: 'running', runId: 456 }));
  success(await api.callback(job.id, payload));
  const after = await api.request('/api/tickets/RLY-1');
  assert.equal(after.data.ticket.status, 'ready');
  assert.equal(after.data.ticket.description, triage.description);
  assert.equal(after.data.ticket.originalDescription, 'The unsent reply disappears during a background refresh.');
  const version = after.data.ticket.version;
  success(await api.callback(job.id, payload));
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.version, version);
});

test('human editing prevents queued or stale AI work from overwriting the ticket', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const queued = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }); success(queued);
  const job = queued.data.jobs[0];
  const paused = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'human-edit' } }); success(paused);
  assert.equal(paused.data.ticket.status, 'human_edit');
  const callback = await api.callback(job.id, { status: 'succeeded', runId: 456, triage, summary: 'Late triage completion.' });
  assert.ok([200, 409].includes(callback.status));
  const current = await api.request('/api/tickets/RLY-1');
  assert.equal(current.data.ticket.status, 'human_edit');
  assert.equal(current.data.ticket.description, 'The unsent reply disappears during a background refresh.');
  const feedback = await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: 'I will make this adjustment myself. @ai', kind: 'comment' } }); success(feedback);
  assert.equal(api.github.dispatches.length, 1);
});

test('new human descriptions survive late triage and callbacks cannot switch workflow identities', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const queued = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }); success(queued);
  const job = queued.data.jobs[0];
  success(await api.callback(job.id, { status: 'running', runId: 456 }));
  assert.equal((await api.callback(job.id, { status: 'succeeded', runId: 999, triage })).status, 409);
  assert.equal((await api.callback(job.id, { status: 'succeeded', runId: 456, triage: { ...triage, files: [null] } })).status, 400);
  const edited = await api.request('/api/tickets/RLY-1', { method: 'PATCH', body: { version: queued.data.ticket.version, description: 'A human clarified that the issue only occurs after signing out.' } }); success(edited);
  assert.equal((await api.callback(job.id, { status: 'succeeded', runId: 456, triage })).status, 409);
  const current = await api.request('/api/tickets/RLY-1');
  assert.equal(current.data.ticket.description, 'A human clarified that the issue only occurs after signing out.');
  assert.equal(current.data.ticket.triage, null);
});

test('a human edit accepted during terminal callback processing is never silently overwritten', { timeout: 10_000 }, async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const queued = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }); success(queued);
  const job = queued.data.jobs[0], database = api.env.DB;
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const terminalReady = new Promise(resolve => { reached = resolve; });
  context.after(() => release());
  api.env.DB = new Proxy(database, { get(target, key) {
    if (key === 'batch') return async statements => { reached(); await gate; return target.batch(statements); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const callback = api.callback(job.id, { status: 'succeeded', runId: 456, triage });
  await terminalReady;
  const humanDescription = 'New human evidence: the problem is restricted to Safari.';
  const edited = await api.request('/api/tickets/RLY-1', { method: 'PATCH', body: { version: queued.data.ticket.version, description: humanDescription } });
  success(edited);
  release();
  const result = await callback;
  assert.equal(result.status, 409);
  const current = await api.request('/api/tickets/RLY-1');
  assert.equal(current.data.ticket.description, humanDescription);
  assert.equal(current.data.ticket.activeJobId, job.id);
  assert.equal(current.data.jobs.find(item => item.id === job.id).status, 'queued');
  assert.equal(current.data.comments.some(comment => comment.kind === 'triage'), false);
});

test('a failing terminal transaction rolls back both job and ticket so the callback can be retried', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const queued = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }); success(queued);
  const job = queued.data.jobs[0], database = api.env.DB;
  api.env.DB = new Proxy(database, { get(target, key) {
    if (key === 'batch') return statements => target.batch([...statements.slice(0, 2), target.prepare('INSERT INTO comments SELECT * FROM comments WHERE id=?').bind(queued.data.comments[0].id)]);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const payload = { status: 'succeeded', runId: 456, triage, summary: 'Ready for implementation.' };
  assert.equal((await api.callback(job.id, payload)).status, 500);
  let current = await api.request('/api/tickets/RLY-1');
  assert.equal(current.data.ticket.status, 'triaging');
  assert.equal(current.data.ticket.activeJobId, job.id);
  assert.equal(current.data.jobs.find(item => item.id === job.id).status, 'queued');
  api.env.DB = database;
  success(await api.callback(job.id, payload));
  current = await api.request('/api/tickets/RLY-1');
  assert.equal(current.data.ticket.status, 'ready');
  assert.equal(current.data.ticket.activeJobId, null);
  assert.equal(current.data.jobs.find(item => item.id === job.id).status, 'succeeded');
  assert.equal(current.data.comments.filter(comment => comment.kind === 'triage').length, 1);
});

test('concurrent deliveries of the same mock email create one ticket and one agent run', async context => {
  const api = await signedIn(context);
  const body = { senderName: 'Jamie Example', senderEmail: 'jamie@example.test', subject: 'Concurrent delivery', body: 'The email request may be delivered twice.', idempotencyKey: 'fixture-concurrent-support-email' };
  const results = await Promise.all([api.request('/api/inbox', { method: 'POST', body }), api.request('/api/inbox', { method: 'POST', body })]);
  assert.ok(results.some(result => result.status === 201));
  assert.ok(results.every(result => [201, 409].includes(result.status)), JSON.stringify(results.map(({status,data}) => ({status,data}))));
  assert.equal((await api.request('/api/workspace')).data.tickets.length, 1);
  assert.equal((await api.request('/api/inbox')).data.messages.length, 1);
  assert.equal(api.github.dispatches.length, 1);
});

test('password attempts are rate limited before a public caller can brute-force sign-in', async context => {
  const api = await platformHarness(context);
  for (let index = 0; index < 10; index++) assert.equal((await api.request('/api/session', { method: 'POST', body: { password: 'incorrect' } })).status, 401);
  assert.equal((await api.request('/api/session', { method: 'POST', body: { password: PASSWORD } })).status, 429);
  assert.equal((await api.request('/api/session')).data.authenticated, false);
});

test('support email retries are idempotent and conflicting key reuse cannot create duplicate tickets', async context => {
  const api = await signedIn(context);
  const body = { senderName: 'Jamie Example', senderEmail: 'jamie@example.test', subject: 'My draft vanished', body: 'A background ticket refresh removed the draft.', idempotencyKey: 'fixture-support-email-001' };
  const first = await api.request('/api/inbox', { method: 'POST', body }); success(first);
  const second = await api.request('/api/inbox', { method: 'POST', body }); success(second);
  assert.equal(second.data.ticket.id, first.data.ticket.id);
  assert.equal(second.data.message.id, first.data.message.id);
  assert.equal((await api.request('/api/inbox')).data.messages.length, 1);
  assert.equal((await api.request('/api/workspace')).data.tickets.length, 1);
  assert.equal(api.github.dispatches.length, 1);
  assert.equal((await api.request('/api/inbox', { method: 'POST', body: { ...body, subject: 'An unrelated request' } })).status, 409);
});

test('the full trusted agent sequence requires exact-head evidence, human approval, and verified deployment ancestry', async context => {
  const api = await signedIn(context);
  success(await api.createTicket());
  const triaging = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }); success(triaging);
  success(await api.callback(triaging.data.jobs[0].id, { status: 'succeeded', runId: 456, triage, summary: 'Triage complete.' }));
  const implementing = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'implement' } }); success(implementing);
  const implementation = implementing.data.jobs.find(job => job.kind === 'implement');
  success(await api.callback(implementation.id, { status: 'succeeded', runId: 456, headSha: PR_SHA, summary: 'Implementation published.', pullRequest: { number: 71, headSha: PR_SHA } }));
  const review = await api.request('/api/tickets/RLY-1'); success(review);
  assert.equal(review.data.ticket.status, 'in_review');
  assert.equal(review.data.ticket.prNumber, 71);
  assert.equal(review.data.ticket.headSha, PR_SHA);
  assert.equal(review.data.pullRequest.canMerge, false);
  let evidenceJob = review.data.jobs.find(job => job.kind === 'evidence' && ['queued', 'running'].includes(job.status));
  if (!evidenceJob) {
    const evidence = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'evidence' } }); success(evidence);
    evidenceJob = evidence.data.jobs.find(job => job.kind === 'evidence');
  }
  const item = { kind: 'artifact', title: 'Desktop and mobile report with videos', url: `https://github.com/${REPO}/actions/runs/456/artifacts/789`, headSha: PR_SHA };
  const mismatched = await api.callback(evidenceJob.id, { status: 'succeeded', runId: 456, headSha: PR_SHA, evidence: [{ ...item, headSha: BASE_SHA }], summary: 'Evidence ready.' });
  assert.equal(mismatched.status, 400);
  success(await api.callback(evidenceJob.id, { status: 'succeeded', runId: 456, headSha: PR_SHA, evidence: [item], summary: 'Evidence ready.' }));
  const completed = await api.request('/api/tickets/RLY-1');
  assert.equal(completed.data.evidence.length, 1);
  assert.equal(completed.data.pullRequest.evidenceReady, true);
  assert.equal(completed.data.pullRequest.checksReady, true);
  const action = headSha => api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'approve-merge', headSha } });
  assert.equal((await action(BASE_SHA)).status, 409);
  assert.equal(api.github.mergeCalls, 0);
  api.github.checks[0].conclusion = 'failure';
  assert.equal((await action(PR_SHA)).status, 409);
  assert.equal(api.github.mergeCalls, 0);
  api.github.checks[0].conclusion = 'success';
  api.github.files.push({ filename: '.github/workflows/unsafe.yml', additions: 1, deletions: 0 });
  assert.equal((await action(PR_SHA)).status, 409);
  assert.equal(api.github.mergeCalls, 0);
  api.github.files.pop();
  const merged = await action(PR_SHA); success(merged);
  assert.equal(merged.data.ticket.status, 'merged');
  assert.equal(api.github.mergeCalls, 1);
  assert.equal(api.github.calls.find(call => call.path.endsWith('/merge')).body.sha, PR_SHA);
  const deploy = (body, authorized = true) => api.request('/api/automation/deployment', { method: 'POST', authenticated: false, csrf: false, origin: null, headers: authorized ? { Authorization: 'Bearer ' + api.env.RELAY_CALLBACK_SECRET } : {}, body });
  const deployment = { sha: BASE_SHA, url: PLATFORM_ORIGIN, runId: 789 };
  assert.equal((await deploy(deployment, false)).status, 401);
  assert.equal((await deploy({ ...deployment, url: 'https://attacker.test' })).status, 400);
  api.github.compareStatus = 'diverged';
  success(await deploy(deployment));
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.status, 'merged');
  api.github.compareStatus = 'ahead';
  success(await deploy(deployment));
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.status, 'deployed');
  assert.equal((await api.request('/api/workspace')).data.deployment.sha, BASE_SHA);
});

test('unexpected API errors never include private integration configuration', async context => {
  const api = await signedIn(context);
  api.github.failure = { status: 503, path: '/issues' };
  const result = await api.createTicket();
  assert.ok(result.status >= 400 || (result.data.ticket.error && !result.data.ticket.issueNumber));
  const serialized = JSON.stringify(result.data);
  for (const secret of [api.env.GITHUB_TOKEN, api.env.RELAY_CALLBACK_SECRET, api.env.SESSION_SECRET]) assert.equal(serialized.includes(secret), false);
});
