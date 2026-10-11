import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { deploymentFreshness, deploymentGate, validateArtifact, validateDeploymentRun, verifyCloudflareDeployment } from '../scripts/relay/deploy.mjs';

const sha = 'a'.repeat(40), oldSha = 'b'.repeat(40), repository = 'owner/relay';
const ciRun = () => ({ id: 42, workflow_id: 99, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', head_sha: sha, repository: { full_name: repository }, head_repository: { full_name: repository } });
const expected = { repository, workflowId: 99, mainSha: sha };
test('Cloudflare deployment requires successful same-repository main-push CI and its exact current head', () => {
  assert.deepEqual(validateDeploymentRun(ciRun(), expected), { sha, ciRunId: '42', deploy: true });
  assert.equal(validateDeploymentRun({ ...ciRun(), head_sha: oldSha }, expected).deploy, false);
  for (const change of [{ workflow_id: 100 }, { path: '.github/workflows/untrusted.yml' }, { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'feature' }, { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { repository: { full_name: 'fork/relay' } }, { head_repository: { full_name: 'fork/relay' } }, { head_sha: 'main' }, { id: -1 }]) assert.throws(() => validateDeploymentRun({ ...ciRun(), ...change }, expected));
});
test('deployment gate resolves authoritative GitHub metadata and manual recovery cannot bypass CI', async () => {
  const calls = [], outputs = {}, notices = [];
  const core = { setOutput: (name, value) => { outputs[name] = value; }, notice: value => notices.push(value) };
  let run = ciRun(), head = sha;
  const github = { rest: {
    actions: { getWorkflowRun: async args => { calls.push(args); return { data: run }; }, getWorkflow: async args => { calls.push(args); return { data: { id: 99 } }; } },
    git: { getRef: async args => { calls.push(args); return { data: { object: { sha: head } } }; } },
  } };
  const context = { ref: 'refs/heads/main', eventName: 'workflow_run', payload: { workflow_run: { id: 42 } }, repo: { owner: 'owner', repo: 'relay' } };
  await deploymentGate({ github, context, core });
  assert.deepEqual(outputs, { sha, ci_run_id: '42', deploy: 'true' });
  assert.ok(calls.some(call => call.workflow_id === 'ci.yml'));
  assert.ok(calls.some(call => call.run_id === 42));
  await deploymentGate({ github, context: { ...context, eventName: 'workflow_dispatch', payload: { inputs: { ci_run_id: '42' } } }, core });
  head = oldSha;
  await deploymentGate({ github, context, core });
  assert.equal(outputs.deploy, 'false');
  assert.equal(notices.length, 1);
  for (const changedContext of [{ ...context, ref: 'refs/heads/feature' }, { ...context, eventName: 'pull_request' }, { ...context, payload: { workflow_run: { id: '42; do-bad-things' } } }, { ...context, payload: { workflow_run: { id: '999999999999999999999' } } }]) await assert.rejects(deploymentGate({ github, context: changedContext, core }));
  run = { ...ciRun(), conclusion: 'failure' };
  await assert.rejects(deploymentGate({ github, context, core }), /successful/);
  assert.equal(await deploymentFreshness({ github, context, core, sha }), false);
  head = sha;
  assert.equal(await deploymentFreshness({ github, context, core, sha }), true);
});
test('downloaded site artifact must have the exact commit, repository and CI provenance', () => {
  const artifact = { sha, repository, runId: '42', source: 'github-actions', dirty: false };
  assert.equal(validateArtifact(artifact, { sha, repository, ciRunId: '42' }), artifact);
  for (const change of [{ sha: oldSha }, { repository: 'fork/relay' }, { runId: '43' }, { source: 'local' }, { dirty: true }, { dirty: undefined }]) assert.throws(() => validateArtifact({ ...artifact, ...change }, { sha, repository, ciRunId: '42' }));
});

function publicFetcher({ manifestSha = sha, integrations = true, authenticated = false, emptyAsset, apiStatus = 200 } = {}) {
  return async url => {
    const path = url.pathname;
    if (path === '/build.json') return Response.json({ sha: manifestSha, repository });
    if (path === '/api/session') return Response.json({ authenticated, user: authenticated ? { id: 'admin' } : null }, { status: apiStatus });
    if (path === '/api/workspace') return Response.json({ repository, people: [], tickets: [], integration: { github: integrations, agents: integrations } });
    return new Response(path === emptyAsset ? '' : 'deployed asset');
  };
}
test('deployed verification checks the actual revision, core UI assets and unauthenticated database API', async () => {
  const seen = [];
  const fetcher = publicFetcher();
  assert.deepEqual(await verifyCloudflareDeployment({ url: 'https://relay.example', sha, repository, attempts: 1,
    fetcher: async (url, options) => { seen.push(url.pathname); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.equal(options.headers, undefined); return fetcher(url, options); },
  }), { sha, url: 'https://relay.example', repository });
  assert.ok(seen.includes('/api/session'));
  assert.ok(seen.includes('/api/workspace'));
  assert.ok(seen.includes('/src/platform-core.js'));
  for (const options of [{ manifestSha: oldSha }, { integrations: false }, { authenticated: true }, { emptyAsset: '/inbox.html' }, { apiStatus: 503 }]) await assert.rejects(verifyCloudflareDeployment({ url: 'https://relay.example', sha, repository, attempts: 1, fetcher: publicFetcher(options) }));
  for (const url of ['http://relay.example', 'https://secret@relay.example', 'https://relay.example?token=secret']) await assert.rejects(verifyCloudflareDeployment({ url, sha, repository, attempts: 1, fetcher }));
});
test('deployment verification retries propagation delays and fails after its bounded attempts', async () => {
  let manifests = 0, pauses = 0;
  const healthy = publicFetcher();
  await verifyCloudflareDeployment({ url: 'https://relay.example', sha, repository, attempts: 2, sleep: async () => { pauses++; }, fetcher: async (url, options) => url.pathname === '/build.json' && ++manifests === 1 ? Response.json({ sha: oldSha, repository }) : healthy(url, options) });
  assert.equal(manifests, 2); assert.equal(pauses, 1);
  let attempts = 0;
  await assert.rejects(verifyCloudflareDeployment({ url: 'https://relay.example', sha, repository, attempts: 2, sleep: async () => {}, fetcher: async () => { attempts++; throw new Error('Offline'); } }), /Offline/);
  assert.equal(attempts, 2);
});

const workflow = parse(await readFile('.github/workflows/cloudflare-deploy.yml', 'utf8'));
test('Cloudflare publication is serialized, main-only, and uses the successful CI artifact without rebuilding it', () => {
  assert.deepEqual(workflow.on.workflow_run, { workflows: ['CI'], types: ['completed'], branches: ['main'] });
  assert.equal(workflow.on.workflow_dispatch.inputs.ci_run_id.required, true);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.jobs.gate.if, /refs\/heads\/main/);
  assert.match(workflow.jobs.gate.if, /conclusion == 'success'/);
  assert.match(workflow.jobs.gate.if, /event == 'push'/);
  assert.equal(workflow.jobs.deploy.if, "needs.gate.outputs.deploy == 'true'");
  const steps = workflow.jobs.deploy.steps;
  const download = steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, 'site-preview');
  assert.equal(download.with['run-id'], '${{ needs.gate.outputs.ci_run_id }}');
  assert.equal(steps[0].with.ref, '${{ needs.gate.outputs.sha }}');
  assert.equal(steps.filter(step => step.name?.startsWith('Check main')).length, 2);
  assert.doesNotMatch(steps.map(step => step.run || '').join('\n'), /npm run build|npm run check|npm test/);
});
test('deployment secrets are step-scoped and never exposed during install, artifact download or app verification', () => {
  assert.equal(workflow.env, undefined);
  assert.equal(workflow.jobs.deploy.env, undefined);
  assert.doesNotMatch(JSON.stringify(workflow.jobs.gate), /secrets\./);
  const steps = workflow.jobs.deploy.steps;
  const secretSteps = steps.filter(step => /secrets\./.test(JSON.stringify(step)));
  assert.equal(secretSteps.length, 3);
  assert.equal(secretSteps.filter(step => step.env?.CLOUDFLARE_API_TOKEN).length, 2);
  assert.equal(secretSteps.filter(step => step.env?.RELAY_CALLBACK_SECRET).length, 1);
  for (const step of secretSteps) {
    assert.ok(step.if?.includes('current'));
    assert.doesNotMatch(step.run, /npm ci|npm test|npm run check/);
  }
  const install = steps.find(step => step.run === 'npm ci --ignore-scripts');
  assert.ok(install); assert.equal(install.env, undefined);
  const verify = steps.find(step => step.run === 'node scripts/relay/deploy.mjs verify');
  assert.doesNotMatch(JSON.stringify(verify), /secrets\.|TOKEN/);
});
