#!/bin/sh
# Builds one package with turbo on Vercel: `sh apps/cloud/turbo-build.sh
# @zitadel/console [turbo args]`, from the repository root (the services'
# buildCommands in the repo-root vercel.json and build.sh call it).
#
# Vercel gives every deployment build a token for the team's remote cache,
# and a preview build runs its branch's code with it, so the remote cache has
# to be treated as writable by anyone who can push a branch. The boundary is
# that a production build never restores from it: it only uploads, for the
# previews to reuse. Previews read and do not write; that is the branch's own
# choice (a branch can change this file), which keeps honest branches from
# filling the cache but protects nothing — production not reading does.
#
# The local cache is how a build reuses the previous build's results. Turbo's
# default, .turbo/cache, does not survive to the next build: Vercel's build
# cache keeps node_modules, not that directory. So it lives in node_modules.
# Vercel keeps that cache per branch, a branch's first build starting from
# production's, and only production builds write production's: production
# restores only what production built, the boundary the installed packages
# and Go's build cache in the same cache already rely on. A preview and
# production compute the same task hashes (the root turbo.json keeps
# Vercel's own variables out of them), so a branch's builds reuse
# production's results and then their own. The cap keeps the cache from
# growing build after build; the three apps' builds take about 6 MB.
#
# The project's secrets stay hidden from the JS builds (turbo's strict env
# mode); TURBO_PLATFORM_ENV_DISABLED stops turbo warning about each of them
# for every task. Variables a build needs (CONSOLE_VERCEL_INSIGHTS,
# CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE) pass through the environment and are
# listed in the package's turbo.json.
set -eu
package="${1:?package name, e.g. @zitadel/console}"
shift
root="$(cd "$(dirname "$0")/../.." && pwd)"

# Vercel sets the deprecated TURBO_REMOTE_ONLY for turbo builds, and turbo
# refuses to combine the legacy cache switches with TURBO_CACHE, which carries
# the whole policy here.
unset TURBO_REMOTE_ONLY TURBO_REMOTE_CACHE_READ_ONLY
case "${VERCEL_ENV:-}" in
  production) TURBO_CACHE="local:rw,remote:w" ;;
  *) TURBO_CACHE="local:rw,remote:r" ;;
esac
export TURBO_CACHE TURBO_CACHE_DIR="$root/node_modules/.cache/turbo" TURBO_CACHE_MAX_SIZE=100MB
export TURBO_TELEMETRY_DISABLED=1 TURBO_PLATFORM_ENV_DISABLED=1

exec corepack pnpm exec turbo run build --filter="$package" "$@"
