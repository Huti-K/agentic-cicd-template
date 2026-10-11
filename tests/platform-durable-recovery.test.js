import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../worker/db.js';
import { sha256 } from '../worker/model.js';
import { platformHarness, PR_SHA, BASE_SHA, REPO } from './helpers/platform-harness.js';

const old = '2000-01-01T00:00:00.000Z';
const email = { senderName: 'Jamie Example', senderEmail: 'jamie@example.test', subject: 'Recover interrupted email', body: 'Please preserve this support request.', idempotencyKey: 'durable-email-001' };
const triage = { description: 'Keep support requests durable across interrupted delivery.', summary: 'A recoverable inbox transaction is required.', ready: true, acceptanceCriteria: ['Retrying an email creates one ticket.'], files: [], documentation: [] };
async function setup(context) {
  const api = await platformHarness(context);
  assert.equal((await api.signIn()).status, 200);
  return { api, store: new Store(api.DB) };
}
async function ticket(context, changes = {}) {
  const { api, store } = await setup(context);
  const created = await api.createTicket();
  return { api, store, ticket: await store.update(created.data.ticket, changes) };
}
async function review(context, changes = {}) {
  return ticket(context, { status: 'in_review', prNumber: 71, prUrl: `https://github.com/${REPO}/pull/71`, headSha: PR_SHA, triage: { ready: true }, ...changes });
}

test('an interrupted inbox reservation reuses its durable ticket and queues triage once', async context => {
  const { api, store, ticket: original } = await ticket(context, { sourceInboxId: 'interrupted-email' });
  const message = { id: 'interrupted-email', ...email, ticketId: null, createdAt: old, processingUntil: 1 };
  const hash = await sha256(JSON.stringify({ senderName: email.senderName, senderEmail: email.senderEmail, subject: email.subject, body: email.body }));
  await api.DB.prepare('INSERT INTO inbox(id,idempotency_key,request_hash,data,created_at) VALUES(?,?,?,?,?)').bind(message.id, email.idempotencyKey, hash, JSON.stringify(message), old).run();
  const recovered = await api.request('/api/inbox', { method: 'POST', body: email });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.data.ticket.id, original.id);
  assert.equal(recovered.data.message.ticketId, original.id);
  assert.equal((await store.listTickets()).length, 1);
  assert.equal(api.github.dispatches.length, 1);
  const repeated = await api.request('/api/inbox', { method: 'POST', body: email });
  assert.equal(repeated.status, 201);
  assert.equal(api.github.dispatches.length, 1);
});

test('ticket creation and inbox association roll back together before any external action', async context => {
  const { api, store } = await setup(context), database = api.env.DB;
  api.env.DB = new Proxy(database, { get(target, key) {
    if (key === 'batch') return statements => target.batch([...statements, target.prepare('INSERT INTO missing_recovery_fixture VALUES(1)')]);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const failed = await api.request('/api/inbox', { method: 'POST', body: email });
  assert.equal(failed.status, 500);
  assert.equal((await store.listTickets()).length, 0);
  assert.equal((await store.inbox()).length, 0);
  assert.equal(api.github.calls.length, 0);
  api.env.DB = database;
  assert.equal((await api.request('/api/inbox', { method: 'POST', body: email })).status, 201);
  assert.equal((await store.listTickets()).length, 1);
});

test('retrying a failed inbox dispatch resumes its existing ticket and honors human editing', async context => {
  const { api, store } = await setup(context);
  api.github.failure = { path: '/dispatches', status: 503 };
  const failed = await api.request('/api/inbox', { method: 'POST', body: email });
  assert.equal(failed.status, 201);
  assert.equal(failed.data.ticket.status, 'failed');
  assert.equal(failed.data.message.processingComplete, false);
  api.github.failure = null;
  const recovered = await api.request('/api/inbox', { method: 'POST', body: email });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.data.ticket.id, failed.data.ticket.id);
  assert.equal(recovered.data.ticket.status, 'triaging');
  assert.equal(recovered.data.message.processingComplete, true);
  assert.equal(api.github.dispatches.length, 1);
  assert.equal(api.github.calls.filter(call => call.path.endsWith('/issues') && call.method === 'POST').length, 1);
  assert.equal((await store.listTickets()).length, 1);
  await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'human-edit' } });
  assert.equal((await api.request('/api/inbox', { method: 'POST', body: email })).data.ticket.status, 'human_edit');
  assert.equal(api.github.dispatches.length, 1);
});

