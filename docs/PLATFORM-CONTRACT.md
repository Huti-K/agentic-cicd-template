# Relay platform contract

Implementation contract for the Cloudflare Worker, browser, and trusted GitHub workflows.
All browser routes are same-origin. Public reads; authenticated maintainer writes. JSON errors are `{ error, code }`.
Writes require a `X-CSRF-Token` returned by the session endpoint. No browser GitHub or OpenAI credentials.

## Browser API

- `GET /api/session` → `{ authenticated, user: { id, name, handle } | null, csrfToken?: string }`.
- `POST /api/session` `{ password }` → session above; secure HttpOnly session cookie. `DELETE /api/session` logs out.
- `GET /api/workspace` → `{ repository, people, projects, tickets, ticketCounts: { total, statuses, priorities }, activeJobCount, attentionTickets, jobs, integration: { github, agents }, deployment: { url, sha } }`. Tickets are the latest 50; counts cover the complete workspace and attention tickets are selected across it. Jobs are recent activity, not the source of aggregate counts.
- `GET /api/tickets?query=&status=&priority=&limit=50&cursor=` → `{ tickets, total, nextCursor }`. Search and filters run over all tickets. The numeric cursor continues descending ticket-number order; `total` is the complete filtered count. A null next cursor means the last page.
- `GET /api/tickets/:id` → `{ ticket, comments, jobs, evidence, pullRequest }`.
- `POST /api/tickets` `{ title, description, type: 'bug'|'feature'|'task', priority, tags?: string[], assigneeId?: string, contributorIds?: string[] }` → ticket detail.
- `PATCH /api/tickets/:id` `{ version, title?, description?, priority?, tags?, assigneeId?, contributorIds? }` → ticket detail. Reject stale versions with 409.
- `POST /api/tickets/:id/comments` `{ body, kind?: 'comment'|'feedback' }` → ticket detail. Recognized @handles add contributors. @ai triggers triage (or implementation when a PR exists). Feedback comments rerun implementation unless human editing is selected.
- `POST /api/tickets/:id/actions` `{ action: 'triage'|'implement'|'evidence'|'human-edit'|'resume'|'approve-merge'|'retry-issue', headSha?: string, confirmRetry?: boolean }` → ticket detail. Merge requires current head, completed evidence, green checks and independent review; never unattended. `retry-issue` requires explicit `confirmRetry: true`, reconciles an existing GitHub issue before permitting a new creation attempt, and starts no agent.
- `GET /api/inbox` → `{ messages }`.
- `POST /api/inbox` `{ senderName, senderEmail, subject, body, idempotencyKey }` → `{ message, ticket }`; creates one ticket and starts triage. Fictional email dashboard, no real email delivery.

Ticket: `{ id: 'RLY-1', version, title, description, originalDescription, type, priority: 'urgent'|'high'|'medium'|'low', status: 'new'|'triaging'|'ready'|'implementing'|'in_review'|'human_edit'|'merged'|'deployed'|'failed', tags: string[], assigneeId, contributorIds: string[], createdAt, updatedAt, issueNumber, issueUrl, prNumber, prUrl, headSha, triage: { summary, acceptanceCriteria: string[], files: [{path, reason}], documentation: [{path, reason}], ready: boolean } | null, error: string|null }`.

Person: `{ id, handle, name, initials, color, role }`; handles include `huti`, `davidmikan`, and `ai`. These are workspace identities; adding a contributor does not grant GitHub permissions.
Comment: `{ id, ticketId, authorId, body, kind, createdAt }`.
Job: `{ id, ticketId, kind: 'triage'|'implement'|'evidence', status: 'queued'|'running'|'succeeded'|'failed', runId, runUrl, headSha, summary, createdAt, updatedAt }`.
Evidence: `{ id, jobId, headSha, kind: 'report'|'video'|'screenshot'|'artifact', title, url }`. Only trusted generated evidence, never fabricated successful tests.
Pull request: `{ number, url, title, headSha, state, checks: [{name, status, conclusion}], freshness: { fetchedAt, expiresAt?, cached }, reviewState, mergeable, files: [{path, additions, deletions}], checksReady, evidenceReady, canMerge }` or null. Public reads share a 30-second cache; errors use a short retry backoff. The backend bypasses that cache before merge and when reconciling a pending merge.
Inbox message: `{ id, senderName, senderEmail, subject, body, ticketId, createdAt }`.

## Workflow API

One `relay-agent.yml` workflow dispatched on the trusted branch with inputs `{ job_id, ticket_id, kind }`. The platform base URL is the repository variable `RELAY_URL`. The shared callback key is the GitHub secret and Worker secret `RELAY_CALLBACK_SECRET`.

- `GET /api/automation/jobs/:jobId` with `Authorization: Bearer <callback secret>` → `{ job, ticket, comments, repository, branch, baseSha }`. Fetch this in the trusted preparation job; never expose the callback secret to the AI job.
- `POST /api/automation/jobs/:jobId` same authorization, `{ status: 'running'|'succeeded'|'failed', runId, headSha?, summary?, error?, triage?, pullRequest?: {number, headSha}, evidence?: [{kind,title,url,headSha}] }`. Call from a trusted report/publish job, not the AI or candidate execution job. Duplicate callbacks are idempotent. Stale jobs cannot overwrite newer ticket state.
- `POST /api/automation/deployment` same authorization, `{ sha, url, runId }`; marks merged tickets deployed only when their merge commits are ancestors of this deployed SHA.

Separate isolated jobs for trusted preparation, AI work, verification of candidate code, and publication/callbacks. AI and candidate execution receive no GitHub write token or callback/deployment secret. Keep PR changes within `demo/`, `tests/demo/`, and `e2e/agent/` only. New features need real tests; bug fixes need regression evidence where existing entry points allow it. Evidence agent may write only `e2e/agent/`; its generated tests must run on the exact PR head on another runner. Preserve artifacts/videos and publish their genuine links. A test-generation artifact must not change application code or automation.
