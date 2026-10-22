# Migrating from moon to Turborepo: the plan

> **Status:** accepted for phase 1 (dual run) on 2026-10-12; the decisions
> are recorded at the end. Since 2026-10-14 pull requests no longer run
> `ci-turbo`, which pauses the dual run's comparison (decision 9).
> Turborepo 2.11.7 against moon 2.6.1. The research
> and the reasons to consider the switch are in
> [turborepo-pilot.md](turborepo-pilot.md); this document is the how, and
> [turborepo.md](turborepo.md) is the contributor-facing description of the
> turbo configuration.
>
> **Prototype:** branch `claude/turborepo-migration-prototype-98fc8b`. It
> configures every moon task for turbo, leaves moon fully working, and ports
> the scripts and one CI workflow. Moon stays the runner of record until the
> cutover phase below.

## Short answer

A full switch is feasible and mostly mechanical. The prototype gives every one
of moon's projects (31 when the prototype was written, 32 with `website`) a `turbo.json`, runs the same `package.json` scripts
under both runners, and reproduces the default gate (`moon ci :lint :typecheck
:build :test`) task for task; the measured runs are in
[Results](#results). What turbo lacks (mutexes, retries, serial dependencies,
per-task environment values, interactive tasks) is covered by small,
tool-neutral pieces that moon can use too, so the two runners can coexist for
a parity period before CI, docs and scripts flip.

Estimated effort for the whole migration: about **10 to 13 working days**,
spread over four to six calendar weeks because of the parity period. The
largest single items are the documentation rewrite (45 files) and the release
workflow, not the task graph.

## What the prototype contains

