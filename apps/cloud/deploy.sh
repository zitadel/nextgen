#!/bin/sh
# The `deploy` task of @zitadel/cloud (apps/cloud/turbo.json), the last of
# the `server` service's build (repo-root vercel.json, Go preset), after
# `migrate`: hand the launcher to Vercel's Go builder, which takes the
# function from $VERCEL_OUTPUT_FILE, a path outside the repository. Outside
# a Vercel build there is nothing to hand over.
set -eu
cd "$(dirname "$0")"

if [ -z "${VERCEL_OUTPUT_FILE:-}" ]; then
  echo "no VERCEL_OUTPUT_FILE: the launcher stays in apps/cloud/dist/nextgen-launcher"
  exit 0
fi
mkdir -p "$(dirname "$VERCEL_OUTPUT_FILE")"
cp dist/nextgen-launcher "$VERCEL_OUTPUT_FILE"
echo "handed dist/nextgen-launcher to the Go builder"
