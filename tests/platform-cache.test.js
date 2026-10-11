import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../worker/github.js';
import { Store } from '../worker/db.js';
import { platformHarness, PR_SHA, REPO } from './helpers/platform-harness.js';

const cacheKey = 'github-pull:' + REPO + ':71';
const proxy = DB => ({ prepare: (...args) => DB.prepare(...args) });
const client = (api, DB = api.DB, fetcher = api.github.fetcher) => new GitHub({ ...api.env, DB, GITHUB_PUBLIC_CACHE_SECONDS: '30' }, fetcher);
const expire = (DB, key = 'expiresAt') => DB.prepare("UPDATE metadata SET value=json_set(value,?,0) WHERE key=?").bind('$.' + key, cacheKey).run();

test('public PR cache persists across instances and database proxies, expires, and never replaces fresh validation', async context => {
  const api = await platformHarness(context);
  const first = await client(api, proxy(api.DB)).pull(71, [], 0, { cache: true });
  assert.equal(api.github.calls.length, 4);
  assert.equal(first.freshness.cached, false);
  assert.equal(first.checksReady, true);
  assert.ok(Number.isFinite(Date.parse(first.freshness.fetchedAt)));
  assert.ok(Date.parse(first.freshness.expiresAt) > Date.parse(first.freshness.fetchedAt));

  api.github.checks[0].conclusion = 'failure';
  const reused = await client(api, proxy(api.DB)).pull(71, [], 0, { cache: true });
  assert.equal(api.github.calls.length, 4, 'new instances must reuse the durable cache');
  assert.equal(reused.freshness.cached, true);
  assert.equal(reused.freshness.fetchedAt, first.freshness.fetchedAt);
  assert.equal(reused.checksReady, true);
  const fresh = await client(api, proxy(api.DB)).pull(71);
  assert.equal(api.github.calls.length, 8);
  assert.equal(fresh.freshness.cached, false);
  assert.equal(fresh.checksReady, false, 'merge validation must see newer failed checks');

  await expire(api.DB);
  const refreshed = await client(api, proxy(api.DB)).pull(71, [], 0, { cache: true });
  assert.equal(api.github.calls.length, 12);
  assert.equal(refreshed.freshness.cached, false);
  assert.equal(refreshed.checksReady, false);
});

test('public PR failure backoff survives new instances and retries after expiry', async context => {
  const api = await platformHarness(context);
  api.github.failure = { path: '/pulls/71', status: 503 };
  await assert.rejects(client(api, proxy(api.DB)).cachedPull(71), error => error.code === 'github_error');
  assert.equal(api.github.calls.length, 1);
  api.github.failure = null;
  await assert.rejects(client(api, proxy(api.DB)).cachedPull(71), error => error.code === 'github_error');
  assert.equal(api.github.calls.length, 1, 'public polling must not retry during cached failure backoff');
  await expire(api.DB);
  const recovered = await client(api, proxy(api.DB)).cachedPull(71);
  assert.equal(api.github.calls.length, 5);
  assert.equal(recovered.pr.head.sha, PR_SHA);
  assert.equal(recovered.freshness.cached, false);
});

test('the durable public cache lease coalesces distinct database proxies and recovers after interruption', async context => {
  const api = await platformHarness(context);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  context.after(() => release());
  const fetcher = async (url, options) => {
    if (url.endsWith('/pulls/71')) { entered(); await gate; }
    return api.github.fetcher(url, options);
  };
  const first = client(api, proxy(api.DB), fetcher).cachedPull(71);
  await started;
  await assert.rejects(client(api, proxy(api.DB)).cachedPull(71), error => error.code === 'github_refreshing');
  assert.equal(api.github.calls.length, 0, 'a competing isolate must not issue its own request');
  release(); await first;
  assert.equal(api.github.calls.length, 4);
  assert.equal((await client(api, proxy(api.DB)).cachedPull(71)).freshness.cached, true);
  await api.DB.prepare('UPDATE metadata SET value=? WHERE key=?').bind(JSON.stringify({ owner: 'interrupted', until: Date.now() + 60_000 }), cacheKey).run();
  await assert.rejects(client(api, proxy(api.DB)).cachedPull(71), error => error.code === 'github_refreshing');
  assert.equal(api.github.calls.length, 4);
  await expire(api.DB, 'until');
  assert.equal((await client(api, proxy(api.DB)).cachedPull(71)).freshness.cached, false);
  assert.equal(api.github.calls.length, 8);
});

test('cached pre-merge state cannot release an expired merge lease when fresh GitHub validation fails', async context => {
  const api = await platformHarness(context); await api.signIn();
  api.env.GITHUB_PUBLIC_CACHE_SECONDS = '30';
  const store = new Store(api.DB);
  const ticket = await store.update((await api.createTicket()).data.ticket, { status: 'in_review', prNumber: 71, headSha: PR_SHA });
  await client(api).cachedPull(71);
  await store.update(ticket, { mergePending: true, mergeStartedAt: new Date(Date.now() - 120_000).toISOString() });
  api.github.failure = { path: '/pulls/71', status: 503 };
  const before = api.github.calls.length;
  const result = await api.request('/api/tickets/' + ticket.id);
  assert.equal(result.status, 200);
  assert.equal(result.data.ticket.mergePending, true);
  assert.equal(result.data.ticket.status, 'in_review');
  assert.equal(result.data.pullRequest, null);
  assert.match(result.data.integrationError, /GitHub/);
  assert.equal(api.github.calls.length, before + 1, 'merge recovery must bypass the cached open PR');
  assert.equal(api.github.mergeCalls, 0);
});
