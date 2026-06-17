# Contributing

## Prerequisites

- Go version from [`go.mod`](go.mod)
- Node.js from [`.nvmrc`](.nvmrc)
- pnpm 10 from [`package.json`](package.json) (`corepack enable`)

## Workflow front doors

### I am contributing to Zitadel

| I want to...                       | Run                                        |
| ---------------------------------- | ------------------------------------------ |
| Check my setup                     | `moon run workspace:doctor`                |
| Try the local Zitadel CLI          | `moon run workspace:cli -- --help`         |
| Run the server from source         | `moon run workspace:server -- --help`      |
| Test the fresh-app onboarding path | `moon run workspace:journey`               |
| Run normal local checks            | `moon ci :lint :typecheck :build :test`    |
| Preview planned Changesets bumps      | `corepack pnpm exec changeset status --since origin/main` |
| Mirror CI locally                  | `moon run workspace:check -- --full`       |
| Rerun one failed task              | `moon run <project>:<task>`                |

### I am adding Zitadel to my app

| I want to...                      | Run                                                            |
| --------------------------------- | -------------------------------------------------------------- |
| Check local runtime prerequisites | `npx @zitadel/cli@alpha doctor`                                |
| Start local Zitadel               | `npx @zitadel/cli@alpha start`                                 |
| Add auth to Next.js               | `npx @zitadel/cli@alpha setup --server local`                  |
| Stop local Zitadel, keeping data  | `npx @zitadel/cli@alpha stop`                                  |
| Delete local Zitadel data         | `npx @zitadel/cli@alpha reset --force`                         |

Moon owns the monorepo task graph for TypeScript, Go, release tooling, and
journeys. Published `zitadel` runtime commands are for customers and agents
adding Zitadel to an app; they manage the `@zitadel/server` npm binary runtime
by default and do not require Docker, Go, Moon, or this source checkout.

For contributors, `moon run workspace:cli -- start` builds the local CLI and
runs it against the workspace package train. Pass `--runtime docker`,
`--image <tag>`, or set `ZITADEL_LOCAL_IMAGE=<tag>` when intentionally testing
the Docker backend.

`moon run workspace:cli -- setup ...` is the manual whole-local-train path for
humans and agents. Before invoking the local CLI, the wrapper builds and packs
the public workspace packages, publishes them to a persistent local Verdaccio
registry under `tmp/cli-local-registry`, and points the generated app install at
that registry. Set `ZITADEL_CLI_USE_PUBLIC_PACKAGES=1` when you intentionally
want the generated app to install public npm packages instead.

`moon run workspace:server` builds the embedded console/login UI before startup,
then runs `go run .`; help output skips the UI builds.

## Local checks

```sh
moon run workspace:doctor
moon ci :lint :typecheck :build :test
```

The repository doctor checks Moon and local toolchain prerequisites. Docker is
needed for container builds, Docker fallback journeys, and container-backed
integration tests; it is not required for the default npm-binary local runtime.
Playwright browsers remain advisory for opt-in e2e and journey workflows.

If you are new to Moon, start by listing the project graph and available tasks:

```sh
moon projects
moon tasks
moon project cli
moon task cli:test
```

Moon task targets use the `<project>:<task>` form, for example
`moon run cli:test`.

Use `corepack pnpm exec changeset status --since origin/main` when you want to
preview the package bumps Changesets will plan from your PR. Pull requests also
get an informational Changesets comment; maintainers use that and
`.changeset/README.md` to review release intent.

`moon run workspace:check -- --full` runs the repository's slower local
CI-parity script, including integration tests, demo e2e, package smoke checks,
release snapshots, and the fresh-app journey. Use `moon run <project>:<task>` to
rerun one named task, or `moon run workspace:check -- --only <phase>` to rerun
one legacy check phase.

## End-to-end checks

End-to-end checks are opt-in locally because they start real servers and need a
browser install. The demo suites exercise the checked-in framework demos:

```sh
corepack pnpm --filter @zitadel/demo-next-e2e exec playwright install
moon run demo-next-e2e:e2e
moon run demo-nuxt-e2e:e2e
```

The consumer journey suite reproduces the CI quality gate against a fresh
generated Next.js app:

```sh
moon run workspace:journey
```

The local runner starts Verdaccio as a Node process, builds and packs the local
publishable packages including `@zitadel/server`, publishes them to the
temporary registry, creates a Next.js app outside the repo, runs CLI setup
through npm, starts the generated app on localhost, and runs Playwright with one
worker.

