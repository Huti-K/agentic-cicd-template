import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

export const PLATFORM_ORIGIN = 'https://relay.test';
export const REPO = 'Huti-K/agentic-cicd-template';
export const BASE_SHA = 'a'.repeat(40);
export const PR_SHA = 'b'.repeat(40);
export const MERGE_SHA = 'c'.repeat(40);
export const PASSWORD = 'fixture password';

export function githubFixture() {
  const fixture = {
    calls: [], issueNumber: 99, failure: null,
    pull: { number: 71, title: 'Keep support drafts', state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', html_url: `https://github.com/${REPO}/pull/71`, head: { sha: PR_SHA, ref: 'relay/ticket-RLY-1', repo: { full_name: REPO } }, base: { sha: BASE_SHA, ref: 'main', repo: { full_name: REPO } }, user: { login: 'relay-agent' }, merge_commit_sha: MERGE_SHA },
    checks: [{ id: 10, name: 'verify', status: 'completed', conclusion: 'success', head_sha: PR_SHA }, { id: 11, name: 'AI review', status: 'completed', conclusion: 'success', head_sha: PR_SHA }],
    reviews: [{ id: 1, state: 'APPROVED', commit_id: PR_SHA, user: { login: 'independent-reviewer' }, submitted_at: '2026-10-12T10:00:00Z' }],
    statuses: [], mergeCalls: 0, dispatches: [], compareStatus: 'ahead',
    files: [{ filename: 'demo/src/platform.js', additions: 12, deletions: 3, status: 'modified' }],
  };
  fixture.fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    fixture.calls.push({ path: url.pathname, method, body });
    const response = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (fixture.failure && (!fixture.failure.path || url.pathname.includes(fixture.failure.path))) return response({ message: 'Fixture upstream failure' }, fixture.failure.status ?? 503);
    const path = url.pathname.replace(`/repos/${REPO}`, '');
    if (path === '/issues' && method === 'POST') {
      const number = ++fixture.issueNumber;
      return response({ number, html_url: `https://github.com/${REPO}/issues/${number}`, ...body }, 201);
    }
    if (/^\/issues\/\d+$/.test(path)) return response({ number: Number(path.split('/').at(-1)), ...body });
    if (/^\/issues\/\d+\/comments$/.test(path)) return response({ id: 22, ...body }, 201);
    if (path.includes('/dispatches')) {
      fixture.dispatches.push(body);
      return response(null, 204);
    }
    if (path === '/pulls/71') return response(fixture.pull);
    if (path === '/pulls/71/files') return response(fixture.files);
    if (path === '/pulls/71/reviews') return response(fixture.reviews);
    if (path === '/pulls/71/merge' && method === 'PUT') {
      fixture.mergeCalls++;
      fixture.pull.state = 'closed'; fixture.pull.merged = true; fixture.pull.merged_at = '2026-10-12T10:00:00Z';
      return response({ merged: true, sha: MERGE_SHA, message: 'Merged' });
    }
    if (path.endsWith('/check-runs')) return response({ total_count: fixture.checksTotal ?? fixture.checks.length, check_runs: fixture.checks });
    if (path.endsWith('/status')) return response({ state: fixture.statuses.some(status => status.state !== 'success') ? 'failure' : 'success', statuses: fixture.statuses, total_count: fixture.statusesTotal ?? fixture.statuses.length });
    if (path.startsWith('/compare/')) return response({ status: fixture.compareStatus, ahead_by: 1, behind_by: 0, commits: [{ sha: MERGE_SHA }, { sha: BASE_SHA }] });
    if (path.startsWith('/git/trees/')) return response({ truncated: false, tree: [{ path: 'demo/src/platform.js', type: 'blob' }, { path: 'docs/ARCHITECTURE.md', type: 'blob' }] });
    if (path.startsWith('/git/ref/heads/')) return response({ object: { sha: BASE_SHA } });
    if (path.startsWith('/branches/')) return response({ name: 'main', commit: { sha: BASE_SHA } });
    if (path.startsWith('/commits/')) return response({ sha: BASE_SHA });
    if (/^\/actions\/runs\/\d+$/.test(path)) return response({ id: 456, head_sha: PR_SHA, status: 'completed', conclusion: 'success', html_url: `https://github.com/${REPO}/actions/runs/456` });
    if (path === '' || path === '/') return response({ full_name: REPO, default_branch: 'main', permissions: { admin: true, push: true } });
    return response({ message: `Unmocked GitHub endpoint: ${method} ${path}` }, 404);
  };
  return fixture;
}

export async function platformHarness(context) {
  const { createApp } = await import('../../worker/index.js');
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } };', compatibilityDate: '2026-10-01', d1Databases: ['DB'] }));
  context.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const migration = await readFile(new URL('../../migrations/0001_platform.sql', import.meta.url), 'utf8');
  for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await DB.prepare(statement).run();
  const github = githubFixture();
  const env = { DB, GITHUB_TOKEN: 'fixture-github-token', GITHUB_REPOSITORY: REPO, RELAY_CALLBACK_SECRET: 'fixture-callback-secret', MAINTAINER_PASSWORD_HASH: createHash('sha256').update(PASSWORD).digest('hex'), SESSION_SECRET: 'fixture-session-secret-which-is-long-enough', DEPLOYMENT_URL: PLATFORM_ORIGIN, AGENT_REF: 'main' };
  const app = createApp({ fetcher: github.fetcher });
  const pending = [];
  let cookie = '', csrfToken = '';
  const request = async (path, options = {}) => {
    const { method = 'GET', body, authenticated = true, origin = PLATFORM_ORIGIN, csrf = true, headers: extraHeaders = {} } = options;
    const headers = new Headers(extraHeaders);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (origin) headers.set('Origin', origin);
    if (authenticated && cookie) headers.set('Cookie', cookie);
    if (csrf && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const response = await app.fetch(new Request(PLATFORM_ORIGIN + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending.splice(0));
    let data = null;
    try { data = await response.clone().json(); } catch { /* Some success responses are intentionally empty. */ }
    return { response, status: response.status, data };
  };
  const signIn = async () => {
    const result = await request('/api/session', { method: 'POST', body: { password: PASSWORD } });
    cookie = result.response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    csrfToken = result.data?.csrfToken ?? '';
    return result;
  };
  const createTicket = async (overrides = {}) => request('/api/tickets', { method: 'POST', body: { title: 'Preserve support reply drafts', description: 'The unsent reply disappears during a background refresh.', type: 'bug', priority: 'high', tags: ['support'], ...overrides } });
  const callback = async (jobId, body, authorized = true) => request(`/api/automation/jobs/${jobId}`, { method: 'POST', authenticated: false, csrf: false, origin: null, headers: authorized ? { Authorization: 'Bearer ' + env.RELAY_CALLBACK_SECRET } : {}, body });
  return { DB, env, app, github, request, signIn, createTicket, callback, get cookie() { return cookie; }, get csrfToken() { return csrfToken; } };
}
