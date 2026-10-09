#!/bin/sh
# Build and migrate for Vercel's Go runtime (vercel.json: service "server",
# framework "go"): stub UI embeds (the UIs are their own services; the server
# only validates that an index.html exists), build metadata from the server
# manifest and the deployment's commit, then a static binary written to
# $VERCEL_OUTPUT_FILE.
set -eu
cd "$(dirname "$0")/../.."

mkdir -p internal/staticui/console/dist internal/staticui/login/dist
for ui in console login; do
  [ -s "internal/staticui/$ui/dist/index.html" ] \
    || printf '<!doctype html><title>%s is served by its own service</title>\n' "$ui" \
      > "internal/staticui/$ui/dist/index.html"
done

version="$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' apps/server/package.json | head -1)"
commit="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="${VERCEL_OUTPUT_FILE:-bin/nextgen-launcher}"
mkdir -p "$(dirname "$out")"

CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w \
    -X github.com/zitadel/nextgen/internal/build.version=${version}+cloud \
    -X github.com/zitadel/nextgen/internal/build.commit=${commit} \
    -X github.com/zitadel/nextgen/internal/build.date=${date}" \
  -o "$out" ./apps/cloud/launcher
echo "built $out (version ${version}+cloud, commit ${commit})"

# Migrations run here, at deploy time, never at startup: the launcher's
# migrate mode resolves the same database URL the function will serve from
# (production as configured and only from main, a preview in the schema of
# its pull request) and runs the server's migrate command. A failed
# migration fails the build; the previous deployment keeps serving.
"$out" migrate
