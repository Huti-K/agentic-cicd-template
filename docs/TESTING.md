# Testing and showcasing Relay

## Walk through the product

1. Start on **Overview**. Totals, priority tickets, project progress and activity are derived from the sample workspace.
2. Open **Tickets**. Switch between board and list, search, and combine project/status/priority filters.
3. Create a ticket, assign it, edit it, and change its status. Reload to confirm the locally saved changes.
4. Open **Pull requests → Reconcile saved trips after reconnecting**. The sample PR has failed checks. Run the agent review to see an actionable finding.
5. Apply the suggested fix. Both checks and review become pending. Rerun each, then merge the sample PR. Only its linked ticket is completed.
6. Open **GitHub**. The default public repository is `Huti-K/agentic-cicd-template`; another public `owner/repository` can be connected. Inspect real issues, PR checks, agent comments, and workflow runs.
7. Use **Draft on GitHub** from a sample ticket to open a prefilled issue. This prepares a draft; publishing requires submitting it on GitHub.
8. Use **Reset sample data** to restore the fictional workspace. It does not change GitHub.

The four projects, people, tickets and sample PRs are fictional. Sample checks and reviews are deterministic simulations. The GitHub view and pipeline page query actual public data. No intentional application bug is currently seeded; sample PR findings are scenario data.

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

Browser checks run against the built application on desktop and mobile. They cover search/filtering, creation/editing/persistence, safe text rendering, PR review/fix/merge, blocked ticket completion, reset, corrupted local data, GitHub API results and outages, and the real pipeline page. GitHub responses are stubbed in browser CI for deterministic results. Stubs are test-only; the application uses the public API.

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
6. Follow main CI through **deploy** and confirm the public manifest matches the merged commit.

New workflow definitions take full effect after the upgrade is merged. Deployment only runs from main.
