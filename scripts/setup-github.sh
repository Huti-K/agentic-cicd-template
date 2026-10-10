#!/usr/bin/env bash
set -euo pipefail
repo="${1:?Usage: bash scripts/setup-github.sh OWNER/REPO [--pages]}"
gh repo view "$repo" --json nameWithOwner --jq .nameWithOwner
gh label create agent-ready --repo "$repo" --color 247A51 --description 'Maintainer authorized a Codex implementation run' --force
gh label create bug --repo "$repo" --color D73A4A --description 'Something is not working' --force
gh api --method PUT "repos/$repo/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
if [[ "${2:-}" == '--pages' ]]; then
  if gh api "repos/$repo/pages" >/dev/null 2>&1; then
    gh api --method PUT "repos/$repo/pages" -f build_type=workflow >/dev/null
  else
    gh api --method POST "repos/$repo/pages" -f build_type=workflow >/dev/null
  fi
  gh variable set PAGES_ENABLED --repo "$repo" --body true
fi
printf 'Setup complete. Add OPENAI_API_KEY in GitHub Secrets before starting an agent.\n'