| Area | Files | What it does |
|---|---|---|
| Task graph | root `turbo.json`, 26 package `turbo.json` files (`"extends": ["//"]`) | Every moon task, with the same dependency edges. The root file holds the shared task shapes (moon's `.moon/tasks/*.yml`); each package file adds only what differs, which turbo merges field by field. |
| Scripts as the task contract | 30 `package.json` files | Every task runs a `package.json` script: `lint` scripts for the 26 TypeScript packages, the Go server's 13 tasks as scripts in `apps/server/package.json`, 16 `build-release` scripts, the e2e lanes with the environment moon used to set. |
| Tool packages | `tools/bench/package.json`, `tools/release/package.json`, `pnpm-workspace.yaml` (`tools/*`) | Moon's `bench` and `release` projects become private workspace packages (`@zitadel/bench`, `@zitadel/release`) so turbo can address their tasks. |
| Mutex and retry | `scripts/task-guard.mjs` | `--mutex <name>` (a lock directory in the OS temp dir, keyed by repository root, stale holders reclaimed) and `--retries <n>`. Used by the four browser-mode test scripts and the six generated-sources tasks. It acts only when turbo runs the task (`TURBO_HASH` is set); under moon, which has its own `mutex` and `retryCount`, and when a person runs the script, it runs the command once, unchanged. |
| Inline scripts | `scripts/go-format-check.mjs`, `scripts/go-lint.mjs` | Turbo's versions of the `format` and `lint` inline scripts of the two Go projects; moon keeps its inline scripts until the cutover. |
| Runner selection | `scripts/task-runner.mjs` (+ `.d.mts`) | `NEXTGEN_TASK_RUNNER=moon\|turbo` picks the runner the contributor scripts build through; maps `project:task` to turbo tasks and back. |
| Ported scripts | `ci-mode.mjs`, `check.mjs`, `run-server.mjs`, `run-server-debug.mjs`, `run-cli.mjs`, `apps/console/scripts/dev-real.mts`, `e2e/journey/scripts/local-registry.mjs`, new `report-turbo-failures.mjs` | Work under either runner; tests added for the turbo paths. |
| CI | `.github/workflows/ci-turbo.yml` | The turbo version of ci.yml's moon steps, a non-required job: on every pull request and merge-group entry until 2026-10-14, since then on pushes to main and by hand (decision 9). |
| Unchanged | all `moon.yml`, `.moon/`, ci.yml, the required check | Moon runs exactly as before. |

Verified in the prototype, 2026-10-12:

- `turbo run lint typecheck build test` resolves 116 real tasks (160 task ids,
  44 of them placeholders for packages that have no such script, which turbo
  skips: that is how moon's `inheritedTasks.exclude` maps).
- The release graph resolves without cycles: `snapshot` 40 tasks, `pack` 32.
- The e2e lanes pull exactly moon's dependencies (`console-e2e:e2e-real`: 17
  tasks ending in `server#build`, `cli#build`, `testing#build`).
- A package `turbo.json` overrides a root task field by field: `{"build":
  {"dependsOn": [...]}}` keeps the root's `outputs`, `inputs` and `env`.
- `$TURBO_ROOT$/**/*.go` style inputs hash correctly (1,540 files for
  `server#test`), and outputs outside the package (`$TURBO_ROOT$/internal/
  staticui/console/dist/**`) restore from the cache.
- In strict env mode a task sees `PATH`, `HOME`, `SHELL`, `CI`, `TERM`,
  `LANG`, `USER`, `GITHUB_ACTIONS`, `RUNNER_TEMP`, `VERCEL`, `COREPACK_*`,
  `TURBO_*` and nothing else unless listed; `GOPATH`, `DO_NOT_TRACK`,
  `TMPDIR`, `LC_ALL` are not passed by default.
- `turbo query affectedTasks` follows the artifact edges: a console-only commit
  marks `server#test`, both `e2e-real` lanes and `testing#test:integration`
  affected (moon's `--downstream deep`), where `turbo run --affected` and
  `affectedPackages` see only `@zitadel/console`. It also lists upstream
  dependencies (`api#build`), which moon's query does not; the ci-mode port
  therefore derives the set itself from `turbo run --dry=json`.
- `--summarize` writes `.turbo/runs/<id>.json` on success and failure, with
  per-task exit codes; `--continue=dependencies-successful` is moon's
  behaviour on a failure (dependents skipped, the rest runs).
- `interactive: true` tasks only run inside turbo's terminal UI.
- A task-graph cycle fails fast ("Cyclic dependency detected").

## Results

The default gate, both runners, on the prototype branch (Apple M4, 10 cores,
clean environment: `env -i HOME TERM PATH`, with the pnpm shim, an arm64 Go
1.26 and a `docker` stub that reports the daemon down on `PATH`; Docker
Desktop is not installed on that machine). Cold = both tools' caches deleted
and `go clean -cache`; warm = the same command again with nothing changed. Two
rounds each, alternating.

| | moon (`moon ci :lint :typecheck :build :test`) | turbo (`turbo run lint typecheck build test`) |
|---|---|---|
| tasks run | 123: the 119 shared ones, `release:lint`, and the three database lanes `server:test-postgres`, `test-sqlite`, `test-spanner` (`runInCI: true` tasks, which `moon ci` runs whether or not the targets name them); `workspace:lint` was not selected | 120: the 119 shared ones and `//#lint` (`release:lint` has no files and no script) |
| cold, round 1 | 5 m 59 s | 3 m 47 s |
| cold, round 2 | 4 m 17 s | 3 m 51 s |
| warm, round 1 | 2 m 36 s (the failed `cli:test` and `console:test` re-ran) | 6 s (116 hits; the four `install-browsers` are `cache: false`) |
| warm, round 2 | 1 m 07 s (the failed `cli:test` re-ran) | 7 s |
| results | 119 shared tasks: all passed except `cli:test` in both cold rounds (two time-sensitive tests: `claim.test.ts` waits 5 s for the CLI to call `claim/init`; `local-runtime.test.ts` expects `doctor` to see an occupied port) and `console:test` in round 1; `components:test` passed on moon's retry in round 1. The two Docker lanes failed on the stub; `test-sqlite` passed. | all 120 passed in both rounds; the guard's locks were taken (`generated-sources` and `browser-tests` waits appear in the log) and no retry was needed |
| the same `cli:test` alone, or in the warm round with little else running | passes (1,864 tests) | passes |

Read the wall times with the caveat that moon did more work: the three
database lanes add two Go compiles with build tags and a three-minute SQLite
suite, and because they are `cache: false` they ran in the warm rounds too.
That load is also the reason the CLI and console tests failed only under
moon: every failure is a 20–25 s timeout or a missed 5 s deadline, the same
suites pass alone and under turbo's lighter graph, and the worst round (warm
1, 15 CLI and 21 console failures) is the one where only those two suites and
the three Go lanes were running. The comparable number is round 2, 4 m 17 s
against 3 m 51 s, with the same tasks at the top of both lists: the storybook
and Qwik browser suites (about 100 s each, serialised by the lock), `cli:test`
(75–87 s), the server's analyzers and build (80–90 s) and the console tests
(60–70 s). The sum of task durations was 2,356 s under moon and 1,464 s under
turbo in round 1, which is the extra lanes plus the contention they cause, not
a per-task speed difference: the pilot measured the same builds at the same
speed under both tools.

One e2e lane was also run under turbo in the same environment:
`turbo run test:integration --filter=@zitadel/testing` (the kit's
real-instance suite, 17 tasks including the server build) passed, which
exercises the strict environment mode and the variables the scripts now set.

Two side findings about today's CI from these runs: `moon ci` runs the
`runInCI: true` database lanes inside the gate step even though ci.yml names
`:test`, so on a Depot runner they run there and again in their explicit steps
(`cache: false`); and `moon ci` did not select `workspace:lint` in either
round — a root-project task without explicit inputs has no inputs in moon, so
the root lint is never selected by affectedness and the root `scripts/*.mjs`
are linted only where a package task happens to reach them. Both are worth a
look in a real CI log. The turbo configuration gives `//#lint` the files Biome
checks as inputs instead of copying the gap.

The port's affected sets were also compared with today's moon on two real
commits (a console-only and a Go-only change): the lane gates and the journey
matrix come out identical; the sets differ only in moon listing the console's
persistent dev tasks (never gated on) and turbo listing `//#lint`.

Not measured here: the e2e lanes and the release graph under load (see the
dual-run phase), and the remote cache, which the pilot covered on Vercel.

## Task mapping

Every moon task, its turbo task and what runs. Turbo tasks are
`<package>#<script>`; the package of a moon project is `@zitadel/<project>`
except `workspace` → `//`, and the task runs the `package.json` script of the
same name. "Script" names what the prototype added; existing scripts are kept
as they were.

### Shared TypeScript tasks (`.moon/tasks/typescript.yml`, 26 projects)

| moon | turbo | script | notes |
|---|---|---|---|
| `lint` (`corepack pnpm exec biome check .`) | `lint` | **new** `biome check .` in every TypeScript package | same command, resolved from the package; `release:lint` (no files) is dropped |
| `typecheck` | `typecheck` | existing | deps per package, below |
| `build` (`outputs: dist/**/*`) | `build` (`outputs: ["dist/**"]`) | existing | packages that write elsewhere override `outputs` |
| `test` (`corepack pnpm run test:all`) | `test` | existing `test`; in `components` and `api-mock` the full lane moves from `test:all` to `test` (`test:unit` is the old fast lane, `test:all` still aliases `test` for moon) | turbo runs the script of the task's name, so `test` must be the gate lane |

### Per project

| project | moon task | turbo task | script / replacement |
|---|---|---|---|
| api | `generate` (mutex generated-sources, inputs `/api/openapi/**/*.yaml`) | `@zitadel/api#generate` | `generate` → `task-guard --mutex generated-sources -- orval …`; inputs `$TURBO_ROOT$/api/openapi/**/*.yaml` |
| api | `build-release` (inline, mutex public-dist) | `#build-release` | **new** `release-clean.mjs local-dist && pnpm run build`; ordered after `@zitadel/cli#test` |
| api-mock, components, sdk-qwik, storybook | `install-browsers` (cache false) | `#install-browsers` | **new** `playwright install chromium`; the `test` task depends on it, as in moon |
| api-mock | `test` (retryCount 3) | `#test` | `test` → `task-guard --retries 3 -- vitest run` |
| api-mock | `start` (persistent) | `#start` | existing |
| components | `build` (dep config:build, design-tokens:build) | `#build` | same edges |
| components | `build-release` (inline + check script) | `#build-release` | **new** script with `check-standalone-artifact.mjs` |
| components | `test` (retry, dep build) | `#test` | guarded script |
| config | `sync-schemas` (mutex generated-sources) | `#sync-schemas` | script wrapped in the guard; the `pre*` scripts keep calling it |
| config | `build-release` (mutex public-dist) | `#build-release` | ordered after api's release build |
| design-tokens | `sync` (cache false) | `#sync` | `passThroughEnv: FIGMA_*` |
| design-tokens | `sync-export` | `#sync:export` | existing script; gains the output it writes |
| design-tokens | `generate` (4 outputs) | `#generate` | same outputs |
| sdk-core / sdk-next / sdk-nuxt / sdk-react / sdk-vue / sdk-angular / sdk-solid / sdk-svelte / sdk-qwik | `typecheck`, `build`, `test` | same | same edges (api-mock for the specs that need it, components, sdk-core) |
| sdk-* | `build-release` (inline) | `#build-release` | **new** script; the dev build's edges, on the release builds (components, sdk-core) |
| sdk-nuxt | `build` (mutex sdk-nuxt-dist) | `#build` | ordered by the demo-nuxt edge; see mutexes |
| sdk-nuxt | `dev` (persistent) | `#dev` | existing |
| sdk-qwik | `install-browsers`, `test` (retry) | same | guarded script |
| testing | `test-integration` (env, cache false) | `#test:integration` | existing script, now sets the env itself |
| testing | `build-release` | `#build-release` | after config's release build |
| cli | `test` (inputs + `/apps/server/bin/**`, mutex public-dist) | `#test` | inputs `$TURBO_ROOT$/apps/server/bin/**`; the mutex becomes an edge: the release builds start after it |
| cli | `build-release` (runDepsInParallel false, dep test) | `#build-release` | **new** script; `dependsOn: ["test", "@zitadel/sdk-next#build-release"]` |
| cli | `readme` | `#readme` | existing; `outputs: ["README.md"]` |
| console | `build` (outputs staticui, env input) | `#build` | `env: ["CONSOLE_VERCEL_INSIGHTS"]`, outputs `$TURBO_ROOT$/internal/staticui/console/dist/**` |
| console | `build-release` | `#build-release` | **new** `vite build`; waits for the public packages' release builds |
| console | `dev`, `preview` (persistent) | `#dev`, `#preview` | existing |
| console | `dev-real`, `dev-claim` (persistent) | `#dev:real`, `#dev:claim` | existing; the script builds the server through the selected runner |
| demo-next | `build` (outputs .next) | `#build` | outputs `.next/**`, `!.next/cache/**` |
| demo-next, demo-nuxt | `dev`, `start` | same | existing |
| demo-nuxt | `build` (outputs .output, mutex sdk-nuxt-dist) | `#build` | outputs `.output/**` |
| e2e | `test` (journey harness unit tests); lanes `console-smoke`, `console-real`, `console-embedded`, `console-platform`, `console-deployment`, `demo-next-mock`, `demo-next-real`, `demo-nuxt-mock`, `journey`, `journey-local` (env; the demo-next pair's mutex `demo-next-app`); `all` (noop over every lane; ci.yml's e2e step runs it) | `@zitadel/e2e#…`, same lane names, plus `e2e-local`; no `all` | scripts carry the `NEXTGEN_*`, `ZITADEL_TELEMETRY` and `JOURNEY_TARBALLS_REQUIRED` defaults; the demo-next pair holds the guard's `demo-next-app` lock; ci-turbo.yml runs the lanes as gated steps |
| docs | `generate` (inputs openapi + redocly) | `#generate` | same inputs and outputs |
| docs | `build` (`next build`, mergeArgs replace) | `#build` | existing script (`pnpm run generate && next build`): bundles once more than moon; the Vercel docs service runs the script without a runner |
| docs | `dev`, `start` | same | existing |
| docs | `e2e` (dep build), `e2e-deployment` (its own Playwright config, which requires `CLOUD_URL`) | same | **new** scripts; the root's `check:cloud` runs `e2e-deployment` with the e2e package's `console-deployment` |
| console | `build` env inputs `$CONSOLE_VERCEL_INSIGHTS`, `$CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE` | `#build` `env` | both listed: strict mode would otherwise hide them from vite.config.ts. Neither is `VITE_`-prefixed: Vite inference would hash a prefixed one into every Vite package of the cloud's console build (as `VITE_CONSOLE_VERCEL_INSIGHTS`, it had `components` built twice per deployment) |
| login-ui | `build`, `build-release` (outputs staticui) | same | **new** `build-release`: `vite build` |
| login-ui | `dev`, `preview` | same | existing |
| storybook | `test` (mutex, retry) | `#test` | guarded script |
| storybook | `dev` | `#dev` | existing |
| website | `lint`, `typecheck`, `build`, `dev`, `start` | same | **new** `lint` script; `typecheck` depends on `build` (`next typegen` and `next build` both write `.next/types`), and so does moon's since it dropped its `website-next` mutex, which held only while a command ran, not while a cache hit restored `.next`; `build` outputs `.next/**` without its cache |
| server | `openapi`, `format`, `generate`, `clean-generated`, `check-generate`, `check-generate-pruned`, `vet`, `lint`, `test`, `test-postgres`, `test-spanner`, `test-sqlite`, `build` | `@zitadel/server#…` | **new** scripts in `apps/server/package.json`, each `cd ../.. && …`; `format` and `lint` run the new script files; the generation tasks hold the guard's lock; `serverInputs` repeated as `inputs` per task |
| bench | `format`, `vet`, `lint`, `build`, `test`, `sweep`, `summarize` | `@zitadel/bench#…` | **new** `tools/bench/package.json`; `benchInputs` repeated. `vet` depends on `@zitadel/server#check-generate` in turbo: the first `ci-turbo` run caught it compiling `api/generated` while the server's generation rewrote it, a race moon's order could hit too, so moon's `bench:vet` has the same dependency since #1704 |
| release | `changesets`, `check-graph`, `build-public-packages`, `version`, `pack`, `snapshot`, `publish` | `@zitadel/release#…` | **new** `tools/release/package.json` (`cd ../.. && node scripts/release.mjs …`) |
| workspace | `test`, `check-typecheck`, `check-openapi-rules`, `check-moon-graph`, `check-adrs` | `//#…` | root scripts (**new** for the four checks), explicit inputs as in moon.yml |
| workspace | `doctor`, `server`, `server-debug`, `build-local-image`, `smoke-container`, `check` | `//#…` | root scripts (**new** `server-debug`, `build-local-image`, `smoke-container`); `journey` moved to `@zitadel/e2e#journey`, and moon keeps `workspace:journey` as a deprecated alias |
| workspace | `cli` (interactive) | — | not a turbo task: interactive tasks need turbo's terminal UI. `pnpm run cli -- …` (the root script that exists today) |
| cli-skill-e2e (no moon project) | — | — | its `test` script is renamed `eval` (`eval:fresh` for `FRESH=1`), otherwise `turbo run test` would run a Claude-driven eval |

## What replaces each moon feature

### `mutex` (15 uses, 4 names)

| mutex | protected | replacement |
|---|---|---|
| `generated-sources` (server `generate`, `clean-generated`, `check-generate`, `check-generate-pruned`; api `generate`; config `sync-schemas`) | generation rewriting files other tasks read mid-graph | `task-guard --mutex generated-sources` in the six scripts. Ordering edges were rejected: they would put the Go generation on the critical path of every TypeScript build. |
| `public-dist` (api, config, sdk-next `build-release`; cli `test`) | release builds cleaning a dist the CLI tests import | an edge: the release builds start after `@zitadel/cli#test`. Moon could not express that edge (cli depends on those packages, a project-graph cycle); turbo has no project graph. |
| `demo-next-app` (e2e `demo-next-mock`, `demo-next-real`) | the two lanes that serve apps/demo-next with `next dev` on :3002 from one `.next` folder; the other lanes of ci.yml's e2e step (`moon exec e2e:all`) run beside them | their two scripts hold `task-guard --mutex demo-next-app`; ci-turbo.yml also runs the lane groups as separate steps. |
| `sdk-nuxt-dist` (sdk-nuxt `build`, `build-release`; demo-nuxt `build`) | demo-nuxt bundling from sdk-nuxt/dist | the existing `demo-nuxt#build → sdk-nuxt#build` edge orders the dev builds; the release build never shares a turbo invocation with demo-nuxt. If that ever changes, the guard covers it. |

The lock lives in the OS temp dir under a hash of the repository root, so two
checkouts never block each other, and the holder's pid is recorded so the lock
of a run that died is reclaimed (should the pid have been reused, the next run
waits for it, at most 30 minutes). The guard acts only when turbo runs the
task: turbo sets `TURBO_HASH` for every task. Under moon, which has its own
`mutex`, it runs the command once, unchanged.

### `retryCount: 3` (4 uses)

`task-guard --retries 3` in the four browser-test `test` scripts (components,
api-mock, storybook, sdk-qwik). The flake it exists for is a module import that
Chromium aborts when a container changes the host's addresses (#1490, now
prevented in CI; the retry stays as a safety net), so the retry re-runs the
whole suite, which Vitest's own per-test `retry` would not do — a failed module
import fails the file. Moon is unchanged: its `test` task runs each package's
`test:all` script, which calls Vitest directly, so moon keeps its own
`retryCount: 3` and no suite retries under both. The `test:all` scripts go with
moon at the cutover.

