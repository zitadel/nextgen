#!/bin/sh
# Compile the launcher, the server plus its cloud entrypoint, the way both
# Go-preset services do: the `server` service's buildCommand
# (OUT=$VERCEL_OUTPUT_FILE sh apps/cloud/build.sh) and vercel-build.sh (the
# build step of the migrate service). Built with the noui tag: the UIs are
# their own services, nothing is embedded, and the launcher runs the server
# in the external UI mode (the runtime document only) or headless. Build
# metadata comes from the server manifest and the deployment's commit.
# Output: $OUT, default bin/nextgen-launcher. PKG picks another main package
# of the cloud, the control plane (./apps/cloud/api).
set -eu
cd "$(dirname "$0")/../.."
pkg="${PKG:-./apps/cloud/launcher}"

version="$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' apps/server/package.json | head -1)"
commit="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="${OUT:-bin/nextgen-launcher}"
mkdir -p "$(dirname "$out")"

CGO_ENABLED=0 go build -trimpath -tags noui \
  -ldflags "-s -w \
    -X github.com/zitadel/nextgen/internal/build.version=${version}+cloud \
    -X github.com/zitadel/nextgen/internal/build.commit=${commit} \
    -X github.com/zitadel/nextgen/internal/build.date=${date}" \
  -o "$out" "$pkg"
echo "built $out from $pkg (version ${version}+cloud, commit ${commit})"
