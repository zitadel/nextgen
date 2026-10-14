# Turborepo configuration

How the turbo task graph is laid out and the rules for changing it. Read this
before editing a `turbo.json`. While both runners are configured (the dual-run
phase of [turborepo-migration.md](turborepo-migration.md)), every task exists
twice — in `moon.yml` ([.moon/AGENTS.md](../../../.moon/AGENTS.md)) and in a
`turbo.json` — and a change goes into both (where the two differ on purpose
is listed in `.moon/AGENTS.md`). Moon is the runner of record; the
turbo version runs in CI as the non-required `ci-turbo` job, on Vercel for the
hosted cloud's builds, and locally with `NEXTGEN_TASK_RUNNER=turbo`.

## Layout

- The root `turbo.json` holds the task shapes every package shares (what
  `.moon/tasks/*.yml` holds for moon), the root project's tasks (`//#test`,
  `//#check-adrs`, …: moon's `workspace` project) and `globalDependencies`
  (moon's `implicitInputs`: a change to one re-runs every task).
- A package's `turbo.json` starts with `"extends": ["//"]` and lists only what
  differs from the root shape. Turbo merges field by field: a package that
  sets `dependsOn` keeps the root's `outputs`, `inputs` and `env`.
- A task runs the `package.json` script of its name, in the package. No script
  means no task for that package (moon's `inheritedTasks.exclude`), so do not
  add an empty script to fill a gap. Moon's `server`, `bench` and `release`
  projects are the packages `@zitadel/server`, `@zitadel/bench`
  (`tools/bench`) and `@zitadel/release` (`tools/release`); their scripts
  `cd` to the directory the command needs.
- Task names are script names: `dev:real`, `test:integration` and
  `sync:export` keep their colons. The e2e lanes are `@zitadel/e2e`'s
  `console-smoke`, `console-real`, `console-embedded`, `console-platform`,
  `console-deployment`, `demo-next-mock`, `demo-next-real`, `demo-nuxt-mock`,
  `journey`, `journey-local` and `e2e-local` (the journey runner with its
  options from `JOURNEY_*`), plus the docs' `e2e` and `e2e-deployment`. Unlike
  moon there is no `all` aggregate: ci-turbo.yml runs the lanes as gated steps.

## Dependencies

- Edges are explicit (`dependsOn: ["@zitadel/components#build"]`) and mirror
  the moon task's `deps`. `^build` is not used: it follows devDependencies,
  and the console's `@zitadel/testing` would pull the CLI and the server build
  into every console build (and close a cycle).
- Every dependency's result is part of a task's hash, whether or not it has
  outputs, so there is no "unhashed edge" to work around and no duplicate to
  remove.
- A task cannot depend on a persistent task (`dev`, `start`, `preview`,
  `//#server`).
- Each release build cleans and rewrites the `dist/` that dev builds and
  tests of the same graph read, so the release builds start after
  `cli#test` (`api#build-release` depends on it, and every other release
  build reaches `api`'s through its package edges). From there they run in
  parallel on the same package edges as their dev builds: a release build
  depends on the release build of every package its dev build depends on.
  The console and login UI release builds follow the same rule (never a dev
  build: its output would replace the release output they bundle) and wait
  for `@zitadel/release#build-public-packages`. Give a new public package
  those edges and add it to `release-manifest.mjs`.

## Inputs and outputs

- The default inputs are the package's files (tracked, or untracked and not
  ignored) plus the global dependencies. A task that reads files outside its
  package lists them with `$TURBO_DEFAULT$` first:
  `["$TURBO_DEFAULT$", "$TURBO_ROOT$/api/openapi/**/*.yaml"]`. The Go tasks
  list the server's inputs in full (`apps/server/turbo.json`); turbo has no
  file groups, so the list is repeated per task.
- Outputs may lie outside the package (`$TURBO_ROOT$/internal/staticui/
  console/dist/**`). Framework caches are excluded (`!.next/cache/**`).
- `cache: false` for anything that is not a pure function of its inputs: the
  e2e lanes, the database lanes, `install-browsers`, the release builds, dev
  servers.

## Environment

- Strict mode: a task sees `PATH`, `HOME`, `SHELL`, `CI`, `TERM`, `LANG`,
  `GITHUB_ACTIONS`, `RUNNER_TEMP`, `VERCEL`, `COREPACK_*`, `TURBO_*`, what
  framework inference adds (`VITE_*` for Vite packages, `NEXT_*` for Next.js)
  and what the task lists. `env` names variables that change the output and
  are hashed (`CONSOLE_VERCEL_INSIGHTS`, `GOFLAGS`); `passThroughEnv`
  names variables a task reads at run time without affecting its output
  (`NEXTGEN_*` for the e2e lanes, `DOCKER_*` for the database lanes). The Go
  cache locations pass through globally.
- A variable meant for one package does not get a framework prefix
  (`VITE_`, `NEXT_PUBLIC_`): inference hashes a prefixed variable into every
  package of that framework in the run, so its dependencies would get other
  cache keys in that one build than everywhere else. The package lists it in
  its `env` and its config reads it (the console's `CONSOLE_*` variables and
  `vite.config.ts`).
- On Vercel, turbo puts `VERCEL_TARGET_ENV` (`production` or `preview`)
  into every task's hash, its default, so production and preview builds
  keep separate cache entries. The `VITE_VERCEL_*` variables Vercel sets
  are kept out of every hash (`globalEnv` in the root `turbo.json`): turbo
  leaves them out only in the Vite service's build, and the same packages
  would get other keys in the storybook's and the server's builds.
  `VERCEL_*` still reaches every task unhashed (turbo's built-in list): a
  build whose output depends on one lists it in its `env`.
- A task cannot set a variable's value. Values a lane needs (moon's task
  `env:` blocks) are set in the `package.json` script as defaults that a
  caller's own value overrides, as it overrides moon's task `env`:
  `NEXTGEN_SERVER_CONSOLE_ENABLED=${NEXTGEN_SERVER_CONSOLE_ENABLED-false} playwright test …`.

## Mutex and retry

Turbo has neither. `scripts/task-guard.mjs` wraps a command:
`node ../../scripts/task-guard.mjs --mutex generated-sources -- orval …` holds a
lock while the command runs, and the four browser-test packages run
`node ../../scripts/task-guard.mjs --retries 3 -- vitest run`. The lock is a
directory in the OS temp dir keyed by the repository root, so checkouts do not
block each other and a dead holder is reclaimed. The guard acts only when turbo
runs the task (turbo sets `TURBO_HASH` for every task); under moon and when run
by hand it runs the command once, unchanged. Names in use: `generated-sources`
(the generation tasks and the tasks that read what they rewrite) and
`demo-next-app` (the two demo-next e2e lanes, which both serve the demo on
:3002; moon has a mutex of the same name on them).

Moon keeps its own `mutex` and `retryCount` until the cutover. Its `test`
task runs each package's `test:all` script, which in the four browser-test
packages calls Vitest without the guard, so no suite retries under both.

## Commands

| | |
|---|---|
| the default gate | `turbo run lint typecheck build test` |
| one task | `turbo run test --filter=@zitadel/cli` |
| pass arguments (by hand only, below) | `turbo run test --filter=@zitadel/cli -- --reporter=verbose` |
| what would run | `turbo run build --dry` |
| affected tasks, task-level | `turbo query '{ affectedTasks(base: "origin/main", tasks: ["test"]) { items { name package { name } } } }'` |
| a run summary for the failure report | `--summarize` → `.turbo/runs/<id>.json`, `node scripts/report-turbo-failures.mjs` |

Arguments after `--` reach only the named task, but turbo puts them into the
cache key of every task in the run
([vercel/turborepo#14770](https://github.com/vercel/turborepo/issues/14770),
by design): the task's dependencies miss the cache and rebuild. A script that
CI or another script runs through turbo therefore takes its options from the
environment, listed in the task's `passThroughEnv`: `RELEASE_SKIP_CONTAINER=1`
for the release snapshot, `JOURNEY_CI=1`, `JOURNEY_MATRIX`, … for the journey
runner (`e2e/journey/README.md`).

Do not select the gate with `--affected` or `--filter=…[ref]`: both follow
`package.json` edges only and would skip the server's tests on a console
change (the server embeds the console through a task edge). Run the whole
gate; the cache skips the unchanged tasks. `scripts/ci-mode.mjs` computes the
task-level affected set for the CI lanes.

Turbo needs a `pnpm` binary on `PATH` (`corepack enable`). In a git worktree
turbo's cache defaults to the main checkout's `.turbo/cache`; set
`TURBO_CACHE_DIR` to keep worktrees apart. Telemetry is off in CI and on
Vercel (`TURBO_TELEMETRY_DISABLED=1`); set it locally too.

On Vercel, `apps/cloud/turbo-build.sh` runs the hosted cloud's builds with
the cache as Vercel sets it up: every build reads and writes the team's
remote cache, production and previews in separate entries, and keeps no
local cache. Writing takes the team's token, which a fork's pull request
never gets unapproved. The docs and the website do not build through turbo:
with Skew Protection on, a Next.js build's cache key includes the
deployment's ID, so no build could reuse another's.