test('an inbox lease expires and resumes a linked ticket after process interruption', async context => {
  const { api, store, ticket: original } = await ticket(context, { sourceInboxId: 'leased-email' });
  const message = { id: 'leased-email', ...email, ticketId: original.id, createdAt: old, processingUntil: Date.now() + 60_000, processingOwner: 'interrupted-process' };
  const hash = await sha256(JSON.stringify({ senderName: email.senderName, senderEmail: email.senderEmail, subject: email.subject, body: email.body }));
  await api.DB.prepare('INSERT INTO inbox(id,idempotency_key,request_hash,data,created_at) VALUES(?,?,?,?,?)').bind(message.id, email.idempotencyKey, hash, JSON.stringify(message), old).run();
  assert.equal((await api.request('/api/inbox', { method: 'POST', body: email })).status, 409);
  assert.equal(api.github.dispatches.length, 0);
  await api.DB.prepare('UPDATE inbox SET data=json_set(data,\'$.processingUntil\',1) WHERE id=?').bind(message.id).run();
  assert.equal((await api.request('/api/inbox', { method: 'POST', body: email })).status, 201);
  assert.equal((await store.listTickets()).length, 1);
  assert.equal(api.github.dispatches.length, 1);
});

test('expired merge locks release only after GitHub confirms the same revision is still unmerged', async context => {
  const { api, store } = await review(context, { mergePending: true, mergeStartedAt: old });
  api.github.failure = { path: '/pulls/71', status: 503 };
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.mergePending, true);
  api.github.failure = null;
  api.github.pull.head.ref = 'unrelated-branch';
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.mergePending, true);
  api.github.pull.head.ref = 'relay/ticket-RLY-1';
  api.github.pull.head.sha = BASE_SHA;
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.mergePending, true);
  api.github.pull.head.sha = PR_SHA;
  const recovered = await api.request('/api/tickets/RLY-1');
  assert.equal(recovered.data.ticket.mergePending, false);
  assert.equal(recovered.data.ticket.status, 'in_review');
  assert.match(recovered.data.ticket.error, /interrupted|expired/i);
  assert.equal(api.github.mergeCalls, 0);
  await store.update(await store.ticket('RLY-1'), { mergePending: true, mergeStartedAt: new Date().toISOString() });
  assert.equal((await api.request('/api/tickets/RLY-1')).data.ticket.mergePending, true);
});

test('AI mentions during active triage coalesce into one durable rerun using current discussion', async context => {
  const { api, store } = await ticket(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } });
  const initialJob = started.data.jobs[0];
  for (const body of ['@ai include Safari.', '@ai also preserve keyboard focus.']) {
    assert.equal((await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body } })).status, 200);
  }
  assert.ok((await store.ticket('RLY-1')).pendingAgent);
  assert.equal(api.github.dispatches.length, 1);
  const payload = { status: 'succeeded', runId: 456, summary: 'Initial triage completed.', triage };
  assert.equal((await api.callback(initialJob.id, payload)).status, 200);
  const current = await store.ticket('RLY-1'), jobs = await store.jobs('RLY-1');
  assert.equal(current.pendingAgent, null);
  assert.equal(current.status, 'triaging');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].kind, 'triage', 'triage feedback must not bypass the human implementation action');
  assert.equal(jobs[0].description, triage.description);
  assert.equal(api.github.dispatches.length, 2);
  const snapshot = await api.request(`/api/automation/jobs/${jobs[0].id}`, { headers: { Authorization: 'Bearer ' + api.env.RELAY_CALLBACK_SECRET } });
  assert.ok(snapshot.data.comments.some(comment => comment.body.includes('keyboard focus')));
  assert.equal((await api.callback(initialJob.id, payload)).status, 200);
  assert.equal(api.github.dispatches.length, 2);
});

