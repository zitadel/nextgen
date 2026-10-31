# A precise task graph for Turborepo, selected by turbo

> **Status:** proposed and implemented, 2026-10-27. Turborepo 2.11.7, moon
> 2.6.1. Builds on [turborepo.md](turborepo.md) (the configuration) and
> [turborepo-migration.md](turborepo-migration.md) (the switch). The rules
> that came out of it live in turborepo.md; this note keeps the evidence, the
> reasoning and the measurements.

## Short answer

Docs-only and test-only changes ran large parts of the graph for three
reasons:

1. **Folder-wide inputs, no early cutoff.** Every task hashed its whole
   package, and a dependency's hash is part of every dependent's. One line in
   `packages/components/README.md`, or in one of its spec files, selected 105
   moon tasks and re-ran 58 under turbo: every SDK, the console, the server's
   build and tests, the e2e lanes.
2. **The merge queue diffed against `origin/main`.** A queued entry re-tested
   every entry ahead of it. Over 61 queue runs that was 15 minutes of e2e,
   database and snapshot steps, nearly all on small entries: #2404 (docs
   site) spent 312 s of its 490 s job on lanes only the entries ahead needed,
   #2410 (changelog Markdown) 230 s of 281 s.
3. **Turbo's `--affected` followed `package.json` edges**, so the port could
   not use it: it ran the whole gate on every change, and a script of ours
   (`scripts/ci-mode.mjs`) walked turbo's graph to decide the lanes.

