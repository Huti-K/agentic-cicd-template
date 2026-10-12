# Relay architecture

## Application and storage

Relay's main application runs on a Cloudflare Worker. Static assets are built from `demo/`; the same Worker handles `/api` and stores tickets, discussion, jobs, evidence, inbox messages, and session metadata in D1.

- `demo/src/platform.js` renders the workspace, full ticket view, contributor mentions, agent actions, and mock inbox with DOM creation and text nodes.
- `demo/src/platform-core.js` holds the same-origin API client, safe link helpers, filtering, mention parsing, and client-side merge presentation rules.
- `worker/` validates inputs, authorizes writes, persists state, talks to GitHub, and processes trusted automation callbacks.
- `migrations/` defines D1 storage; `wrangler.jsonc` binds the database as `DB` and serves the built assets.
- `docs/PLATFORM-CONTRACT.md` specifies the browser and workflow APIs.

The browser is public to read. Maintainer sign-in establishes an HttpOnly, SameSite session cookie. Authenticated mutations require the session's CSRF token and same-origin requests. Credentials never enter browser code or local storage. Server validation and GitHub's current state decide which operations are allowed; a disabled or enabled browser button is only presentation.

Ticket edits carry a version so stale forms cannot overwrite a newer description or agent result. Comments add recognized mentioned contributors without granting repository access. `@ai` starts triage, or implementation when a PR is already linked. Feedback can request another implementation pass. Human editing cancels active automation for the ticket and suppresses comment-triggered work until resumed.

Inbox submissions are fictional emails, not a real mailbox integration. A submitted message creates a persistent ticket and queues real triage. Idempotency keys make unchanged retries safe.

## Ticket UI and failure handling

Each ticket has a stable URL such as `/#ticket/RLY-1`. Its description, original customer request, enriched brief, acceptance criteria, references, properties, discussion, workflow timeline, PR, and evidence are visible together.

Polling refreshes server state while retaining the actual discussion editor node, unsent text, focus, and selection. An edit dialog remains intact on version conflicts. Successful writes are not reported as failures merely because a subsequent read refresh fails. Live outages retain the last successful snapshot with a notice; the main product does not substitute the local playground's fictional data.

External URLs must be HTTPS and repository paths are encoded into GitHub source links. Source strings are never interpreted as HTML. Font assets and their licenses are served locally under `demo/fonts/`.

## Agent workflow trust boundaries

`relay-agent.yml` handles ticket triage, implementation, and evidence jobs dispatched on a trusted repository ref.

1. **Preparation** fetches the authorized job using the callback credential, fixes the relevant source revision, and writes bounded task data for later jobs.
2. **AI work** uses an isolated runner. Triage proposes a structured brief; implementation proposes application/test changes; evidence generation proposes end-to-end tests. AI output remains untrusted.
3. **Verification** uses another runner to validate allowed paths, apply the proposal, and execute the appropriate checks. Candidate source/tests do not receive repository write, callback, or deployment credentials. Bug fixes require regression evidence when existing entry points permit reproduction. Evidence tests run against the exact PR head and cannot change application code.
4. **Publication/reporting** validates collected output before publishing a branch/PR or recording triage/evidence. This trusted step does not execute candidate application code or tests.
5. **Callbacks** record the real run ID, head revision, result, and artifact links. Duplicate callbacks are idempotent; stale or cancelled jobs cannot overwrite newer ticket state.

Application proposals are limited to the demo and designated test paths. Evidence proposals are limited to `e2e/agent/`. The allowlist and isolated runners enforce these boundaries; prompts alone are insufficient.

Evidence links point to the corresponding GitHub Actions artifact. Reports and recordings are produced by real test execution and downloaded as artifact ZIPs. GitHub may require sign-in for downloads. An artifact's existence is distinct from its tests succeeding.

## Independent review and human merge

The separate `agent-review.yml` workflow inspects the exact PR head/base using trusted review instructions. Candidate source is read as data and never executed by the reviewer. The reporter validates its structured result, links concrete findings to the reviewed commit, and discards outdated results. Review summaries are advisory agent output, not human approvals.

The Worker derives merge eligibility from live PR state, current checks, independent review, evidence bound to the current head, and mergeability. The maintainer explicitly confirms a head SHA in Relay. Immediately before merging, the backend refreshes and checks that revision again. A new commit invalidates an old approval attempt. No comment, callback, or agent result grants unattended merge authority.

## CI and Cloudflare deployment

The stable `verify` gate depends on Node tests/build, workflow validation, a redacted secret scan, and desktop/mobile browser tests. Failed, skipped, or cancelled required checks fail verification.

Successful main-branch CI deploys the verified platform assets and Worker to Cloudflare, applies the required D1 migrations, and verifies the public deployment manifest. Production is served at <https://relay-agent-platform.oktami.workers.dev>.

The trusted deployment callback records the deployed SHA and URL. It marks a merged ticket deployed only after confirming its merge commit is included in that deployment. A failed deploy does not falsely advance ticket status.

Build metadata contains the public commit, repository, workflow run, and build timestamp; it contains no credentials. The pipeline dashboard links to public GitHub Actions runs. See workflow files and the [platform contract](PLATFORM-CONTRACT.md) for the executable configuration.

## Preserved learning examples

`/showcase.html` retains the previous browser-only multi-project workspace. Its fictional tickets and PR actions save in local storage. Its GitHub tab performs public read-only API requests and uses links for GitHub writes. These simulations are explicitly separate from the main platform's real job records.

The original `agent-fix.yml` issue-label workflow also remains a learning example: maintainer gate, isolated Codex proposal, failing-before/passing-after regression proof, trusted publisher, independent review, and human merge. Historical Stockroom PRs are not implementation candidates for the current Relay app.

## Recovery

Use the failing job's logs, ticket error, and exact revision when diagnosing an issue. Missing credentials, API quota, unsafe patches, failed assertions, stale revisions, and a failed deployment are different failure modes. Repeating a run without resolving its cause does not make it trustworthy.

See [Using Relay](PLATFORM-GUIDE.md#troubleshooting) for user-facing recovery steps and [Testing](TESTING.md) for test commands and evidence limitations. To undo a released change, prepare a revert through the same review and deployment process; there is no unattended production rollback.
