# nextgen

Next iteration of the Zitadel identity platform.

> **Preview status:** This repository is a pre-release next-generation Zitadel
> preview. The public name may change, and APIs, CLI flags, package surfaces,
> and docs are still in flux. The checked-in CLI currently supports the local
> npm-binary flow documented below; create-first, claim-later is the product
> direction, but `zitadel claim` is not shipped in this repo yet. See
> [VISION.md](VISION.md).

## Workflow front doors

### I am contributing to Zitadel

| I want to...                       | Run                                      |
| ---------------------------------- | ---------------------------------------- |
| Check my setup                     | `moon run workspace:doctor`              |
| Try the local Zitadel CLI          | `moon run workspace:cli -- --help`       |
| Run the server from source         | `moon run workspace:server -- --help`    |
| Test the fresh-app onboarding path | `moon run workspace:journey`             |
| Run normal local checks            | `moon ci :lint :typecheck :build :test`  |
| Mirror CI locally                  | `moon run workspace:check -- --full`     |
| Rerun one failed task              | `moon run <project>:<task>`              |

### I am adding Zitadel to my app

| I want to...                      | Run                                                            |
| --------------------------------- | -------------------------------------------------------------- |
| Check local runtime prerequisites | `npx @zitadel/cli@alpha doctor`                                |
| Start local Zitadel               | `npx @zitadel/cli@alpha start`                                 |
| Add auth to a Next.js app         | `npx @zitadel/cli@alpha setup --server local`                  |
| Check generated app files         | `npx @zitadel/cli@alpha doctor`                                |
| Stop local Zitadel, keeping data  | `npx @zitadel/cli@alpha stop`                                  |
| Delete local Zitadel data         | `npx @zitadel/cli@alpha reset --force`                         |

Moon owns the monorepo task graph for TypeScript, Go, release tooling, and
journeys. The published `zitadel` runtime commands are customer workflow
commands; they run the released local runtime through the `@zitadel/server` npm
binary by default and do not require Docker, Go, Moon, or a source checkout.
Docker remains available with `zitadel start --runtime docker`.

For contributors, `moon run workspace:cli -- start` runs the local CLI against
the workspace package train. Pass `--runtime docker`, `--image <tag>`, or set
`ZITADEL_LOCAL_IMAGE=<tag>` when intentionally testing the Docker backend.

`moon run workspace:cli -- setup ...` is the manual whole-local-train path for
humans and agents. Before invoking the local CLI, the wrapper builds and packs
the public workspace packages, publishes them to a persistent local Verdaccio
registry under `tmp/cli-local-registry`, and points the generated app install at
that registry. Set `ZITADEL_CLI_USE_PUBLIC_PACKAGES=1` when you intentionally
want the generated app to install public npm packages instead.

`moon run workspace:server` builds and syncs the embedded console/login UI before
startup, then runs `go run .`; help output skips the UI sync.

## Customer quick start

```sh
mkdir myapp
cd myapp
npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
npm run dev
```

Open http://localhost:3000/login and register your first local user. The
managed Zitadel runtime stores its metadata and data under
`.zitadel/local/`; `stop` preserves that data and `reset --force`
deletes it. In a fresh directory, `setup` asks which framework to scaffold and
writes the app into the current directory. It installs dependencies with the
detected package manager; pass `--skip-install` if you want to install them
yourself.

## Manual Docker quick start

Run the API and embedded UIs with Docker Compose when you want to inspect the
operator-style stack directly:

```sh
cd docs/operations
cp env.example .env
docker compose up -d
```

| Surface            | URL                               |
| ------------------ | --------------------------------- |
| Management console | http://localhost:8080/ui/console/ |
| Sign-in shell      | http://localhost:8080/ui/login/   |
| Health             | http://localhost:8080/healthz     |

Details: [docs/quick-start/index.md](docs/quick-start/index.md). To build from source: [CONTRIBUTING.md](CONTRIBUTING.md).

## Current status

This repository is pre-release. The Go `server` command serves the OpenAPI
surface and embeds the console and login UIs at `/ui/console/` and `/ui/login/`.
CI produces installable snapshots for review, not official releases.

For product direction and public-readiness notes, see [VISION.md](VISION.md).

## Local checks

Use Node.js from [.nvmrc](.nvmrc) and the pinned pnpm 10 workspace manager from
`package.json`. Start with the local doctor, then run the fast check set:

```sh
moon run workspace:doctor
moon ci :lint :typecheck :build :test
```

The repository doctor checks Moon and local toolchain prerequisites. Docker is
needed for container builds, Docker fallback journeys, and container-backed
integration tests; it is not required for the default npm-binary local runtime.
Playwright browsers remain advisory for opt-in e2e and journey workflows.

`moon run workspace:check -- --full` runs the slower CI-parity phases, including
integration tests, demo e2e, package smoke checks, release snapshots, and the fresh-app
journey. Use `moon run <project>:<task>` to rerun one named task, or
`moon run workspace:check -- --only <phase>` to rerun one legacy check phase.

To seed demo users for local login testing, pass bootstrap JSON files when starting the server (see [examples/bootstrap-users/](examples/bootstrap-users/)):

```sh
moon run workspace:server -- -c <config.yaml> --user-file examples/bootstrap-users/demo-admin.json
```

The server wrapper runs `scripts/sync-embedded-ui-dist.sh all` before startup so
the default embedded UI routes work from source. Run that script manually only
when bypassing the wrapper with direct `go run .`.

Package smoke checks:

