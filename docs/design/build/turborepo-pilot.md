# Turborepo instead of moon? Research and pilot

> **Status:** research, 2026-10-12. Turborepo 2.11.7 against moon 2.6.1.
> **Pilot:** this branch builds the hosted cloud's console, storybook and
> login UI with turbo on Vercel. Moon still owns CI, local dev and releases.
> **Next step:** the full migration was prototyped and planned in
> [turborepo-migration.md](turborepo-migration.md) (task mapping, feature
> replacements, script ports, CI, remote cache, rollout, effort, decisions).

## Short answer

The reason to look was moon's long-term support, and that worry is fair (see
[Long-term support](#long-term-support)). Turbo could replace moon for the
TypeScript packages, but not as a drop-in swap, and it does not help with
the Go server yet. It is not faster at building. Where it is clearly better
is on Vercel.

- **Go:** turbo 2.11's Go support is experimental and refuses our layout. It
  reads modules from a `go.work`, and a module at the repository root (ours)
  is rejected: "Root modules cannot be go.work members; move the module into
  a subdirectory." Without it, the server's inputs are listed by hand, which
  is what moon's `serverInputs` file group does today.
- **Speed:** the same. Building the three deployed apps from scratch (13
  tasks) took 11–12 s with either tool, under 1 s from the local cache.
- **Vercel:** turbo uses Vercel's remote cache without any setup (measured
  below), Vercel shows turbo's run summary per deployment, and
  `turbo query affected` can decide whether a preview is needed from the
  package graph instead of a folder list.
- **CI:** our CI leans on moon features turbo lacks: mutexes, retries,
  `runInCI`, inline scripts, and scripts that read moon's graph and reports.

## What the pilot changes

| File | Change |
|---|---|
| `package.json`, `pnpm-workspace.yaml` | `turbo` 2.11.7 as a root dev dependency (catalog) |
| `turbo.json` | the build tasks the cloud deployment needs, nothing else |
| `vercel.json` | the console and storybook services run `turbo run build --filter=…` instead of `moon run …:build` |
| `apps/cloud/build.sh` | the server service builds the login UI with turbo |
| `.gitignore` | `.turbo` |

The docs service is unchanged. It never used moon, and caching it with turbo
carries two risks that need their own test: a cache hit skips `next build`,
and with it the hooks Vercel's Next.js adapter runs inside it; and Next.js
reads Vercel's deployment variables (`VERCEL_URL` and the like) at build
time, which turbo hides unless told, and which would let a cached build
carry another deployment's URLs if passed through without being hashed.

## Results

### Locally (Apple M4, clean environment, three runs each)

| | moon | turbo |
|---|---|---|
| console + storybook + login UI from scratch (13 tasks) | 11.1–11.8 s | 11.2–12.5 s |
| again, nothing changed | 0.4 s | 0.1 s |
| outputs deleted, restored from the local cache | 0.6 s | 0.5 s |

The console and login UI builds are byte-identical between the two tools.
The storybook differs only in its own build timestamp and minifier naming,
as it does between any two storybook builds.

Measure in a clean environment: this machine's shell environment made every
Node process several seconds slower, which moon passes to its tasks and
turbo's strict environment mode filters out. The first comparison showed
turbo 3–4× faster for that reason alone.

### On Vercel

Preview builds of this branch against the production build of the same
`main` commit (`6c01332`, moon). All three start without a Vercel build
cache (see finding 8).

| Build step | moon (`main`) | turbo, first build | turbo, second build (no change) |
|---|---|---|---|
| console service (10–11 tasks) | 25.7 s | 27.7 s | 1.7 s, all from Vercel's cache |
| storybook service | 10.2 s | 8.6 s | 1.4 s, all from cache |
| login UI (server service) | 3.5 s | 2.1 s | 1.3 s, all from cache |
| whole deployment build | 3 m 23 s | 3 m 47 s¹ | 2 m 59 s |

¹ includes creating and migrating the branch's preview database (about
25 s), which only a branch's first build does.

Turbo logged "Remote caching enabled" with no setup: the Vercel project's
builds use the team's remote cache automatically. Both preview deployments
serve the console, storybook, login UI, docs and API (all 200), and the
console bundle built on Vercel contains the Web Analytics and Speed Insights
code that `VITE_CONSOLE_VERCEL_INSIGHTS` switches on. Its bundle hash matches
a local turbo build with the same variable.

The rest of a deployment is untouched by turbo: about 50 s of package
installs, the docs' `next build` (about 40 s) and the Go compile (about
70 s).

## Findings

1. **Package graph instead of a second graph.** Turbo takes task edges from
   `package.json` (`dependsOn: ["^build"]`), so the moon rule "the moon edge
   and the npm dependency go together" and `workspace:check-moon-graph` would
   no longer be needed.
2. **`^build` follows devDependencies too.** The console's
   `@zitadel/testing` (used by `dev-real` only) pulls the CLI and sdk-next
   builds into every console build. The pilot names the console's one built
   dependency instead. The same edge makes `turbo query affected` report the
   console as affected by CLI-only changes.
3. **Strict environment mode.** Tasks see only the variables `turbo.json`
   names, plus a built-in list (`PATH`, `SHELL`, `NEXT_*`, `TURBO_*`,
   `COREPACK_*`, …). Vite apps get `VITE_*` automatically, so
   `VITE_CONSOLE_VERCEL_INSIGHTS` reaches the console build and is part of its
   cache key. The Go build and migration (`CLOUD_*`, `MASTER_KEY_*`,
   `VERCEL_GIT_*`) stay outside turbo in the pilot; under turbo every one of
   them would need listing. On Vercel turbo warns about each project variable
   it is not told about, for every task; `TURBO_PLATFORM_ENV_DISABLED=1`
   silences that.
