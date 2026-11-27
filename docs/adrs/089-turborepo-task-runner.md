# ADR 089: Turborepo Replaces Moon as the Task Runner

> **Status:** Accepted
> **Date:** 2026-11-07
> **Supersedes in part:** [ADR 002](002-multi-package-release-strategy.md)
> (Moon owns the task graph and builds the non-npm artifacts; its Changesets
> half stands)
> **Context:** [turborepo-pilot.md](../design/build/turborepo-pilot.md) (the
> research), [turborepo-migration.md](../design/build/turborepo-migration.md)
> (the plan, the dual run and its decisions)

## Decision

Turborepo is the repository's only task runner. It takes over what ADR 002
gave Moon: CI, local checks, Go builds and cross-builds, npm packing and the
release's archives and containers. `moon.yml`, `.moon/` and `@moonrepo/cli`
are removed, with the scripts that read Moon's graph and reports.

1. **One task graph, in `turbo.json` files.** The root `turbo.json` holds the
   task shapes every package shares and the root's own tasks; each package's
   `turbo.json` extends it. The Go modules in `go.work` are packages too
   (`nextgen`, `zitadel/v5`, `bench`, `oidc-mock`). A task runs its package's
   script of the same name, or a module's `command`. The rules are in
   [turborepo.md](../design/build/turborepo.md).
2. **Turbo-native, not Moon's workarounds** (decision 11 of the migration
   plan). A package's `lint` covers its static checks and its `test` the
   tests that need no service; `test:postgres` and `test:spanner` stay apart.
   A release packs the builds the graph made, with no second release build.
   Where a task needs a lock or retries, its script wraps the command in
   `scripts/task-guard.mjs`.
3. **Vercel's remote cache, over OIDC.** Every CI run reads and writes it, as
   the hosted cloud's Vercel builds do; a fork's pull request runs with the
   local cache only.
4. **CI selects with `--affected`.** The required check stays `ci / full-pr`.
   It runs the root `ci` script (`pnpm run ci`, in package.json), whose turbo
   runs select with `--affected` from the pull request's or the merge
   group's base. The task list lives in the script, not in the workflow, and
   no mode script sits between them: the release checks are tasks of the
   graph, so a version PR runs like any other.
5. **One task per CI journey.** Each journey is a task of its own
   (`@zitadel/e2e#journey:<id>`) that packs the npm tarballs it installs
   from the builds it depends on, so turbo runs them side by side, a failure
   names it, and an SDK change selects only the journeys that install it.
   CI names each journey; `journey-local` runs them all.

## Context

ADR 002 made Moon the one task graph for Go and TypeScript work. The pilot
looked at Turborepo because of Moon's long-term support; it found turbo no
faster, but at home on Vercel, where the hosted cloud already built with it.
The migration plan then ran both runners side by side: every task existed in
a `moon.yml` and in a `turbo.json`, Moon stayed the runner of record behind
`ci / full-pr`, and turbo ran the same checks as the non-required `ci-turbo`
workflow on pull requests and in the merge queue.

At first the turbo side reproduced what Moon needed: mutexes, retries,
mirrored release builds and adapters between the runners. Decision 11 of the
plan stopped that: each change takes turbo's own form and is measured on
`ci-turbo`, so the two graphs diverge by design. Keeping Moon working from
there on would have meant a second graph that no longer matched the first,
and every task change made twice.

## Consequences

Positive:

- A task change goes into one `turbo.json` and its package's script.
- Selection and the cache agree: `--affected` and the cache key both follow
  each task's inputs and its edges.
- Pull requests restore main's results and their own earlier pushes from the
  remote cache.
- Each CI journey is selected, run and reported on its own.

Trade-offs:

- `--affected` trusts the inputs: a file a task reads but does not list
  neither selects the task nor misses its cache.
- Arguments after `--` re-key every task in a run, so CI and scripts pass
  options through the environment.
- Strict environment mode hides every variable a task does not list.
- The Go support (`experimentalGoWorkspaces`, `experimentalTaskCommand`) is
  experimental, and turbo's maintenance has the same one-main-developer shape
  as Moon's.

## Alternatives considered

- **Keep Moon** (ADR 002). The pilot's own recommendation was to wait for a
  trigger; with the cloud on turbo already, it left two runners in the repo.
- **Keep both runners.** The dual run, made permanent: every task twice, and
  two CI runs per change (in one day of both, `ci-turbo` took 3,514 runner
  minutes beside ci.yml's 3,147).
- **Turbo with Moon's workarounds.** What the dual run started with; turbo
  would keep mirrored release builds and adapters to a runner that is gone.
