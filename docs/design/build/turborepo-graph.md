# A precise, checked task graph for Turborepo

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
   not use it and ran the whole gate on every change.

The design: inputs by file class; one selector (turbo's own task-level
`--affected`) for the cache key, the gate and the CI lanes; the merge queue's
own base; and checks that keep the inputs complete, statically on every pull
request and without a cache every night. Measured on 23 change classes, a
docs-only change runs nothing, a package README edit nothing but release
packaging, a test edit that package's own checks; source changes select what
they did before. Building the checks also found tasks in both runners that
read files their inputs did not name; they are [listed](#what-the-checks-found)
and fixed.

| change, gate run locally on a warm cache | moon | turbo before | turbo after |
|---|---|---|---|
| `docs/runbooks/cloud.md` | 0.3 s, none | 7.5 s, 4 tasks | 0.2 s, none |
| `packages/components/README.md` | 89 s, 57 tasks | 108 s, 58 tasks | 0.2 s, none |
| a components spec file | 95 s, 57 tasks | 92 s, 59 tasks | 21 s, 5 tasks |
| an sdk-react spec file | 51 s, 23 tasks | 47 s, 28 tasks | 2.9 s, 5 tasks |
| a components source file | 87 s, 57 tasks | 72 s, 59 tasks | 65 s, 58 tasks |

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
every hit, and re-ran whatever the folder-wide inputs invalidated.

## Principles

1. **Sound before fast.** A task re-runs when a file it reads changes. Every
   exclusion is checked mechanically; what the checks cannot see runs.
2. **Hash what a task reads.** Inputs follow file classes, not folders.
3. **One selector.** Turbo matches changed files against the same `inputs`
   for the cache key, `turbo run --affected` and `turbo query affected`, so
   the gate, the lane gates and the cache cannot disagree.
4. **Check the graph, not the reviewer.** Static rules run in the gate; a
   nightly run without the cache and without unclaimed files is the ground
   truth.
5. **Fail open.** A changed file no task claims, an empty diff or a failed
   query runs everything, as ci-mode always did.

## Design

### 1. Inputs by file class

The shared shapes in the root `turbo.json` start from `$TURBO_DEFAULT$` and
leave out what they cannot read:

| class | globs (package-relative) | left out of |
|---|---|---|
| docs | `**/README.md`, `**/AGENTS.md`, `**/CLAUDE.md`, `**/CHANGELOG.md`, `**/LICENSE`, `**/LICENSE.md`, `docs/**`, `skills/**/*.md` | `typecheck`, `build`, `generate`, `test` (`lint` leaves out all Markdown: Biome processes none) |
| tests | `**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`, `**/__tests__/**`, `**/__snapshots__/**`, `tests/**`, `test/**`, `**/vitest.config.*`, `**/vitest.*.config.*` | `build`, `generate` |

A negation wins over any inclusion wherever it stands in the list, and it
matches package-relative paths only (`$TURBO_ROOT$/…` paths never). So a
task that reads a file of an excluded class replaces `inputs` instead of
extending them: `cli#test` keeps `README.md` and `skills/`, which its docs
test reads. Files that only look like docs are outside the class by name:
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
server cache. Repository-wide globs now name the ignored trees they skip.

### 2. Reads outside a package are inputs

A task that reads a file outside its package lists it, as before; the checks
below now find the ones that do not. The CLI's tests of root scripts
(`apps/cli/tests/unit/scripts/`) are the largest case: they import 19 scripts
and read what the release manifest is made from. They belong in the root
`//#test`; until they move, `cli#test` lists what they read.

### 3. One selector

- `futureFlags.affectedUsingTaskInputs` makes `turbo run --affected` and
  `turbo query affected` match changed files against each task's `inputs` and
  follow task edges, including the artifact edges that are no `package.json`
  dependency (the server embeds the console).
- ci-mode asks `turbo query affected` instead of walking a
  `turbo run --dry=json`. Turbo's glob matching sees deleted and renamed
  files, which the walk over the current tree's file list missed. Tasks it
  lists "required by an affected task" are prerequisites, not affected.
- ci-mode reports `gate=affected` when no fail-open reason applies. The gate
  then runs with `--affected` from the same base; otherwise, and on every push
  to main, the whole gate runs, which fills the remote cache with main's
  results and is the first check of anything the selection missed.
- Merge groups compare with `merge_group.base_sha`, the commit the group is
  built on. The entries ahead are tested in their own groups, and an entry
  lands only after them, so a task the entry cannot reach keeps the result
  the group ahead verified. Pull requests keep `pull_request.base.sha`; both
  runners get the same base (`MOON_BASE`, `TURBO_SCM_BASE`).

### 4. Checks

**On every pull request:** `//#check-turbo-graph`
(`scripts/check-turbo-graph.mjs`, about 1 s, in both runners' gates). From
the resolved graph (`turbo run … --dry=json`) it fails on

1. a repository file a task's code reads that is not part of its result:
   named by an import, an fs or path call (`join("..", "x.json")` included),
   a `//go:embed` pattern or the task's command, and hashed neither by the
   task, a task it depends on nor the global dependencies, nor written by a
   dependency. What a task runs depends on its kind: Biome and gofmt read
   nothing a file names, a typecheck resolves imports, a build also runs its
   configs and scripts but not its tests, a test runs its tests, configs and
   what they import. Go files count for the tasks of their module;
2. a declared workspace package a task does not build first (a package's
   `build` for `dependencies`, its `typecheck` and `test` also for
   `devDependencies`), the rule moon's `check-moon-graph` enforced for moon;
3. an ignored file a task hashes.

Every exception names its reason in the script (17 edges, 8 references).
Re-removing four of the fixes below makes it fail with the read that broke.

**Nightly:** `turbo-canary.yml` runs `scripts/check-turbo-hermetic.mjs` on
main. In a scratch worktree it deletes every tracked file no task claims,
builds everything without the test and docs files the builds leave out, then
runs the whole gate without the cache. A task that passes there cannot depend
on a file outside its inputs; one that fails names the read the static check
missed. Its first local run found two: `config#test` checks that the IdP
docs' relative links exist (paths that come from Markdown, not code), and
this design's first test glob, `**/*.spec.*`, also matched
`tsconfig.spec.json`, which `api#generate` resolves through tsx. With both
fixed, every build (39 tasks) passes without the 634 test and docs files the
builds leave out, and the whole gate (130 tasks) without the 47 files no task
claims: 54 s and 103 s here.

### 5. What stays in moon

Moon keeps folder-wide inputs: its rule is never to list a package's own
files, and it goes at the cutover. It gets the input fixes, the merge-queue
base and `workspace:check-turbo-graph`, which make today's required check
correct, faster in the queue, and the guard of the turbo graph during the
dual run.

## What the checks found

Inputs neither runner declared, fixed in both (`turbo.json`, `moon.yml`):

| task | reads |
|---|---|
| `cli#test` | the 19 root and journey scripts its script tests import; `.changeset/config.json`, `.moon/workspace.yml`, every package's `package.json` and `moon.yml`; `.github/semantic.yml`; `Dockerfile`; `docs/design/idp/schemas/**` |
| `cli#typecheck` | the root scripts its tests import |
| `config#test` | `docs/design/idp/**` (ci-mode treated `docs/` as inert, so a change there alone skipped everything) and every file those docs link to, which it checks exist (the hermetic run found these); the orchestrator's `default.liquid`; three `internal/domain/flow_*.go` files |
| `api-mock#test` | `internal/httputil/testdata/redirect_targets.json` |
| `e2e#test`, `e2e#typecheck`, the journey lanes | the root release scripts, the CLI's skill, the mock OIDC users, the built-in schemas |
| `//#test` | `scripts/task-runner.mjs`, `scripts/server-build.mjs`, `packages/config/defaults/**` |
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

### Selection, 23 change classes

Tasks each selector marks affected (ci-mode's view; gate and non-gate tasks
together):

| change | moon | turbo before | turbo after | what turbo after still selects |
|---|---|---|---|---|
| `docs/adrs/*.md` | 1 | 1 | 1 | `check-adrs` |
| `docs/runbooks/*.md`, root `AGENTS.md` | 0 | 0 | 0 | |
| `packages/components/README.md` | 105 | 96 | 16 | release packaging only |
| `apps/console/AGENTS.md` | 28 | 23 | 4 | release packaging only |
| `packages/sdk-react/README.md` | 56 | 62 | 10 | `sdk-core#test` (reads the SDK READMEs), release packaging |
| an SDK's `SKILL.md` | 11 | 11 | 7 | `sdk-core#test`, release packaging |
| `apps/cli/skills/zitadel-cli/SKILL.md` | 22 | 36 | 29 | `cli#test` (reads it), release packaging |
| `e2e/console/README.md` | 9 | 8 | 0 | |
| a components spec file | 105 | 97 | 20 | its lint, typecheck, test; release packaging |
| an sdk-react spec file | 56 | 63 | 14 | its checks, `sdk-core#test`, release packaging |
| a console spec file | 28 | 24 | 8 | its checks, release packaging |
| a components source file | 105 | 97 | 96 | unchanged: everything downstream |
| a console source file | 28 | 24 | 24 | unchanged |
| a Go source file | 24 | 23 | 23 | unchanged |
| `scripts/check-pr-title.mjs` | 0 | 1 | 34 | `cli#test` and what depends on it: the script's tests, which nothing ran |
| `tsconfig.base.json` | 183 | 188 | 188 | everything (a global dependency) |

### Replay of 150 merged pull requests

Each PR's file list, applied to today's tree. Gate tasks (`lint`,
`typecheck`, `build`, `test`, `check-*`) per full-mode PR (145):

| selector | median | mean | PRs with none |
|---|---|---|---|
| moon | 7 | 32.4 | 2 |
| turbo before (whole gate) | 22 | 39.2 | 2 |
| turbo after | 8 | 28.0 | 5 |

Most PRs touch code and select what they did; turbo after's usual one or two
more than moon are `//#lint` (moon's root lint has no inputs and is never
selected) and the new graph check. Turbo after skips lanes moon ran in five
PRs, each by the file classes: SDK spec files and a `vitest.config.ts` feed
no build the lanes run, the CLI patchers' developer READMEs ship nowhere, a
console e2e spec reaches the console lanes but not the journey's snapshot.
It adds the Go lanes in one, an edit of `apps/server/turbo.json`.

### Wall clock

Each runner: one cold run of the gate (its own cache empty), then each
change committed on top and run as CI would: moon's affected gate tasks
(`moon exec` of what `moon query tasks --affected --downstream deep`
selects), turbo before's whole gate, turbo after's `--affected` gate.

| change | moon | turbo before | turbo after |
|---|---|---|---|
| cold, whole gate | 113.7 s (131 tasks) | 90.1 s (130) | 86.4 s (130) |
| no change | 0.3 s (0) | 6.4 s (6) | 0.2 s (0) |
| `docs/runbooks/cloud.md` | 0.3 s (0) | 7.5 s (4) | 0.2 s (0) |
| `packages/components/README.md` | 89.2 s (57) | 108.2 s (58) | 0.2 s (0) |
| a components spec file | 94.6 s (57) | 91.8 s (59) | 21.1 s (5) |
| an sdk-react spec file | 51.4 s (23) | 46.5 s (28) | 2.9 s (5) |
| a console source file | 15.2 s (8) | 17.0 s (14) | 12.9 s (9) |
| a Go source file | 19.5 s (10) | 22.8 s (16) | 18.8 s (10) |
| a components source file | 86.8 s (57) | 72.2 s (59) | 65.0 s (58) |

Tasks in parentheses are the ones that ran; the rest of each gate came from
the cache. Turbo before re-runs the never-cached `install-browsers` tasks
on every change. Under load, `cli:test`'s proxy tests against a remote HTTPS
server and `e2e:test`'s port tests failed in some runs of both runners; the
times include those runs.

Overheads every turbo run pays, three runs each: a dry run of the gate took
3.6–5.5 s before, nearly all of it `//#lint` hashing ignored files, and
0.18–0.20 s after. ci-mode's affected question took 3.3–3.4 s as the walk
over a dry run and takes 0.24 s as `turbo query affected`.

## Limits

- The static check sees paths written as literals. One built from data
  (`join(dir, name)` over a list) is invisible to it; the nightly run is the
  backstop.
- The nightly run proves that every task passes without the files no task
  claims and every build without its excluded files; it does not compare
  outputs. A build that reads such a file only to vary its output would pass.
- `--affected` trusts main: every commit there passed its merge group, and
  pushes to main run the whole gate. Changes that are no file change (a
  workflow's environment) force a full run through ci-mode's `.github/` rule.
- Turbo still has no early cutoff. A source edit that leaves a build's output
  unchanged still re-runs its dependents; the file classes only keep edits
  that cannot change the output from starting the cascade.

## Rollout

- With this change: moon's gate runs `check-turbo-graph` and gets the input
  fixes and the merge-queue base; turbo's configuration and ci-mode's turbo
  path are complete; `turbo-canary.yml` starts nightly.
- `ci-turbo.yml` uses `--affected` once `pull_request` and `merge_group` are
  back in its `on:` for the parity weeks (migration decision 9).
- Follow-up: move `apps/cli/tests/unit/scripts/` to the root `//#test`, which
  shrinks `cli#test`'s inputs to its own package.