test('feedback during implementation takes priority over evidence and blocks merging until consumed', async context => {
  const { api, store } = await review(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'implement' } });
  const original = started.data.jobs[0];
  assert.equal((await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: 'Please also handle keyboard navigation.', kind: 'feedback' } })).status, 200);
  assert.ok((await store.ticket('RLY-1')).pendingAgent);
  assert.equal((await api.callback(original.id, { status: 'succeeded', runId: 456, summary: 'First changes published.', pullRequest: { number: 71, headSha: PR_SHA } })).status, 200);
  const jobs = await store.jobs('RLY-1');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].kind, 'implement');
  assert.equal(jobs[0].headSha, PR_SHA);
  assert.equal(api.github.dispatches.length, 2);
  assert.equal((await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'approve-merge', headSha: PR_SHA } })).status, 409);
  assert.equal(api.github.mergeCalls, 0);
});

test('new clarification received during triage reruns even when the old snapshot needs more detail', async context => {
  const { api, store } = await ticket(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } });
  await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: '@ai clarification: reproduce in Safari by typing then waiting eight seconds.' } });
  assert.equal((await api.callback(started.data.jobs[0].id, { status: 'succeeded', runId: 456, triage: { ...triage, ready: false } })).status, 200);
  assert.equal((await store.ticket('RLY-1')).status, 'triaging');
  assert.equal((await store.jobs('RLY-1')).length, 2);
  assert.equal(api.github.dispatches.length, 2);
});

test('human editing clears pending feedback and prevents terminal retries from launching it', async context => {
  const { api, store } = await ticket(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } });
  await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: '@ai revise the approach.' } });
  assert.ok((await store.ticket('RLY-1')).pendingAgent);
  assert.equal((await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'human-edit' } })).status, 200);
  const current = await store.ticket('RLY-1');
  assert.equal(current.pendingAgent, null);
  assert.equal(current.status, 'human_edit');
  await api.callback(started.data.jobs[0].id, { status: 'failed', runId: 456, summary: 'Cancelled.' });
  assert.equal(api.github.dispatches.length, 1);
});

test('a repeated terminal callback recovers an interrupted feedback handoff without duplicate jobs', async context => {
  const { api, store } = await ticket(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } });
  await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: '@ai include my new evidence.' } });
  const database = api.env.DB;
  api.env.DB = new Proxy(database, { get(target, key) {
    if (key === 'batch') return async statements => { await target.batch(statements); throw new Error('Process interrupted after terminal commit'); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const payload = { status: 'succeeded', runId: 456, triage };
  assert.equal((await api.callback(started.data.jobs[0].id, payload)).status, 500);
  assert.ok((await store.ticket('RLY-1')).pendingAgent);
  assert.equal((await store.ticket('RLY-1')).activeJobId, null);
  api.env.DB = database;
  const retries = await Promise.all([api.callback(started.data.jobs[0].id, payload), api.callback(started.data.jobs[0].id, payload)]);
  assert.ok(retries.every(result => result.status === 200));
  assert.equal((await store.jobs('RLY-1')).length, 2);
  assert.equal(api.github.dispatches.length, 2);
});

test('failed feedback dispatch preserves the request, blocks merge, and retries the latest head', async context => {
  const { api, store } = await review(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'implement' } });
  await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: 'Improve keyboard focus.', kind: 'feedback' } });
  api.github.failure = { path: '/dispatches', status: 503 };
  const payload = { status: 'succeeded', runId: 456, pullRequest: { number: 71, headSha: PR_SHA } };
  assert.equal((await api.callback(started.data.jobs[0].id, payload)).status, 200);
  assert.ok((await store.ticket('RLY-1')).pendingAgent);
  assert.match((await store.ticket('RLY-1')).error, /Feedback is saved/);
  await store.update(await store.ticket('RLY-1'), { status: 'in_review' });
  assert.equal((await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'approve-merge', headSha: PR_SHA } })).status, 409);
  assert.equal(api.github.mergeCalls, 0);
  api.github.failure = null;
  api.github.pull.head.sha = 'd'.repeat(40);
  assert.equal((await api.callback(started.data.jobs[0].id, payload)).status, 200);
  const current = await store.ticket('RLY-1');
  assert.equal(current.pendingAgent, null);
  assert.equal((await store.job(current.activeJobId)).headSha, 'd'.repeat(40));
  assert.equal(api.github.dispatches.length, 2);
});

