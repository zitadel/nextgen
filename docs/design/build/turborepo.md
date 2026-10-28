# Turborepo configuration

How the turbo task graph is laid out and the rules for changing it. Read this
before editing a `turbo.json`. While both runners are configured (the dual-run
phase of [turborepo-migration.md](turborepo-migration.md)), every task exists
twice — in `moon.yml` ([.moon/AGENTS.md](../../../.moon/AGENTS.md)) and in a
`turbo.json` — and a change goes into both (where the two differ on purpose
is listed in `.moon/AGENTS.md`). Moon is the runner of record; the
turbo version runs in CI as the non-required `ci-turbo` job (on pushes to
main and by hand, not on pull requests), on Vercel for the hosted cloud's
builds, and locally with `NEXTGEN_TASK_RUNNER=turbo`.

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
- A package imports only its own files and the workspace packages its
  `package.json` declares; `turbo boundaries` checks it in CI. Shared config
  is a package of its own (`@zitadel/vitest-config`). An import that cannot
  go through a package, such as a root `scripts/` module (no package can
  depend on the workspace root) or a module the runtime provides (k6's),
  carries `// @boundaries-ignore <reason>` on the line above, and its task
  lists the file in its inputs.
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
- An ignored file a task reads is not a default input either, so the task
  lists it. The console's build reads its `.env*` files (Vite's `loadEnv`)
  and lists `["$TURBO_DEFAULT$", ".env*"]`; without them, a changed
  `.env.local` would restore a build made without it. Moon hashes only what
  git sees, listed or not ([.moon/AGENTS.md](../../../.moon/AGENTS.md)).
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
- A dev server or preview that reads a variable the task does not list never
  sees it and quietly runs with its default. The console's `dev`, `dev:real`,
  `dev:claim` and `preview` pass `CONSOLE_*` through; without that, the dev
  proxy went to `:8080` whatever the caller's `CONSOLE_BACKEND_URL` said,
  `dev:real` ignored the `CONSOLE_DEV_*` ports, and the preview served
  `/ui/console/` while its build dependency, which hashes
  `CONSOLE_BASE_PATH`, was made for `/console/`.
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

## Remote cache

Any build with a token for the team's remote cache can write any entry,
under a hash anyone can compute from the commit. So turbo signs what it
uploads with `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (`remoteCache.signature`) and
takes an entry it cannot verify with its own key for a miss: a run restores
only what runs holding its key wrote.

| Runs | Key, held in | Kept apart in the hash by |
|---|---|---|
| Vercel production builds | production's: project variable (Production) | `VERCEL_TARGET_ENV=production` |
| ci-turbo on `main` | production's: GitHub environment `turbo-cache-main` | `CACHE_SIGNER=main` |
| Vercel previews | the previews': project variable (Preview) | `VERCEL_TARGET_ENV=preview` |
| ci-turbo on any other ref | the previews': GitHub environment `turbo-cache-branches` | `CACHE_SIGNER=branches` |

- Both GitHub environments hold the key as the secret
  `TURBO_REMOTE_CACHE_SIGNATURE_KEY`. Give `turbo-cache-main` a branch rule
  admitting `main` alone before its secret: GitHub creates an environment a
  workflow names, without rules. The Vercel side:
  [runbook](../../runbooks/cloud.md#3-vercel-project).
- Turbo hashes `VERCEL_TARGET_ENV` wherever it is set, so a preview can
  compute production's hashes and upload under them; only the key keeps
  production from restoring that.
- Every task sees the key (strict mode passes `TURBO_*`), so whatever runs in
  a production build or a ci-turbo run on `main` can sign as production:
  `main`'s code and its dependencies, and a preview promoted to production or
  a `vercel deploy --prod`, which build with production's variables.
- The merge queue signs as a branch: GitHub does not document that only the
  queue can create `gh-readonly-queue/` branches, and a branch rule admitting
  them would hand production's key to anyone who could (by running ci-turbo
  by hand on one). Once only the queue can, add `gh-readonly-queue/main/*` to
  `turbo-cache-main`'s rule and `merge_group` to ci-turbo.yml's choice of
  environment and `CACHE_SIGNER`.
- A rejected entry is a plain `cache miss` in the log, even at `-vvv`.
  Without a key, turbo uploads nothing (`WARNING artifact signature error`)
  and misses on every remote entry; a key under 32 bytes, an empty one
  included, fails a run that uses the remote cache before its first task
  (`futureFlags.longerSignatureKey`).
- Contributors need no key: without a remote cache turbo never reads it, and
  with one linked but no key, turbo warns on each upload and runs from the
  local cache alone.

## Commands

| | |
|---|---|
| the default gate | `turbo run lint typecheck build test` |
| one task | `turbo run test --filter=@zitadel/cli` |
| pass arguments (by hand only, below) | `turbo run test --filter=@zitadel/cli -- --reporter=verbose` |
| what would run | `turbo run build --dry` |
| package boundaries | `turbo boundaries` |
| affected tasks, task-level | `turbo query '{ affectedTasks(base: "origin/main", tasks: ["test"]) { items { name package { name } } } }'` |
| a run summary for the failure report | `--summarize` → `.turbo/runs/<id>.json`, `node scripts/report-turbo-failures.mjs` |
| check a deployment of the cloud | `CLOUD_URL=<url> pnpm check:cloud`: every deployment suite, `--continue` ([runbook](../../runbooks/cloud.md#checking-a-deployment-by-hand)) |

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

Turbo needs a `pnpm` binary on `PATH` (`corepack enable`). A checkout has no
`turbo` on `PATH`: install it globally (`npm install --global turbo`), which
hands over to the workspace's pinned version, or call `node_modules/.bin/turbo`.
Run through pnpm (`pnpm turbo`, `pnpm exec turbo`, a script such as
`pnpm check:cloud`), every task prints pnpm's `Unsupported platform` warning
for each other platform's server package: pnpm sets
`pnpm_config_verify_deps_before_run` for what it starts, each task's own
`pnpm run` inherits it, and the cache keeps those lines in the task's log. In a
git worktree turbo's cache defaults to the main checkout's `.turbo/cache`; set
`TURBO_CACHE_DIR` to keep worktrees apart. Telemetry is off in CI and on
Vercel (`TURBO_TELEMETRY_DISABLED=1`); set it locally too.

On Vercel, the hosted cloud's services build with the plain `turbo run build`
Vercel itself uses (repo-root `vercel.json`; the server's login UI in
`apps/cloud/build.sh`). Two project variables, `TURBO_TELEMETRY_DISABLED`
and `TURBO_PLATFORM_ENV_DISABLED`, turn off telemetry and turbo's warning
about each project variable `turbo.json` does not pass
([runbook](../../runbooks/cloud.md)). The cache works as Vercel sets it up:
every build reads and writes the team's remote cache, production and
previews in separate entries, and keeps no local cache. Writing takes the
team's token, which a fork's pull request never gets unapproved. The docs
and the website do not build through turbo: with Skew Protection on, a
Next.js build's cache key includes the deployment's ID, so no build could
reuse another's.
