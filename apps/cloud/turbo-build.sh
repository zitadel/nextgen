#!/bin/sh
# Builds one package with turbo on Vercel: `sh apps/cloud/turbo-build.sh
# @zitadel/console [turbo args]`, from the repository root (the services'
# buildCommands in the repo-root vercel.json and build.sh call it).
#
# The cache works as Vercel sets it up for every turbo build: each build
# reads and writes the team's remote cache with a token Vercel gives it, and
# keeps no local cache. Turbo puts VERCEL_TARGET_ENV into every task's hash,
# so production builds find only what production builds wrote, previews only
# what previews wrote. Writing takes the team's token: a fork's pull request
# gets no build, and so no token, until a team member approves it (the
# project's Git fork protection).
#
# The project's secrets stay hidden from the JS builds (turbo's strict env
# mode); TURBO_PLATFORM_ENV_DISABLED stops turbo warning about each of them
# for every task. Variables a build needs (CONSOLE_BASE_PATH,
# CONSOLE_VERCEL_INSIGHTS, CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE) pass through
# the environment and are listed in the package's turbo.json.
#
# Turbo starts from its own binary, not through `pnpm exec`: a pnpm that a
# pnpm process starts reads the pnpm_config_verify_deps_before_run=false the
# parent hands down as set (pnpm 10.33/10.34), so every task's `pnpm run`
# re-checked the workspace and logged an "Unsupported platform" warning for
# each of the server's other-platform packages.
set -eu
package="${1:?package name, e.g. @zitadel/console}"
shift

export TURBO_TELEMETRY_DISABLED=1 TURBO_PLATFORM_ENV_DISABLED=1

exec node_modules/.bin/turbo run build --filter="$package" "$@"