The design: inputs by file class; turbo's own task-level `--affected` as the
one selector, for the gate, for every lane and, through `turbo query
affected`, for the setup the lanes need; the merge queue's own base; and
every night a run of every task without the cache. No script of ours models
turbo's graph a second time. Building it also found tasks in both runners
that read files their inputs did not name; they are
[listed](#reads-the-inputs-missed) and fixed.

| change, gate run locally on a warm cache | moon | turbo before | turbo after |
|---|---|---|---|
| `docs/runbooks/cloud.md` | 0.3 s, none | 7.5 s, 4 tasks | 1.1 s, 1 task |
| `packages/components/README.md` | 89 s, 57 tasks | 108 s, 58 tasks | 0.2 s, none |
| a components spec file | 95 s, 57 tasks | 92 s, 59 tasks | 22 s, 5 tasks |
| an sdk-react spec file | 51 s, 23 tasks | 47 s, 28 tasks | 3.0 s, 5 tasks |
| a components source file | 87 s, 57 tasks | 72 s, 59 tasks | 68 s, 58 tasks |

Over the last 150 merged pull requests, ci-turbo.yml would have run 796 e2e
lane steps where ci.yml ran 1,089: ci.yml runs every lane once one is
affected, turbo the lanes a change reaches.

## Why docs-only changes ran tests

**Inputs.** Moon's rule is to use a project's whole folder as its inputs,
and the turbo port copied it. A package's `build` therefore hashed its
README, AGENTS.md, CHANGELOG.md and every test file. Turbo (like moon) puts
a dependency's hash into each dependent's hash and has no early cutoff: a
rebuilt `dist` that is byte-identical still re-runs everything downstream.
Selected tasks for one-line edits, before the change:

| edit | moon | turbo |
|---|---|---|
| `packages/components/README.md` | 105 | 96 |
| a components spec file | 105 | 97 |
| `packages/sdk-react/README.md` | 56 | 62 |
| `apps/console/AGENTS.md` | 28 | 23 |
| `e2e/console/README.md` | 9 | 8 |

**The merge queue.** `ci.yml` passed `github.event.pull_request.base.sha ||
'origin/main'` to ci-mode, and `moon ci` had no base at all ("Base revision:
N/A"). In a merge group the first is empty, so both compared the group with
`origin/main`, which does not have the entries queued ahead yet: their files
were part of every later group's diff. A docs-only entry inherited their e2e
suite, database lanes and release snapshot, and an entry behind one that
touched `apps/website/moon.yml` or `scripts/` was forced into a full run
(runs 40595016819, 40578336520).

**Turbo's selection.** Without `futureFlags.affectedUsingTaskInputs`,
`turbo run --affected` selects packages along `package.json` edges and would
skip the server's tests on a console change. The port ran the whole gate
instead and relied on the cache, which still hashes 130 tasks and replays
every hit, and re-ran whatever the folder-wide inputs invalidated. Its lanes
ran when ci-mode's walk over `turbo run --dry=json` counted them affected.

## Principles

1. **Sound before fast.** A task re-runs when a file it reads changes. A
   change no task's inputs name runs nothing, so every file a task reads is
   one of its inputs, and a nightly run without the cache checks what that
   rule cannot.
2. **Hash what a task reads.** Inputs follow file classes, not folders, and
   leave out what other tasks write.
3. **One selector, turbo's.** Turbo matches changed files against the same
   `inputs` for the cache key, `turbo run --affected` and `turbo query
   affected`, so the gate, the lanes, their setup and the cache cannot
   disagree.
4. **Turbo's features, not ours.** `--affected`, `turbo query affected
   --exit-code`, `TURBO_FORCE` and `turbo boundaries` instead of scripts
   that model the graph again, each with its own exceptions to maintain.

## Design

### 1. Inputs by file class

The shared shapes in the root `turbo.json` start from `$TURBO_DEFAULT$` and
leave out what they cannot read:

| class | globs (package-relative) | left out of |
|---|---|---|
| docs | `**/README.md`, `**/AGENTS.md`, `**/CLAUDE.md`, `**/CHANGELOG.md`, `**/LICENSE`, `**/LICENSE.md`, `docs/**`, `skills/**/*.md` | `typecheck`, `build`, `generate`, `test` (`lint` leaves out all Markdown: Biome processes none) |
| tests | `**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`, `**/__tests__/**`, `**/__snapshots__/**`, `tests/**`, `test/**`, `**/vitest.config.*`, `**/vitest.*.config.*` | `build`, `generate` |

A negation wins over any inclusion wherever it stands in the list, and a
package-relative one never matches a `$TURBO_ROOT$/…` path. So a task that
reads a file of an excluded class replaces `inputs` instead of extending
them: `cli#test` keeps `README.md` and `skills/`, which its docs test reads.
Files that only look like docs are outside the class by name:
`packages/config/defaults/README-*.md` ship and are read at run time,
`apps/docs/content/**/*.mdx` and `apps/website/changelog/*.md` are content.
Release tasks keep every file, since the tarballs ship the docs.

Two more inputs fixes in the same spirit: `install-browsers` (never cached)
hashed its whole package, so a README edit made every browser test
affected; it now counts only `package.json`. Generation tasks (api's
`generate`, config's `sync-schemas`) feed every build, so they take the
build's exclusions.

Explicit globs match ignored files too (the console's `.env*` relies on it).
`//#lint`'s `**/*.{js,ts,…}` hashed 101,000 files in `node_modules` and
50,000 build outputs on every turbo run, and the Go tasks'
`$TURBO_ROOT$/**/*.go` would, in the main checkout, hash every checkout under
`.claude/worktrees/`, so any worktree's edit missed the main checkout's
server cache. On Vercel it would hash the Go toolchain and module cache,
which its builds keep under `.vercel/`. Repository-wide globs now name the
ignored trees they skip.

Turbo hashes a run's inputs before the run starts. A task whose inputs match
files another task of the run writes therefore hashes them without that
run's output, and with it on the next run, which misses the cache. Three did:
the server's build listed the console's dist it embeds (the `console#build`
edge already hashes it), `//#lint` matched Next's `next-env.d.ts` and
Vitest's `.vitest/` caches (both ignored, and Biome reads neither), and
`sdk-core#test` matched the demo apps' `.next/` and `.nuxt/` output (its
contract test skips them). A second run of the whole gate on an unchanged
tree now runs only the four never-cached `install-browsers` tasks.

### 2. Reads outside a package are inputs

A task that reads a file outside its package lists it, as before. Building
this change found tasks in both runners that did not, listed
[below](#reads-the-inputs-missed). The CLI's tests of root scripts
(`apps/cli/tests/unit/scripts/`) are the largest case: they import 19
scripts and read what the release manifest is made from. They belong in the
root `//#test`; until they move, `cli#test` lists what they read.

### 3. One selector

- `futureFlags.affectedUsingTaskInputs` makes `turbo run --affected` and
  `turbo query affected` match changed files against each task's `inputs`,
  deleted and renamed files included, and follow task edges, including the
  artifact edges that are no `package.json` dependency (the server embeds
  the console).
- Every `turbo run` in `ci-turbo.yml` takes `--affected` from
  `TURBO_SCM_BASE`: a merge group's `base_sha`, a pull request's base, or the
  commit a push to main replaced. The e2e lanes but the journey's run in
  one `turbo run --affected` in a job of their own, side by side as moon's
  `e2e:all` runs them; the two demo-next lanes, which both serve the demo on
  :3002, take turns through their `demo-next-app` mutex. The journey runs
  after the release snapshot in a job of its own, and the database lanes in
  the gate's run.
- Each job first asks `turbo query affected --tasks … --exit-code` about its
  own tasks, which exits 1 when one of the named tasks is affected, 0 when
  none is and 2 on an error, which counts as affected; the job skips its
  setup and its runs when none is. The journey's job thereby gates the
  release snapshot and the registry cache, and Playwright's browsers come
  through each lane's `install-browsers`. The snapshot runs without
  `--affected`: the journey needs it whenever it runs, and a change to the
  journey's own specs reaches no release task.
- The journey runs its framework matrix in full when `@zitadel/e2e#journey`
  (the by-hand lane, which reads the journey's files and depends on the CLI,
  the test kit and the mock OIDC provider) or an SDK's `build` is affected,
  and one framework otherwise, ci-mode's rule from turbo's answer.
  `--packages` takes exact names, so the step lists `packages/sdk-*`.
- Turbo's `journey-local` also depends on `server#build`. The journey runs
  the server from the snapshot's tarballs, built in a step before it and
  outside its graph, so without the edge a Go change selected every server
  lane but the journey. Moon runs the journey with every other lane through
  `e2e:all`, and keeps its graph as it was.
- A version PR is its `changeset-release/*` branch: it runs the release's
  checks instead of the gate, as ci.yml's version-only mode does. Its
  merge-queue entry has the queue's branch name and runs like any other.
- A push to main runs the gate alone, from the commit it replaced: its merge
  group ran the same tasks, so they come from the cache, and the remote cache
  holds main's results for the branches cut from it.
- Merge groups compare with `merge_group.base_sha`, the commit the group is
  built on. The entries ahead are tested in their own groups, and an entry
  lands only after them, so a task the entry cannot reach keeps the result
  the group ahead verified. Pull requests keep `pull_request.base.sha`; both
  runners get the same base (`MOON_BASE` and ci-mode's argument in ci.yml,
  `TURBO_SCM_BASE` in ci-turbo.yml).

### 4. What checks the inputs

Nothing before a merge: a file a task reads but does not list neither
selects the task nor misses its cache. Every night, and by hand with
`force`, ci-turbo.yml runs every job with `TURBO_FORCE` and without
`--affected`, so every cacheable task runs without reading the cache and
writes its result, and every lane runs on prerequisites its own job built.
A failure there, on a main whose merge groups passed, is a read the inputs
miss or a change no task reads (a workflow) that broke something: it shows
a day late, not never.

Two checks of our own found the reads below and were dropped again: a
static one that scanned each task's code for the files it opens (imports,
fs and path calls, `//go:embed` patterns) and compared them with the
hashed inputs, and a nightly run in a scratch tree without the files no
task claims. Each modelled turbo's graph a second time, with its own
exceptions to keep in step with the graph. `turbo boundaries` keeps each
package's imports inside the package graph (zitadel/nextgen#2423).

### 5. What stays in moon

Moon keeps folder-wide inputs: its rule is never to list a package's own
files, and it goes at the cutover. It gets the input fixes and the
merge-queue base, which make today's required check correct and faster in
the queue. ci-mode still selects ci.yml's lanes; ci-turbo.yml does not use
it.

## Reads the inputs missed

Inputs neither runner declared, fixed in both (`turbo.json`, `moon.yml`):

| task | reads |
|---|---|
| `cli#test` | the 19 root and journey scripts its script tests import; `.changeset/config.json`, `.moon/workspace.yml`, every package's `package.json` and `moon.yml`; `.github/semantic.yml`; `Dockerfile`; `docs/design/idp/schemas/**` |
| `cli#typecheck` | the root scripts its tests import |
| `config#test` | `docs/design/idp/**` (ci-mode treated `docs/` as inert, so a change there alone skipped everything) and every Markdown file under `docs/` those docs may link to, which it checks exist; the orchestrator's `default.liquid`; three `internal/domain/flow_*.go` files |
| `api-mock#test` | `internal/httputil/testdata/redirect_targets.json` |
| `e2e#test`, `e2e#typecheck`, the journey lanes | the root release scripts, the CLI's skill, the mock OIDC users, the built-in schemas |
| `//#test` | `scripts/server-build.mjs` (through the release scripts it tests), `packages/config/defaults/**` |
| every lint | `biome-plugins/*.grit`, the rules `biome.json` loads |

Turbo-only drift from moon or from the port:

| task | reads |
|---|---|
| every Go server task | `internal/errorpage/*` and the design tokens' `tokens.css`, both `//go:embed`ed: moon's file group had them, the port did not, so an error-page edit restored a stale binary |
| `//#test` | `packages/config/src/defaults.ts` |
| 12 tasks whose command runs `scripts/task-guard.mjs` | the guard |
| `server#test-postgres`, `server#test-sqlite` | `vercel.json`, `apps/cloud/build.sh` (the cloud launcher's tests, which `./...` includes) |
| `//#build-local-image`, `server#clean-generated`, the release tasks | the scripts their scripts import |
| `docs#typecheck` | 1,368 ignored generated files, which `api#generate` already covers |

## Benchmarks

Apple M5 Max (18 cores), warm Go and pnpm caches, local turbo cache only.
"Turbo before" is main's configuration with ci-mode's walk over a dry run.
Its numbers, and moon's wall clock, were measured on the first revision of
this change; moon's selection and everything under "turbo after" on this
one.

### Selection, 21 change classes

Tasks each selector marks affected (moon's query as ci-mode asks it, turbo's
without the prerequisites it adds; gate and non-gate tasks together), and
the lanes CI runs for the change out of twelve: the generated-files check,
the two database lanes and nine e2e lanes, the journey and the kit's
real-instance suite among them.

| change | moon | turbo before | turbo after | ci.yml lanes | ci-turbo lanes | what turbo after still selects |
|---|---|---|---|---|---|---|
| `docs/adrs/*.md` | 2 | 1 | 2 | 0 | 0 | `check-adrs`, `config#test` (it checks that the docs' links resolve) |
| `docs/runbooks/*.md` | 1 | 0 | 1 | 0 | 0 | `config#test` |
| root `AGENTS.md` | 0 | 0 | 0 | 0 | 0 | |
| `packages/components/README.md` | 105 | 96 | 16 | 12 | 0 | release packaging only |
| `apps/console/AGENTS.md` | 28 | 23 | 4 | 12 | 0 | release packaging only |
| `packages/sdk-react/README.md` | 56 | 62 | 10 | 12 | 0 | `sdk-core#test` (reads the SDK READMEs), release packaging |
| an SDK's `SKILL.md` | 12 | 11 | 7 | 9 | 0 | `sdk-core#test`, release packaging |
| `apps/cli/skills/zitadel-cli/SKILL.md` | 23 | 36 | 30 | 9 | 1 | `cli#test` and `e2e#test` (read it), the journey, release packaging |
| `e2e/console/README.md` | 9 | 8 | 0 | 9 | 0 | |
| a components spec file | 105 | 97 | 20 | 12 | 0 | its lint, typecheck, test; `//#lint`; release packaging |
| an sdk-react spec file | 56 | 63 | 14 | 12 | 0 | its checks, `sdk-core#test`, `//#lint`, release packaging |
| a console spec file | 28 | 24 | 8 | 12 | 0 | its checks, `//#lint`, release packaging |
| a components source file | 105 | 97 | 97 | 12 | 11 | everything downstream |
| a console source file | 28 | 24 | 25 | 12 | 9 | everything downstream, the journey through `server#build` |
| a Go source file | 24 | 23 | 24 | 12 | 9 | the server's tasks, the lanes that run the server |
| an sdk-vue source file | 11 | | 12 | 9 | 1 | its checks, the journey |
| a journey spec | 6 | | 7 | 9 | 1 | the journey's checks and lanes |
| an api-mock source file | 39 | | 52 | 9 | 2 | its checks and dependents, the two mock demo lanes, release packaging |
| `scripts/check-pr-title.mjs` | 9 | 1 | 34 | 12 (forced) | 1 | `cli#test` and what depends on it, the journey (both read root scripts) |
| `tsconfig.base.json` | 183 | 188 | 193 | 12 (forced) | 12 | everything (a global dependency) |
| `.github/workflows/ci.yml` | 0 | | 0 | 12 (forced) | 0 | nothing: no task reads it |

"Forced" is ci-mode's fail-open rule for files no moon task claims. Release
packaging is the release builds and `snapshot`, which only the release
flows and the journey's snapshot step run.

### Replay of 150 merged pull requests

Each of the last 150 merged pull requests (#2157 to #2419), its files
touched in today's tree and committed on top, then asked of moon and ci-mode
as ci.yml asks them and of turbo as ci-turbo.yml does. 144 ran in full mode;
four were version PRs, two touched no file left in today's tree, and two
file lists stop at GitHub's 100.

Gate tasks (`lint`, `typecheck`, `build`, `test`, `check-*`) per full-mode
pull request:

| selector | median | mean | pull requests with none |
|---|---|---|---|
| moon | 8 | 32.0 | 1 |
| turbo after | 8 | 28.5 | 2 |

Turbo after selects one more in 68, always `//#lint` (moon's root lint has no
inputs and is never selected), five more in #2312, which edits the server's
`turbo.json`, and fewer in 14: docs, test and lockfile edits that moon's
folder-wide and implicit inputs spread.

Lanes:

| | ci.yml | ci-turbo.yml |
|---|---|---|
| lane runs | 1,386 | 1,021 |
| of them e2e lanes | 1,089 | 796 |
| pull requests with the database lanes | 99 | 85 |
| pull requests with the journey (full matrix) | 121 (87) | 112 (78) |
| pull requests with no lane | 23 | 30 |

ci-turbo.yml runs a lane ci.yml does not in one pull request, #2312. It
skips a lane ci.yml runs in 91. In 21 of them ci-mode forced a full run for
a workflow, root script, manifest or `moon.yml` edit, which turbo follows
only as far as a task reads the file (in four, to no lane at all). In the
rest ci.yml runs every e2e lane once one is affected, or moon's folder-wide
inputs carry a test edit into the builds: #2189 and #2191 edit only SDK
specs and a Vitest config, and run every lane under moon.

### Wall clock

Each runner: one cold run of the gate (its own cache empty), then each
change committed on top and run as CI would: moon's affected gate tasks
(`moon exec` of what `moon query tasks --affected --downstream deep`
selects), turbo before's whole gate, turbo after's `--affected` gate.

| change | moon | turbo before | turbo after |
|---|---|---|---|
| cold, whole gate | 113.7 s (131 tasks) | 90.1 s (130) | 97.3 s (133) |
| no change | 0.3 s (0) | 6.4 s (6) | 0.2 s (0) |
| `docs/runbooks/cloud.md` | 0.3 s (0) | 7.5 s (4) | 1.1 s (1) |
| `packages/components/README.md` | 89.2 s (57) | 108.2 s (58) | 0.2 s (0) |
| a components spec file | 94.6 s (57) | 91.8 s (59) | 21.8 s (5) |
| an sdk-react spec file | 51.4 s (23) | 46.5 s (28) | 3.0 s (5) |
| a console source file | 15.2 s (8) | 17.0 s (14) | 13.2 s (9) |
| a Go source file | 19.5 s (10) | 22.8 s (16) | 18.9 s (10) |
| a components source file | 86.8 s (57) | 72.2 s (59) | 67.5 s (58) |

Tasks in parentheses are the ones that ran; the rest of each gate came from
the cache. The cold run of this revision ran on a busier machine (the first
revision's took 86.4 s). Turbo before re-runs the never-cached
`install-browsers` tasks on every change. In the first revision's runs,
`cli:test`'s proxy tests against a remote HTTPS server and `e2e:test`'s port
tests failed under load in some runs of both runners; the times include
those runs.

Overheads: a dry run of the gate took 3.6–5.5 s before, nearly all of it
`//#lint` hashing ignored files, and 0.18–0.20 s after. The setup step's
three `turbo query affected --exit-code` calls take 0.4 s together.

## Limits

- A change no task's inputs name runs nothing in ci-turbo.yml: a workflow
  edit, a new runner image. ci-mode forces a full ci.yml run for the files it
  knows no task claims; turbo has no such list, and the nightly run is the
  check, a day late.
- `--affected` trusts main: every commit there passed its merge group, and
  the nightly run checks main without the cache.
- `turbo run --affected` fails, rather than counting every file changed,
  when its base does not resolve. The bases CI passes are always in the
  full-depth checkout. Without a base, as on a run by hand, turbo compares
  with a local `main`; a branch's checkout has none, so turbo counts every
  file as changed and runs everything through the cache.
- The nightly run proves that every task passes on main; it does not compare
  outputs. A build that reads an unlisted file only to vary its output would
  pass.
- Turbo still has no early cutoff. A source edit that leaves a build's output
  unchanged still re-runs its dependents; the file classes only keep edits
  that cannot change the output from starting the cascade.

## Rollout

- With this change: ci-turbo.yml runs on pull requests, the merge queue,
  pushes to main and nightly, still not required; moon's gate gets the input
  fixes and the merge-queue base.
- The two weeks of the dual run's comparison count from here (migration
  plan, decision 9).
- Follow-up: move `apps/cli/tests/unit/scripts/` to the root `//#test`, which
  shrinks `cli#test`'s inputs to its own package.
