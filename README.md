# Huti's agentic CI/CD lab

[![CI](https://github.com/Huti-K/agentic-cicd-template/actions/workflows/ci.yml/badge.svg)](https://github.com/Huti-K/agentic-cicd-template/actions/workflows/ci.yml)

A public template for **bug report → Codex fix → regression test → pull request → independent Codex review → human merge → deployment**.

The included Stockroom demo is a small barcode inventory app. It deliberately starts with a leading-zero lookup bug so you can test the entire workflow on a real failure.

- [Open the demo](https://huti-k.github.io/agentic-cicd-template/)
- [Report a bug](https://github.com/Huti-K/agentic-cicd-template/issues/new?template=bug.yml)
- [Watch the workflows](https://github.com/Huti-K/agentic-cicd-template/actions)

## Run locally

Requires Node.js 22+. There are no application or npm dependencies.

```sh
npm run check
npm run dev
```

Open http://127.0.0.1:4173. Click **Scanner** to see a successful lookup, then **Label roll** to reproduce the starter bug. Stock is kept in memory and resets on refresh.

## Try the full workflow

1. Open a bug report using the form. Include reproduction steps, expected behavior, and testable acceptance criteria. A ready-to-use report is in [docs/sample-bug.md](docs/sample-bug.md).
2. A maintainer adds **agent-ready**. This starts **Codex issue fix**. Alternatively, run that workflow manually with the issue number.
3. Codex works in a runner with repository read permissions. Its patch is limited to `demo/` and `tests/demo/`.
4. A fresh runner validates the patch and runs `npm run check`. Only then does a separate publishing job open a PR.
5. The publisher explicitly starts CI and **Codex independent review**. This avoids GitHub's suppression of automatic workflow triggers for PRs created with `GITHUB_TOKEN`.
6. Inspect the tests and AI review, then merge the PR yourself. Main-branch CI deploys the demo to GitHub Pages when Pages is enabled.

AI findings do not trigger an unlimited repair loop. Edit the PR or address findings locally, push the changes, and review again. The manual review workflow accepts a PR number. A changed PR head invalidates older review results.

## Use this template

Click **Use this template** on GitHub, create your repository, and clone it. Then:

1. Save an OpenAI API key as the Actions secret **OPENAI_API_KEY** in your repository settings. GitHub Actions uses API billing; a local ChatGPT login is not copied to runners. Do not commit credentials.
2. Run `bash scripts/setup-github.sh OWNER/REPO`. It creates the labels and enables Actions-created PRs.
3. Optional: run `bash scripts/setup-github.sh OWNER/REPO --pages` to also enable GitHub Pages deployment.
4. Replace the repository URLs in this README with your own.
5. Set a repository variable **CODEX_MODEL** if you want an explicit model. Otherwise the Codex CLI selects its default. Both implementation and review use medium reasoning effort.
6. In Settings → Branches, require the **verify** and **AI review** checks before merging. For a solo-owned repository you can merge your own PR after checking the evidence; AI comments do not count as human approvals.

Actions are pinned to commit SHAs, with Dependabot updates enabled. Codex CLI itself follows the action's default version unless you pin `codex-version` in both agent workflows.

## What runs where

| Workflow | Trigger | What it does |
| --- | --- | --- |
| CI | PR, push to main, manual dispatch | Syntax checks, Node tests, static build; deploys main when enabled |
| Codex issue fix | Maintainer adds `agent-ready`, or manual dispatch | Validate report, generate patch, independently test, publish PR |
| Codex independent review | Same-repo PR or explicit dispatch | Review exact diff from trusted base code; publish findings and `AI review` status |

Implementation times out after 15 minutes; review after 10. These are runtime limits, not dollar caps. Use API project budget controls and monitor usage for your account.

Fork PRs still get ordinary CI but never the API secret or automatic AI review. The paid agent only accepts a maintainer-authorized issue. Candidate code is tested without secrets; the publisher never executes that code. Publication rejects changes outside the demo and its tests, binaries, symlinks, executable files, and patches above 200 KB.

See [Testing](docs/TESTING.md) for the experiment and [Architecture](docs/ARCHITECTURE.md) for boundaries and troubleshooting.

## Attribution

Adapted from [whyisjake/agentic-deployment-template](https://github.com/whyisjake/agentic-deployment-template), revision `4e230e5370a34ed7abfd4bb7134db5d6c073a2b9`. This version retains the structured issue and maintainer-gated execution approach, replaces the Claude-specific workflows with Codex jobs, and adds the demo, patch validation, independent review, CI, and Pages deployment. The upstream MIT license is retained; see [LICENSE](LICENSE).

Built with the official [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action).