### `runInCI` (72 uses)

Turbo runs what is named. The gate names `lint typecheck build test
check-adrs check-moon-graph`; every `runInCI: false` task has another name
(`build-release`, `dev`, …) and is never reached. Moon's e2e lanes are
`runInCI: "skip"`, which keeps them out of the `moon ci` graph, and ci.yml runs
them in a step of its own with `moon exec e2e:all --ignore-ci-checks`; turbo
has no `all`, and ci-turbo.yml runs the lanes as steps gated by ci-mode. One
known difference: the console real-instance configs retry once when `CI` is
set (`retries: process.env.CI ? 1 : 0`); moon's lane commands unset `CI`
(`env -u`: a task `env` entry would not override the runner's value), turbo
leaves it set, so only turbo retries them. The e2e lanes and
the dev/runtime tasks also get `cache: false`, which moon mostly left cached.
`runInCI: true` on the database lanes existed only to keep `moon run` from
hiding them in CI; it has no counterpart and needs none, and the `env -u CI`
dance in the workflows goes away.

### Inline `script:` (19 uses)

| inline script | replacement |
|---|---|
| server `format`, bench `format` (gofmt over tracked files) | `scripts/go-format-check.mjs` (same check, from the current directory) |
| server `lint` (analyzers per build tag + Biome on `bin/`) | `scripts/go-lint.mjs` |
| 14 × `build-release` (`release-clean.mjs local-dist` then build) | `package.json` scripts: `node ../../scripts/release-clean.mjs local-dist && pnpm run build` (+ the standalone check for components) |
| workspace `check-typecheck`, `check-openapi-rules` | root `package.json` scripts, same commands |

Moon could run the same files (`command: node scripts/go-lint.mjs`), but
phase 1 leaves moon's configuration exactly as on main, so until the cutover
the inline scripts and the files are kept in step by hand.

### `runFromWorkspaceRoot` (20 uses)

The server's and the release project's scripts start with `cd ../.. &&`. Both
packages are published or private wrappers whose `scripts` never run on
install, so the extra scripts in `@zitadel/server`'s manifest are inert, but
they are visible to anyone reading the published `package.json` (open
decision 4).

### `persistent` (17), `interactive` (1), `cache: false` (49)

`persistent: true` and `cache: false` map one to one. `interactive` does not:
turbo runs interactive tasks only in its terminal UI (`--ui=tui`), so
`workspace:cli` stays a plain script (`pnpm run cli -- …`), which is what the
moon task wrapped anyway.

### `mergeOutputs` / `mergeArgs` (6), `fileGroups` (2), `implicitInputs`

A package `turbo.json` replaces the root's field, so "replace" is the only
mode and the options disappear. File groups do not exist: the server's 15
input globs are repeated in each of its 10 tasks (`apps/server/turbo.json`),
bench's 6 globs in 3 tasks. `implicitInputs` become `globalDependencies` in
the root; `pnpm-lock.yaml` is left out because turbo hashes each package's
slice of it.

### Task `env:` values (7 tasks)

Turbo tasks cannot set environment values, only name variables to hash or
pass through. The values moved into the scripts as defaults that a caller's own
value overrides, as it overrides moon's task `env`
(`NEXTGEN_SERVER_CONSOLE_ENABLED=${NEXTGEN_SERVER_CONSOLE_ENABLED-false}
playwright test …`), which is POSIX shell syntax; the better home is the
Playwright configs and the kit's options, where the comments explaining each
switch already live (cutover task). `$workspaceRoot` had no replacement and
needed none: the configs default the binary path and the ports.

### `runDepsInParallel: false` (6 uses)

Turbo has no serial dependencies. The release project relied on them because
every `build-release` cleans and rewrites the `dist/` that the dev builds and
tests of the same graph read. The prototype wrote moon's serial order as
edges, a chain of the 14 public-package release builds. Since moon runs those
builds in parallel on their package edges (2026-10-14), turbo has the same
edges: the release builds start after `cli#test` (`api#build-release`
depends on it, the rest reach `api`'s), each depends on the release builds of
the packages its dev build depends on, and the two UI release builds wait for
all of them. One race remains: in `snapshot`, the server's tests run
alongside the release builds, and the console release build rewrites the
embedded dist they compile. Go compiles the embed package once and caches it,
so in practice the tests see one dist; the clean fix is for release builds to
write somewhere other than the dev `dist/` (open decision 5). The order check
(`release:check-graph`) asserts these edges after its port.

## Script ports

| script | moon dependency | port | state in the prototype |
|---|---|---|---|
| `scripts/ci-mode.mjs` | `moon query tasks --affected --downstream deep` | `queryAffectedTargets` takes the runner: under turbo, `turbo run <all tasks> --dry=json` gives every task's hashed inputs and dependents; tasks with a changed input are roots, their dependents the affected set, mapped back to `project:task` so the gate logic and its 25 tests are unchanged. A changed global input affects everything, as moon's implicitInputs do. | done, 6 new tests; needs a replay over real PRs during the parity period |
| `scripts/report-moon-failures.mjs` | `.moon/cache/ciReport.json` | `scripts/report-turbo-failures.mjs` reads the newest `.turbo/runs/*.json` from `--summarize`; same annotations and summary table | done, 4 tests; the moon version stays until moon is removed |
| `scripts/check-moon-graph.mjs` | `moon query projects` | kept during the dual run (as `//#check-moon-graph`); dropped with moon. Its rule "the moon edge and the npm dependency go together" has no turbo form to check, and its hashed-edge subtlety disappears: turbo hashes every dependency's result. | unchanged |
| `scripts/check-release-graph.mjs` | `moon task-graph`, `moon task` | reads `turbo run snapshot --dry=json` (dependencies per task) and asserts: each public package's `build-release` cleans local dist, mirrors its dev build's package edges and starts after `cli#test`, no release build reaches its own `build`, the UI release builds depend on the release builds of the packages they bundle, mirror their dev builds' package edges and reach no public package's `build`, no public package's `build` runs after the release builds, and the entry points depend on `build-public-packages`. The mutex and `runInCI` assertions go. | not ported (plan: 1 day incl. tests) |
| `scripts/release-manifest.mjs` | `moonProject` fields, `buildTarget` `project:build-release` | `buildTarget` becomes `@zitadel/<name>#build-release` (or stays and is mapped through `task-runner.mjs`); `release-manifest.test.ts` asserts against `turbo.json` files instead of `.moon/workspace.yml` and `moon.yml` | not ported (half a day) |
| `scripts/check-typecheck-programs.mjs` | parses each `moon.yml` `typecheck` task | reads each package's `typecheck` script directly (the moon task only ever ran that script); the `moon.yml` existence check becomes "has a `typecheck` script" | not ported (half a day; test unchanged) |
| `scripts/doctor.mjs` | `node_modules/.bin/moon --version` | checks turbo the same way (`turbo --version` from `node_modules/.bin`, the catalog pin); drops the PATH-shadowing warning or applies it to turbo | not ported (half a day) |
| `scripts/check.mjs` | `moon run …`, `moon ci …` | phases call `runnerCommand` / `workspaceCommand`; the Node phase runs the whole gate under turbo (no `--affected`, see below) | done |
| `scripts/run-server.mjs`, `run-server-debug.mjs`, `run-cli.mjs`, `apps/console/scripts/dev-real.mts`, `e2e/journey/scripts/local-registry.mjs` | `moon run <targets>` | `runnerCommand(targets)` | done; existing tests pass (default runner moon) |
| `scripts/go-generate.mjs`, `check-pr-title.mjs`, `clean-generated.mjs`, `generated-outputs.mjs`, `assert-file.mjs` | mention moon in skip lists or hints | `.turbo` is already skipped; hints say `moon run server:generate` → runner-neutral wording | cutover |
| `scripts/release.mjs` | none (its deps came from the task graph) | reads `RELEASE_SKIP_CONTAINER=1` as `--skip-container`: under turbo, arguments after `--` would put new cache keys on the whole release graph (turborepo.md, Commands) | done |

Why no `--affected` for the gate: turbo's `--affected` and `--filter=…[ref]`
select packages, following `package.json` edges only. The artifact edges
(server embeds the UIs, e2e suites run the binary) are task edges, so a
console-only change would skip the server's tests. Running the whole gate
costs nothing when the remote cache holds the unchanged results, which is
turbo's model; `ci-mode` still gates the expensive lanes from the task-level
set.

## CI and release workflows

### `ci.yml` → the draft `ci-turbo.yml`

| ci.yml step | turbo draft |
|---|---|
| `MOON_SUMMARY=detailed` | `--summarize` + `report-turbo-failures.mjs` |
| `node scripts/ci-mode.mjs <base>` | same, with `NEXTGEN_TASK_RUNNER=turbo` |
| `moon run server:check-generate-pruned` | `turbo run check-generate-pruned --filter=@zitadel/server`, on pushes to main too, so that its result is in the remote cache |
| `moon ci :lint :typecheck :build :test :check-adrs :check-moon-graph --downstream deep --include-relations` | `turbo run lint typecheck build test check-adrs check-moon-graph --continue=dependencies-successful --summarize` |
| `moon run server:test` | dropped: part of the gate (moon re-ran it because `moon ci` selects by affectedness) |
| `moon run server:test-postgres` / `test-sqlite` | `turbo run test-postgres --filter=@zitadel/server` / `test-sqlite` |
| `env -u CI -u GITHUB_ACTIONS moon run release:snapshot -- --skip-container` | `RELEASE_SKIP_CONTAINER=1 turbo run snapshot --filter=@zitadel/release` (no `env -u`; no arguments after `--`, see turborepo.md) |
| `moon exec e2e:all --ignore-ci-checks` (gate `e2e`): every lane below, in one step after the graph | the lanes as gated steps (rows below) |
| `e2e:journey-local` in the e2e step (`JOURNEY_*` env on the step) | `JOURNEY_CI=1 JOURNEY_MATRIX=… turbo run e2e-local --filter=@zitadel/e2e` |
| `testing:test-integration`, `e2e:demo-next-real` in the e2e step | `turbo run test:integration demo-next-real --filter=@zitadel/testing --filter=@zitadel/e2e` |
| `e2e:console-real` (embedded, platform) in the e2e step | `turbo run console-real --filter=@zitadel/e2e` (…) |
| `e2e:console-smoke`, `e2e:demo-next-mock`, `e2e:demo-nuxt-mock` in the e2e step | `turbo run console-smoke demo-next-mock demo-nuxt-mock --filter=@zitadel/e2e` (gate `suites_mock`) |
| `… moon run release:version` / `release:pack` | `turbo run version --filter=@zitadel/release` / `pack` |
| Depot's remote cache (implicit) | the remote-cache step, see below |

Fork pull requests keep running on GitHub-hosted runners without a cache
token.

### The other workflows

- **release-publish.yml:** `env -u CI moon run release:publish [-- --dry-run
  --recover-version X]` → `turbo run publish --filter=@zitadel/release -- …`.
  The job needs the remote-cache step only for speed; publishing itself is
  `cache: false` throughout. The arguments after `--` give the dependencies
  new cache keys (turborepo.md, Commands), so they rebuild; acceptable for a
  rare job, or the options become environment variables like the snapshot's.
- **spanner.yml:** `moon run server:test-spanner` → `turbo run test-spanner
  --filter=@zitadel/server`; `MOON_SUMMARY` goes.
- **sync-design-tokens.yml:** `moon run design-tokens:sync-export` / `sync` /
  `generate` / `test` → `turbo run sync:export --filter=@zitadel/design-tokens`
  etc. Its filtered install (`--filter @zitadel/design-tokens...`) keeps the
  root devDependencies, so `node_modules/.bin/turbo` is present.
- **deployment-checks.yml** (and the production variant, which calls it):
  done ahead of the cutover (decision 10). Each job runs its suite's turbo
  task (`turbo run e2e-deployment --filter=@zitadel/docs`, `turbo run
  console-deployment --filter=@zitadel/e2e`), the tasks the root's
  `pnpm check:cloud` runs by hand, and the step summary's "Reproduce" line
  names that command.
- **Vercel:** the repo-root `vercel.json` and `apps/cloud/build.sh` already
  build with turbo (pilot). `apps/console/vercel.json` belongs to the paused
  legacy `nextgen` project and still says `moon run console:build`; it is
  deleted or updated with that project.
- **Dockerfile:** the comment "Consumed by Moon release tasks" is text only.

## Documentation

45 Markdown files mention moon with about 245 `moon run` / `moon ci` /
`moon query` commands (counted on this branch). The rewrite is mechanical but
large, and it is the one piece that must land exactly at the cutover:

| where | what changes |
|---|---|
| `AGENTS.md` | the front-door table (`moon run workspace:doctor` → `pnpm run doctor`, `moon ci :lint :typecheck :build :test` → `turbo run lint typecheck build test`, `moon run <project>:<task>` → `turbo run <task> --filter=@zitadel/<project>`), "Project Shape" (moon owns the graph), "General Guidelines for working with Moon" → a turbo section, the ADR note about Nx |
| `CONTRIBUTING.md` | the four command tables, "What CI runs", the remote-cache paragraph (Depot → the chosen cache), "If you are new to Moon" (`turbo ls`, `turbo run --dry`), the release section |
| `.moon/AGENTS.md` | replaced by `docs/design/build/turborepo.md`: the config layout (root vs package files), the inputs rule (`$TURBO_DEFAULT$` + `$TURBO_ROOT$`), the dependency rules (no `^build`; the release chain), what the guard is for |
| `README.md`, `docs/runbooks/*.md`, `docs/design/**`, package `README.md`/`AGENTS.md` files (storybook, console, testing, api-mock, config, design-tokens, e2e, …), `apps/docs/content/**` (two pages) | command substitutions; the `env -u CI` incantations disappear |
| code comments and error hints | `internal/staticui/*/embed.go`, `cmd/server/mux_test.go`, the Playwright configs, `packages/testing/src/playwright-config.ts`, `packages/design-tokens/scripts/build.ts` banners (regenerate), `apps/cli/vitest.config.ts`, `vitest.shared.mjs`, … — each says "run `moon run x:build`"; they become runner-neutral (`pnpm run server`, `turbo run build --filter=…`) |
| ADRs | an ADR recording the switch (the repo rule: "Do not reintroduce Nx or GoReleaser without updating the ADRs first" applies to the task runner too) |

Command translation, for the rewrite and for muscle memory:

| moon | turbo |
|---|---|
| `moon run <project>:<task>` | `turbo run <task> --filter=@zitadel/<project>` |
| `moon run a:build b:build` | `turbo run build --filter=@zitadel/a --filter=@zitadel/b` |
| `moon ci :lint :typecheck :build :test` | `turbo run lint typecheck build test` |
| `moon run workspace:<task>` | `pnpm run <task>` (or `turbo run <task>` for the root tasks) |
| `moon run x:task -- --flag` | `turbo run task --filter=@zitadel/x -- --flag` (by hand; it re-keys every task in the run, see turborepo.md) |
| `moon projects` / `moon tasks` | `turbo ls` / `turbo run <task> --dry` |
| `moon query tasks --affected` | `turbo query '{ affectedTasks(base: "origin/main", tasks: […]) { items { name package { name } } } }'` |
| `MOON_SUMMARY=detailed` | `--summarize` |

## Remote cache

Two workable setups; the prototype's draft uses the first.

| | Vercel Remote Cache (OIDC) | Depot's turbo cache |
|---|---|---|
| Setup | a repository variable `TURBO_TEAM=zitadel`, `id-token: write` on the job, `vercel/setup-turborepo-remote-cache-action@v1.1.0` before the first `turbo` (with `policy:` set to the policy's ID only if more than one of the team's Turborepo policies matches the token: Vercel then refuses the exchange), `TURBO_API=https://vercel.com` on Depot runners (they inject Depot's `TURBO_API`), and a **Turborepo CLI OIDC policy** in the Vercel team settings (Build and Deployment → OIDC Policies for CLI Access → Turborepo CLI Policies, not a VCR policy; select GitHub, repository `zitadel/nextgen`; optionally restrict to a workflow or branch) | nothing on Depot runners: `TURBO_API`, `TURBO_TOKEN`, `TURBO_TEAM` are injected |
| Shared with | the cloud deployments (same team cache): a build CI did is a hit on Vercel and the reverse | CI only |
| Cost | free, within a fair-use limit of 1 TB/month of uploads on Pro; artifacts expire after 7 days | part of the Depot plan (as moon's cache today) |
| Forks | no token, local cache only | same |
| Write policy | `TURBO_CACHE=local:rw,remote:rw` on every run: pushes to main (which run the gate alone), runs by hand, and pull requests and the merge queue while they run it (decision 9), as moon's runs write Depot's cache; on Vercel, every build reads and writes, Vercel's default, production and previews in separate entries (see "Who may write to the cache") | same flags |

Recommendation: Vercel's, for the one shared cache and because the cloud
deployments use it already. Set up on 2026-10-12: the variable
`TURBO_TEAM=zitadel` and a Turborepo CLI policy for any workflow and branch of
`zitadel/nextgen`. The first exchanges after the policy was created
answered HTTP 400, one job got 400 and 200 for identical requests a third of
a second apart, and every exchange since has succeeded: a new policy
probably takes a while to apply everywhere. To check a run,
look for "Remote caching enabled" in turbo's output. If the policy is not
wanted, delete the `TURBO_API` line and the cache step from the workflow and
Depot's cache is used with no further setup.

### Who may write to the cache

A remote cache is a trust boundary: whoever can upload an artifact under a
task's hash decides what a later restore of that hash contains, and
`TURBO_CACHE=…remote:r` is a flag the uploading side sets for itself — code
on a branch can drop it. The rules that follow from that, as the prototype
sets them up:

- **Vercel builds** use the cache as Vercel sets it up (decision 3): every
  build, production and preview, reads and writes it with a token Vercel
  gives the build, and keeps no local cache. Turbo puts `VERCEL_TARGET_ENV`
  into every task's hash, so production builds restore only entries written
  under production's keys, previews only previews'. That separation is by
  key, not by permission: a branch's preview build runs the branch's code
  with a token that can write any entry, production's keys included, so
  anyone who can push a branch could plant one. Forks cannot: their pull
  requests get no build, and so no token, until a team member approves one
  (the project's Git fork protection). A planted entry is removed by
  clearing the team's cache (owners only).
- **GitHub Actions on pull requests** run the pull request's code, and the
  OIDC policy gives every run of this repository a token that can write
  (Vercel's docs describe no read-only policy; forks get no token).
  Restricting the policy to main would take the remote cache away from
  pull requests without narrowing who can write: anyone who can push a
  branch can write through that branch's Vercel preview build. So every run
  reads and writes (decision 8), as moon's CI runs do with Depot's cache: a
  pull request's later pushes restore what its earlier ones built, and the
  merge queue writes the results of the commit that lands on main. A
  read-only flag (`remote:r`) is the pull request's own choice, so it only
  ever kept honest branches out. Without `VERCEL_TARGET_ENV`, CI's entries
  are apart from the Vercel builds'. A poisoned artifact could still make a
  pull-request or merge-queue run pass for code that fails; the signatures
  below close that.
- **Later, to let only main's results reach production:** turbo's
  artifact signatures (`remoteCache.signature: true` with
  `TURBO_REMOTE_CACHE_SIGNATURE_KEY`). Production and trusted CI get the
  real key (a Vercel Production-only env var; a GitHub environment with a
  branch rule for main and the merge queue), previews and pull requests a
  different one, and restores reject artifacts signed with the wrong key.
  That separates the two populations server-side without a second cache, at
  the price of two more secrets.

This was raised by the security review of the first pull request and is
tracked there (zitadel/nextgen#1696).

## Rollout

### Phase 0: decide (this document)

The open decisions below, in particular whether to proceed at all; the pilot's
recommendation was to hedge and wait for a trigger.

### Phase 1: dual run (2 to 4 weeks)

Land the prototype with moon's configuration exactly as on main: no
`moon.yml` or `.moon/tasks` change. Moon's `test` runs `test:all`, which
bypasses the guard, and its Go `format`/`lint` keep their inline scripts.
Then port `check-release-graph.mjs`, `release-manifest`,
`check-typecheck-programs` and `doctor` behind the runner switch. Wire
`ci-turbo.yml` to `pull_request` and `merge_group` as a non-required check,
and to pushes to main, which run the gate alone to fill the remote cache; set
up the remote cache. Every PR then runs both. What to compare, weekly:
pass/fail per task (the two run summaries), what `ci-mode` gated under each
runner (its step summary line), and the job durations. Divergences are bugs
in the turbo configuration until proven otherwise. Exit criterion: two
consecutive weeks without a divergence that was turbo's fault.

Paused on 2026-10-14 (decision 9): pull requests and the merge queue no
longer run `ci-turbo`. They go back into the workflow for the two weeks.

### Phase 2: cutover (1 week)

- `ci.yml` takes the turbo steps under the same job name `full-pr` (the
  required check does not change its name), `ci-turbo.yml` is deleted;
  release-publish, spanner and sync-design-tokens follow.
- `NEXTGEN_TASK_RUNNER` defaults to turbo; `doctor` requires turbo.
- The documentation rewrite lands in the same PR train as the workflow change
  (the front doors must not point at a runner CI no longer exercises).
- The e2e lanes' environment values move from the scripts into the Playwright
  configs.
- Rollback: revert the workflow commits; moon's configuration is still
  complete and its remote cache still works, so a revert restores the previous
  CI exactly. The scripts keep the runner switch until phase 3.

### Phase 3: moon removal (2 days, after two quiet weeks on turbo)

Delete the `moon.yml` files, `.moon/`, `@moonrepo/cli` from the catalog and root
manifest, `check-moon-graph.mjs` and its root task, `report-moon-failures.mjs`
and its test, the `moon` branch of `task-runner.mjs` (keep the module: the
scripts still need "run these targets"), the `moonProject` fields, the
`.moon/cache` gitignore entry and the `.moon` skip-list entries. The `check-
typecheck-programs` input list drops `moon.yml`. Rollback after this phase is
a revert of one PR, which is why it waits.

## Effort

| work | days |
|---|---|
| Finish the prototype: release-graph check, manifest, typecheck check, doctor, their tests | 2 |
| Remote cache setup and the dual-run workflow wiring, first comparison runs | 1 |
| Parity period: weekly comparisons, fixing divergences (budget) | 2 |
| Cutover: ci.yml, release-publish, spanner, sync-design-tokens, env values into the Playwright configs, runner default | 2 |
| Documentation rewrite (45 files, code hints, the turbo doc, an ADR) | 3 |
| Moon removal | 1 |
| Total | **11** (10 to 13) |

The pilot's estimate was two to three weeks of CI and script work; the
prototype confirms it and moves most of the remaining effort to the docs and
the release graph.

## Risks

1. **The release graph.** Moon orders it with serial dependencies and the
   release builds' package edges; turbo's edges reproduce that order for
   `snapshot`, `pack` and `publish`, but the
   server-tests-versus-console-release-build overlap in `snapshot` is not
   fully ordered. Mitigation: run `snapshot` on the dual-run job every time
   (it is gated like today) and watch for embed mismatches; fix properly by
   separating release output directories (decision 5).
2. **Package-level selection.** Any future use of `turbo run --affected` or
   `--filter=…[ref]` for the gate silently drops the artifact edges. The
   `task-runner.mjs` comment and the turbo doc say so; `ci-mode` carries the
   task-level walk.
3. **Strict environment mode.** A task that reads a variable not listed on it
   sees nothing and may pass vacuously or fail obscurely (the e2e lanes and
   the Go database lanes list theirs; something will be missed). Mitigation:
   the parity period, and `--env-mode=loose` as the emergency switch.
4. **Windows.** The e2e scripts set variables with POSIX syntax. Those lanes
   never ran on Windows, but the scripts now say so. Fix with the move into
   the Playwright configs.
5. **The published `@zitadel/server` manifest** carries 13 `scripts` that
   only make sense in the repository (decision 4).
6. **`pnpm test` in `components` and `api-mock`** now runs the browser lane
   too; the fast lane is `pnpm test:unit`. A note in the package READMEs.
7. **Two runners for weeks.** Every task change touches `moon.yml` and
   `turbo.json`; the parity comparison catches drift, but reviewers should
   ask for both.
8. **Turbo's own maintenance** is the same one-main-developer shape as moon's
   (pilot, Long-term support); the difference is who pays. The configuration
   is small enough to move again.

## Decisions (Florian, 2026-10-12)

1. **Go ahead.** Phase 1 starts with the prototype branch as a pull request;
   the pilot's triggers (moon unmaintained for three months, a blocking bug,
   turbo's Go support accepting a root module) are no longer the gate.
2. **Remote cache: Vercel over OIDC.** The repository variable `TURBO_TEAM`
   and the "Turborepo CLI" OIDC policy (any workflow and branch of
   `zitadel/nextgen`) are set up and `ci-turbo` gets a token (see "Remote
   cache"). When the exchange fails, `ci-turbo` runs with the local cache
   only.
3. **Vercel builds use the remote cache as Vercel sets it up** (2026-10-13,
   replacing "production never restores from the cache"). Every build,
   production and preview, reads and writes the team's remote cache, and
   turbo's default `VERCEL_TARGET_ENV` hash keeps production's entries
   apart from the previews'. Writing takes the team's token, which forks do
   not get (see "Who may write to the cache"). The cloud's builds set no
   cache policy of their own.
4. **The Go tasks' scripts stay in `apps/server/package.json`** (published,
   inert).
5. **Release builds keep rewriting `dist/` in place**, ordered by the edge
   chain; separate output directories stay a later cleanup.
6. **`test` is the full lane, `test:unit` the fast one** in `components` and
   `api-mock`.
7. **Dual run as proposed:** two to four weeks, exit after two consecutive
   weeks without a divergence that was turbo's fault.
8. **Every CI run writes the cache** (2026-10-14, replacing "Main creates
   the cache"). `ci-turbo` reads and writes the remote cache on pull
   requests, the merge queue and pushes to main, as moon's runs write
   Depot's. While only main wrote, a pull request restored main's results
   but never its own earlier pushes' (pull requests averaged almost five CI
   runs each). Replayed over the 143 green pull-request runs of 2026-10-14,
   the gate restores 57 of its 119 tasks at the median instead of none. The
   price is the upload: about 93 MB a run, some 0.5 TB a month at the
   current number of pull-request runs, against the 1 TB fair-use limit of
   Vercel's cache on Pro. The read-only flag kept honest branches out of the
   cache and no one else (see "Who may write to the cache").
9. **Pull requests stop running `ci-turbo`** (2026-10-14). It runs on
   pushes to main (the gate, so the cache keeps main's results) and by
   hand, `gh workflow run ci-turbo.yml --ref <branch>`: every lane on main,
   a pull request's lanes on a branch. In the 21.5 hours before, `ci-turbo`
   took 3,514 runner minutes and ci.yml 3,147 on the same runners; its
   pushes to main took 103 of them. The merge queue never waited for it:
   of the last 47 merged entries, 31 merged while their `ci-turbo` run was
   still going and two after it had failed, each about half a minute after
   `ci / full-pr` passed. On pull requests the two disagreed on 21 of 287
   commits (`ci-turbo` alone failed 8, ci.yml alone 13), the divergences
   the parity period is there to explain. That period is paused: the two
   weeks of decision 7 count from when `pull_request` and `merge_group`
   are back in the workflow.
10. **The deployment checks run turbo ahead of the cutover** (2026-10-14).
    People run them by hand to see whether the cloud works, so the root's
    `pnpm check:cloud` runs every deployment suite against the deployment
    `CLOUD_URL` names, and deployment-checks.yml runs the same tasks, one
    job each. `moon run` stops the other suites at the first failure (with
    the docs' suite failing, it ended the console's after 7 ms); turbo's
    `--continue` reports every suite. The suites build and cache nothing,
    so the runner changes nothing else there: moon took about 1.5 s of a
    one-minute job.
