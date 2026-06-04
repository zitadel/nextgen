# nextgen

Next iteration of the Zitadel identity platform.

## Quick start (Docker)

Run the API and embedded UIs with PostgreSQL:

```sh
cd docs/operations
cp env.example .env
docker compose up -d
```

| Surface | URL |
| ------- | --- |
| Management console | http://localhost:8080/ui/console/ |
| Sign-in shell | http://localhost:8080/ui/login/ |
| Health | http://localhost:8080/healthz |

Details: [docs/quick-start/index.md](docs/quick-start/index.md). To build from source: [CONTRIBUTING.md](CONTRIBUTING.md).

## Current status

This repository is pre-release. The Go `server` command serves the OpenAPI
surface and embeds the console and login UIs at `/ui/console/` and `/ui/login/`.
CI produces installable snapshots for review, not official releases.

## Local checks

Use Node.js from [.nvmrc](.nvmrc) and the pinned pnpm 10 workspace manager from
`package.json`.

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm nx run-many -t lint,typecheck,build,test

go vet ./...
go test ./...
```

To seed demo users for local login testing, pass bootstrap JSON files when starting the server (see [examples/bootstrap-users/](examples/bootstrap-users/)):

```sh
go run . server -c <config.yaml> --user-file examples/bootstrap-users/demo-admin.json
```

Package smoke checks:

```sh
node apps/cli/dist/zitadel.mjs --version
node apps/cli/dist/zitadel.mjs capabilities --json

(cd apps/cli && npm pack --dry-run)
(cd packages/sdk-core && npm pack --dry-run)
(cd packages/sdk-next && npm pack --dry-run)
```

Fresh-app consumer journey check:

```sh
corepack pnpm nx run @zitadel/cli-journey-e2e:e2e-local
```

This opt-in check builds the local npm packages, publishes them to a temporary
Verdaccio registry, starts a source backend with embedded Postgres, scaffolds a
new Next.js app outside the repo, and verifies registration/login journeys
against the generated app.

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
  -e NEXTGEN_SERVER_ENCRYPTION_KEY=4D61737465726B65794E65656473546F48617665333243686172616374657273 \
  -e NEXTGEN_DATABASE_POSTGRES='postgres://...' \
  ghcr.io/zitadel/nextgen:<snapshot-tag>-amd64
```

The publish-capable release workflow is currently manual-only via
`.github/workflows/release.yml` (`workflow_dispatch`). It can run a dry snapshot
or, when intentionally invoked for a release tag, produce multi-arch tarballs and
push a multi-arch image manifest to `ghcr.io/zitadel/nextgen`.

### npm packages (`changesets`)

`apps/cli` and `packages/sdk-*` are intended to be published to npm via
[changesets](https://github.com/changesets/changesets). On any user-visible
change to those packages:

```sh
corepack pnpm changeset
```

The future changesets workflow should open a "Version Packages" PR; merging it
will tag and publish the affected packages once npm ownership and tokens are in
place. No npm publishing workflow is enabled yet.

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
