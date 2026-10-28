#!/bin/sh
# Build step of the `server` service (repo-root vercel.json, Go preset):
# build the launcher, the function binary, through turbo (@zitadel/cloud's
# `build` task, build-launcher.sh), so it comes from the team's remote cache
# when nothing it compiles changed, then migrate the deployment's database
# (a preview's is created first; see apps/cloud/launcher/database.go).
#
# Migrations run here, before the deployment goes live, never when a
# function starts, and never from turbo's cache. A failed migration fails
# the build and the previous deployment keeps serving, so every migration
# must leave the schema readable by the deployment still serving
# (expand/contract).
#
# Output: $VERCEL_OUTPUT_FILE on Vercel, apps/cloud/dist/nextgen-launcher
# locally.
set -eu
cd "$(dirname "$0")/../.."

if [ -n "${VERCEL_OUTPUT_FILE:-}" ]; then
  # The Go preset runs no installCommand, so the install the other services
  # declare in vercel.json runs here; pnpm skips it once a service built
  # earlier in the deployment has installed.
  pnpm install --os=current --cpu=current --optimistic-repeat-install
fi
# turbo's own binary: through `pnpm exec`, every task's `pnpm run` would
# re-check the workspace and warn about each other platform's package.
node_modules/.bin/turbo run build --filter=@zitadel/cloud

launcher=apps/cloud/dist/nextgen-launcher
out="${VERCEL_OUTPUT_FILE:-$launcher}"
if [ "$out" != "$launcher" ]; then
  mkdir -p "$(dirname "$out")"
  cp "$launcher" "$out"
fi

"$out" migrate
