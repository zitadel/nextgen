#!/usr/bin/env bash
# Commit generated design-token artifacts and open/update the sync PR.
#
# Used by .github/workflows/sync-design-tokens.yml. Kept as a script so it can
# be syntax-checked and dry-run locally without a Figma push.
#
# Required env (each falls back to the Actions default when unset):
#   EVENT_NAME   — github.event_name (push | workflow_dispatch); default $GITHUB_EVENT_NAME
#   ACTOR        — github.actor;                                  default $GITHUB_ACTOR
# Optional env:
#   DRY_RUN=1    — print actions; do not stage, commit, push, or call gh
set -euo pipefail

SYNC_BRANCH=design-tokens/figma-sync
# Scope omitted: design-tokens is not in .github/semantic.yml.
TITLE='chore: sync tokens from Figma'
EVENT_NAME=${EVENT_NAME:-${GITHUB_EVENT_NAME:?EVENT_NAME or GITHUB_EVENT_NAME is required}}
ACTOR=${ACTOR:-${GITHUB_ACTOR:?ACTOR or GITHUB_ACTOR is required}}
DRY_RUN=${DRY_RUN:-0}

# Generated + provenance artifacts the sync owns. Full paths so the PR body
# instructions are unambiguous.
ARTIFACT_PATHS=(
  packages/design-tokens/figma-export
  packages/design-tokens/figma-tokens.lock
  packages/design-tokens/src/generated/figma.tokens.json
  packages/design-tokens/src/generated/tokens.css
  packages/design-tokens/src/generated/tokens.ts
  packages/design-tokens/src/generated/tailwind.css
  packages/design-tokens/src/generated/shadcn.css
)

TRIGGER="$EVENT_NAME"
if [[ "$EVENT_NAME" == "push" ]]; then
  TRIGGER="$EVENT_NAME (push by $ACTOR)"
fi

BODY=$(
  cat <<EOF
Automated design-token sync from the Zitadel Design System.

**Trigger:** ${TRIGGER}

**Before merging:**
1. Review \`packages/design-tokens/figma-export/\` and \`packages/design-tokens/src/generated/\`.
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

# Stage + commit. In dry run, do not touch the index — detect changes with
# `git status --porcelain` so local testers keep a clean working tree.
committed=0
if [[ "$DRY_RUN" == "1" ]]; then
  if [[ -n "$(git status --porcelain -- "${ARTIFACT_PATHS[@]}")" ]]; then
    echo "+ DRY_RUN: would stage + commit:"
    git status --porcelain -- "${ARTIFACT_PATHS[@]}"
    committed=1
  else
    echo "No generated artifact changes to commit."
  fi
else
  git add -- "${ARTIFACT_PATHS[@]}"
  if ! git diff --cached --quiet; then
    git commit -m "$TITLE"
    committed=1
  else
    echo "No generated artifact changes to commit."
  fi
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$CURRENT_BRANCH" in
  "$SYNC_BRANCH")
    # Plugin / export path: append on top of existing figma-export commits.
    run git push -q origin "HEAD:$SYNC_BRANCH"
    ;;
  main)
    # REST path: the workflow checks out main, so the generated commit sits on
    # top of main and replaces the sync branch tip.
    if [[ "$committed" != "1" ]]; then
      echo "REST sync produced no changes; leaving $SYNC_BRANCH untouched."
      exit 0
    fi
    # Refresh the tracking ref so --force-with-lease compares against the real
    # remote tip. Do not swallow a fetch failure: a stale/absent lease would let
    # the force-push clobber commits that landed since checkout, defeating the
    # point of --force-with-lease.
    run git fetch -q origin "refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH"
    run git push -q --force-with-lease origin "HEAD:$SYNC_BRANCH"
    ;;
  *)
    # Guard against a workflow_dispatch from an arbitrary feature branch
    # force-pushing the wrong source into the sync branch.
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "+ DRY_RUN: on '$CURRENT_BRANCH' (not $SYNC_BRANCH or main); a real run would refuse to push."
    else
      echo "Refusing to sync from unexpected branch '$CURRENT_BRANCH' (expected $SYNC_BRANCH or main)." >&2
      exit 1
    fi
    ;;
esac

if [[ "$DRY_RUN" == "1" ]]; then
  echo "+ DRY_RUN: would fetch origin main $SYNC_BRANCH and open/update PR"
  echo "+ DRY_RUN: title=$TITLE"
  echo "+ DRY_RUN: body<<EOF"
  printf '%s\n' "$BODY"
  echo "EOF"
  echo "+ DRY_RUN: would dispatch ci.yml on $SYNC_BRANCH for the full-pr gate"
  exit 0
fi

git fetch -q --no-tags origin \
  +refs/heads/main:refs/remotes/origin/main \
  "+refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH"
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

# A PR opened/updated by GITHUB_TOKEN gets its pull_request checks (full-pr)
# stuck in approval-required. workflow_dispatch is exempt from that gate, so
# dispatch ci.yml on the sync branch to run full-pr unattended. Requires
# actions: write in the calling workflow.
gh workflow run ci.yml --ref "$SYNC_BRANCH"
echo "Dispatched ci.yml on $SYNC_BRANCH for the full-pr gate."
