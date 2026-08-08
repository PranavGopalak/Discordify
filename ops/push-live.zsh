#!/bin/zsh
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
requested_revision="${1:-}"

cd "$repository_root"

if [[ ! "$requested_revision" =~ '^[0-9a-f]{40}$' ]]; then
  print -u2 "Usage: npm run push:live -- <full-codex-dev-revision>"
  exit 64
fi

test "$(git branch --show-current)" = "codex-dev"
test -z "$(git status --porcelain --untracked-files=all)"
git fetch origin --prune
test "$requested_revision" = "$(git rev-parse HEAD)"
test "$requested_revision" = "$(git rev-parse origin/codex-dev)"

npm run validate

if git show-ref --verify --quiet refs/remotes/origin/production; then
  git merge-base --is-ancestor origin/production "$requested_revision"
fi

git push origin "$requested_revision:refs/heads/production"
git fetch origin production
test "$requested_revision" = "$(git rev-parse origin/production)"

zsh ops/deploy-local.zsh "$requested_revision"
