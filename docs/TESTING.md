# Testing and showcasing Relay

## Walk through the platform

Use the [platform walkthrough](PLATFORM-GUIDE.md) for the real ticket → triage → implementation → evidence → human merge → deployment flow. Sign in as a maintainer before starting paid agents or writing to GitHub. The mock inbox receives fictional customer requests but creates real persisted tickets and requests actual agent runs.

Review the exact PR head, tests, agent review, and generated evidence before merging. Reports and recordings are real GitHub artifacts; an earlier revision's artifacts do not satisfy the current merge gate.

## Preserved local playground

Open `/showcase.html` for the previous fictional multi-project workspace. Its overview, board/list filters, ticket creation/editing, PR finding/fix/check/merge flow, and reset remain interactive and save in the browser. Its sample mutations do not modify GitHub. The GitHub tab and `/pipeline.html` query real public data.

The four projects, people, tickets, and sample PRs in this playground are fictional. Its checks and reviews are deterministic simulations. No intentional application bug is currently seeded; sample findings are scenario data.

## Historical agent evidence

[PR #7](https://github.com/Huti-K/agentic-cicd-template/pull/7) and [PR #11](https://github.com/Huti-K/agentic-cicd-template/pull/11) demonstrate real agent fixes for the previous Stockroom application. [PR #12](https://github.com/Huti-K/agentic-cicd-template/pull/12) is an intentionally bad, unmerged stock-boundary change caught by the reviewer. These are historical examples, not tickets against Relay. Do not merge PR #12.

[The old sample bug report](sample-bug.md) targets starter revision `e902feb`.

## Commands

```sh
npm ci --ignore-scripts
npm run check
npx playwright install chromium
npm run test:browser
npm run tools:install
npm run lint:workflows
npm run scan:secrets
```

`check` runs syntax checks, Node tests, and a clean build. Unit tests cover workspace validation, immutable ticket/PR operations, merge guards, persistence recovery, the public GitHub adapter, issue validation, regression evidence, review reporting, workflow policy, and deployment verification.

Browser checks run against the built application on desktop and mobile. Platform cases cover public access and authentication, ticket creation, version-conflict draft preservation, contributor mentions, agent actions, polling without losing an unsent reply, triage references, exact-head merge confirmation, feedback and human editing, safe text/links, read/write failures, and inbox retries. Legacy cases continue to cover the preserved playground and public GitHub adapter.

Platform API and GitHub responses are stubbed in browser CI for deterministic results. Stubs are test-only. Backend integration tests exercise temporary databases and mocked GitHub responses. Native workerd tests also exercise Cloudflare's actual fetch and D1 runtime, including authentication, CSRF, issue creation, mentions, Actions dispatch, and redirect rejection. Workflow tests validate the trusted orchestration and artifact boundaries. These tests do not claim that a real paid agent, remote GitHub merge, or Cloudflare deployment happened. Live operational smoke runs must be recorded separately.

CI runs Node 22 and 24. Browser tests serve the built site on port 4174; development defaults to 4173. Reports are saved in ignored `playwright-report/` and `test-results/` directories.

Relay implementation verification runs with browser retries disabled and writes a [Playwright JSON report](https://playwright.dev/docs/test-reporters#json-reporter) alongside the HTML report. A failed test can trigger one repair of the existing candidate, followed by full isolated verification. Inspect `relay-verification` and, when present, `relay-repair-verification` for the failed project, test, source location, and error. Repair artifacts have separate names, so the publisher cannot accidentally consume the first failing proposal. A second failure stops the workflow and reports details to the ticket; it never loops indefinitely.

`tests/relay-repair.test.js` covers the repair gate, credential separation, bounded diagnostic data, wrong-job/run rejection, browser report integrity, and safe PR metadata retries. Discussion artifact coverage is included in the normal browser suite through `e2e/evidence-thread.spec.js`. Browser authors should follow `.github/codex/relay-browser-testing.md`: account for count-bearing accessible names, sliding navigation, covered overlays, and animated CSS values without weakening the feature assertions.

## What the regression gate proves

Automated issue fixes must change at least one `tests/demo/**/*.test.js` file. The verifier copies the changed tests onto an archive of the original commit and runs them with a trusted Node reporter. At least one assertion must fail, with no other runner/import/syntax errors. The candidate's full checks must then pass.

Use `assert.doesNotThrow` when an unexpected exception demonstrates the bug. New test imports must resolve on the original revision. The gate rejects already-passing tests, missing imports and invalid JavaScript.

This proves a behavioral difference, not exhaustive correctness. A maintainer still checks whether the assertion matches the issue.

## End-to-end agent acceptance

1. Create a ticket in Relay with a concrete request; include reproduction steps for bugs.
2. Mention `@ai` and inspect the completed triage, acceptance criteria, and source references.
3. Choose **Start implementation** and inspect the actual Actions run and linked PR. Bug implementations must demonstrate a failing assertion on the original source.
4. Confirm only permitted browser source and behavioral tests changed. Check the exact PR revision has green **verify** and **AI review** statuses.
5. Inspect the separate evidence run's real browser report and videos. Exercise feedback or human editing when changes are needed.
6. Use **Approve and merge** for the exact reviewed revision, then follow main CI through the Cloudflare deployment and confirm the public manifest matches the deployed commit.
7. Simulate a fictional support email in the inbox and confirm it creates one ticket and starts triage; retry the same submission to check idempotency.

New workflow definitions take full effect after the upgrade is merged. Deployment only runs from main.
