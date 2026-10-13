#!/bin/sh
# Builds one package with turbo on Vercel: `sh apps/cloud/turbo-build.sh
# @zitadel/console [turbo args]`, from the repository root (the services'
# buildCommands in the repo-root vercel.json and build.sh call it).
#
# Vercel gives every deployment build a token for the team's remote cache,
# and a preview build runs its branch's code with it, so the cache has to be
# treated as writable by anyone who can push a branch. The boundary is that a
# production build never restores from it: it builds from source and only
# uploads, for the previews to reuse. Previews read and do not write; that is
# the branch's own choice (a branch can change this file), which keeps honest
# branches from filling the cache but protects nothing — production not
# reading does.
#
# The project's secrets stay hidden from the JS builds (turbo's strict env
# mode); TURBO_PLATFORM_ENV_DISABLED stops turbo warning about each of them
# for every task. Variables a build needs (VITE_CONSOLE_VERCEL_INSIGHTS,
# CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE) pass through the environment and are
# listed in the package's turbo.json.
set -eu
package="${1:?package name, e.g. @zitadel/console}"
shift

case "${VERCEL_ENV:-}" in
  production) TURBO_CACHE="local:rw,remote:w" ;;
  *) TURBO_CACHE="local:rw,remote:r" ;;
esac
export TURBO_CACHE TURBO_TELEMETRY_DISABLED=1 TURBO_PLATFORM_ENV_DISABLED=1

exec corepack pnpm exec turbo run build --filter="$package" "$@"
