# Turborepo configuration

How the turbo task graph is laid out and the rules for changing it. Read this
before editing a `turbo.json` or a workspace dependency. Turborepo is the only
task runner ([ADR 088](../../adrs/088-turborepo-task-runner.md)): CI runs it
(ci.yml's `full-pr`, see [Commands](#commands)), Vercel builds the hosted
cloud with it, and contributors run it with `turbo run` or through the root
scripts, which build through turbo (`turbo run @zitadel/<package>#<task>`).

## Layout

- The root `turbo.json` holds the task shapes every package shares, the root
  package's tasks (`//#test`, `//#check-adrs`, …) and `globalDependencies`
  (the root files that fix the toolchain and the installed dependencies: a
  change to one re-runs every task).
- A package's `turbo.json` starts with `"extends": ["//"]` and lists only what
  differs from the root shape. Turbo merges field by field: a package that
  sets `dependsOn` keeps the root's `outputs`, `inputs` and `env`.
- A task runs the `package.json` script of its name, in the package. No script
  means no task for that package, so do not add an empty script to fill a
  gap. The scripts of `@zitadel/server` (`apps/server`, the server's Go tasks)
  and `@zitadel/release` (`tools/release`) `cd` to the directory the command
  needs; a root script finds the server's module through `SERVER_MODULE_DIR`
  (`scripts/server-build.mjs`). `@zitadel/cloud` (`apps/cloud`) holds the
  hosted cloud's launcher and schemas; its `dev` is `pnpm run cloud`.
- The Go modules in `go.work` are packages too
  (`experimentalGoWorkspaces`), named after the last element of their module
  path, a major-version suffix keeping the element before it: `nextgen`
  (`apps/api`), `zitadel/v5` (`packages/go`), `bench` (`tools/bench`),
  `oidc-mock` (`tools/oidc-mock`), `defaults` and `design-tokens`. A module
  has no scripts: its `turbo.json` gives each task its command as a `command`
  array (`experimentalTaskCommand`, no shell, run in the module). Turbo adds
  `build`, `test`, `lint` (go vet), `format` (go fmt, which rewrites) and
  `dev` to every module; a module replaces the ones it uses and drops the
  rest with `"extends": false`. `defaults` and
  `design-tokens` have no `turbo.json` of their own (the design tokens share
  `@zitadel/design-tokens`'s, and `packages/config/defaults` ships to npm), so
  they keep the cheap built-ins and the root replaces their `format` by name.
- A script does its own task's work only. A step that is a task of its own,
  such as the package's `generate` or another package's `build`, is a
  `dependsOn` edge, never `a && b` in the script: chained, it reruns on every
  run, and turbo can neither cache, order nor skip it. So the docs' `build`
  and `dev` are plain `next build` and `next dev`.
- A task the published manifest has no use for is a `command` in the
  package's `turbo.json` (futureFlags.experimentalTaskCommand), not a
  script: the server platform packages' `build-binary`.
- Task names are script names: `dev:real`, `test:integration` and
  `sync:export` keep their colons.
- A package's checks run under its `lint` and its tests under its `test`, so
  the gate names only `lint typecheck build test`. A `lint` waits for the
  package's other checks (in the Go modules vet, format and the server's
  openapi; the server's and the design tokens' `check-generate`; at the root
  `check-adrs`, `check-go-work` and `check-typecheck`);
  a `test` runs the tests that need no service (the server's runs
  `test:unit` and `test:sqlite`), and Go tests wait for no check. The
  server's `test:postgres` (Docker) and `test:spanner` (the emulator) stay
  apart.
- The e2e lanes are `@zitadel/e2e`'s
  `console-smoke`, `console-real`, `console-embedded`, `console-platform`,
  `console-deployment`, `demo-next-mock`, `demo-next-real`, `demo-nuxt-mock`,
  `journey` (the journey runner with the caller's options), `journey-local`
  (the umbrella over one `journey:<id>` task per CI journey), plus the docs'
  `e2e` and `e2e-deployment`. There is no aggregate: a `turbo run` names the
  lanes it runs.

## Tasks that write files

- A task writes only its own output, which git ignores, and may empty it
  first (`orval --clean`, Vite's `emptyOutDir`, `build-binary`'s `bin/`). A
  task that reads that output depends on its task.
- No task writes a committed file during a run. Committed generated files
  (the server's Go and OpenAPI output, the design tokens) are source to every
  task, which lists them as `inputs`. Their `generate` is the tool a person
  runs after changing a source: never cached, no task depends on it, and it
  writes only the files whose content changed, each in one rename (the
  server's generates in a copy of the tree first, `scripts/go-generate.mjs`).
  Their `check-generate`, in `lint`, compares without writing.
- A package's lifecycle script (`pre*`, `post*`) never repeats a task: turbo
  runs `pnpm run <task>`, so a `pretest` that builds rebuilds the dist other
  tasks are reading.
- When a task would delete or rewrite what another reads mid-run, fix the
  task; never add a lock, an ordering edge or a run of its own around it.
- `turbo run clean` (one package: `--filter=<package>`) deletes the ignored
  output under the paths the root `turbo.json` lists, with `git clean -X`, so
  a committed file always survives; the console, `@zitadel/e2e`, the server
  and the release name their own paths, and the repository root keeps
  `dist/`, which holds the local servers' data. Run it on its own: beside another task it deletes what that task
  writes.

## Dependencies

- A task that uses another package depends on that package's task, and the
  package declares it in `package.json` (`devDependencies` when only tests or
  tooling use it). An edge on what another package builds (embedded UIs,
  built apps and binaries, the release tasks) needs no `package.json` entry.
- Edges are explicit (`dependsOn: ["@zitadel/components#build"]`). `^build`
  is not used: it follows devDependencies,
  and the console's `@zitadel/testing` would pull the CLI and the server build
  into every console build (and close a cycle). The one `^` edge is the Go
  modules' `^go-sources`, which follows their go.mod requires.
- Every dependency's result is part of a task's hash, whether or not it has
  outputs. Give a task that writes files its real `outputs` all the same: a
  cache hit restores only those, and a dependent finds anything else
  missing.
- A task cannot depend on a persistent task (`dev`, `start`, `preview`,
  `//#server`).
- A script that builds part of the workspace runs
  `turbo run @zitadel/<package>#<task>`. A task that runs one lists the same targets as
  `dependsOn`, so the script's own build can reuse cached package builds and
  the graph shows what the task needs: `//#server`,
  `@zitadel/console#dev:real`, `@zitadel/cloud#dev`.
- A task that opens Chromium depends on its package's `install-browsers`
  (`playwright install chromium`, never cached), so a run installs it only
  when such a task runs: the browser test suites, the e2e lanes,
  `@zitadel/testing#test:integration`.
- A package imports only its own files and the workspace packages its
  `package.json` declares, each through its exports, never a relative path
  into its folder; `turbo boundaries` checks it in CI. Shared config
  is a package of its own (`@zitadel/vitest-config`). An import that cannot
  go through a package, such as a root `scripts/` module (no package can
  depend on the workspace root) or a module the runtime provides (k6's),
  carries `// @boundaries-ignore <reason>` on the line above, and its task
  lists the file in its inputs.
  The root Vitest config uses that waiver for a direct shared-config import:
  Turbo otherwise hashes a root workspace dependency into every task.
- A release packs what the graph built. `@zitadel/release`'s `pack`,
  `snapshot` and `publish` depend on `build-public-packages`: every public
  package's `build` and each server platform package's `build-binary`, which
  cross-compiles the server into the `bin/` its npm package ships. There is
  no second build of anything, so no task rewrites a `dist/` another reads
  and the entry points wait for no test. A run that must not restore from the
  cache takes `--force`. Give a new public package its edge there and add it
  to `release-manifest.mjs`; `scripts/task-graph.test.mjs` checks both.

## Inputs and outputs

- Inputs follow file classes, not folders
  ([turborepo-graph.md](turborepo-graph.md)): the root shapes of `lint`,
  `typecheck`, `build`, `test` and `generate` start from `$TURBO_DEFAULT$`
  (the package's files) and leave out its docs (`README.md`, `AGENTS.md`,
  `CHANGELOG.md`, `docs/`, `skills/**/*.md`, …), and `build` and `generate`
  also its tests. A task that reads more lists it after `$TURBO_EXTENDS$`:
  `["$TURBO_EXTENDS$", "$TURBO_ROOT$/api/openapi/**/*.yaml"]`. Never list a
  package's own files: the default covers a new file without a list to
  maintain. The root's tasks (`//#test`, `//#check-*`) list theirs, because
  the root's folder is the whole repository.
- A negation wins over every inclusion, wherever it stands. Anchor excludes
  outside the package with `$TURBO_ROOT$`. A task that reads an excluded class
  replaces `inputs` instead of extending them (`cli#test` reads its
  `README.md`). Release tasks keep every file: the tarballs ship the docs.
- A Go module's production files (no tests, no docs) are the inputs of its
  `go-sources`, a task in the root `turbo.json` with no command: turbo hashes
  it but runs nothing. It depends on the `go-sources` of every module the
  module requires, so the graph, not an input list, says which modules a
  build compiles. Keep `//go:generate` out of test files: generation does not
  hash them. Each Go task depends on its module's;
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
  selects the task nor misses its cache. CI runs through the cache, so it
  fails on what such an edit broke only once another change misses that
  task's cache; a run with `--force` finds it at once.
- An ignored file a task reads is not a default input either, so the task
  lists it. Console, docs and website builds list `.env*`; without them, a
  changed `.env.local` would restore a build made without it.
- Outputs may lie outside the package (`$TURBO_ROOT$/internal/staticui/
  console/dist/**`). Framework caches are excluded (`!.next/cache/**`).
- `cache: false` for anything that is not a pure function of its inputs: the
  journey run by hand (`journey`), the
  deployment lanes, the database lanes, `install-browsers`, `pack`, the
  server binaries (the local one stamps Git HEAD and branch, the platform
  ones the release version and the commit), generation, `//#check-go-work`
  (its answer depends on every module's imports), and dev servers. Their
  inputs still decide when they count as affected, which gates the CI lanes.
- The console and demo lanes, the CI journeys (`journey:<id>`) and
  `@zitadel/testing#test:integration` are cached: they boot servers and
  browsers, but only on the repo's own builds, so a later push that leaves
  their inputs alone restores their pass instead of rerunning them. A journey
  runs each framework CLI at the CLI's pin
  (`apps/cli/src/lib/orca/scaffolders/framework-clis/package.json`, bumped by
  Dependabot); only the npm ranges those releases write resolve at run time,
  so the nightly run sets `TURBO_FORCE` and reruns them.
- Each journey depends on the builds of exactly what it installs
  (`journey-packages` plus its framework's SDK), and packs only those; so an
  SDK change selects only the journeys that install it.
  `@zitadel/release#pack` packs and checks the full release set.
- A cached lane's pass is the hashed tree's: its key holds the switches that
  change what it tests (`env`, below), and as a turbo task it never uses a
  server already on its port (`e2e/playwright.shared.ts`).
- Go tasks are cached. Turbo keys every task of a Go module, and every task
  that depends on a module's `go-sources`, on `go version` and the effective
  `go env` (GOOS, GOARCH, CGO_ENABLED, GOFLAGS, …), so a result never
  restores on another host, target or toolchain. Turbo itself leaves a Go
  module's `format` (its own is go fmt, which rewrites) and a library
  module's `build` uncached; the format checks here say `cache: true`. Tests
  that read files outside their module keep
  `-count=1`, because Go's result cache does not see those files; turbo's key does.
- The root's `test` (`pnpm run test`, `scripts/task-graph.test.mjs` among
  its suites) probes the real graph in an isolated fixture: source/test
  invalidation, shared config scope, release ordering, ignored dotenv changes
  and the ignored files builds write. CI runs it as `//#test`.

## Environment

- Strict mode: a task sees `PATH`, `HOME`, `SHELL`, `CI`, `TERM`, `LANG`,
  `GITHUB_ACTIONS`, `RUNNER_TEMP`, `VERCEL`, `COREPACK_*`, `TURBO_*`, what
  framework inference adds (`VITE_*` for Vite packages, `NEXT_*` for Next.js)
  and what the task lists. `env` names variables that change the output and
  are hashed (`CONSOLE_ADDON`, `GOFLAGS`, the cached e2e lanes' `ZITADEL_*`
  and `NEXTGEN_*`, the journeys' `JOURNEY_*` but `JOURNEY_WORK_DIR`); `passThroughEnv`
  names variables a task reads at run time without affecting its output
  (`PLAYWRIGHT_*` for the e2e lanes, `DOCKER_*` for the database lanes). The Go
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
- A task cannot set a variable's value. Values a lane needs are set in the
  `package.json` script as defaults that a caller's own value overrides:
  `NEXTGEN_SERVER_CONSOLE_ENABLED=${NEXTGEN_SERVER_CONSOLE_ENABLED-false} playwright test …`.

## Mutex and retry

Turbo has neither. `scripts/task-guard.mjs` wraps a command:
`node ../scripts/task-guard.mjs --mutex demo-next-app -- playwright test …`
holds a lock while the command runs, and the four browser-test packages run
`node ../../scripts/task-guard.mjs --retries 3 -- vitest run`. The lock is a
directory in the OS temp dir keyed by the repository root, so checkouts do not
block each other and a dead holder is reclaimed. The guard acts only when turbo
runs the task (turbo sets `TURBO_HASH` for every task); run by hand it runs the
command once, unchanged. The one name in use is `demo-next-app`: the two
demo-next e2e lanes both run `next dev` in the demo's folder on :3002.

## Check the graph

Run these after changing a `turbo.json`, a script a task runs or a workspace
dependency; CI runs both:

```sh
turbo boundaries   # imports against package.json (Dependencies, above)
pnpm run test      # the real graph in a fixture (Inputs and outputs, above)
```

Then run the gate twice: the second run must hit every cached task.

## Commands

| | |
|---|---|
| the default gate | `turbo run lint typecheck build test` |
| everything CI runs (below) | `pnpm run ci` |
| an agent's or a script's run | add `--output-logs=errors-only` |
| only what a branch changed | `TURBO_SCM_BASE=origin/main turbo run lint typecheck build test --affected` |
| one task | `turbo run test --filter=@zitadel/cli` |
| pass arguments (by hand only, below) | `turbo run test --filter=@zitadel/cli -- --reporter=verbose` |
| what would run | `turbo run build --dry` |
| package boundaries | `turbo boundaries` |
| affected tasks, task-level | `turbo query affected --base origin/main --tasks test` (its prerequisites carry the reason "required by an affected task") |
| every task without the cache | `turbo run lint typecheck build test --force` |
| delete build output | `turbo run clean`, alone (Tasks that write files, above) |
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
environment: `RELEASE_SKIP_CONTAINER=1` for the release snapshot
(`passThroughEnv`), `JOURNEY_RUNTIME`, `JOURNEY_MATRIX`, … for the journey
runner (`e2e/journey/README.md`; `env` on the cached journeys).

`--affected` and `turbo query affected` match the diff against each task's
`inputs` and follow task edges, so a console change still reaches the
server's tests, which embed it (`futureFlags.affectedUsingTaskInputs`).
ci.yml's required `full-pr` job runs the root `ci` script (`pnpm run ci`:
`turbo boundaries`, then one `turbo run --affected` of the checks and the
lanes, so a lane starts once its own dependencies are done) on GitHub's
32-core arm64 runner, with `--concurrency=100%` (a task per core; the script
keeps turbo's default of 10, which a laptop can take), measured from the pull request's or the merge group's base; a
dispatch and the nightly run on `main` measure from the repository's first
commit, so they run every task, and the nightly reads no cache. It keeps setup-go's and setup-node's caches
and reads and writes Vercel's remote cache over OIDC; a fork's pull request
gets no token and runs with the local cache only. A Changesets version PR
runs like any other: the release checks are tasks of the graph
(`@zitadel/release#check-npm` and `#check-changesets` under `test`, `pack`
under the journeys). The
task list is the script and ci.yml is a global dependency, so editing either
reruns every task. Add a task to the script, never a step to the workflow.
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
