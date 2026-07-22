#!/usr/bin/env bash
# Commit generated design-token artifacts and open/update the sync PR.
#
# Used by .github/workflows/sync-design-tokens.yml. Kept as a script so it can
# be syntax-checked and dry-run locally without a Figma push.
#
# Required env:
#   EVENT_NAME   — github.event_name (push | workflow_dispatch)
#   ACTOR        — github.actor
# Optional env:
#   DRY_RUN=1    — print actions; do not commit, push, or call gh
set -euo pipefail

SYNC_BRANCH=design-tokens/figma-sync
# Scope omitted: design-tokens is not in .github/semantic.yml.
TITLE='chore: sync tokens from Figma'
EVENT_NAME=${EVENT_NAME:?EVENT_NAME is required}
ACTOR=${ACTOR:?ACTOR is required}
DRY_RUN=${DRY_RUN:-0}

TRIGGER="$EVENT_NAME"
if [[ "$EVENT_NAME" == "push" ]]; then
  TRIGGER="$EVENT_NAME (push by $ACTOR)"
fi

BODY=$(
  cat <<EOF
Automated design-token sync from the Zitadel Design System.

**Trigger:** ${TRIGGER}

**Before merging:**
1. Review \`packages/design-tokens/figma-export/\` and \`src/generated/\`.
2. If the snapshot check is red, a token name changed — update consumers
   and the snapshot intentionally, or roll the sync back.
3. Spot-check console light + dark in \`apps/console\`.

Repeat syncs before merge append commits to this PR instead of opening a new one.
EOF
)

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '+ DRY_RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

git add \
  packages/design-tokens/figma-export \
  packages/design-tokens/figma-tokens.lock \
  packages/design-tokens/src/generated/figma.tokens.json \
  packages/design-tokens/src/generated/tokens.css \
  packages/design-tokens/src/generated/tokens.ts \
  packages/design-tokens/src/generated/tailwind.css \
  packages/design-tokens/src/generated/shadcn.css

committed=0
if ! git diff --cached --quiet; then
  run git commit -m "$TITLE"
  committed=1
else
  echo "No generated artifact changes to commit."
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == "$SYNC_BRANCH" ]]; then
  # Plugin / export path: append on top of existing figma-export commits.
  run git push origin "HEAD:$SYNC_BRANCH"
elif [[ "$committed" == "1" ]]; then
  # REST path checks out main; replace the sync branch tip with this result.
  # Fetch first so --force-with-lease can compare against the current remote tip
  # (without a tracking ref it is an unprotected force).
  if [[ "$DRY_RUN" == "1" ]]; then
    run git fetch origin "refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH"
  else
    git fetch origin "refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH" || true
  fi
  run git push --force-with-lease origin "HEAD:$SYNC_BRANCH"
else
  echo "REST sync produced no changes; leaving $SYNC_BRANCH untouched."
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "+ DRY_RUN: would fetch origin main $SYNC_BRANCH and open/update PR"
  echo "+ DRY_RUN: title=$TITLE"
  echo "+ DRY_RUN: body<<EOF"
  printf '%s\n' "$BODY"
  echo "EOF"
  exit 0
fi

git fetch origin main "$SYNC_BRANCH"
if git diff --quiet "origin/main...origin/$SYNC_BRANCH"; then
  echo "No diff vs main; skipping PR."
  exit 0
fi

PR_NUMBER=$(gh pr list --base main --head "$SYNC_BRANCH" --state open --json number --jq '.[0].number // empty')
if [[ -n "$PR_NUMBER" ]]; then
  gh pr edit "$PR_NUMBER" --title "$TITLE" --body "$BODY"
  echo "Updated PR #$PR_NUMBER"
else
  gh pr create --base main --head "$SYNC_BRANCH" --title "$TITLE" --body "$BODY"
fi
