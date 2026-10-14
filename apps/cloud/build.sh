#!/bin/sh
# Build step of the `server` service (repo-root vercel.json, Go preset):
# build the login UI the server embeds, compile the launcher into the
# function binary, then migrate the deployment's database (a preview's is
# created first; see apps/cloud/launcher/database.go).
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

# The Go preset runs no installCommand, so the install runs here; install.sh
# skips it when a service built earlier installed for this deployment.
sh apps/cloud/install.sh
# The login UI through turbo, with the remote cache every service shares
# (turbo-build.sh: every build reads and writes it).
sh apps/cloud/turbo-build.sh @zitadel/login-ui

version="$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' apps/server/package.json | head -1)"
commit="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
# The branch picks a preview's database; stamped in so the serving function
# knows it even where Vercel exposes no Git metadata at runtime.
ref="${VERCEL_GIT_COMMIT_REF:-}"
date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="${VERCEL_OUTPUT_FILE:-dist/nextgen-launcher}"
mkdir -p "$(dirname "$out")"

CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w \
    -X github.com/zitadel/nextgen/internal/build.version=${version}+cloud \
    -X github.com/zitadel/nextgen/internal/build.commit=${commit} \
    -X github.com/zitadel/nextgen/internal/build.date=${date} \
    -X main.buildRef=${ref}" \
  -o "$out" ./apps/cloud/launcher
echo "built $out (version ${version}+cloud, commit ${commit})"

# Go drops a build cache entry only after five days unused, and Vercel
# carries the cache from build to build, so every rebuild's packages would
# pile up towards the build cache's limit. On Vercel, drop what no build
# used in the last two hours (Go refreshes an entry's time at most hourly).
if [ -n "${VERCEL_OUTPUT_FILE:-}" ]; then
  find -H "$(go env GOCACHE)" -mindepth 2 -type f -mmin +120 -delete
fi

"$out" migrate
