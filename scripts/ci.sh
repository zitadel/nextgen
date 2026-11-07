#!/bin/sh
# What CI runs (`pnpm run ci`): ci-turbo.yml passes `--affected`, and every
# argument goes to each turbo run. The task list lives here and not in the
# root package.json, a global input of every task's hash.
#
# Three runs, in order. check-generate-pruned deletes every generated file
# before generating it again, so it runs alone. The lanes follow the checks:
# beside the unit tests they fail them (both start servers, browsers and
# builds at once). A run that fails stops the ones after it.
set -eu

turbo boundaries
turbo run @zitadel/server#check-generate-pruned "$@"
turbo run lint typecheck build test --continue=dependencies-successful "$@"

# The journeys install the release snapshot: with these, it holds only this
# machine's server platform package and builds no Docker image. Each journey
# is named on its own: through an umbrella task such as journey-local,
# `--affected` would run all of them whenever one is affected.
RELEASE_HOST_ONLY=1 RELEASE_SKIP_CONTAINER=1 turbo run \
  @zitadel/server#test:postgres \
  @zitadel/testing#test:integration \
  console-smoke console-real console-embedded console-platform \
  demo-next-mock demo-next-real demo-nuxt-mock \
  journey:next journey:nuxt journey:react journey:vue journey:angular \
  journey:solid journey:svelte journey:qwik journey:passkey \
  journey:preexisting-next journey:preexisting-nuxt journey:testkit journey:remote \
  --continue=dependencies-successful "$@"
