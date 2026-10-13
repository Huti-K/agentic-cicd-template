import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real Worker runtime authenticates writes, links an issue and dispatches native-fetch triage without following redirects', async context => {
  const origin = 'https://relay.test';
  const repository = 'Huti-K/agentic-cicd-template';
  const calls = [];
  let redirectIssue = false;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: ['index.js', 'model.js', 'db.js', 'github.js', 'media.js'].map(name => ({ type: 'ESModule', path: fileURLToPath(new URL('../worker/' + name, import.meta.url)) })),
    modulesRoot: fileURLToPath(new URL('../worker/', import.meta.url)),
    compatibilityDate: '2026-10-11',
    d1Databases: ['DB'],
    bindings: {
      GITHUB_TOKEN: 'fixture-github-token', GITHUB_REPOSITORY: repository,
      RELAY_CALLBACK_SECRET: 'fixture-callback-secret',
      MAINTAINER_PASSWORD_HASH: createHash('sha256').update('fixture password').digest('hex'),
      SESSION_SECRET: 'fixture-session-secret-which-is-long-enough',
      DEPLOYMENT_URL: origin, AGENT_REF: 'main',
    },
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ method: request.method, origin: url.origin, path: url.pathname });
      assert.equal(url.origin, 'https://api.github.com', 'all outbound requests must stay inside the GitHub fixture');
      const body = request.method === 'POST' ? await request.json() : null;
      calls.at(-1).body = body;
      if (request.method === 'POST' && url.pathname === `/repos/${repository}/issues`) {
        if (redirectIssue) return new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/collect' } });
        return new Response(JSON.stringify({ number: 123, html_url: `https://github.com/${repository}/issues/123`, ...body }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'GET' && url.pathname === `/repos/${repository}/commits/main`) return Response.json({ sha: 'a'.repeat(40) });
      if (request.method === 'POST' && url.pathname === `/repos/${repository}/actions/workflows/relay-agent.yml/dispatches`) return new Response(null, { status: 204 });
      throw new Error(`Unexpected outbound fixture request: ${request.method} ${url.pathname}`);
    },
  }));
  context.after(() => runtime.dispose());
  const database = await runtime.getD1Database('DB');
  const migration = await readFile(new URL('../migrations/0001_platform.sql', import.meta.url), 'utf8');
  for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await database.prepare(statement).run();
  const ticketBody = { title: 'Runtime integration ticket', description: 'Verify the deployed Worker can create its linked GitHub issue.', type: 'bug', priority: 'high', tags: ['support'] };
  const unauthenticated = await runtime.dispatchFetch(`${origin}/api/tickets`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(ticketBody),
  });
  assert.equal(unauthenticated.status, 401);
  const signIn = await runtime.dispatchFetch(`${origin}/api/session`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'fixture password' }),
  });
  assert.equal(signIn.status, 200);
  const session = await signIn.json();
  assert.equal(session.authenticated, true);
  const cookie = signIn.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] };
  const missingCSRF = await runtime.dispatchFetch(`${origin}/api/tickets`, { method: 'POST', headers, body: JSON.stringify(ticketBody) });
  assert.equal(missingCSRF.status, 403);
  assert.equal(calls.length, 0);
  headers['X-CSRF-Token'] = session.csrfToken;
  const response = await runtime.dispatchFetch(`${origin}/api/tickets`, {
    method: 'POST', headers, body: JSON.stringify(ticketBody),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.ticket.error, null, `GitHub issue creation failed in workerd: ${result.ticket.error}`);
  assert.equal(result.ticket.issueNumber, 123);
  assert.equal(result.ticket.issueUrl, `https://github.com/${repository}/issues/123`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.title, '[RLY-1] Runtime integration ticket');
  const saved = await database.prepare('SELECT data FROM tickets WHERE number = 1').first();
  assert.equal(JSON.parse(saved.data).issueNumber, 123);
  const discussion = await runtime.dispatchFetch(`${origin}/api/tickets/RLY-1/comments`, {
    method: 'POST', headers, body: JSON.stringify({ body: '@davidmikan @ai please triage this request.', kind: 'comment' }),
  });
  assert.equal(discussion.status, 200);
  const detail = await discussion.json();
  assert.equal(detail.ticket.error, null);
  assert.equal(detail.ticket.status, 'triaging');
  assert.ok(detail.ticket.contributorIds.includes('davidmikan'));
  assert.ok(detail.ticket.contributorIds.includes('ai'));
  assert.equal(detail.jobs[0].status, 'queued');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body, { ref: 'main', inputs: { job_id: detail.jobs[0].id, ticket_id: 'RLY-1', kind: 'triage' } });

  // A 302 must surface as a GitHub failure without sending credentials to its Location.
  redirectIssue = true;
  const redirected = await runtime.dispatchFetch(`${origin}/api/tickets`, { method: 'POST', headers, body: JSON.stringify({ ...ticketBody, title: 'Reject an upstream redirect' }) });
  assert.equal(redirected.status, 201);
  const redirectedTicket = (await redirected.json()).ticket;
  assert.equal(redirectedTicket.issueNumber, null);
  assert.match(redirectedTicket.error, /HTTP 302/);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.origin === 'https://api.github.com'));
  const logout = await runtime.dispatchFetch(`${origin}/api/session`, { method: 'DELETE', headers });
  assert.equal(logout.status, 200);
  const signedOut = await runtime.dispatchFetch(`${origin}/api/session`, { headers });
  assert.equal((await signedOut.json()).authenticated, false);
});