Use `moon run workspace:journey` for deterministic CI-style proof. Use
`moon run workspace:cli -- ...` when you want to drive the same local package
train manually in a browser and see whether the command guidance is clear enough
for a human or agent.

To exercise the Docker fallback path, provide a local backend image tag:

```sh
moon run workspace:journey -- --runtime docker --image nextgen:local
```

Use `--keep` to preserve the temporary work directory after success. On failure
the runner keeps diagnostics automatically and prints the path.

## Run the server from source

### 1. Embedded UI assets

The Go binary embeds production builds from `internal/staticui/console/dist` and `internal/staticui/login/dist`:

```sh
moon run console:build login-ui:build
```

The `server` wrapper runs these builds automatically before startup. Run them
manually only when bypassing the wrapper with direct `go run .`. The Vite
production builds write directly into the internal embed folders.

### 2. Configure and start

```sh
moon run workspace:server
```

With no database configured, the source server starts embedded Postgres and
stores its data plus generated encryption key under the server data directory.
Use `-c docs/operations/nextgen.example.yaml` or `NEXTGEN_DATABASE_POSTGRES`
when you want to point at a database you manage.

Open http://localhost:8080/ui/console/ and http://localhost:8080/ui/login/

### Debugging with VSCode

Use `server-debug` to build the binary with debug symbols and disabled inlining, then attach
VSCode's Go debugger by PID:

```sh
moon run workspace:server-debug -- server --user-file examples/boostrap-users/demo-admin.json
```

The task prints the exact `go build` invocation and the PID of the running process:

```
[server-debug] build: go build -gcflags 'all=-N -l' -ldflags '-X main.version=debug' -o dist/server/nextgen-debug .
[server-debug] run:   ./dist/server/nextgen-debug server --user-file examples/boostrap-users/demo-admin.json

[server-debug] PID 98765 — VSCode: Run ▸ Start Debugging ▸ "Attach to Process"
```

In VSCode, open the **Run and Debug** panel (`⇧⌘D`), select **"Attach to Process"**, and type
`nextgen-debug` in the picker to filter.

Add the following configuration to your `.vscode/launch.json` to enable it:

```json
{
    "name": "Attach to Process",
    "type": "go",
    "request": "attach",
    "mode": "local",
    "processId": "${command:pickProcess}"
}
```

The debug binary stamps `version=debug` so it is distinguishable from a production build
(semver) and a plain `go run` build (`dev`).

### Frontends only (without Go)

```sh
moon run console:dev   # http://localhost:5174
moon run login-ui:dev  # http://localhost:5175
```

Dev servers use `/` as the Vite base; production embeds use `/ui/console/` and `/ui/login/`.

## Moon release snapshot

```sh
moon run release:snapshot
```

The release task builds the embedded UI surfaces automatically.

### Local runtime image from source

The contributor CLI wrapper builds the image layout expected by the Dockerfile
without publishing a snapshot:

```sh
moon run workspace:cli -- start
```

When no image override is present, the wrapper runs:

```sh
go build -trimpath -ldflags "<version metadata>" -o <tmp>/linux/<arch>/nextgen .
docker buildx build --platform linux/<arch> --load \
  -t ghcr.io/zitadel/nextgen:local-dev <tmp>
```

The wrapper embeds version metadata from the private server release record and
the current Git commit.

Use an existing image explicitly when you do not want the wrapper to rebuild:

```sh
moon run workspace:cli -- start --image custom:tag
ZITADEL_LOCAL_IMAGE=custom:tag moon run workspace:cli -- start
```

## Agent and architecture docs

- [`AGENTS.md`](AGENTS.md) — workspace conventions
- [`docs/adrs/`](docs/adrs/) — architecture decisions

## Pull request titles

Pull request titles are checked by Semantic PR. Use the conventional format
`<type>(optional-scope): <summary>`.

Allowed types and scopes live in [`.github/semantic.yml`](.github/semantic.yml).
Scopes are optional; omit the scope instead of inventing one. For
documentation-only changes, use the `docs` type, for example:

```text
docs: add preview status disclaimer
```

## Pull request descriptions

Include a concise PR description before handing work off for review. Use these
sections:

- `Summary` — what changed and why.
- `Validation` — exact commands run. If validation was not run, say so
  explicitly.
- `Release notes / changeset` — changeset status for user-visible package
  changes.
- `Notes` — reviewer context, follow-ups, risks, or `None`.
