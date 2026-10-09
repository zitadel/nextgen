#!/bin/sh
# Compile the launcher, the server plus its cloud entrypoint, the way both
# Vercel builds do: Dockerfile.vercel (the serving container) and
# vercel-build.sh (the build step of the migrate service). Stub UI embeds
# first: the UIs are their own services and the server only validates that
# an index.html exists per UI. Build metadata comes from the server manifest
# and the deployment's commit. Output: $OUT, default bin/nextgen-launcher.
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
out="${OUT:-bin/nextgen-launcher}"
mkdir -p "$(dirname "$out")"

CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w \
    -X github.com/zitadel/nextgen/internal/build.version=${version}+cloud \
    -X github.com/zitadel/nextgen/internal/build.commit=${commit} \
    -X github.com/zitadel/nextgen/internal/build.date=${date}" \
  -o "$out" ./apps/cloud/launcher
echo "built $out (version ${version}+cloud, commit ${commit})"
