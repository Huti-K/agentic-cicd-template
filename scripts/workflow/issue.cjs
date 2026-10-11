// Adapted from whyisjake/agentic-deployment-template's maintainer-gated issue flow.
function validateIssue(body) {
  body = String(body).replace(/\r\n?/g, '\n');
  const required = ['What happened', 'Steps to reproduce', 'Expected behavior', 'Acceptance criteria'];
  return required.filter((title) => {
    const section = body.split(`### ${title}\n`)[1]?.split(/\n### /)[0]?.trim();
    return !section || section === '_No response_' || section.replace(/[-*\s\[\]]/g, '').length < 5;
  });
}

async function gate({ github, context, core }) {
  const repo = context.repo;
  const actor = context.payload.sender?.login ?? context.actor;
  const { data: permission } = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: actor });
  if (!['admin', 'write', 'maintain'].includes(permission.permission)) throw new Error('Only a maintainer may start Codex.');
  const number = Number(context.payload.issue?.number ?? context.payload.inputs?.issue_number);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Supply a valid issue number.');
  const { data: issue } = await github.rest.issues.get({ ...repo, issue_number: number });
  if (issue.pull_request || issue.state !== 'open') throw new Error('Choose an open issue, not a pull request.');
  if ((issue.body ?? '').length > 16_000) throw new Error('Keep the bug report under 16,000 characters.');
  const missing = validateIssue(issue.body ?? '');
  if (missing.length) throw new Error(`Complete these bug-report sections first: ${missing.join(', ')}`);
  const { data: repository } = await github.rest.repos.get(repo);
  const { data: commit } = await github.rest.repos.getCommit({ ...repo, ref: repository.default_branch });
  const { data: existing } = await github.rest.pulls.list({ ...repo, state: 'open', head: `${repo.owner}:agent/issue-${number}` });
  if (existing.length) throw new Error(`A PR already exists: ${existing[0].html_url}. Review it before starting another run.`);
  core.setOutput('number', String(number));
  core.setOutput('title', issue.title.replace(/\s+/g, ' ').trim().slice(0, 100));
  core.setOutput('base', repository.default_branch);
  core.setOutput('sha', commit.sha);
  core.setOutput('issue', JSON.stringify({ number, title: issue.title, body: issue.body, url: issue.html_url }));
}
module.exports = { validateIssue, gate };
