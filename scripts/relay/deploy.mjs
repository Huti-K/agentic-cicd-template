import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { SHA } from './policy.mjs';
import { clients } from './client.mjs';

export function validateDeploymentRun(run, { repository, workflowId, mainSha }) {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repository) || !Number.isSafeInteger(workflowId) || workflowId < 1
    || !run || run.workflow_id !== workflowId || run.path !== '.github/workflows/ci.yml'
    || run.event !== 'push' || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success'
    || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || !Number.isSafeInteger(run.id) || run.id < 1 || !SHA.test(run.head_sha) || !SHA.test(mainSha)) throw new Error('Deployment requires a successful same-repository CI push on main.');
  return { sha: run.head_sha, ciRunId: String(run.id), deploy: run.head_sha === mainSha };
}
export async function deploymentGate({ github, context, core }) {
  if (context.ref !== 'refs/heads/main') throw new Error('Deployments may only run from main.');
  const input = context.eventName === 'workflow_run' ? context.payload.workflow_run?.id : context.payload.inputs?.ci_run_id;
  if (!['workflow_run', 'workflow_dispatch'].includes(context.eventName) || !/^[1-9][0-9]*$/.test(String(input || ''))) throw new Error('Supply a completed CI run ID.');
  const runId = Number(input);
  if (!Number.isSafeInteger(runId)) throw new Error('Invalid CI run ID.');
  const [run, workflow, branch] = await Promise.all([
    github.rest.actions.getWorkflowRun({ ...context.repo, run_id: runId }),
    github.rest.actions.getWorkflow({ ...context.repo, workflow_id: 'ci.yml' }),
    github.rest.git.getRef({ ...context.repo, ref: 'heads/main' }),
  ]);
  const plan = validateDeploymentRun(run.data, { repository: `${context.repo.owner}/${context.repo.repo}`, workflowId: workflow.data.id, mainSha: branch.data.object.sha });
  core.setOutput('sha', plan.sha);
  core.setOutput('ci_run_id', plan.ciRunId);
  core.setOutput('deploy', String(plan.deploy));
  if (!plan.deploy) core.notice('Skipping stale CI result: main has moved on. This run cannot roll production back.');
  return plan;
}
export async function deploymentFreshness({ github, context, core, sha }) {
  if (!SHA.test(sha)) throw new Error('Invalid deployment revision.');
  const { data: branch } = await github.rest.git.getRef({ ...context.repo, ref: 'heads/main' });
  const fresh = branch.object.sha === sha;
  core.setOutput('current', String(fresh));
  if (!fresh) core.notice('Main changed before publication; this deployment is skipped.');
  return fresh;
}
export function validateArtifact(manifest, { sha, ciRunId, repository }) {
  if (!SHA.test(sha) || !/^[1-9][0-9]*$/.test(String(ciRunId || '')) || !repository || !manifest || manifest.sha !== sha || manifest.repository !== repository
    || String(manifest.runId) !== String(ciRunId) || manifest.source !== 'github-actions' || manifest.dirty !== false) throw new Error('Site artifact does not match the successful CI run and exact deployment revision.');
  return manifest;
}
export async function verifyCloudflareDeployment({ url, sha, repository, attempts = 12, delay = 5000, fetcher = fetch, sleep = setTimeout }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || !SHA.test(sha)) throw new Error('Supply a trusted HTTPS deployment URL and exact revision.');
  const request = async path => {
    const response = await fetcher(new URL(path, base), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path.split('?')[0]} returned HTTP ${response.status}.`);
    return response;
  };
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const manifest = await (await request(`/build.json?sha=${sha}&attempt=${attempt}`)).json();
      if (manifest.sha !== sha || manifest.repository !== repository) throw new Error('Cloudflare is serving a different revision.');
      for (const path of ['/index.html', '/inbox.html', '/platform.css', '/src/platform.js', '/src/platform-core.js']) {
        const response = await request(path);
        if (!(await response.text()).trim()) throw new Error(`Empty deployed asset: ${path}`);
      }
      const session = await (await request('/api/session')).json();
      if (session.authenticated !== false || session.user !== null || session.csrfToken) throw new Error('Public API unexpectedly grants a maintainer session.');
      const workspace = await (await request('/api/workspace')).json();
      if (workspace.repository !== repository || !Array.isArray(workspace.tickets) || !Array.isArray(workspace.people)
        || workspace.integration?.github !== true || workspace.integration?.agents !== true) throw new Error('The deployed database/API integration is not ready.');
      return { sha, url: base.origin, repository };
    } catch (error) {
      failure = error;
      if (attempt < attempts) await sleep(delay);
    }
  }
  throw new Error(`Cloudflare verification failed: ${failure?.message || 'No verification attempts completed.'}`);
}
async function main() {
  const env = process.env;
  if (process.argv[2] === 'artifact') return validateArtifact(JSON.parse(await readFile('dist/build.json', 'utf8')), { sha: env.DEPLOYED_SHA, ciRunId: env.CI_RUN_ID, repository: env.GITHUB_REPOSITORY });
  if (process.argv[2] === 'verify') return verifyCloudflareDeployment({ url: env.RELAY_URL, sha: env.DEPLOYED_SHA, repository: env.GITHUB_REPOSITORY });
  if (process.argv[2] === 'report') {
    // Verify again immediately before sending a privileged success callback.
    await verifyCloudflareDeployment({ url: env.RELAY_URL, sha: env.DEPLOYED_SHA, repository: env.GITHUB_REPOSITORY });
    await clients(env).platform('/api/automation/deployment', { sha: env.DEPLOYED_SHA, url: env.RELAY_URL, runId: env.GITHUB_RUN_ID });
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `## Cloudflare deployment verified\n\n[Open Relay](${env.RELAY_URL})\n\nCommit: \`${env.DEPLOYED_SHA}\`\n\nThe successful CI artifact, public assets, database API, and signed ticket deployment callback were verified.\n`);
    return;
  }
  throw new Error('Unknown deployment command.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
