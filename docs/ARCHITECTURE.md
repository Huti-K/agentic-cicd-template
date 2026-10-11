# Delivery architecture

## Relay application

The site is a dependency-free browser application deployed as static files. There is no authentication server or browser credential.

- `demo/src/seed.js` defines fictional projects, people, tickets, PRs and activity.
- `demo/src/workspace.js` validates the workspace and provides immutable operations. Ticket IDs stay with their project; failed changes leave the original state untouched. A sample PR must pass checks and review before merging.
- `demo/src/app.js` renders with DOM creation and text nodes. Externally supplied strings are never parsed as HTML. Sample mutations save to a versioned local-storage key.
- `demo/src/github.js` validates repository names, constructs GitHub URLs, and performs credential-free public API requests. Requests time out, support cancellation, and cache in memory for one minute.
- `demo/src/pipeline.js` uses the build manifest's repository to show real Actions runs.

The sample state and live GitHub snapshot are distinct. Sample changes cannot publish to GitHub. Write actions are links to GitHub, where its authentication and authorization apply. The site accepts no tokens. A sample ticket can prepare an issue URL, but the user submits the draft on GitHub.

The GitHub adapter reads repository metadata, recent issues/PRs and workflow runs. PR details fetch the current head SHA first, then checks and commit statuses for that SHA, reviews, and conversation comments. Agent review reports appear in the conversation. Review history may concern earlier revisions; the UI does not infer merge permission. GitHub remains the source of truth for branch protection and review resolution.

Live views include refresh time, partial-list notices, loading and error states. Failed refreshes retain the last successful snapshot with an explicit notice. Async requests are cancelled when superseded so a late response cannot overwrite another repository or PR.

## Issue implementation

1. **gate** checks the initiating maintainer, report structure/size, open issue, and existing PR. It records an immutable base SHA and issue snapshot. CRLF and LF reports are accepted.
2. **implement** checks out that revision without persisted Git credentials. Development dependencies are installed before Codex runs. Codex gets workspace-write access through the official action, with its protected API proxy and drop-sudo strategy. No GitHub write permission is available. Only an untrusted patch is collected afterward.
3. **verify-patch** uses a fresh runner with no API secret or write token. Trusted validation rejects forbidden paths, file modes, binaries, and oversized patches. The verifier archives the original revision in a temporary directory, copies changed demo tests onto it, and requires an assertion failure. Syntax errors and missing imports are rejected. It then runs `npm run check` on the fixed tree and saves regression evidence.
4. **publish** independently reapplies and validates the artifact. It never runs candidate tests or application code. It opens `agent/issue-N`, then explicitly dispatches CI on the PR branch and review from the base branch because workflow-token-created PRs don't reliably trigger follow-up workflows.
5. **summary** records every handoff's result. Failures don't start automatic repair attempts.

The path allowlist, separate runners, and verification jobs enforce the publication boundary. Prompt instructions alone are not sufficient. A failing-before/passing-after test is useful evidence, not a proof that the test is complete or honest; independent review and the human merge decision remain necessary.

## Independent review

An open, ready, same-repository PR is required. The preparer records its exact head/base and sets a pending status. A fresh Codex invocation reads a bounded diff and trusted base instructions in a read-only sandbox, with drop-sudo protecting the API proxy. Candidate source can be inspected with `git show`; it is never executed.

The reporter has no API key. It validates the structured result, rejects empty or contradictory verdicts, escapes supplied text, and links findings to the reviewed commit. Findings fail **AI review**; errors remain errors. It discards results when the PR closes or either revision changes. Review summaries appear on both the PR and the run. They are advisory comments, not human approvals.

Paid review is skipped for draft/fork PRs and automatic Dependabot events. Maintainers can manually dispatch review on ready same-repository PRs. A required AI status on fork PRs needs an independently designed trusted review process.

## CI and deployment

Three independent jobs feed a stable **verify** gate:

- **unit:** syntax checks, all Node tests, and a clean static build on Node 22 and 24.
- **automation:** SHA-verified actionlint and Gitleaks binaries validate workflows and scan fetched Git history with secret values redacted.
- **browser:** desktop/mobile Chromium exercises the built application and dashboard. Reports retain failure screenshots and traces for seven days. The exact tested site is saved as **site-preview**, and main also uploads its Pages artifact.

The aggregate job runs even after failures and explicitly rejects failed, skipped, and cancelled dependencies. Branch protection continues to require `verify` plus `AI review`.

Only main, with `PAGES_ENABLED=true`, can deploy. The deploy job uses Pages/OIDC permissions and publishes the already-tested artifact. It then waits for the public `build.json` to match the expected commit and checks the application assets. The run fails if the CDN never serves that version. This verifies delivery, while the browser job verifies behavior.

Each build contains only demo assets plus its public manifest: commit, repository, build time, source, and workflow run ID. The dashboard uses that repository to query public Actions data on demand. It neither stores nor requests API credentials.

## Recovery

| Symptom | Next step |
| --- | --- |
| Missing API key, quota, or model access | Correct the Actions secret or API project configuration, then rerun the failed workflow |
| Regression not proved | Add an assertion against existing demo entry points that fails on the original implementation; missing imports and syntax errors are not reproductions |
| Duplicate issue run | Review the open `agent/issue-N` PR before starting another attempt |
| Failed browser check | Download **browser-report**; open it with `npx playwright show-report PATH` and inspect the trace |
| Agent PR has no CI/review | Inspect the publisher's dispatch step; both dispatches must succeed |
| GitHub asks to approve bot PR workflows | Inspect the patch and approve the runs; explicitly dispatched checks still run separately |
| Review discarded | The PR closed or its head/base changed; update the branch and dispatch a fresh review |
| Pages deployment skipped | Enable Pages with Actions as the source and set `PAGES_ENABLED=true` |
| Deployment smoke check failed | Inspect the manifest URL and failed assets; rerun CI on main after correcting the deployment issue |
| Dashboard cannot load runs | GitHub may be offline or rate limited; the Actions link remains available |

To undo a released change, create a normal revert PR and pass the same checks before merging. No workflow grants an unattended production rollback or merge.

Actions are SHA-pinned and updated by Dependabot. Tool versions and archive hashes live in `scripts/install-tools.mjs`; update both together. `CODEX_VERSION` optionally pins the CLI. There is no hidden recurring agent job or unbounded paid loop.
