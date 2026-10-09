#!/bin/sh
# Build step of the `migrate` service (vercel.json, framework "go"): compile
# the launcher, then run the migrations at deploy time, never at startup.
# The function this service produces is never routed; the service exists so
# that the migrations run in a build step of their own and a failure fails
# the deployment, never the serving function. The launcher's migrate mode
# resolves the same database URL the server will serve from (production as
# configured and only from main, a preview in the schema of its pull
# request). A failed migration
# fails the build; the previous deployment keeps serving.
set -eu
cd "$(dirname "$0")/../.."
out="${VERCEL_OUTPUT_FILE:-bin/nextgen-launcher}"
OUT="$out" sh apps/cloud/build.sh
"$out" migrate
