# nextgen

Next iteration of the Zitadel identity platform.

> **Preview status:** This repository is a pre-release next-generation Zitadel
> preview. The public name may change, and APIs, CLI flags, package surfaces,
> and docs are still in flux. The checked-in CLI currently supports the local
> Docker-backed flow documented below; create-first, claim-later is the product
> direction, but `zitadel claim` is not shipped in this repo yet. See
> [VISION.md](VISION.md).

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
| Check local runtime prerequisites | `npx @zitadel/cli@alpha doctor`                                |
| Start local Zitadel               | `npx @zitadel/cli@alpha start`                                 |
| Add auth to a Next.js app         | `npx @zitadel/cli@alpha setup --framework next --server local` |
| Check generated app files         | `npx @zitadel/cli@alpha doctor`                                |
| Stop local Zitadel, keeping data  | `npx @zitadel/cli@alpha stop`                                  |
| Delete local Zitadel data         | `npx @zitadel/cli@alpha reset --force`                         |

Nx manages TypeScript workspace targets. Go commands and long-running local
orchestration run through repository scripts so server processes are signaled
and cleaned up directly. The published `zitadel` runtime commands are customer
workflow commands; they run the released container image through Docker and do
not require Go, Nx, or a source checkout.

For contributors, `corepack pnpm run cli -- start` builds and uses a fresh
local runtime image by default. The wrapper runs the CLI build, then builds
`ghcr.io/zitadel/nextgen:local-dev` through GoReleaser's single-target build
before invoking `zitadel start`. Pass `--image <tag>` or set
`ZITADEL_LOCAL_IMAGE=<tag>` to use an existing image instead.

`corepack pnpm run server` builds and syncs the embedded console/login UI before
startup, then runs `go run .`; help output skips the UI sync.

## Customer quick start

```sh
npx create-next-app@latest myapp
cd myapp
npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --framework next --server local
npm run dev
```

Open http://localhost:3000/login and register your first local user. The
managed Zitadel runtime stores its container metadata and data under
`.zitadel/local/`; `stop` preserves that data and `reset --force`
deletes it. `setup` installs dependencies with the detected package manager;
pass `--skip-install` if you want to install them yourself.

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
corepack pnpm run doctor
corepack pnpm run check
```

The repository doctor checks Docker and GoReleaser because contributor
`corepack pnpm run cli -- start` auto-builds the local runtime image from this
source checkout. Playwright browsers remain advisory for opt-in e2e and journey
workflows.

`corepack pnpm run check -- --full` runs the slower CI-parity phases, including
integration tests, demo e2e, package smoke checks, GoReleaser, and the fresh-app
journey. Use `--only <phase>` to rerun one phase after a failure.

To seed demo users for local login testing, pass bootstrap JSON files when starting the server (see [examples/bootstrap-users/](examples/bootstrap-users/)):

```sh
corepack pnpm run server -- -c <config.yaml> --user-file examples/bootstrap-users/demo-admin.json
```

The server wrapper runs `scripts/sync-embedded-ui-dist.sh all` before startup so
the default embedded UI routes work from source. Run that script manually only
when bypassing the wrapper with direct `go run .`.

Package smoke checks:

```sh
corepack pnpm run cli -- --version
corepack pnpm run cli -- commands
corepack pnpm --silent run cli -- status --json
corepack pnpm run check -- --only pack
```

Use `corepack pnpm --silent run cli -- ... --json` when a script needs
parseable CLI stdout. Plain `pnpm run` prints its own script prelude before
the command output.

Fresh-app consumer journey check:

```sh
corepack pnpm run journey
```

This opt-in check ensures the Playwright Chromium browsers are installed, builds
the local npm packages, publishes them to a temporary Verdaccio registry, starts
a source backend with embedded Postgres, scaffolds a new Next.js app outside the
repo, and verifies registration/login journeys against the generated app.

## CI

Pull requests and pushes to `main` run:

- Go vet and tests.
- pnpm install and Nx lint/typecheck/build/test targets.
- Built CLI smoke checks.
- npm package dry-run/pack checks.
- A non-publishing GoReleaser snapshot.
- `consumer-journey-e2e`, which downloads the current workflow's GoReleaser
  snapshot image and npm package tarballs, installs them through a temporary
  npm registry into a fresh Next.js app, and runs the Playwright user journey.

CI uploads short-lived workflow artifacts for review: GoReleaser snapshot output
and npm package tarballs. On consumer journey failures it also uploads focused
diagnostics such as Playwright traces, setup JSON, package lock metadata, and
service logs. These artifacts expire after 7 days and are not release artifacts.

## Build & release

This monorepo separates Go release artifacts, console build output, and npm
package artifacts. The full rationale lives in
[docs/adrs/002-multi-package-release-strategy.md](docs/adrs/002-multi-package-release-strategy.md).

### Go server binary + embedded UIs (`goreleaser`)

GoReleaser builds the console and login-ui SPAs, syncs them into `internal/*/dist`,
and embeds them into the `nextgen` binary (`scripts/sync-embedded-ui-dist.sh`).

```sh
# Local snapshot (no publish, no signing)
goreleaser release --snapshot --clean --skip=publish,sign

# Run a snapshot Docker image (defaults to `nextgen server`)
docker run --rm -p 8080:8080 \
  -v "$PWD/.zitadel/local/nextgen-data:/var/lib/zitadel/nextgen-data" \
  -e NEXTGEN_SERVER_DATA_DIR=/var/lib/zitadel/nextgen-data \
  ghcr.io/zitadel/nextgen:<snapshot-tag>-amd64
```

The publish-capable release workflow is currently manual-only via
`.github/workflows/release.yml` (`workflow_dispatch`). It can run a dry snapshot
or, when intentionally invoked for a release tag, produce multi-arch tarballs and
push a multi-arch image manifest to `ghcr.io/zitadel/nextgen`.

### npm packages (`changesets`)

`apps/cli` and the public packages under `packages/` publish to npm via
[changesets](https://github.com/changesets/changesets). On any user-visible
change to those packages:

```sh
corepack pnpm changeset
```

The changesets workflow opens a "Version Packages" PR. Merging that PR versions
and publishes the affected packages through npm trusted publishing.

### Preview product bundles (`zitadel-preview`)

`zitadel-preview@0.x` is the customer-facing bundle layer for external testers.
It does not replace the GoReleaser or Changesets workflows; it records the exact
server image and npm package versions that were tested together.

Release ceremony:

1. Merge normal feature and fix PRs with changesets as usual.
2. Let [`release-npm.yml`](.github/workflows/release-npm.yml) publish the npm
   prerelease packages.
3. Run [`release.yml`](.github/workflows/release.yml) for the server image.
4. Run [`release-preview.yml`](.github/workflows/release-preview.yml) with:
   - `preview_version`, for example `0.1.0`;
   - immutable `server_image`, for example `ghcr.io/zitadel/nextgen:v0.1.0-alpha.3`;
   - exact `cli_version` and `sdk_next_version`;
   - optional extra npm packages as JSON.

Follow the short [preview release runbook](docs/runbooks/release-preview.md)
when cutting a bundle.

The preview workflow creates a draft GitHub Release tagged
`zitadel-preview-v<version>` with a `zitadel-preview-<version>.json` manifest
asset and generated tester commands:

```sh
npx @zitadel/cli@<exact-cli-version> doctor --preview-manifest <manifest-url>
npx @zitadel/cli@<exact-cli-version> start --preview-manifest <manifest-url>
npx @zitadel/cli@<exact-cli-version> setup --framework next --server local --preview-manifest <manifest-url>
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
