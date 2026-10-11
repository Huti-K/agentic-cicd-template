export const HEAD_SHA = 'a'.repeat(40);
import { filterTickets } from '../../demo/src/platform-core.js';
export const REPOSITORY = 'Huti-K/agentic-cicd-template';
const timestamp = '2026-10-12T10:00:00.000Z';
const people = [
  { id: 'huti', handle: 'huti', name: 'Huti', initials: 'HU', color: 'violet', role: 'Maintainer' },
  { id: 'davidmikan', handle: 'davidmikan', name: 'David Mikan', initials: 'DM', color: 'blue', role: 'Contributor' },
  { id: 'ai', handle: 'ai', name: 'Relay AI', initials: 'AI', color: 'green', role: 'Agent' },
];

export function ticketFixture(overrides = {}) {
  return {
    id: 'RLY-1', version: 1, title: 'Preserve a reply while ticket updates arrive',
    description: 'A support reply must survive background refreshes.\nAcceptance: keep the unsent text.',
    originalDescription: 'My support reply disappeared when the screen updated.',
    type: 'bug', priority: 'high', status: 'new', tags: ['support', 'usability'],
    assigneeId: 'huti', contributorIds: ['huti'], createdAt: timestamp, updatedAt: timestamp,
    issueNumber: 31, issueUrl: `https://github.com/${REPOSITORY}/issues/31`,
    prNumber: null, prUrl: null, headSha: null, triage: null, error: null, ...overrides,
  };
}

export function detailFixture(overrides = {}) {
  return {
    ticket: ticketFixture(),
    comments: [{ id: 'comment-1', ticketId: 'RLY-1', authorId: 'davidmikan', body: 'I can help reproduce this on mobile.', kind: 'comment', createdAt: timestamp }],
    jobs: [], evidence: [], pullRequest: null, ...overrides,
  };
}

export function reviewDetailFixture(overrides = {}) {
  return detailFixture({
    ticket: ticketFixture({ status: 'in_review', prNumber: 32, prUrl: `https://github.com/${REPOSITORY}/pull/32`, headSha: HEAD_SHA }),
    jobs: [{ id: 'evidence-1', ticketId: 'RLY-1', kind: 'evidence', status: 'succeeded', runId: 456, runUrl: `https://github.com/${REPOSITORY}/actions/runs/456`, headSha: HEAD_SHA, summary: 'Browser checks passed for this revision.', createdAt: timestamp, updatedAt: timestamp }],
    evidence: [{ id: 'artifact-1', jobId: 'evidence-1', headSha: HEAD_SHA, kind: 'video', title: 'Mobile reply flow video', url: `https://github.com/${REPOSITORY}/actions/runs/456/artifacts/789` }],
    pullRequest: { number: 32, url: `https://github.com/${REPOSITORY}/pull/32`, title: 'Preserve unsent support replies', headSha: HEAD_SHA, state: 'open', checks: [{ name: 'verify', status: 'completed', conclusion: 'success' }], reviewState: 'approved', mergeable: true, files: [{ path: 'demo/src/platform.js', additions: 20, deletions: 4 }], checksReady: true, evidenceReady: true, canMerge: true },
    ...overrides,
  });
}

