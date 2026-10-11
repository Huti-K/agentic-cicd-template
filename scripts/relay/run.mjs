import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clients } from './client.mjs';
import { allowedPath, assertCurrentPr, evidenceSummary, SHA, validatePatch, validateSnapshot, validateTriage } from './policy.mjs';

const env = process.env;
const command = process.argv[2];
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 2_000_000 });
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const output = async (name, value) => { if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `${name}=${value}\n`); };
const saveJson = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const jobPath = () => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(env.JOB_ID)) throw new Error('Invalid job ID.');
  return '/api/automation/jobs/' + env.JOB_ID;
};
const runUrl = () => `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
const snapshot = () => readJson('.agent-output/job.json');
const callback = async (api, body) => api.platform(jobPath(), { runId: env.GITHUB_RUN_ID, ...body });
const validSummary = value => typeof value === 'string' && value.trim() && value.length <= 1500;
const safeMarkdown = value => String(value).replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}\[\]()#+.!|~<>])/g, '\\$1').replace(/@/g, '@\u200b');

export async function currentJob(api, old) {
  const next = validateSnapshot(await api.platform(jobPath()), { repository: env.GITHUB_REPOSITORY, jobId: env.JOB_ID, ticketId: old.ticket.id, kind: old.job.kind });
  if (next.job.id !== old.job.id || next.ticket.headSha !== old.ticket.headSha || next.ticket.prNumber !== old.ticket.prNumber
    || next.ticket.description !== old.ticket.description || next.ticket.title !== old.ticket.title || next.ticket.status === 'human_edit') throw new Error('Ticket changed while the agent was working.');
  if (old.ticket.prNumber) assertCurrentPr(await api.github(`pulls/${old.ticket.prNumber}`), old);
  else if (old.recoveredPrNumber) assertCurrentPr(await api.github(`pulls/${old.recoveredPrNumber}`), { ...old, ticket: { ...old.ticket, headSha: old.sourceSha } });
  else if (old.existingBranch) {
    const ref = await api.github(`git/ref/heads/${old.branch}`);
    if (ref.object?.sha !== old.sourceSha) throw new Error('The recovered branch changed while the agent was working.');
  }
  return next;
}
async function validatePrScope(api, pr) {
  if (pr.changed_files > 30) throw new Error('Existing PR exceeds agent change scope.');
  const files = await api.github(`pulls/${pr.number}/files?per_page=100`);
  if (!Array.isArray(files) || files.length !== pr.changed_files || files.some(file => !allowedPath(file.filename) || (file.previous_filename && !allowedPath(file.previous_filename)))) throw new Error('Existing PR changes protected files.');
  const tree = await api.github(`git/trees/${pr.head.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree) || files.some(file => file.status !== 'removed' && tree.tree.find(entry => entry.path === file.filename)?.mode !== '100644')) throw new Error('Existing PR includes unsafe file modes.');
  return files;
}
const hasBehavioralTest = files => files.some(file => file.status !== 'removed' && /^(tests\/demo\/.*\.test\.js|e2e\/agent\/.*\.spec\.js)$/.test(file.filename));
export async function recoverPublication(api, value) {
  const matches = await api.github(`pulls?state=open&head=${encodeURIComponent(value.repository.split('/')[0] + ':' + value.branch)}&per_page=2`);
  if (!Array.isArray(matches) || matches.length > 1) throw new Error('Ambiguous ticket PR recovery.');
  if (matches.length) {
    const pr = await api.github(`pulls/${matches[0].number}`);
    if (!SHA.test(pr.head?.sha) || pr.base?.ref !== value.baseBranch) throw new Error('Invalid recoverable PR.');
    assertCurrentPr(pr, { ...value, ticket: { ...value.ticket, headSha: pr.head.sha } });
    if (!hasBehavioralTest(await validatePrScope(api, pr))) throw new Error('Recovered implementation requires behavioral tests.');
    value.recoveredPrNumber = pr.number;
    value.existingBranch = true;
    value.sourceSha = pr.head.sha;
    return;
  }
  let ref;
  try { ref = await api.github(`git/ref/heads/${value.branch}`); } catch (error) { if (error.status === 404) return; throw error; }
  if (!SHA.test(ref.object?.sha) || ref.object?.type !== 'commit') throw new Error('Invalid recoverable branch.');
  const comparison = await api.github(`compare/${value.baseSha}...${ref.object.sha}`);
  if (!['ahead', 'identical'].includes(comparison.status) || !Array.isArray(comparison.files) || comparison.files.length > 30
    || comparison.files.some(file => !allowedPath(file.filename) || (file.previous_filename && !allowedPath(file.previous_filename)))) throw new Error('Orphan branch changes protected files or has an unrelated base.');
  const tree = await api.github(`git/trees/${ref.object.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree) || comparison.files.some(file => file.status !== 'removed' && tree.tree.find(entry => entry.path === file.filename)?.mode !== '100644')) throw new Error('Orphan branch includes unsafe file modes.');
  if (!hasBehavioralTest(comparison.files)) throw new Error('Recovered implementation requires behavioral tests.');
  value.existingBranch = true;
  value.sourceSha = ref.object.sha;
}
export async function prepare(api = clients()) {
  const value = validateSnapshot(await api.platform(jobPath()), { repository: env.GITHUB_REPOSITORY, jobId: env.JOB_ID, ticketId: env.TICKET_ID, kind: env.JOB_KIND });
  const repo = await api.github('');
  if (env.GITHUB_REF !== 'refs/heads/' + repo.default_branch) throw new Error('Relay automation must run from the default branch.');
  const base = await api.github(`commits/${encodeURIComponent(repo.default_branch)}`);
  if (base.sha !== value.baseSha) throw new Error('Default branch changed during preparation; retry with a fresh job.');
  value.baseBranch = repo.default_branch;
  value.sourceSha = value.baseSha;
  if (value.ticket.prNumber) {
    const pr = assertCurrentPr(await api.github(`pulls/${value.ticket.prNumber}`), value);
    if (pr.base.ref !== repo.default_branch) throw new Error('PR must target the default branch.');
    await validatePrScope(api, pr);
    value.sourceSha = pr.head.sha;
  } else if (value.job.kind === 'implement') await recoverPublication(api, value);
  if (value.job.kind === 'implement' && !value.ticket.triage?.ready && !value.ticket.prNumber) throw new Error('Human-approved implementation requires a ready triage.');
  await mkdir('.agent-output', { recursive: true });
  await saveJson('.agent-output/job.json', value);
  await output('source_sha', value.sourceSha);
  await output('base_sha', value.baseSha);
  await output('base_branch', value.baseBranch);
  await output('kind', value.job.kind);
  await output('recovered', value.existingBranch ? 'true' : 'false');
  await callback(api, { status: 'running', ...(value.ticket.headSha ? { headSha: value.ticket.headSha } : {}), summary: `Started ${value.job.kind} on ${value.sourceSha.slice(0, 12)}.` });
}
async function triageReport() {
  const api = clients();
  const value = await snapshot();
  await currentJob(api, value);
  const paths = git(['ls-tree', '-r', '--name-only', value.sourceSha]).trim().split('\n');
  const triage = validateTriage(await readJson('.agent-output/triage.json'), paths);
  await callback(api, { status: 'succeeded', summary: triage.summary, triage });
}
export function validateCandidate(value) {
  const empty = !git(['diff', '--cached', '--name-only']).trim();
  if (empty && value.job.kind === 'implement' && value.existingBranch && SHA.test(value.sourceSha)) return [];
  return validatePatch(value.job.kind);
}
export async function publish(api = clients()) {
  const value = await snapshot();
  await currentJob(api, value);
  if (git(['rev-parse', 'HEAD']).trim() !== value.sourceSha) throw new Error('Publication checkout does not match verified source.');
  const entries = validateCandidate(value);
  const summary = await readJson('.agent-output/summary.json');
  if (!validSummary(summary.summary)) throw new Error('Invalid implementation summary.');
  let headSha = value.sourceSha;
  if (entries.length) {
    const parent = await api.github(`git/commits/${value.sourceSha}`);
    const tree = [];
    for (const entry of entries) tree.push(entry.mode === '000000'
      ? { path: entry.path, mode: '100644', type: 'blob', sha: null }
      : { path: entry.path, mode: '100644', type: 'blob', content: git(['show', ':' + entry.path]) });
    const createdTree = await api.github('git/trees', { base_tree: parent.tree.sha, tree });
    const commit = await api.github('git/commits', { message: `feat: address ${value.ticket.id}\n\nRelay job ${value.job.id}`, tree: createdTree.sha, parents: [value.sourceSha] });
    // Recheck after uploading blobs; a non-force ref update also enforces the source-head lease.
    await currentJob(api, value);
    if (value.ticket.prNumber || value.existingBranch) await api.github(`git/refs/heads/${value.branch}`, { sha: commit.sha, force: false }, 'PATCH');
    else await api.github('git/refs', { ref: 'refs/heads/' + value.branch, sha: commit.sha });
    headSha = commit.sha;
  }
  const body = [
    `## ${value.ticket.id}`, '', safeMarkdown(summary.summary), '',
    value.ticket.issueNumber ? `Closes #${value.ticket.issueNumber}` : '', '',
    '### Delivery evidence', '',
    '- The patch was checked on an isolated runner without API credentials.',
    '- Behavioral tests, the application build, and browser checks passed.',
    '- Independent review and CI are dispatched against this exact commit.',
    '- A separate evidence agent will record fixture-backed browser scenarios.', '',
    `[Implementation run](${runUrl()})`, '', 'A maintainer must approve merging from the ticket. No agent merges automatically.',
  ].join('\n');
  const existingPrNumber = value.ticket.prNumber || value.recoveredPrNumber;
  const pr = existingPrNumber
    ? await api.github(`pulls/${existingPrNumber}`, { body }, 'PATCH')
    : await api.github('pulls', { head: value.branch, base: value.baseBranch, title: `${value.ticket.id}: ${value.ticket.title}`.replace(/[\r\n]/g, ' ').slice(0, 240), body, draft: false });
  if (pr.head.sha !== headSha) throw new Error('PR head changed before dispatch.');
  await api.github('actions/workflows/ci.yml/dispatches', { ref: value.branch });
  await api.github('actions/workflows/agent-review.yml/dispatches', { ref: value.baseBranch, inputs: { pr_number: String(pr.number) } });
  await callback(api, { status: 'succeeded', headSha, summary: summary.summary, pullRequest: { number: pr.number, headSha } });
  await output('head_sha', headSha);
}
async function manifest() {
  const value = await snapshot();
  const report = await readJson('.agent-output/browser-results.json');
  const counts = evidenceSummary(report);
  const paths = await readdir('.agent-output/browser-results', { recursive: true });
  const videos = paths.filter(path => path.endsWith('.webm'));
  const screenshots = paths.filter(path => path.endsWith('.png'));
  if (!videos.length || !screenshots.length) throw new Error('Evidence is missing recorded video or screenshots.');
  if (!SHA.test(value.sourceSha) || value.sourceSha !== value.ticket.headSha) throw new Error('Evidence is not for the queued PR head.');
  await saveJson('.agent-output/evidence-manifest.json', { headSha: value.sourceSha, jobId: value.job.id, mode: 'fixture-backed-browser', ...counts, videos, screenshots });
}
async function evidenceReport() {
  const api = clients();
  const value = await snapshot();
  await currentJob(api, value);
  const manifest = await readJson('.agent-output/evidence-manifest.json');
  if (manifest.headSha !== value.ticket.headSha || manifest.jobId !== value.job.id || !Number.isSafeInteger(manifest.passed) || manifest.passed < 1 || manifest.failed !== 0 || manifest.skipped !== 0 || !manifest.videos?.length) throw new Error('Invalid evidence manifest.');
  const artifacts = await api.github(`actions/runs/${env.GITHUB_RUN_ID}/artifacts?per_page=100`);
  const artifact = artifacts.artifacts?.find(item => item.name === 'relay-browser-evidence' && !item.expired);
  if (!artifact) throw new Error('Uploaded browser evidence artifact not found.');
  const url = `${runUrl()}/artifacts/${artifact.id}`;
  await api.github(`statuses/${value.ticket.headSha}`, { state: 'success', context: 'Relay evidence', target_url: runUrl(), description: `${manifest.passed} browser scenarios; video and screenshot artifacts recorded` });
  await callback(api, { status: 'succeeded', headSha: value.ticket.headSha, summary: `${manifest.passed} fixture-backed browser scenarios passed on the exact PR head. Videos, screenshots, traces, and the HTML report are attached.`, evidence: [{ kind: 'artifact', title: 'Browser report, videos, screenshots & generated scenarios (ZIP)', url, headSha: value.ticket.headSha }] });
}
async function failed() {
  const api = clients();
  // The endpoint validates the job and run. Failure callbacks cannot advance a ticket.
  await callback(api, { status: 'failed', error: 'Automation did not complete. Open the linked GitHub Actions run for the failed stage, then retry after correcting it.', summary: env.FAILURE_SUMMARY?.slice(0, 1000) || 'One or more isolated automation stages failed.' });
}
async function main() {
  if (command === 'prepare') return prepare();
  if (command === 'validate-patch') {
    const value = await snapshot();
    if (value.job.kind !== env.JOB_KIND) throw new Error('Patch kind does not match job.');
    return validateCandidate(value);
  }
  if (command === 'triage-report') return triageReport();
  if (command === 'publish') return publish();
  if (command === 'evidence-manifest') return manifest();
  if (command === 'evidence-report') return evidenceReport();
  if (command === 'regression') {
    const value = await snapshot();
    if (value.ticket.type === 'bug' && git(['diff', '--cached', '--name-only']).trim()) {
      const { verifyRegression } = await import('../workflow/verify-regression.mjs');
      await saveJson('.agent-output/regression.json', await verifyRegression());
    }
    return;
  }
  if (command === 'failed') return failed();
  throw new Error('Unknown Relay automation command.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
