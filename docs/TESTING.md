# Testing and showcasing the lab

## Useful demonstrations

The current Stockroom app includes the barcode and safe-stock fixes. Scanning **Label roll** succeeds, quantities stay safe integers, and shipping the final unit reaches zero.

- [PR #7](https://github.com/Huti-K/agentic-cicd-template/pull/7) demonstrates the original leading-zero fix.
- [PR #11](https://github.com/Huti-K/agentic-cicd-template/pull/11) demonstrates unsafe-stock validation.
- [PR #12](https://github.com/Huti-K/agentic-cicd-template/pull/12) contains the deliberately incorrect zero-stock boundary. Its old test suite passed and the AI reviewer found the regression. Do not merge it. The upgraded browser suite now covers this boundary too.

There are no intentional inventory bugs in the upgraded application. The report in [sample-bug.md](sample-bug.md) is a historical fixture for the starter revision `e902feb`; it is not a new bug report against the upgraded app.

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

`check` runs syntax checks, Node tests, and a clean build. Unit tests exercise inventory boundaries, issue validation, regression evidence, review reporting, workflow policy, and deployment verification. Browser tests exercise the built application on desktop and mobile viewports. The GitHub API is stubbed only inside dashboard tests so rate limits don't make CI flaky.

CI also runs on Node 22 and 24. Local browser tests serve the built site on port 4174, separate from the development server on 4173. Reports are written to ignored `playwright-report/` and `test-results/` directories.

## What the regression gate proves

The agent must change at least one `tests/demo/*.test.js` file. The verifier copies those tests onto an archive of the original commit and runs them with a trusted Node reporter. At least one assertion must fail, with no other runner/import/syntax errors. Then the candidate's full checks must pass.

A failing test caused by an unexpected exception should use `assert.doesNotThrow` to express the expected behavior. New test imports must resolve on the original revision. The gate rejects a test that already passes, a missing import, and invalid JavaScript; fixtures exercise those cases locally.

The check proves a reported behavioral difference, not exhaustive correctness. A maintainer still reviews whether the assertion matches the issue.

## End-to-end acceptance

For a new, genuine bug:

1. Confirm the issue's report is reproducible before adding `agent-ready`.
2. Inspect the successful implementation run and its **regression-evidence** artifact.
3. Verify that only demo files and demo tests changed.
4. Confirm the exact PR revision has green **verify** and **AI review** statuses.
5. Inspect browser evidence and reviewer findings, then make the human merge decision.
6. Follow main CI through **deploy**. Confirm its public manifest matches the merged commit and open the pipeline page.

New workflow definitions take full effect after their upgrade PR is merged. PR CI and review validate the proposed upgrade beforehand; deployment only runs from main.
