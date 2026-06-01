# nextgen

Next iteration of the Zitadel identity platform.

## Current status

This repository is pre-release. The Go server command is wired up — `main.go`
runs `cmd/server`, which loads config, connects and migrates the database,
bootstraps users, and serves the ogen-generated OpenAPI API with graceful
shutdown. OIDC-related endpoints are not implemented yet. Its release path runs
through GoReleaser. The server does not yet embed or serve the console SPA; that
wiring is still follow-up work. The frontend workspace is managed by Nx and
includes a Vite React console shell, shared components, SDKs, and the
agent-facing CLI. CI produces installable snapshots for review, not official
releases.

## Local checks

Use Node.js from [.nvmrc](.nvmrc) and the pnpm version pinned in `package.json`
(`packageManager`).

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm nx run-many -t lint,typecheck,build,test

go vet ./...
go test -timeout=10m ./...
```

The Go tests use `embedded-postgres`, which downloads PostgreSQL (the version it
pins, currently 18) on first run; on Linux it also needs `libicu-dev` and
`libssl-dev`. See [AGENTS.md](AGENTS.md) for the authoritative command reference.

To seed demo users for local login testing, pass bootstrap JSON files when
starting the server (see [examples/bootstrap-users/](examples/bootstrap-users/)).
`main.go` runs the server command directly — the root + `server` subcommand
split is still pending — so there is no `server` word yet:

```sh
go run . -c <config.yaml> --user-file examples/bootstrap-users/demo-admin.json
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

- Go vet, unit tests, and generated-code verification (`go-test`).
- Go integration tests against embedded PostgreSQL (`go-integration-test`) and
  the Spanner emulator (`go-integration-test-spanner`).
- pnpm install and Nx lint/typecheck/build/test targets (`node-check`).
- Playwright end-to-end suites, which gate merges (`node-e2e`).
- Built CLI smoke checks and npm package dry-run/pack checks (`npm-pack-smoke`).
- A non-publishing GoReleaser snapshot (`goreleaser-snapshot`).

CI uploads short-lived workflow artifacts for review: GoReleaser snapshot output
and npm package tarballs. These artifacts expire after 7 days and are not
release artifacts.

## Build & release

This monorepo separates Go release artifacts, console build output, and npm
package artifacts. The full rationale lives in
[docs/adrs/002-multi-package-release-strategy.md](docs/adrs/002-multi-package-release-strategy.md).

### Go server binary + console build (`goreleaser`)

GoReleaser builds the React console SPA through Nx before packaging snapshots:
`corepack pnpm nx build @zitadel-nextgen/console`. Server-side console serving
and Go `//go:embed` wiring are still follow-up work, so snapshot builds verify
that the console can be produced but the server does not yet expose it.

```sh
# Local snapshot (no publish, no signing)
goreleaser release --snapshot --clean --skip=publish,sign

# Run a snapshot Docker image. The image's default CMD is `--help` until the
# root + `server` subcommand split lands; pass server flags (e.g. `-c <config>`)
# to run it instead.
docker run --rm ghcr.io/zitadel/nextgen:<snapshot-tag>-amd64
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