// Exercise the browser's API contract without sending writes to a live repository.
// Tests can mutate `detail`/`failure` to model background updates and outages.
export async function installPlatformAPI(page, options = {}) {
  const fixture = {
    authenticated: options.authenticated ?? true,
    csrfToken: 'test-csrf-token-only',
    detail: structuredClone(options.detail ?? detailFixture()),
    tickets: [], messages: [], requests: [], failure: null, conflict: false,
    deployment: { url: 'https://relay.example.test', sha: HEAD_SHA },
    ...options,
  };
  const session = () => ({ authenticated: fixture.authenticated, user: fixture.authenticated ? people[0] : null, ...(fixture.authenticated ? { csrfToken: fixture.csrfToken } : {}) });
  const addJob = kind => {
    const job = { id: `job-${fixture.detail.jobs.length + 1}`, ticketId: fixture.detail.ticket.id, kind, status: 'queued', runId: null, runUrl: null, headSha: fixture.detail.ticket.headSha, summary: null, createdAt: timestamp, updatedAt: timestamp };
    fixture.detail.jobs.unshift(job);
    fixture.detail.ticket.status = kind === 'triage' ? 'triaging' : kind === 'implement' ? 'implementing' : 'in_review';
    fixture.detail.ticket.version++;
  };
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    let body = null;
    try { body = request.postDataJSON(); } catch { /* GET has no body. */ }
    fixture.requests.push({ path, method, body, headers: request.headers() });
    const send = (json, status = 200) => route.fulfill({ status, json });
    const failure = fixture.failure;
    if (failure && (!failure.path || path === failure.path) && (!failure.method || method === failure.method)) {
      return send({ error: failure.error ?? 'GitHub is temporarily unavailable.', code: failure.code ?? 'UPSTREAM_ERROR' }, failure.status ?? 503);
    }
    if (path === '/api/session' && method === 'GET') return send(session());
    if (path === '/api/session' && method === 'POST') {
      if (body?.password !== 'demo-password') return send({ error: 'Invalid maintainer password.', code: 'INVALID_PASSWORD' }, 401);
      fixture.authenticated = true;
      return send(session());
    }
    if (method !== 'GET') {
      if (!fixture.authenticated) return send({ error: 'Sign in to continue.', code: 'UNAUTHORIZED' }, 401);
      if (request.headers()['x-csrf-token'] !== fixture.csrfToken) return send({ error: 'CSRF token is required.', code: 'CSRF_INVALID' }, 403);
    }
    if (path === '/api/session' && method === 'DELETE') { fixture.authenticated = false; return send(session()); }
    const tickets=[fixture.detail.ticket,...fixture.tickets].sort((a,b)=>Number(b.id.slice(4))-Number(a.id.slice(4)));
    if (path === '/api/tickets' && method === 'GET') {
      const params=new URL(request.url()).searchParams, matching=filterTickets(tickets,Object.fromEntries(params)),after=matching.filter(ticket=>!params.get('cursor')||Number(ticket.id.slice(4))<Number(params.get('cursor'))),limit=Number(params.get('limit')||50),page=after.slice(0,limit);
      if(params.get('query')&&params.get('query')===fixture.holdTicketQuery)await new Promise(resolve=>{fixture.releaseTicketPage=resolve;});
      return send({tickets:page,total:matching.length,nextCursor:after.length>limit?page.at(-1).id.slice(4):null});
    }
    if (path === '/api/workspace' && method === 'GET') return send({ repository: REPOSITORY, people, projects: [{ id: 'relay', name: 'Relay', repository: REPOSITORY }], tickets:tickets.slice(0,50),ticketCounts:{total:tickets.length,statuses:Object.fromEntries([...new Set(tickets.map(t=>t.status))].map(status=>[status,tickets.filter(t=>t.status===status).length]))},attentionTickets:tickets.filter(t=>['in_review','ready','failed','new'].includes(t.status)).slice(0,5),activeJobCount:fixture.detail.jobs.filter(j=>['queued','running'].includes(j.status)).length,jobs: fixture.detail.jobs, integration: { github: true, agents: true }, deployment: fixture.deployment });
    if (path === '/api/inbox' && method === 'GET') return send({ messages: fixture.messages });
    if (path === '/api/inbox' && method === 'POST') {
      const previous = fixture.messages.find(message => message.idempotencyKey === body.idempotencyKey);
      if (previous) {
        if (!previous.processingComplete && !fixture.incompleteEmail) { addJob('triage'); previous.processingComplete=true; fixture.detail.ticket.error=null; }
        return send({ message: previous, ticket: fixture.detail.ticket }, 201);
      }
      fixture.detail = detailFixture({ ticket: ticketFixture({ title: body.subject, description: body.body, originalDescription: body.body }) });
      if (!fixture.incompleteEmail) addJob('triage');
      else fixture.detail.ticket.error='Email saved; GitHub dispatch failed. Retry delivery with the same key.';
      const message = { id: `email-${fixture.messages.length + 1}`, ...body, ticketId: fixture.detail.ticket.id, processingComplete:!fixture.incompleteEmail, createdAt: timestamp };
      fixture.messages.push(message);
      return send({ message, ticket: fixture.detail.ticket }, 201);
    }
    if (path === '/api/tickets' && method === 'POST') {
      fixture.detail = detailFixture({ ticket: ticketFixture({ ...body, id: 'RLY-2', originalDescription: body.description }), comments: [] });
      return send(fixture.detail, 201);
    }
    if (path === `/api/tickets/${fixture.detail.ticket.id}`) {
      if (method === 'GET') return send(fixture.detail);
      if (method === 'PATCH') {
        if (fixture.conflict || body.version !== fixture.detail.ticket.version) return send({ error: 'This ticket changed. Reload the current version before saving.', code: 'VERSION_CONFLICT' }, 409);
        Object.assign(fixture.detail.ticket, body, { version: fixture.detail.ticket.version + 1 });
        return send(fixture.detail);
      }
    }
    if (path.endsWith('/comments') && method === 'POST') {
      const comment = { id: `comment-${fixture.detail.comments.length + 1}`, ticketId: fixture.detail.ticket.id, authorId: 'huti', kind: 'comment', ...body, createdAt: timestamp };
      fixture.detail.comments.push(comment);
      for (const person of people) if (new RegExp(`(^|\\s)@${person.handle}(?![\\w-])`, 'i').test(body.body) && !fixture.detail.ticket.contributorIds.includes(person.id)) fixture.detail.ticket.contributorIds.push(person.id);
      if (/@ai\b/i.test(body.body) || body.kind === 'feedback') {
        if (fixture.detail.ticket.status !== 'human_edit') addJob(fixture.detail.pullRequest ? 'implement' : 'triage');
      }
      fixture.detail.ticket.version++;
      return send(fixture.detail, 201);
    }
    if (path.endsWith('/actions') && method === 'POST') {
      if (body.action === 'retry-issue') {
        if(body.confirmRetry!==true)return send({error:'Confirm issue recovery.'},400);
        Object.assign(fixture.detail.ticket,{issueNumber:99,issueUrl:`https://github.com/${REPOSITORY}/issues/99`,error:null});
      }
      else if (body.action === 'human-edit') {
        fixture.detail.ticket.status = 'human_edit';
        fixture.detail.jobs.forEach(job => { if (['queued', 'running'].includes(job.status)) { job.status = 'failed'; job.summary = 'Stopped for human editing.'; } });
      }
      else if (body.action === 'resume') fixture.detail.ticket.status = fixture.detail.pullRequest ? 'in_review' : 'ready';
      else if (body.action === 'approve-merge') {
        if (!fixture.detail.pullRequest?.canMerge || body.headSha !== fixture.detail.pullRequest.headSha) return send({ error: 'The pull request changed. Review its current revision before merging.', code: 'HEAD_CHANGED' }, 409);
        fixture.detail.ticket.status = 'merged';
        fixture.detail.pullRequest.state = 'merged';
        fixture.detail.pullRequest.canMerge = false;
      } else addJob(body.action);
      return send(fixture.detail);
    }
    return send({ error: `Unmocked API endpoint: ${method} ${path}`, code: 'NOT_FOUND' }, 404);
  });
  return fixture;
}
