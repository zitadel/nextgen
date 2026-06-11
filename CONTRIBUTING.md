# Contributing

## Prerequisites

- Go version from [`go.mod`](go.mod)
- Node.js from [`.nvmrc`](.nvmrc)
- pnpm 10 from [`package.json`](package.json) (`corepack enable`)

## Workflow front doors

### I am contributing to Zitadel

| I want to...                       | Run                                      |
| ---------------------------------- | ---------------------------------------- |
| Check my setup                     | `corepack pnpm run doctor`               |
| Try the local Zitadel CLI          | `corepack pnpm run cli -- --help`        |
| Run the server from source         | `corepack pnpm run server -- --help`     |
| Test the fresh-app onboarding path | `corepack pnpm run journey`              |
| Run normal local checks            | `corepack pnpm run check`                |
| Mirror CI locally                  | `corepack pnpm run check -- --full`      |
| Rerun one failed phase             | `corepack pnpm run check -- --only node` |

### I am adding Zitadel to my app

| I want to...                      | Run                                                            |
| --------------------------------- | -------------------------------------------------------------- |
| Check local runtime prerequisites | `npx @zitadel/cli@preview doctor`                              |
| Start local Zitadel               | `npx @zitadel/cli@preview start`                               |
| Add auth to Next.js               | `npx @zitadel/cli@preview setup --framework next --server local` |
| Stop local Zitadel, keeping data  | `npx @zitadel/cli@preview stop`                                |
| Delete local Zitadel data         | `npx @zitadel/cli@preview reset --force`                       |

Nx manages TypeScript workspace targets. Go commands and long-running local
orchestration run through repository scripts so server processes are signaled
and cleaned up directly. Published `zitadel` runtime commands are for customers and
agents adding Zitadel to an app; they manage a Docker-backed local runtime and
do not require Go, Nx, or this source checkout.

For contributors, `corepack pnpm run cli -- start` builds and uses a fresh
local runtime image by default. The wrapper runs the CLI build, then builds
`ghcr.io/zitadel/nextgen:local-dev` through GoReleaser's single-target build
before invoking `zitadel start`. Pass `--image <tag>` or set
`ZITADEL_LOCAL_IMAGE=<tag>` to use an existing image instead.

`corepack pnpm run server` builds and syncs the embedded console/login UI before
startup, then runs `go run .`; help output skips the UI sync.

## Local checks

```sh
corepack pnpm run doctor
corepack pnpm run check
```

The repository doctor checks Docker and GoReleaser because contributor
`corepack pnpm run cli -- start` auto-builds the local runtime image from this
source checkout. Playwright browsers remain advisory for opt-in e2e and journey
workflows.

`corepack pnpm run check -- --full` runs the slower CI-parity phases. Use
`--only <phase>` to rerun one phase after a failure.

## End-to-end checks

End-to-end checks are opt-in locally because they start real servers and need a
browser install. The demo suites exercise the checked-in framework demos:

```sh
corepack pnpm exec playwright install
corepack pnpm nx run-many -t e2e -p @zitadel/demo-next-e2e,@zitadel/demo-nuxt-e2e
```

The consumer journey suite reproduces the CI quality gate against a fresh
generated Next.js app:

```sh
corepack pnpm run journey
```

The local runner needs Docker for Verdaccio, but by default it starts the
backend from source with embedded Postgres, so no local database container is
required. It ensures the Playwright Chromium browsers are installed, builds and
packs the local publishable packages with pnpm, publishes them to the temporary
registry, creates a Next.js app outside the repo, runs CLI setup through npm,
starts the generated app on localhost, and runs Playwright with one worker.

For image parity with CI, provide a local backend image tag:

```sh
corepack pnpm run journey -- --backend image --image nextgen:local
```

Use `--keep` to preserve the temporary work directory after success. On failure
the runner keeps diagnostics automatically and prints the path.

## Run the server from source

### 1. Embedded UI assets

The Go binary embeds production builds from `internal/staticui/console/dist` and `internal/staticui/login/dist`:

```sh
sh scripts/sync-embedded-ui-dist.sh all
```

The `server` wrapper runs this automatically before startup. Run it manually
only when bypassing the wrapper with direct `go run .`. It uses Nx for
`@zitadel/console` and `@zitadel/login-ui`, then copies the build output into
the internal embed folders.

### 2. Configure and start

```sh
corepack pnpm run server
```

With no database configured, the source server starts embedded Postgres and
stores its data plus generated encryption key under the server data directory.
Use `-c docs/operations/nextgen.example.yaml` or `NEXTGEN_DATABASE_POSTGRES`
when you want to point at a database you manage.

Open http://localhost:8080/ui/console/ and http://localhost:8080/ui/login/

### Frontends only (without Go)

```sh
corepack pnpm nx dev @zitadel/console   # http://localhost:5174
corepack pnpm nx dev @zitadel/login-ui  # http://localhost:5175
```

Dev servers use `/` as the Vite base; production embeds use `/ui/console/` and `/ui/login/`.

## GoReleaser snapshot

```sh
goreleaser release --snapshot --clean --skip=publish,sign
```

The `before` hook runs `scripts/sync-embedded-ui-dist.sh` automatically.

### Local runtime image from source

The contributor CLI wrapper builds the image layout expected by the Dockerfile
without publishing a snapshot:

```sh
corepack pnpm run cli -- start
```

When no image override is present, the wrapper runs:

```sh
goreleaser build --snapshot --clean --single-target --id nextgen \
  --output <tmp>/linux/<arch>/nextgen
docker build --platform linux/<arch> -t ghcr.io/zitadel/nextgen:local-dev <tmp>
```

The wrapper sets GoReleaser's tag environment from the nearest server semver
tag and ignores Changesets-created package tags such as `@zitadel/cli@...`.

Use an existing image explicitly when you do not want the wrapper to rebuild:

```sh
corepack pnpm run cli -- start --image custom:tag
ZITADEL_LOCAL_IMAGE=custom:tag corepack pnpm run cli -- start
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
