# Testing the lab

## Starter experiment

The initial demo intentionally converts input to a number before lookup. That breaks identifiers with leading zeros and can accept unintended numeric spellings. The baseline tests cover other inventory behavior and intentionally leave this regression for the issue-fixing agent to discover and test. CI being green does not imply exhaustive coverage.

Use [sample-bug.md](sample-bug.md) as the first issue. After the agent opens its PR, verify:

1. The new regression test fails against the base version of `demo/src/inventory.js`.
2. The PR changes only demo code and its tests.
3. `npm run check` passes on the proposed commit.
4. **Codex independent review** publishes a report attached to that same commit.
5. **AI review** is successful, and the PR's **verify** check is successful.
6. The label roll lookup works on the PR checkout.
7. After you merge, main CI deploys Pages and the hosted label roll lookup works too.

The initial test PR is intentionally left open for you to inspect and merge. Creating another issue for the same bug after merging is not a fresh test; use a new bug or a separate repository created from a starter revision.

## Local checks

`npm run check` performs JavaScript syntax checks, Node unit tests (inventory behavior and workflow gates), and the static build. `npm run dev` serves the demo on localhost:4173. No npm install is necessary.

For workflow changes, run [actionlint](https://github.com/rhysd/actionlint). Do not give a green review based only on YAML parsing; verify event conditions, credentials, PR publication, and follow-up workflow runs too.

## Review failures

API errors, missing credentials, invalid review JSON, and timeouts are failures, not approval. The review publishes an error status. After correcting the cause, rerun the review workflow for the PR. Actionable findings produce a failing **AI review** status; make the fix and push before re-reviewing.
