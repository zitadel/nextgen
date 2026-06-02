# nextgen

Next iteration of the Zitadel identity platform.

## Current status

This repository is pre-release. The Go server release path is wired through
GoReleaser, with the Vite React console embedded into tagged server builds.
The frontend workspace is managed by Nx and includes shared components, SDKs,
and the agent-facing CLI. npm packages publish through Changesets once the
Version Packages PR lands and npm credentials are configured.

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

## CI

Pull requests and pushes to `main` run:

- Go vet and tests.
- pnpm install and Nx lint/typecheck/build/test targets.
- Built CLI smoke checks.
- npm package dry-run/pack checks.
- A non-publishing GoReleaser snapshot.

CI uploads short-lived workflow artifacts for review: GoReleaser snapshot output
and npm package tarballs. These artifacts expire after 7 days and are not
release artifacts.

## Build & release

This monorepo separates Go release artifacts, console build output, and npm
package artifacts. The full rationale lives in
[docs/adrs/002-multi-package-release-strategy.md](docs/adrs/002-multi-package-release-strategy.md).

### Go server binary + console build (`goreleaser`)

GoReleaser builds the React console SPA through Nx before packaging snapshots:
`corepack pnpm nx build @zitadel-nextgen/console`, copies the built files into
the Go embed package, and compiles release builds with the `embed_console` tag.
The server serves that SPA at `/console/`; API routes continue to be handled by
the generated OpenAPI server.

```sh
# Local snapshot (no publish, no signing)
goreleaser release --snapshot --clean --skip=publish,sign

# Run a snapshot Docker image.
docker run --rm ghcr.io/zitadel/nextgen:<snapshot-tag>-amd64
```

Server releases publish from `v*` tags via `.github/workflows/release.yml`.
The same workflow still supports manual non-publishing snapshots through
`workflow_dispatch`.

### npm packages (`changesets`)

The public runtime packages publish under the `@zitadel/*` scope via
[changesets](https://github.com/changesets/changesets). On any user-visible
change to those packages:

```sh
corepack pnpm changeset
```

The `npm-release` workflow opens a "Version Packages" PR on `main` when pending
changesets exist. Merging that PR publishes changed packages to npm with the
`next` dist-tag when `NPM_TOKEN` is available.

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
