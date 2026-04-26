# nextgen

Next iteration of the Zitadel identity platform.

## Current status

This repository is pre-release. The Go server release path is wired through
GoReleaser, but `main.go` is still a placeholder and the embedded console
directory contains only `apps/console/dist/.gitkeep` in clean checkouts. The
CLI and SDK packages are also pre-release; CI produces installable snapshots for
review, not official releases.

## Local checks

Use Node.js from [.nvmrc](.nvmrc) and the pinned pnpm 10 workspace manager from
`package.json`.

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm -r build

go vet ./...
go test ./...
```

Package smoke checks:

```sh
node apps/cli/dist/zitadel.js --version
node apps/cli/dist/zitadel.js capabilities --json

(cd apps/cli && npm pack --dry-run)
(cd packages/sdk-core && npm pack --dry-run)
(cd packages/sdk-next && npm pack --dry-run)
```

## CI

Pull requests and pushes to `main` run:

- Go vet and tests.
- pnpm install, typecheck, tests, and builds.
- Built CLI smoke checks.
- npm package dry-run/pack checks.
- A non-publishing GoReleaser snapshot.

CI uploads short-lived workflow artifacts for review: GoReleaser snapshot output
and npm package tarballs. These artifacts expire after 7 days and are not
release artifacts.

## Build & release

This monorepo ships three artifact families on independent cadences. The full rationale lives in [docs/adrs/002-multi-package-release-strategy.md](docs/adrs/002-multi-package-release-strategy.md).

### Go server binary + embedded console (`goreleaser`)

The `nextgen` binary embeds the React console SPA built by Vite at `apps/console/dist/`. In clean checkouts the embed dir holds only `.gitkeep`; build the SPA first to ship a real UI.

```sh
# Local snapshot (no publish, no signing)
goreleaser release --snapshot --clean --skip=publish,sign

# Run a snapshot Docker image. The image's default CMD is `--help` while
# the `server` subcommand is being wired up in cmd/server (PR #17).
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
