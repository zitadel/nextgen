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

# The service's installCommand normally ran already; the Go preset is not
# known to honour it, so install when nothing is there.
[ -x node_modules/.bin/turbo ] || corepack pnpm install --frozen-lockfile
TURBO_TELEMETRY_DISABLED=1 corepack pnpm exec turbo run build --filter=@zitadel/login-ui

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

"$out" migrate
