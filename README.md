# nextgen

Next iteration of the Zitadel identity platform.

## Current status

This repository is pre-release. The Go server release path is wired through
GoReleaser, but `main.go` is still a placeholder. The frontend workspace is now
managed by Nx and includes a Vite React console shell, shared components, SDKs,
and the agent-facing CLI. CI produces installable snapshots for review, not
official releases.

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
`corepack pnpm nx build @zitadel-nextgen/console`. Server-side console serving
and Go `//go:embed` wiring are still follow-up work, so snapshot builds verify
that the console can be produced but do not yet expose it from the placeholder
server.

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
