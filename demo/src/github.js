export const DEFAULT_REPOSITORY = 'Huti-K/agentic-cicd-template';
export function parseRepository(value) {
  const candidate = String(value ?? '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(candidate) || ['.','..'].includes(candidate.split('/')[1])) {
    throw new Error('Enter a public repository as owner/repository.');
  }
  return candidate;
}
export function githubURL(repository, path = '') {
  return 'https://github.com/' + parseRepository(repository) + path;
}
export function issueDraftURL(repository, ticket, project) {
  const query = new URLSearchParams({ title: '[' + ticket.id + '] ' + ticket.title,
    body: 'Showcase ticket from Relay\n\nProject: ' + project.name + ' (fictional)\nPriority: ' + ticket.priority + '\n\n' + ticket.description + '\n\nThis draft was prepared from fictional sample data. Review before publishing.' });
  return githubURL(repository, '/issues/new?' + query);
}
export function createGitHubClient(fetcher = globalThis.fetch) {
  const cache = new Map();
  async function get(repository, path, { fresh = false, signal } = {}) {
    const repo = parseRepository(repository);
    const url = 'https://api.github.com/repos/' + repo + path;
    const previous = cache.get(url);
    if (!fresh && previous && Date.now() - previous.at < 60_000) return previous.data;
    let response;
    try {
      response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('GitHub could not be reached. Check your connection and try again.');
    }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new Error('GitHub is rate limited or denied this request. Wait before refreshing, or open the repository on GitHub.');
      if (response.status === 404) throw new Error('Public repository not found. Check the name; private repositories are not supported here.');
      throw new Error('GitHub returned ' + response.status + '. Try again later.');
    }
    const data = await response.json();
    cache.set(url, { at: Date.now(), data });
    // Bound memory while exploring different repositories and pull requests.
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return data;
  }
  async function snapshot(repository, options) {
    // Refresh applies to all data for this repository, including opened PR details.
    // Include the slash boundary so owner/repo does not invalidate owner/repo-extra.
    if (options?.fresh) {
      const prefix = 'https://api.github.com/repos/' + parseRepository(repository);
      for (const url of cache.keys()) if (url === prefix || url.startsWith(prefix + '/')) cache.delete(url);
    }
    const [repo, issues, pulls, runs] = await Promise.all([
      get(repository, '', options), get(repository, '/issues?state=all&sort=updated&per_page=100', options),
      get(repository, '/pulls?state=all&sort=updated&direction=desc&per_page=100', options),
      get(repository, '/actions/runs?per_page=20', options),
    ]);
    if (!repo || !Array.isArray(issues) || !Array.isArray(pulls) || !Array.isArray(runs?.workflow_runs)) throw new Error('GitHub returned unexpected data. Try refreshing.');
    return { repository: parseRepository(repository), description: String(repo.description || ''),
      issues: issues.filter(issue => !issue.pull_request), pulls, runs: runs.workflow_runs, fetchedAt: new Date().toISOString(),
      limited: issues.length === 100 || pulls.length === 100 };
  }
  async function pullRequest(repository, number, options) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid pull request number.');
    const pr = await get(repository, '/pulls/' + number, options);
    if (!/^[a-f0-9]{40}$/.test(pr?.head?.sha)) throw new Error('GitHub returned an invalid pull request revision.');
    const [reviews, comments, checks, status] = await Promise.all([
      get(repository, '/pulls/' + number + '/reviews?per_page=100', options),
      get(repository, '/issues/' + number + '/comments?per_page=100', options),
      get(repository, '/commits/' + pr.head.sha + '/check-runs?per_page=100', options),
      get(repository, '/commits/' + pr.head.sha + '/status?per_page=100', options),
    ]);
    if (!Array.isArray(reviews) || !Array.isArray(comments) || !Array.isArray(checks?.check_runs) || !Array.isArray(status?.statuses)) throw new Error('GitHub returned unexpected review data.');
    return { pr, reviews, comments, checks: checks.check_runs, statuses: status.statuses,
      limited: reviews.length === 100 || comments.length === 100 || checks.total_count > 100 || status.total_count > 100 };
  }
  return { snapshot, pullRequest };
}
