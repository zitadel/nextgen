# Turborepo configuration

How the turbo task graph is laid out and the rules for changing it. Read this
before editing a `turbo.json`. While both runners are configured (the dual-run
phase of [turborepo-migration.md](turborepo-migration.md)), every task exists
twice — in `moon.yml` ([.moon/AGENTS.md](../../../.moon/AGENTS.md)) and in a
`turbo.json` — and a change goes into both (where the two differ on purpose
is listed in `.moon/AGENTS.md`). Moon is the runner of record; the
turbo version runs in CI as the non-required `ci-turbo` workflow (on pull
requests, in the merge queue, on pushes to main and nightly), on Vercel for
the hosted cloud's builds, and locally with `turbo run`. Run directly, the
contributor scripts build through moon, or through turbo with
`NEXTGEN_TASK_RUNNER=turbo`.

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
  add an empty script to fill a gap. Moon's `server` and `release` projects
  are the packages `@zitadel/server` and `@zitadel/release` (`tools/release`);
  their scripts `cd` to the directory the command needs. `@zitadel/cloud`
  (`apps/cloud`, the hosted cloud's launcher and schemas) has no moon
  project: its `dev` is moon's `workspace:cloud`.
- The Go modules in `go.work` are packages too
  (`experimentalGoWorkspaces`), named after the last element of their module
  path, a major-version suffix keeping the element before it: `nextgen` (`apps/api`), `zitadel/v5` (`packages/go`), `bench`,
  `oidc-mock`, `defaults` and `design-tokens`. Moon's `go`, `bench` and
  `oidc-mock` projects are the packages `zitadel/v5`, `bench` and
  `oidc-mock`. A module has no scripts: its `turbo.json` gives each task
  moon's command as a `command` array (`experimentalTaskCommand`, no shell,
  run in the module). Turbo adds `build`, `test`, `lint` (go vet), `format`
  (go fmt, which rewrites) and `dev` to every module; a module replaces the
  ones moon has and drops the rest with `"extends": false`. `defaults` and
  `design-tokens` have no `turbo.json` of their own (the design tokens share
  `@zitadel/design-tokens`'s, and `packages/config/defaults` ships to npm), so
  they keep the cheap built-ins and the root replaces their `format` by name.
- A script does its own task's work only. A step that is a task of its own,
  such as the package's `generate` or another package's `build`, is a
  `dependsOn` edge here and a `deps` entry in `moon.yml`, never `a && b` in
  the script: chained, it reruns on every run, and neither runner can cache,
  order or skip it. So the docs' `build` and `dev` are plain `next build` and
  `next dev`. A release build that cleans and rebuilds its own `dist`
  (`build-release`) is still one task's work.
- Task names are script names: `dev:real`, `test:integration` and
  `sync:export` keep their colons. The e2e lanes are `@zitadel/e2e`'s
  `console-smoke`, `console-real`, `console-embedded`, `console-platform`,
  `console-deployment`, `demo-next-mock`, `demo-next-real`, `demo-nuxt-mock`,
  `journey`, `journey-local` and `e2e-local` (the journey runner with its
  options from `JOURNEY_*`), plus the docs' `e2e` and `e2e-deployment`. Unlike
  moon there is no `all` aggregate: ci-turbo.yml runs `journey-local` in a
  job of its own and names every other lane in one `turbo run --affected`,
  which runs the affected ones side by side.

## Dependencies

- Edges are explicit (`dependsOn: ["@zitadel/components#build"]`) and mirror
  the moon task's `deps`. `^build` is not used: it follows devDependencies,
  and the console's `@zitadel/testing` would pull the CLI and the server build
  into every console build (and close a cycle). The one `^` edge is the Go
  modules' `^go-sources`, which follows their go.mod requires.
- Every dependency's result is part of a task's hash, whether or not it has
  outputs, so there is no "unhashed edge" to work around and no duplicate to
  remove.
- A task cannot depend on a persistent task (`dev`, `start`, `preview`,
  `//#server`).
- A script that builds part of the workspace (`scripts/task-runner.mjs`)
  builds through turbo when a turbo task runs it (turbo sets `TURBO_HASH`).
  The task lists the same targets as `dependsOn`, so the script's own build
  can reuse cached package builds and the graph shows what the task needs: `//#server`,
  `@zitadel/console#dev:real`, `@zitadel/cloud#dev`.
- A task that opens Chromium depends on its package's `install-browsers`
  (`playwright install chromium`, never cached), so a run installs it only
  when such a task runs: the browser test suites, the e2e lanes,
  `@zitadel/testing#test:integration`.
- A package imports only its own files and the workspace packages its
  `package.json` declares; `turbo boundaries` checks it in CI. Shared config
  is a package of its own (`@zitadel/vitest-config`). An import that cannot
  go through a package, such as a root `scripts/` module (no package can
  depend on the workspace root) or a module the runtime provides (k6's),
  carries `// @boundaries-ignore <reason>` on the line above, and its task
  lists the file in its inputs.
  The root Vitest config uses that waiver for a direct shared-config import:
  Turbo otherwise hashes a root workspace dependency into every task.
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
- `api#build-release` also depends on `@zitadel/server#test`, which the other
  release builds reach. This finishes the normal console build and its Go
  readers before any release dist is cleaned. Turbo has no order-only edge,
  so `pack` and `publish` run the Go tests as well; moon orders them only in
  `snapshot`, its one release entry point with Go tasks.

## Inputs and outputs

- Inputs follow file classes, not folders
  ([turborepo-graph.md](turborepo-graph.md)): the root shapes of `lint`,
  `typecheck`, `build`, `test` and `generate` start from `$TURBO_DEFAULT$`
  (the package's files) and leave out its docs (`README.md`, `AGENTS.md`,
  `CHANGELOG.md`, `docs/`, `skills/**/*.md`, …), and `build` and `generate`
  also its tests. A task that reads more lists it after `$TURBO_EXTENDS$`:
  `["$TURBO_EXTENDS$", "$TURBO_ROOT$/api/openapi/**/*.yaml"]`.
- A negation wins over every inclusion, wherever it stands. Anchor excludes
  outside the package with `$TURBO_ROOT$`. A task that reads an excluded class
  replaces `inputs` instead of extending them (`cli#test` reads its
  `README.md`). Release tasks keep every file: the tarballs ship the docs.
- Turbo has no file groups. A Go module's production files (no tests, no
  docs) are the inputs of its `go-sources`, a task in the root `turbo.json`
  with no command: turbo hashes it but runs nothing. It depends on the
  `go-sources` of every module the module requires, so the graph, not an
  input list, says which modules a build compiles (moon lists them:
  `serverInputs`, `benchInputs`). Each Go task depends on its module's;
  `@zitadel/server#go-sources` depends on `nextgen#go-sources` and adds what
  generation reads outside the modules. The server's `go-tests` adds
  `_test.go`, `testdata` and test-only files for format, vet, lint and tests.
  Changing the OIDC mock, which no module requires, does not select the server
  or benchmark. A Go task's own `inputs` list only what that task alone reads
  (its script, a lint config).
- Turbo hashes every file of a module and of the modules it requires into the
  built-in Go tasks (`build`, `test`, `lint`, `format`), tests included, even
  with a `command`. A built-in task that must not see other modules' tests
  excludes them with `$TURBO_ROOT$` negations (`bench#build`, `bench#test`).
- Shared Vitest configuration is an input of tests and typechecks, not a
  global dependency. Apps without Vitest remove it from typecheck inputs;
  console's Vitest config is separate from the Vite production config.
- An explicit glob matches ignored files too. A repository-wide one
  (`$TURBO_ROOT$/**/*.go`, `//#lint`'s) names the ignored trees it would
  otherwise walk: `node_modules`, build output, `.claude/`, and `.vercel/`,
  where Vercel's builds keep the Go toolchain and module cache.
- `$TURBO_DEFAULT$` still hashes a `.gitignore` that ignores itself (`*`),
  as some generated folders carry: the package's tasks leave such a folder
  out (`apps/cloud-functions/turbo.json`). Run the gate twice to find one:
  the second run must hit every cached task, and `--summarize` lists each
  task's inputs to compare.
- A task does not list what its dependencies write (the server's build and
  the console's dist): the dependency's hash covers it, and turbo hashes a
  run's inputs before the run starts, so those files would change the task's
  hash on the next run, which then misses the cache.
- A file a task reads is one of its inputs or a dependency's: `--affected`
  and the cache key see nothing else, so an edit to an unlisted file neither
  selects the task nor misses its cache. Nothing checks that before a merge;
  the nightly `ci-turbo` run executes every task without the cache and fails
  on what such an edit broke.
- An ignored file a task reads is not a default input either, so the task
  lists it. Console, docs and website builds list `.env*`; without them, a
  changed `.env.local` would restore a build made without it. Moon lists each
  supported dotenv path explicitly as `file://.env.local?optional` (and its
  peers): its glob inputs skip ignored files.
- Outputs may lie outside the package (`$TURBO_ROOT$/internal/staticui/
  console/dist/**`). Framework caches are excluded (`!.next/cache/**`).
- `cache: false` for anything that is not a pure function of its inputs: the
  e2e lanes, the database lanes, `install-browsers`, the release builds, dev
  servers, and native Go commands. Their inputs still decide when they count
  as affected, which gates the CI lanes.
- Go owns its compiler and ordinary test-result caches. Both runners always
  invoke native Go commands when selected: their task keys do not capture
  the effective host/target/compiler when Go variables are unset, and the
  local server binary stamps Git HEAD, commit date and branch metadata.
  Database tests additionally use `-count=1` to disable Go's result cache.
  Generation stays cached: go.mod pins its toolchain, and nothing it writes
  depends on the host or the commit.
- `moon run workspace:test` probes both real graphs in an isolated fixture:
  source/test invalidation, shared config scope, release ordering, ignored
  dotenv changes and the ignored files builds write. CI runs these tests
  through each runner's `test` task.

## Environment

- Strict mode: a task sees `PATH`, `HOME`, `SHELL`, `CI`, `TERM`, `LANG`,
  `GITHUB_ACTIONS`, `RUNNER_TEMP`, `VERCEL`, `COREPACK_*`, `TURBO_*`, what
  framework inference adds (`VITE_*` for Vite packages, `NEXT_*` for Next.js)
  and what the task lists. `env` names variables that change the output and
  are hashed (`CONSOLE_ADDON`, `GOFLAGS`); `passThroughEnv`
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
  build whose output depends on one lists it in its `env` (the Next.js
  builds `VERCEL_DEPLOYMENT_ID`).
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
| an agent's or a script's run | add `--output-logs=errors-only` |
| only what a branch changed | `TURBO_SCM_BASE=origin/main turbo run lint typecheck build test --affected` |
| one task | `turbo run test --filter=@zitadel/cli` |
| pass arguments (by hand only, below) | `turbo run test --filter=@zitadel/cli -- --reporter=verbose` |
| what would run | `turbo run build --dry` |
| package boundaries | `turbo boundaries` |
| affected tasks, task-level | `turbo query affected --base origin/main --tasks test` (its prerequisites carry the reason "required by an affected task") |
| every task without the cache (CI's nightly run) | `turbo run lint typecheck build test --force` |
| a run summary (per-task exit codes) | `--summarize` → `.turbo/runs/<id>.json` |
| check a deployment of the cloud | `CLOUD_URL=<url> pnpm check:cloud`: every deployment suite, `--continue` ([runbook](../../runbooks/cloud.md#checking-a-deployment-by-hand)) |

The default output replays every task's log, cached ones included: about
25,000 lines for a gate in which every task hits. `--output-logs=errors-only`
prints the run's summary and each failed task's whole log. No environment
variable sets it.

Arguments after `--` reach only the named task, but turbo puts them into the
cache key of every task in the run
([vercel/turborepo#14770](https://github.com/vercel/turborepo/issues/14770),
by design): the task's dependencies miss the cache and rebuild. A script that
CI or another script runs through turbo therefore takes its options from the
environment, listed in the task's `passThroughEnv`: `RELEASE_SKIP_CONTAINER=1`
and `RELEASE_HOST_ONLY=1` for the release snapshot, `JOURNEY_CI=1`, `JOURNEY_MATRIX`, … for the journey
runner (`e2e/journey/README.md`).

`--affected` and `turbo query affected` match the diff against each task's
`inputs` and follow task edges, so a console change still reaches the
server's tests, which embed it (`futureFlags.affectedUsingTaskInputs`).
ci-turbo.yml runs one job per role, side by side, each on a runner of its
own: `checks` (lint, typecheck and the repository checks), `build-test`,
`go-db` (the Go database lanes), `generated` (`check-generate-pruned`),
`e2e` (the e2e lanes but the journey's) and `journey` (the release snapshot,
then its lane); a version PR runs `release` instead. A role is a task list,
`turbo run $TASKS --affected`, so the graph stays in `turbo.json`: add a
task to a role's list, never a step or a condition to the workflow. The
journey is the one role with steps of its own, because its snapshot
rewrites the `dist/` its lane's dependencies write. Roles share results
through the remote cache: a cached task two roles need runs in the one that
reaches it first and is restored in the other, unless both start it at
once. Native Go tasks run in each role, using Go's own cache, one entry per
role, which only a forced run saves (the nightly, or `force` by hand). `--affected` from the pull
request's base, the merge group's or the commit a push to main replaced
picks the tasks the change reaches; a change no task reads, such as a
workflow edit, runs nothing there. `full-pr-turbo` needs every role: it is
the one check name to require. Nightly every role runs every task and lane
with `TURBO_FORCE` instead.
`--filter=…[ref]` still selects packages: do not use it for the gate. In
GitHub Actions turbo groups each task's log and annotates every failed task
itself (`::error::`), so no script reads the run summary.

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

On Vercel, every service of the hosted cloud builds through turbo (repo-root
`vercel.json`): the console, the docs and the website with
`turbo run build`, the server with `@zitadel/cloud`'s `build`, `migrate`
and `deploy`, in that order (`dependsOn`), and the schemas with its `schemas`.
The launcher build, migrations and deployment always run; Go's compiler cache
persists in Vercel's branch build cache. See [apps/cloud/turbo.json](../../../apps/cloud/turbo.json)
for the cache boundary and deployment ordering, and the
[cloud runbook](../../runbooks/cloud.md#operating) for cache diagnostics.
The server's build command installs the cloud
services and their dependencies before running Turbo: Vercel's Go builder runs
no `installCommand`, and Turbo comes with the install. `migrate` passes the whole environment through
(`passThroughEnv: ["*"]`): the launcher checks every variable the function
needs, and strict mode would hide one nobody listed. Two project variables, `TURBO_TELEMETRY_DISABLED`
and `TURBO_PLATFORM_ENV_DISABLED`, turn off telemetry and turbo's warning
about each project variable `turbo.json` does not pass
([runbook](../../runbooks/cloud.md)). The other services use the cache as Vercel sets it up:
their builds read and write the team's remote cache, production and
previews in separate entries, and keep no local cache. Writing takes the
team's token, which a fork's pull request never gets unapproved. The docs'
and the website's builds never hit there: a Next.js build bakes in its
deployment (Skew Protection's ID in its asset URLs, Vercel's URLs in its
metadata), so their keys hold `VERCEL_DEPLOYMENT_ID`. Turbo infers every
`NEXT_*` variable into every task of a Next.js package, and each deployment
brings its own (`NEXT_DEPLOYMENT_ID`, and Vercel's `NEXT_PUBLIC_VERCEL_*`,
which these services' builds hash too), so the docs' `generate` and
`typecheck`, which read none, drop them (`!NEXT_*`) and still hit.
