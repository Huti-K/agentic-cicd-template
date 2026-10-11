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

Platform API and GitHub responses are stubbed in browser CI for deterministic results. Stubs are test-only. Backend integration tests exercise temporary databases and mocked GitHub responses; workflow tests validate the trusted orchestration and artifact boundaries. These tests do not claim that a real paid agent, remote GitHub merge, or Cloudflare deployment happened. Live operational smoke runs must be recorded separately.

CI runs Node 22 and 24. Browser tests serve the built site on port 4174; development defaults to 4173. Reports are saved in ignored `playwright-report/` and `test-results/` directories.

## What the regression gate proves

Automated issue fixes must change at least one `tests/demo/**/*.test.js` file. The verifier copies the changed tests onto an archive of the original commit and runs them with a trusted Node reporter. At least one assertion must fail, with no other runner/import/syntax errors. The candidate's full checks must then pass.

Use `assert.doesNotThrow` when an unexpected exception demonstrates the bug. New test imports must resolve on the original revision. The gate rejects already-passing tests, missing imports and invalid JavaScript.

This proves a behavioral difference, not exhaustive correctness. A maintainer still checks whether the assertion matches the issue.

## End-to-end agent acceptance

1. Confirm a new bug is reproducible before adding `agent-ready`.
2. Inspect the implementation run and its **regression-evidence** artifact.
3. Confirm only demo source and demo tests changed.
4. Check the exact PR revision has green **verify** and **AI review** statuses.
5. Inspect browser evidence and reviewer findings, then make the human merge decision.
6. Follow main CI through the Cloudflare deployment and confirm the public manifest matches the merged commit.

New workflow definitions take full effect after the upgrade is merged. Deployment only runs from main.
