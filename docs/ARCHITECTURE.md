# Workflow boundaries

The upstream template supplies the idea of a maintainer adding a label to a structured issue. This adaptation keeps that interaction while implementing Codex support directly.

## Issue implementation

- `gate`: checks the initiating user's repository permission, the open issue, required report fields, and existing PRs. Records an immutable base SHA and issue snapshot.
- `implement`: checks out that base with no persisted Git credentials, gives Codex workspace-write access, and uses the official action's protected API proxy and drop-sudo strategy. No GitHub write permission. Only the proposed patch is uploaded.
- `verify-patch`: a new runner applies the patch, rejects forbidden paths/file modes/binary data and oversized patches, and runs the checks without the API key or a write token.
- `publish`: another runner applies the same artifact to the same base. Trusted validation code runs before publication; candidate code is never executed. The PR uses `agent/issue-N`. CI and AI review are explicitly dispatched because a PR created with the workflow token does not trigger ordinary PR workflows.

The artifact and model output are untrusted. The path allowlist restricts what can be published; prompt instructions alone are not the boundary. This first version supports demo fixes only. To adopt a real application, deliberately update the allowlist, build/test commands, and agent guidance.

## Independent review

Review runs only for an open same-repository PR. It records the exact head SHA, reads a diff against trusted base code, and uses a fresh Codex invocation. It does not check out or execute the candidate tree. A separate job posts the structured result and refuses to report an old result against a changed head. AI review is a commit status plus an advisory GitHub review; it never merges or grants human approval.

Fork contributions receive ordinary secret-free CI. A required AI review status on fork PRs needs a separately designed maintainer review process; do not weaken the same-repository guard to make it pass.

## Troubleshooting

- **API authentication or quota error:** replace `OPENAI_API_KEY`, check API billing/model access, then rerun the failed job. No key is stored in source.
- **GitHub Actions is not permitted to create PRs:** enable “Allow GitHub Actions to create and approve pull requests” under Actions → General. `scripts/setup-github.sh` configures this via the API.
- **Duplicate issue run:** an open `agent/issue-N` PR blocks another implementation. Update that PR or close it before a fresh run.
- **No CI on a bot PR:** inspect the publisher's dispatch step. Both the PR branch CI and base-branch review dispatch must succeed.
- **GitHub asks to approve workflows on a bot PR:** inspect the patch, then use **Approve and run workflows**. Explicitly dispatched checks still run separately; this repository does not disable GitHub's approval policy.
- **Dependabot PR has no AI review:** dispatch **Codex independent review** manually as a maintainer. Dependabot-triggered runs cannot read Actions secrets and are excluded from automatic AI review.
- **Review became stale:** a newer commit arrived. Run a new review; the previous result is deliberately discarded.
- **Pages deployment skipped:** set Pages build source to GitHub Actions and the repository variable `PAGES_ENABLED=true`, or run setup with `--pages`.
- **GitHub Pages 404 immediately after deployment:** allow the CDN to update and open the repository subpath, not the account root.

No automatic merge, recursive review-repair loop, external issue tracker, or production credentials are included in this template.