test('an interrupted queued dispatch is resumed under one lease without allocating another job', async context => {
  const { api, store, ticket: original } = await ticket(context);
  const started = await store.startJob(original, 'triage', BASE_SHA);
  await store.claimDispatch(started.job);
  assert.equal((await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } })).status, 409);
  await api.DB.prepare('UPDATE jobs SET data=json_set(data,\'$.dispatchUntil\',1) WHERE id=?').bind(started.job.id).run();
  const attempts = await Promise.all([api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } }), api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } })]);
  assert.ok(attempts.some(result => result.status === 200));
  assert.ok(attempts.every(result => [200,409].includes(result.status)));
  assert.equal(api.github.dispatches.length, 1);
  assert.equal((await store.jobs('RLY-1')).length, 1);
  assert.equal((await store.ticket('RLY-1')).activeJobId, started.job.id);
});

test('simultaneous feedback comments preserve both requests and one active follow-up', async context => {
  const { api, store } = await ticket(context);
  const started = await api.request('/api/tickets/RLY-1/actions', { method: 'POST', body: { action: 'triage' } });
  const comments = await Promise.all(['@ai include keyboard support.', '@ai include screen reader support.'].map(body => api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body } })));
  assert.ok(comments.every(result => result.status === 200));
  assert.equal((await store.comments('RLY-1')).filter(comment => comment.body.includes('@ai include')).length, 2);
  assert.equal((await api.callback(started.data.jobs[0].id, { status: 'failed', runId: 456, summary: 'The initial attempt failed.' })).status, 200);
  const jobs = await store.jobs('RLY-1');
  assert.equal(jobs.length, 2);
  assert.equal(jobs.filter(job => ['queued','running'].includes(job.status)).length, 1);
  assert.equal(api.github.dispatches.length, 2);
});

test('automation snapshots retain the latest comments after the discussion reaches its display limit', async context => {
  const { api, store } = await ticket(context);
  await api.DB.batch(Array.from({ length: 301 }, (_, index) => api.DB.prepare('INSERT INTO comments(id,ticket_id,author_id,body,kind,created_at) VALUES(?,?,?,?,?,?)')
    .bind('history-'+String(index).padStart(3,'0'),'RLY-1','huti','Old comment '+index,'comment',old)));
  const queued = await api.request('/api/tickets/RLY-1/comments', { method: 'POST', body: { body: '@ai the newest acceptance criterion must be included.' } });
  assert.equal(queued.status, 200);
  const current = await store.ticket('RLY-1');
  const snapshot = await api.request(`/api/automation/jobs/${current.activeJobId}`, { headers: { Authorization: 'Bearer ' + api.env.RELAY_CALLBACK_SECRET } });
  assert.equal(snapshot.data.comments.length, 300);
  assert.ok(snapshot.data.comments.some(comment => comment.body.includes('newest acceptance criterion')));
});
