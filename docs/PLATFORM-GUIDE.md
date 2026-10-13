# Using Relay

## Open the workspace

Open [Relay](https://relay-agent-platform.oktami.workers.dev) or the [support inbox](https://relay-agent-platform.oktami.workers.dev/inbox.html).

The Cloudflare deployment serves the application and `/api` from the same origin. The main workspace is `/`, the support inbox is `/inbox.html`, the preserved local playground is `/showcase.html`, and the public Actions dashboard is `/pipeline.html`.

Public visitors can inspect tickets, discussions, agent runs, and evidence. **Sign in** opens the maintainer password form. A successful sign-in enables server-authorized writes. No GitHub token or OpenAI key is entered in the browser.

If automation is not configured, Relay shows an integration notice. If a refresh fails, it retains the last successfully loaded data with an explicit warning. An unavailable backend is an error state, not a substitute fictional workspace.

## Create a useful ticket

Choose **New ticket**. Add a title, description, type, priority, assignee, tags, and contributors. Explain:

- What the customer was trying to do.
- What happened and what should happen instead.
- Reproduction steps for a bug, or the desired outcome for a feature.
- Any constraints that a human should consider before approving a change.

Ticket identifiers and their GitHub links remain stable. **Edit ticket** updates the description and properties using the version you opened. If another update arrives before you save, the server rejects the stale edit and the form keeps your draft. Copy any draft changes you need, close the form, and reopen it against the current ticket.

All descriptions, labels, and comments render as text. Pasted HTML is never executed.

Ticket totals and filters cover the whole workspace. The ticket list loads in pages; choose **Load more** to continue and **Refresh tickets** to restart from the newest records. Search also finds older tickets that have not been loaded yet. The overview shows recent tickets and a workspace-wide attention queue.

## Mention contributors and start triage

In **Discussion**, type `@` to open the contributor picker. Search by name or handle, use the arrow keys, and press Enter or Tab to insert the selected mention. You can also type a recognized handle directly.

A posted mention adds that person as a contributor. This does not invite them to GitHub or change repository permissions.

Mention **`@ai`** to start triage on a ticket without a PR. The workflow timeline links to the actual GitHub Actions run. A successful triage can:

- Enrich the ticket description while keeping the original request available.
- Produce a concise implementation brief and acceptance criteria.
- Attach relevant code and documentation paths with reasons.
- Mark the ticket ready for implementation.

Triage can fail or identify an unready request. The UI displays the reported result; it does not mark every request ready automatically. Background updates preserve the unsent discussion text and its cursor position.

If dispatch was interrupted before GitHub accepted a queued job, **Resume queued agent** becomes available after its short dispatch lease expires. It resumes the existing job. A run already accepted by GitHub continues to show its queue or execution state.

## Implement and inspect a change

When triage marks the ticket ready, a maintainer chooses **Start implementation**. The trusted workflow prepares the task, an agent works in isolation, verification runs on another runner, and a publisher attaches the real PR to the ticket.

**Pull request** shows the head revision, check results, independent review state, and changed files. Public GitHub reads share a short cache, with the last checked time shown; approval always checks GitHub afresh. Its links open the actual repository and revision. A failed run leaves its error and run link available for investigation.

A separate evidence agent starts automatically after implementation publishes its PR. Choose **Generate evidence** to retry or refresh that evidence. The agent proposes end-to-end tests in the permitted test directory; an isolated runner runs those tests against the current PR head. The ticket and its discussion show playable recordings with scenario, device, result, and revision. Videos and preview images are stored as public assets in a dedicated prerelease for the workflow run; Relay streams them through a read-only endpoint, so playback needs no GitHub login and is independent of the artifact retention period. The full report ZIP remains on GitHub Actions and may require sign-in. General CI keeps videos only for failed tests. Recordings are limited to eight scenarios and 25 MB per media file; failed or stale runs cannot publish successful evidence.

An artifact link is not an assertion that every test passed. Check the workflow result, report, exact head SHA, and acceptance criteria. Earlier-revision evidence is identified as such and cannot satisfy the current merge gate.

## Feedback, manual work, and approval

Use **Comment type → Feedback** to request another implementation pass. Write actionable feedback: what is wrong, the expected behavior, and any additional acceptance criteria. Mentioning `@ai` on a ticket that already has a PR also requests another implementation run.

If an agent is already running, feedback is saved and combined into one follow-up run after it finishes. Pending feedback blocks merging. If GitHub cannot start that run, the ticket keeps the feedback and shows a retry action instead of discarding it.

While a merge result is pending, feedback and `@ai` requests are temporarily rejected and the form keeps your draft. Wait for the merge result before posting that request again.

Choose **Switch to human editing** when a person needs to change the code or clarify the approach. Active jobs are cancelled for that ticket and stale callbacks cannot restore their old state. Discussion can continue without automatically launching another agent. Choose **Resume agents** after the manual work is ready for automation again.

**Approve and merge** is enabled only when the server reports current checks, independent review, evidence, and mergeability ready. The confirmation displays the exact head SHA. **Merge this revision** submits that SHA, and the backend rechecks the live PR before merging. If the PR has changed, review the newer revision and obtain fresh evidence instead of retrying an old approval.

After merge, successful main CI automatically triggers **Deploy Relay to Cloudflare**, which publishes and verifies the Worker and static application. Cloudflare is the sole production deployment path; it has no optional enablement flag and deployment failures fail the workflow. Failed CI and superseded revisions cannot deploy. The deployment callback marks tickets deployed only when their merged changes are included in the verified deployment. Use the manifest and Actions link to inspect a deployment that is still pending or has failed.

## Simulate an incoming support email

1. Open **Support inbox** and choose **Simulate incoming email**.
2. Use a fictional sender name and an `example.com` email address.
3. Enter a realistic subject and body, then choose **Receive email and triage**.
4. Open the linked ticket to follow the real triage run and subsequent workflow.

This is a demo inbox, not an email service. It sends no email and does not connect to a real customer mailbox. Receiving a message creates a persistent ticket and requests actual agent work, so maintainer authentication is required.

An idempotency key protects retries of the same email submission. If the network fails, keep the draft and retry it unchanged. Editing the payload starts a distinct request.

The inbox message and its ticket are saved together. An interrupted delivery can resume with the same key after its short processing lease expires. Issue linking uses a durable claim and a stable marker to reconcile an issue GitHub accepted before an interrupted response. A competing request waits or reports that linking is in progress instead of creating another issue.

If GitHub's issue-creation result stays uncertain and no matching issue can be found, automatic retries stop. A maintainer can choose **Retry GitHub connection** on the ticket and confirm another creation attempt. Relay checks for the existing issue again first. This recovery does not start an agent; resume the requested agent action separately. GitHub provides no issue-creation idempotency key, so an uncertain remote operation needs this explicit decision.

## Local development and configuration

Install dependencies and build first:

```sh
npm ci --ignore-scripts
npm run dev:platform
```

The development command builds assets, applies the local D1 migrations, and starts Wrangler using `wrangler.jsonc`. The database is bound as `DB`. The equivalent separate commands are:

```sh
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Keep local secrets in an ignored `.dev.vars` file. Never commit that file. Production values belong in Worker secrets and GitHub Actions secrets/variables; consult the checked-in Worker configuration and the [API contract](PLATFORM-CONTRACT.md) for binding names.

The deployment operator configures:

| Location | Purpose |
| --- | --- |
| Worker `MAINTAINER_PASSWORD_HASH` secret | Authenticates the shared maintainer demo account |
| Worker `GITHUB_TOKEN` secret | Creates/updates issues, dispatches workflows, reads checks, and performs authorized merges |
| Worker and Actions `RELAY_CALLBACK_SECRET` | Authenticates trusted job and deployment callbacks |
| Actions `RELAY_PUBLISH_TOKEN` | Maintainer credential for the trusted publisher only; creates/updates PR branches so normal CI and review start without a separate workflow approval. Requires repository contents, pull requests, and Actions writes. Do not use the built-in Actions token as a fallback. |
| Actions `OPENAI_API_KEY` secret | Enables isolated agent work |
| Actions Cloudflare deployment credential | Deploys tested main revisions |
| Repository `RELAY_URL` variable | Directs trusted workflow callbacks to this deployment |

The browser receives only public platform data, a session cookie, and its CSRF value. Agent candidate execution receives no GitHub write token, callback key, or deployment credential.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Cannot sign in | Check the maintainer password and Worker configuration; failed authentication is not a GitHub login failure |
| An edit conflicts | Preserve your draft, reopen the current ticket, and apply the intended changes to the latest version |
| Comments do not launch agents | Check whether human editing is active, the mention is a recognized handle, or an existing job is already active |
| Agent run fails | Open its GitHub run and inspect the failing job; missing secrets, API quota, rejected patches, and failing tests require different fixes |
| Evidence is missing | Run the evidence agent against the current PR revision; downloading an older artifact does not refresh it |
| Merge remains disabled | Inspect current checks, independent review, evidence, mergeability, and any explicit backend error |
| Revision changed during approval | Inspect the new head, rerun review/evidence as required, and approve the new revision explicitly |
| Ticket is merged but not deployed | Inspect main CI and Cloudflare deployment verification before assuming the change is live |
| API refresh fails | Relay keeps the last snapshot with a warning; restore connectivity and refresh before making decisions |
| Static preview cannot load tickets | Run the Cloudflare Worker backend, or open `/showcase.html` for the local-only playground |