4. **It edits `AGENTS.md`.** When an AI agent runs it, turbo writes its own
   block into the root `AGENTS.md`. `"agentGuidance": false` stops that.
5. **Telemetry is on by default.** `TURBO_TELEMETRY_DISABLED=1` or
   `DO_NOT_TRACK=1` (CI already sets the latter).
6. **One cache for all worktrees.** In a git worktree turbo uses the main
   checkout's `.turbo/cache`, so worktrees share build results. Moon keeps a
   cache per worktree.
7. **Skipping previews.** Replaying the last 60 merges to `main`,
   `turbo query affected --tasks build` would have skipped 9 of them, all
   docs- or CI-only; the folder list removed in #1686 would have skipped 11.
   The package-level form (without `--tasks`) misses OpenAPI-only changes,
   because only task inputs see files outside packages. The Go server still
   needs a folder list either way.
8. **Not turbo's to fix, but the biggest cost today:** every cloud build
   starts from scratch. Vercel drops the build cache because it is over its
   1.5 GB limit (1.52 GB), after spending about 4.5 minutes creating it. So
   each build installs all packages (33 s) and compiles the Go server from
   nothing (about 70 s).
9. **Moon's remote cache fails on Vercel.** Every task logs "invalid token"
   against Depot and runs uncached: the variable `.moon/workspace.yml` expects
   is not set there, and moon still tries.

## Long-term support

| | moon | Turborepo |
|---|---|---|
| Owner | moonrepo, a two-founder startup (Y Combinator, winter 2023, about $0.5 M). YC now lists it as inactive. Its paid product, moonbase, shut down in March 2025 | Vercel, since 2021. Vercel builds its own monorepos with it and sells its remote cache |
| Last 12 months | 436 commits by people, 87 % by its founder, Miles Johnson. v2.0 in February 2026, six minor releases since, about one release a week | 2,083 commits by people, 88 % by one Vercel engineer. 2.11 in September 2026 |
| License | MIT | MIT |

Both are, in practice, one main developer. The difference is who pays for
that developer: turbo is part of Vercel's product, moon no longer has a
visible business behind it. It is a slow risk, not an urgent one: moon ships
steadily, and the pinned version keeps working if development stops. What
we would lose is fixes for new Node, pnpm or Go versions.

## What a full switch would take

Roughly two to three weeks, most of it CI and scripts (worked out in detail,
with a prototype, in [turborepo-migration.md](turborepo-migration.md)):

- Rewrite the 33 `moon.yml` files and `.moon/tasks` as `turbo.json` (root
  plus a package configuration where a package differs).
- Replace what turbo does not have:
  - `mutex` (17 tasks): ordering edges between the tasks, or a separate
    `--concurrency=1` run;
  - `retryCount` (4): Vitest's own `retry`;
  - `runInCI` (72): CI names the tasks it runs;
  - inline `script:` (19): `package.json` scripts or `.mjs` files;
  - `runFromWorkspaceRoot` (Go tasks): scripts that change to the root.
- Port the scripts that read moon: `ci-mode.mjs` (`moon query tasks
  --affected`), `check-moon-graph.mjs` (mostly obsolete),
  `check-release-graph.mjs`, `report-moon-failures.mjs` (turbo's
  `--summarize`), `release-manifest.mjs`, `doctor.mjs`, `check.mjs`.
- Remote cache in CI: Depot's runners set `TURBO_API`, `TURBO_TOKEN` and
  `TURBO_TEAM` themselves.
- Docs: 43 Markdown files mention moon, 229 `moon run`/`ci`/`query`
  commands.
- The Go server: a `package.json` wrapper with hand-listed inputs, or move
  the Go module into a subdirectory to use turbo's Go support once it is
  stable.

## Recommendation

Do not replace moon now. A full switch is weeks of CI and script work and
buys no build speed. Hedge instead, so that a switch stays a few weeks of
mechanical work whenever it is needed:

1. **Keep the pilot as a foothold.** It is a few small changes, saves about
   35 s per deployment whenever the TypeScript packages did not change, and
   keeps turbo working in this repository. Make preview builds read-only on
   the remote cache (`TURBO_CACHE=local:rw,remote:r`), so production never
   restores something a branch build uploaded. The cost: `turbo.json` and the
   moon configs describe the same builds twice, though turbo takes most of
   its edges from `package.json`.
2. **Keep the moon configuration portable.** Every task runs a
   `package.json` script or a script file (19 tasks still run inline
   scripts); prefer tool-neutral features where they exist (Vitest's own
   retry rather than moon's `retryCount`); keep moon edges equal to
   `package.json` edges, as `workspace:check-moon-graph` already enforces.
3. **Switch when one of these happens:** moon goes three months without a
   release, its maintainer steps back, a moon bug blocks us with no fix in
   sight, or turbo's Go support is stable and accepts a module at the
   repository root.

Separately, the bigger saving on Vercel is its build cache: bring it under
the 1.5 GB limit and every deployment stops installing all packages and
compiling Go from scratch. The docs service is the next candidate for
turbo's cache, after a test of the two risks named above.
