#!/bin/sh
# The `deploy` task of @zitadel/cloud (apps/cloud/turbo.json), which the
# `server` service's build command runs (repo-root vercel.json, Go preset)
# once turbo has the launcher (`build`, build-launcher.sh): hand the binary
# to Vercel's Go builder, then migrate the deployment's database (a
# preview's is created first; see apps/cloud/launcher/database.go).
#
# Migrations run here, before the deployment goes live, never when a
# function starts, and never from turbo's cache: the task is uncached. A
# failed migration fails the build and the previous deployment keeps
# serving, so every migration must leave the schema readable by the
# deployment still serving (expand/contract).
#
# Output: $VERCEL_OUTPUT_FILE on Vercel; locally the binary stays in
# apps/cloud/dist/nextgen-launcher.
set -eu
cd "$(dirname "$0")/../.."

launcher=apps/cloud/dist/nextgen-launcher
out="${VERCEL_OUTPUT_FILE:-$launcher}"
if [ "$out" != "$launcher" ]; then
  mkdir -p "$(dirname "$out")"
  cp "$launcher" "$out"
fi

"$out" migrate
