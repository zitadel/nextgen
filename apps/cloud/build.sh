#!/bin/sh
# Build step of the `server` service (repo-root vercel.json, Go preset):
# build the login UI the server embeds, compile the launcher into the
# function binary, then migrate the deployment's database.
#
# The console is not embedded: it is a service of its own, and the launcher
# turns the server's console off. Migrations run here, before the deployment
# goes live, never when a function starts. A failed migration fails the
# build and the previous deployment keeps serving, so every migration must
# leave the schema readable by the deployment still serving
# (expand/contract).
#
# Output: $VERCEL_OUTPUT_FILE on Vercel, dist/nextgen-launcher locally.
set -eu
cd "$(dirname "$0")/../.."

# The service's installCommand normally ran already; the Go preset is not
# known to honour it, so install when nothing is there.
[ -x node_modules/.bin/moon ] || corepack pnpm install --frozen-lockfile
corepack pnpm exec moon run login-ui:build

version="$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' apps/server/package.json | head -1)"
commit="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="${VERCEL_OUTPUT_FILE:-dist/nextgen-launcher}"
mkdir -p "$(dirname "$out")"

CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w \
    -X github.com/zitadel/nextgen/internal/build.version=${version}+cloud \
    -X github.com/zitadel/nextgen/internal/build.commit=${commit} \
    -X github.com/zitadel/nextgen/internal/build.date=${date}" \
  -o "$out" ./apps/cloud/launcher
echo "built $out (version ${version}+cloud, commit ${commit})"

"$out" migrate
