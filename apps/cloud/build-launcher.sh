#!/bin/sh
# The `build` task of @zitadel/cloud (apps/cloud/turbo.json): compile the
# launcher into the `server` service's function binary,
# apps/cloud/dist/nextgen-launcher. The service's build command runs it
# through turbo, before `migrate` and `deploy`.
#
# The console is not embedded: it is a service of its own, and the launcher
# turns the server's console off. The services build one after another in
# one checkout, and the console service's build lands in the server's embed
# directory (internal/staticui/console/dist), so the launcher is compiled
# with -tags noconsole; without it, the function would carry the console
# whenever that service built first.
set -eu
cd "$(dirname "$0")/../.."

version="$(node -p 'require("./apps/server/package.json").version')"
commit="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
# The branch picks a preview's database; stamped in so the serving function
# knows it even where Vercel exposes no Git metadata at runtime. turbo.json
# hashes it, so a cached binary never serves another branch.
ref="${VERCEL_GIT_COMMIT_REF:-}"
date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out=apps/cloud/dist/nextgen-launcher
mkdir -p "$(dirname "$out")"

CGO_ENABLED=0 go build -trimpath -tags noconsole \
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
# Here rather than in a task that runs on every deployment: when turbo
# restores the binary, Go has refreshed nothing, and the prune would empty
# the cache.
if [ -n "${VERCEL:-}" ]; then
  find -H "$(go env GOCACHE)" -mindepth 2 -type f -mmin +120 -delete
fi