```sh
moon run workspace:cli -- --version
moon run workspace:cli -- commands
corepack pnpm --silent run cli -- status --json
moon run release:pack
```

Use `corepack pnpm --silent run cli -- ... --json` when a script needs
parseable CLI stdout. Plain `pnpm run` prints its own script prelude before
the command output.

Customer local setup journey check:

```sh
moon run workspace:journey
```

This opt-in check ensures the Playwright Chromium browsers are installed, builds
the local npm packages including `@zitadel/server`, publishes them to a
temporary Verdaccio registry, runs `npx @zitadel/cli@alpha doctor`, `start`, and
`setup --framework <id> --server local` with the binary runtime in fresh app directories for every
supported framework, starts the generated apps, and verifies registration/login
journeys. Use `moon run workspace:journey -- --framework next` to run only the
Next.js journey. Use `--runtime docker --image <tag>` to exercise the Docker
fallback path.

Use `moon run workspace:journey` for deterministic CI-style proof. Use
`moon run workspace:cli -- ...` when you want to drive the same local package
train manually in a browser and see whether the command guidance is clear enough
for a human or agent.

## CI

Pull requests run one Moon-driven `ci / validate` job on a 16-core Depot runner:

- Go vet and tests.
- pnpm install and Moon lint/typecheck/build/test tasks.
- Built CLI smoke checks.
- npm package dry-run/pack checks.
- A non-publishing Moon release snapshot without building a container.
- The fresh-app journey against the default npm server binary runtime.

Changesets version PRs run a smaller release/package validation path. A
separate `ci-docker-runtime` workflow runs on `main` and manually to exercise
the Docker fallback journey.

CI uploads short-lived workflow artifacts for review: Moon release snapshot output
and npm package tarballs. On consumer journey failures it also uploads focused
diagnostics such as Playwright traces, doctor/start/setup JSON, package lock
metadata, local runtime logs, and service logs. These artifacts expire after 7
days and are not release artifacts.

## Build & release

This monorepo uses Moon for task execution, non-npm artifact builds, and the
product GitHub Release. Changesets owns package versions, changelogs, npm
publishing, and public package tags.
The current alpha release model uses one fixed Changesets version across the
CLI, server npm runtime, API packages, components, and SDKs. The full rationale
lives in
[docs/adrs/002-multi-package-release-strategy.md](docs/adrs/002-multi-package-release-strategy.md)
and [docs/adrs/023-lockstep-alpha-release-train.md](docs/adrs/023-lockstep-alpha-release-train.md).

### Moon release artifacts

Moon runs repo-owned scripts that build the console and login-ui SPAs, sync them
into `internal/*/dist`, cross-compile the Go server, stage npm platform
packages, create archives and checksums, build Docker images, and assemble
release metadata.

```sh
# Local snapshot without publishing
moon run release:snapshot

# Dry-run the manual publish graph
moon run release:publish -- --dry-run
```

Release output lands in `dist/release/<version>`. Product tags remain
`vX.Y.Z` or `vX.Y.Z-alpha.N` and are created by the Moon release task from the
fixed `@zitadel/server` version; prerelease images publish only immutable
version tags, while stable releases may move
`ghcr.io/zitadel/nextgen:latest`.

### npm packages (`changesets`)

`apps/cli`, `apps/server*`, and the public packages under `packages/` publish
to npm via [changesets](https://github.com/changesets/changesets). On any
user-visible change to those packages:

```sh
corepack pnpm changeset
```

The manual `release-prepare.yml` workflow runs Moon release validation,
executes `changeset version`, and opens or updates the version PR. After that
PR is reviewed and merged, `release-publish.yml` publishes npm packages with
Changesets, pushes the product tag and container image, and creates or updates
the single product GitHub Release.

Follow the [manual release runbook](docs/runbooks/manual-release.md) when
cutting a release.

Release process checks can be run locally with:

```sh
moon run release:snapshot
```

Tester commands use either the latest alpha stream or an exact train:

```sh
npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local

npx @zitadel/cli@0.1.0-alpha.N start
```

### Local development

The devcontainer at [.devcontainer/](.devcontainer/) pins Go 1.26 and a PostgreSQL sidecar.

After changing devcontainer configuration, use **Dev Containers: Rebuild Container** so features and volume mounts apply.

**Docker (integration tests)** — both the Postgres and Spanner integration tests use [testcontainers](https://golang.testcontainers.org/) to start their databases (a Postgres container and the Cloud Spanner emulator), so a running Docker daemon is required. The devcontainer reuses the host Docker daemon (Docker-outside-of-Docker). Verify inside the container:

```sh
docker info
```

Run the integration tests (same commands as CI):

```sh
# Postgres
go test -v -tags postgres_integration -timeout=10m ./...

# Spanner
go test -v -tags spanner_integration -timeout=10m ./...
```

If `docker info` fails and the host uses **rootless Docker**, override the socket mount in [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) per the [docker-outside-of-docker feature docs](https://github.com/devcontainers/features/tree/main/src/docker-outside-of-docker#rootless-docker-support), for example bind `/run/user/<uid>/docker.sock` to `/var/run/docker-host.sock` (use `id -u` on the host for `<uid>`).

To run the integration tests against a database you manage instead of testcontainers, set `ZITADEL_TEST_POSTGRES_URL` (Postgres DSN) or `ZITADEL_TEST_SPANNER_URL` (Spanner DSN); every integration suite honors these and connects to your database instead of starting a container, so `go test -tags … ./...` needs no Docker. Point it at a throwaway database — the suites run migrations that create the `zitadel_nextgen` schema.
