# Moon configuration

How tasks, inputs and dependencies are laid out across the workspace. Read
this before editing any `moon.yml` or a file under `.moon/`.

## Turborepo runs beside moon

Every task also exists in a `turbo.json`
([turborepo.md](../docs/design/build/turborepo.md)). Until the cutover in
[turborepo-migration.md](../docs/design/build/turborepo-migration.md), a
change to a task's command, dependencies, inputs or outputs goes into both
files. Moon is the runner of record; CI runs the turbo version as the
non-required `ci-turbo` job.

Where the two differ on purpose:

- Moon's `test` runs each package's `test:all` script, turbo runs `test`. In
  the browser-test packages, `test` wraps `scripts/task-guard.mjs` for
  turbo's retries and `test:all` calls Vitest directly, because moon has its
  own `retryCount`.
- The Go `format` and `lint` tasks keep inline scripts here; turbo runs copies
  of them (`scripts/go-format-check.mjs`, `scripts/go-lint.mjs`). Change both.
- `scripts/task-guard.mjs` in api `generate` and config `sync-schemas` acts
  only under turbo; under moon it runs the command once, unchanged.
- Some scripts set values a moon task's `env` sets too, because turbo cannot.
  They set them as defaults (`${VAR-default}`), so a caller's value still
  wins.
- Turbo's console `build` lists the git-ignored `.env*` files as inputs. Moon
  hashes only the files git sees, listed or not, so `moon.yml` does not list
  them: under moon a changed `.env.local` still restores the old build.
- Turbo's inputs follow file classes: no task hashes its package's docs, and
  no build its tests ([turborepo-graph.md](../docs/design/build/turborepo-graph.md)).
  Moon keeps the whole folder (below). A file read outside the folder goes
  into both.
- Turbo's `journey-local` also depends on `server#build`: ci-turbo.yml
  selects each lane with `--affected`, and the server the journey runs comes
  packed in the release snapshot, outside the graph. Moon runs the journey
  with every other lane through `e2e:all`.

## Shared tasks live in `.moon/tasks`

- `all.yml` applies to every project. Its `implicitInputs` (the root files
  that fix the toolchain and the installed dependencies, plus
  `.moon/tasks/**/*.yml`) re-run every task when they change.
- `typescript.yml` defines `lint`, `typecheck`, `build`
  (`outputs: dist/**/*`) and `test` once for every TypeScript project.
  `javascript.yml` gives the JavaScript projects the same `lint`.
- A project's `moon.yml` never repeats a shared task's command. It adds only
  `deps` (appended), `outputs` with `options.mergeOutputs: "replace"`, a
  different command with `options.mergeArgs: "replace"`, or options (a mutex,
  retries, `runInCI`).
- A project with nothing to build or test excludes the task with
  `workspace.inheritedTasks.exclude` and a comment saying why, never with an
  empty script.

## Inputs

A task uses moon's default inputs, the whole project folder, so a new file is
covered without a list to maintain. Never write an `inputs` list naming a
package's own files. The exceptions name only what lies outside the folder:

- A task that reads files outside its project lists `**/*` plus that path
  (`api:generate` reads `/api/openapi/**/*.yaml`).
- `server` keeps its file groups because its code lives at the repo root, and
  `bench` because `tools/bench` compiles the root module through
  `replace github.com/zitadel/nextgen => ../..` (`tools/bench/go.mod`).
  Anything compiled in through `//go:embed` or read by a test belongs in them.
- The root `workspace` project's `test` and `check-*` tasks list their files,
  because its folder is the whole repo.

## Dependencies between projects

- A task that uses another package depends on that package's task, and the
  project declares the package in `package.json` (`devDependencies` when only
  tests or tooling use it).
- Use another package through its exports, never a relative path into its
  folder.
- Never list a dependency another one already reaches, unless the path runs
  through a task with no `outputs`, which moon does not hash (`server:test`
  lists the UI builds although `server:vet` already orders them).
- Give a depended-on task its real `outputs`: without them, a change there
  does not re-run its dependents.
- An edge on what another project builds (embedded UIs, built apps and
  binaries, the release tasks) has no `package.json` entry; the graph check's
  allowlists hold them. `release:build-public-packages` names every public
  package, because `release:check-graph` requires it.

## Check the graph

Run it after changing any `moon.yml`, `.moon/` file or workspace dependency;
CI runs it too:

```sh
moon run workspace:check-moon-graph
```

It fails on a transitive duplicate reached through hashed edges, a
cross-project dependency without a matching `package.json` entry, or a
declared workspace package no task reaches. Extend its allowlists
(`scripts/check-moon-graph.mjs`) only for the same kind of case, with a
comment saying why.
