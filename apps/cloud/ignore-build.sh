#!/bin/sh
# Ignored Build Step of the repo-root vercel.json: exit 0 skips the
# deployment, exit 1 builds it.
#
# Production (main) always deploys, so every merge reaches it. A preview
# builds only when its branch touches what this deployment runs: the server,
# the login UI, the console, the storybook and the docs site with the
# packages they build from, and the deployment wiring. SDK-only branches get
# no preview build. Whenever the answer is unclear, the preview builds.
#
# Each service of vercel.json runs it from its own root; the paths below are
# the repository's.
set -u
cd "$(dirname "$0")/../.." || exit 1

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "ignore-build: production always deploys"
  exit 1
fi

paths="
.moon
api
apps/cloud
apps/console
apps/docs
apps/login-ui
apps/storybook
cmd
docs/design/api/events-catalog.md
go.mod
go.sum
internal
main.go
package.json
packages/api
packages/api-mock
packages/components
packages/config
packages/design-tokens
packages/sdk-core
packages/sdk-react
pnpm-lock.yaml
pnpm-workspace.yaml
redocly.yaml
vercel.json
"

# What changed since the branch's last successful preview, when Vercel names
# it and the clone (shallow, about ten commits) has it. Else what changed
# since the branch left main: the repository is public, so main is fetched
# without credentials, deep enough to hold the branch point of any branch
# that is not ancient.
previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$previous" ] && git cat-file -e "${previous}^{commit}" 2>/dev/null; then
  range="${previous} HEAD"
else
  repo="https://github.com/${VERCEL_GIT_REPO_OWNER:-zitadel}/${VERCEL_GIT_REPO_SLUG:-nextgen}.git"
  if ! GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags --depth=200 "$repo" main; then
    echo "ignore-build: could not fetch main; building the preview"
    exit 1
  fi
  range="FETCH_HEAD...HEAD"
fi

# shellcheck disable=SC2086 # the range is two revisions or one, the paths one per line
git diff --quiet $range -- $paths
case $? in
  0)
    echo "ignore-build: nothing this deployment runs changed (${range}); skipping the preview"
    exit 0
    ;;
  1)
    echo "ignore-build: building the preview (${range})"
    exit 1
    ;;
  *)
    echo "ignore-build: could not compare ${range}; building the preview"
    exit 1
    ;;
esac
