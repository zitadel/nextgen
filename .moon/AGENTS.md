# Moon configuration

How tasks, inputs and dependencies are laid out across the workspace. Read this
before editing any `moon.yml` or a file under `.moon/`.

## Shared tasks live in `.moon/tasks`

- `.moon/tasks/all.yml` applies to every project. Its `implicitInputs` are the
  root files that decide the toolchain and the installed dependencies
  (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`, `.npmrc`,
  `.nvmrc`, `devbox.json`, `devbox.lock`) plus `.moon/tasks/**/*.yml`, so a
  change to any of them re-runs every task.
- `.moon/tasks/typescript.yml` applies to every TypeScript project. It defines
  the standard tasks once: `lint`, `typecheck`, `build` (with
  `outputs: dist/**/*`) and `test`. Its `implicitInputs` add the shared
  configs every project extends (`tsconfig.base.json`, `biome.json`,
  `vitest.shared.*`).
- `.moon/tasks/javascript.yml` gives the JavaScript projects (the root
  `workspace` project and `tools/release`) the same `lint`.

A project's `moon.yml` does not repeat a shared task's command. It only adds
what is specific to it:

- `deps`, which moon appends to the inherited task;
- `outputs` when its build writes somewhere other than `dist/`, with
  `options.mergeOutputs: "replace"` so it replaces the inherited one;
- a different command, with `options.mergeArgs: "replace"`;
- options such as a mutex, retries or `runInCI`.

A project with nothing to build or test opts out with
`workspace.inheritedTasks.exclude`, with a comment saying why. Do not add an
empty script to fill the gap.

## Inputs

A task uses moon's default inputs, the whole project folder, so any file added
to a package (a new `vite.config.mts`, say) is covered without a list to keep
up to date. Do not write an `inputs` list that names a package's own files.

The exceptions name only what lies outside the project folder:

- A task that reads files outside its project uses `**/*` plus that path, e.g.
  `api:generate` reads `/api/openapi/**/*.yaml`.
- The Go projects (`server`, `bench`) keep their file groups, because their
  code lives at the repo root, not in their folders. Anything compiled in
  through `//go:embed` or read by a test belongs in them.
- The root `workspace` project's `test` and `check-*` tasks list their files,
  because its folder is the whole repo.

## Dependencies between projects

- A task that uses another package depends on that package's task, and the
  project declares the package in `package.json` (`devDependencies` when only
  tests or tooling use it). The moon edge and the npm dependency go together.
- Code from another package is used through its exports, never through a
  relative path into its folder.
- Do not list a dependency that another dependency already reaches. If `B`
  depends on `C` and `A` depends on `B`, `A` does not also depend on `C`. The
  exception is a path through a task with no `outputs`: moon does not hash
  through it, so `A` keeps `C` to keep it in its cache key (`server:test`
  lists the UI builds although `server:vet` already orders them).
- A dependency on a task with no `outputs` is not hashed by moon, so a change
  there does not re-run the dependent. Give the depended-on task its real
  outputs.

Some edges are on another project's build artifact, not its code, and have no
`package.json` entry: the server and the local runtime image embed the
console and login UI builds, the e2e suites and `testing:test-integration` run
built apps and the server binary (and demo-next's dev server loads the sdk-next
build), the console's `dev-real` boots an instance through the built CLI, and
the `release` tasks package everything.
`release:build-public-packages` names every public package explicitly, because
`release:check-graph` requires it.

## Check the graph

CI runs this as `workspace:check-moon-graph`. Run it after changing any
`moon.yml`, `.moon/` file or workspace dependency:

```sh
moon run workspace:check-moon-graph
```

It reads the resolved graph from `moon query projects` and fails on a
transitive duplicate reached through hashed edges, a cross-project dependency with no matching
`package.json` entry, or a declared workspace package that no task reaches. Its
allowlists hold the exceptions above; extend them only for the same kind of
case, with a comment saying why.
