# Turborepo configuration

How the turbo task graph is laid out and the rules for changing it. Read this
before editing a `turbo.json`. While both runners are configured (the dual-run
phase of [turborepo-migration.md](turborepo-migration.md)), every task exists
twice — in `moon.yml` ([.moon/AGENTS.md](../../../.moon/AGENTS.md)) and in a
`turbo.json` — and a change goes into both. Moon is the runner of record; the
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
  `sync:export` keep their colons; the e2e lanes are `e2e`, `e2e-real`,
  `e2e-embedded`, `e2e-platform`, `e2e-local`, `e2e-testkit` and the docs'
  `e2e-deployment`.

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
- The release builds run in a fixed order because each cleans and rewrites
  the `dist/` that dev builds and tests of the same graph read (moon ran them
  serially). The chain, each link naming its predecessor in its own
  `turbo.json`: `cli` (after `cli#test`) → `api` → `config` → `components` →
  `sdk-core` → `sdk-next` → `sdk-nuxt` → `sdk-react` → `sdk-vue` →
  `sdk-angular` → `sdk-solid` → `sdk-svelte` → `sdk-qwik` → `testing`; the
  console and login UI release builds wait for
  `@zitadel/release#build-public-packages`. Keep a new public package in that
  chain and in `release-manifest.mjs`.

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
  are hashed (`VITE_CONSOLE_VERCEL_INSIGHTS`, `GOFLAGS`); `passThroughEnv`
  names variables a task reads at run time without affecting its output
  (`NEXTGEN_*` for the e2e lanes, `DOCKER_*` for the database lanes). The Go
  cache locations pass through globally.
- A task cannot set a variable's value. Values a lane needs (moon's task
  `env:` blocks) are set in the `package.json` script, for example
  `NEXTGEN_SERVER_CONSOLE_ENABLED=false playwright test …`.

## Mutex and retry

Turbo has neither. `scripts/task-guard.mjs` wraps a command:
`node ../../scripts/task-guard.mjs --mutex browser-tests --retries 3 -- vitest run`.
The lock is a directory in the OS temp dir keyed by the repository root, so
checkouts do not block each other and a dead holder is reclaimed. Names in
use: `browser-tests` (one real-Chromium Vite server at a time, #1490) and
`generated-sources` (the generation tasks and the tasks that read what they
rewrite).

## Commands

| | |
|---|---|
| the default gate | `turbo run lint typecheck build test` |
| one task | `turbo run test --filter=@zitadel/cli` |
| pass arguments | `turbo run snapshot --filter=@zitadel/release -- --skip-container` |
| what would run | `turbo run build --dry` |
| affected tasks, task-level | `turbo query '{ affectedTasks(base: "origin/main", tasks: ["test"]) { items { name package { name } } } }'` |
| a run summary for the failure report | `--summarize` → `.turbo/runs/<id>.json`, `node scripts/report-turbo-failures.mjs` |

Do not select the gate with `--affected` or `--filter=…[ref]`: both follow
`package.json` edges only and would skip the server's tests on a console
change (the server embeds the console through a task edge). Run the whole
gate; the cache skips the unchanged tasks. `scripts/ci-mode.mjs` computes the
task-level affected set for the CI lanes.

Turbo needs a `pnpm` binary on `PATH` (`corepack enable`). In a git worktree
turbo's cache defaults to the main checkout's `.turbo/cache`; set
`TURBO_CACHE_DIR` to keep worktrees apart. Telemetry is off in CI and on
Vercel (`TURBO_TELEMETRY_DISABLED=1`); set it locally too.
