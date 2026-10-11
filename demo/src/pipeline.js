const fallbackRepository = 'Huti-K/agentic-cicd-template';
let repository = fallbackRepository;
const status = document.querySelector('#run-status');
const runs = document.querySelector('#runs');
const refresh = document.querySelector('#refresh');
const labels = { success: 'Passed', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', timed_out: 'Timed out',
  action_required: 'Approval needed', in_progress: 'Running', queued: 'Queued', waiting: 'Waiting', pending: 'Pending', neutral: 'Neutral', stale: 'Stale' };
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
async function loadBuild() {
  try {
    const response = await fetch('./build.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('No build manifest');
    const build = await response.json();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(build.repository)) repository = build.repository;
    const commit = document.querySelector('#build-commit');
    if (/^[a-f0-9]{40}$/.test(build.sha)) {
      commit.textContent = build.sha.slice(0, 7) + (build.dirty ? ' · modified' : '');
      commit.href = `https://github.com/${repository}/commit/${build.sha}`;
    } else commit.textContent = 'Unversioned';
    document.querySelector('#build-date').textContent = formatDate(build.builtAt);
    document.querySelector('#build-source').textContent = build.source === 'github-actions' ? 'GitHub Actions' : 'Local build';
  } catch {
    document.querySelector('#build-commit').textContent = 'Local development';
    document.querySelector('#build-date').textContent = 'Build to record a version';
    document.querySelector('#build-source').textContent = 'Development server';
  }
  document.querySelectorAll('[data-repo-link]').forEach(link => { link.href = `https://github.com/${repository}`; });
  document.querySelectorAll('[data-actions-link]').forEach(link => { link.href = `https://github.com/${repository}/actions`; });
}
async function loadRuns() {
  refresh.disabled = true;
  status.textContent = 'Loading recent workflow runs…';
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs?per_page=8`, {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('GitHub unavailable');
    const data = await response.json();
    if (!Array.isArray(data.workflow_runs)) throw new Error('Invalid run data');
    runs.replaceChildren();
    for (const run of data.workflow_runs) {
      const link = element('a', 'run', '');
      const expectedPrefix = `https://github.com/${repository}/actions/runs/`;
      link.href = typeof run.html_url === 'string' && run.html_url.startsWith(expectedPrefix) ? run.html_url : `https://github.com/${repository}/actions`;
      const state = run.status === 'completed' ? run.conclusion : run.status;
      const result = element('span', 'run-result', labels[state] || 'Unknown');
      result.dataset.state = labels[state] ? state : 'unknown';
      const detail = element('div', '', '');
      detail.append(element('p', 'run-title', run.display_title || run.name || 'Workflow run'),
        element('span', 'run-meta', `${run.name || 'Workflow'} · ${run.head_branch || 'Unknown branch'} · ${String(run.head_sha || '').slice(0, 7)}`));
      link.append(result, detail, element('span', 'run-date', formatDate(run.created_at)));
      runs.append(link);
    }
    status.textContent = data.workflow_runs.length ? `Latest runs across branches · refreshed ${new Date().toLocaleTimeString()}` : 'No workflow runs yet. Open Actions to start a run.';
  } catch {
    runs.replaceChildren();
    status.textContent = 'Live run data is unavailable. GitHub may be rate limited or offline; use “Explore the runs” or try again.';
  } finally { refresh.disabled = false; }
}
refresh.addEventListener('click', loadRuns);
await loadBuild();
await loadRuns();
