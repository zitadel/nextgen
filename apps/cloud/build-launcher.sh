#!/bin/sh
# The `build` task of @zitadel/cloud (apps/cloud/turbo.json): compile the
# launcher (apps/api/cmd/cloud-launcher, a package of the Go module in
# apps/api) into the `server` service's function binary,
# apps/cloud/dist/nextgen-launcher. The service's build command runs it
# through turbo, before `migrate` and `deploy`.
#
# The console is not embedded: it is a service of its own, and the launcher
# turns the server's console off. The services build one after another in
# one checkout, and the console service's build lands in the server's embed
# directory (apps/api/internal/staticui/console/dist), so the launcher is
# compiled with -tags noconsole; without it, the function would carry the
# console whenever that service built first.
set -eu
cd "$(dirname "$0")/../.."
repo="$PWD"

# Vercel supplies GOOS/GOARCH for the function's architecture. Go caches
# compilation for that target; each deployment links fresh commit/date metadata.
export CGO_ENABLED=0

# Bound the persistent module cache to the workspace's current dependency set.
if [ -n "${VERCEL:-}" ]; then
  modules="$(go list -m all)"
  if [ "$modules" != "$(cat "$repo/.vercel/cache/cloud-go/modules.list" 2>/dev/null || true)" ]; then
    GOMODCACHE="$repo/.vercel/cache/cloud-go/modules" go clean -modcache
    mkdir -p "$repo/.vercel/cache/cloud-go"
    printf '%s\n' "$modules" > "$repo/.vercel/cache/cloud-go/modules.list"
  fi
fi

version="$(node -p 'require("./apps/server/package.json").version')"
commit="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
# The branch picks a preview's database; stamped in so the serving function
# knows it even where Vercel exposes no Git metadata at runtime.
ref="${VERCEL_GIT_COMMIT_REF:-}"
# The date orders platform configuration deployments; never reuse an old one.
date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Absolute, because the build runs in the module and the binary lands here.
out="$repo/apps/cloud/dist/nextgen-launcher"
mkdir -p "$(dirname "$out")"

# The -X targets name packages of the module github.com/zitadel/nextgen
# (apps/api/go.mod); `go build` silently ignores a -X it cannot resolve.
cd "$repo/apps/api"
go build -trimpath -buildvcs=false -tags noconsole \
  -ldflags "-s -w \
    -X github.com/zitadel/nextgen/internal/build.version=${version}+cloud \
    -X github.com/zitadel/nextgen/internal/build.commit=${commit} \
    -X github.com/zitadel/nextgen/internal/build.date=${date} \
    -X main.buildRef=${ref}" \
  -o "$out" ./cmd/cloud-launcher
echo "built apps/cloud/dist/nextgen-launcher (version ${version}+cloud, commit ${commit})"

# Go drops a build cache entry only after five days unused, and Vercel
# carries the cache from build to build, so every rebuild's packages would
# pile up towards the build cache's limit. On Vercel, drop what no build
# used in the last two hours (Go refreshes an entry's time at most hourly).
if [ -n "${VERCEL:-}" ]; then
  find -H "$(go env GOCACHE)" -mindepth 2 -type f -mmin +120 -delete
  # Extracted modules plus .mod/.info/.ziphash are sufficient for go build.
  # Keeping their original ZIPs duplicates them in Vercel's limited archive.
  downloads="$(go env GOMODCACHE)/cache/download"
  [ ! -d "$downloads" ] || find -H "$downloads" -type f -name '*.zip' -delete
  # The persistent paths in vercel.json replace these preset caches. Keep
  # the service's toolchain, without archiving duplicate module/build caches.
  rm -rf "$repo/.vercel/cache/golang" \
    "$repo/apps/api/.vercel/cache/golang/pkg/mod" \
    "$repo/apps/api/.vercel/cache/golang/go-build"
fi
