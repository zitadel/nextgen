# nextgen

Next iteration of the Zitadel identity platform.

## Build & release

This monorepo ships three artifact families on independent cadences. The full rationale lives in [docs/adrs/002-multi-package-release-strategy.md](docs/adrs/002-multi-package-release-strategy.md).

### Go server binary + embedded console (`goreleaser`)

The `nextgen` binary embeds the React console SPA built by Vite at `apps/console/dist/`. In clean checkouts the embed dir holds only `.gitkeep`; build the SPA first to ship a real UI.

```sh
# Local snapshot (no publish, no signing)
goreleaser release --snapshot --clean --skip=publish,sign

# Run a snapshot Docker image
docker run --rm ghcr.io/zitadel/nextgen:<snapshot-tag>-amd64 server --help
```

Tagged releases (`v*`) trigger `.github/workflows/release.yml`, which produces multi-arch tarballs and pushes a multi-arch image manifest to `ghcr.io/zitadel/nextgen`.

### npm packages (`changesets`)

`apps/cli`, `packages/components`, and `packages/sdk-*` are published to npm via [changesets](https://github.com/changesets/changesets). On any user-visible change to those packages:

```sh
corepack pnpm changeset
```

The bot opens a "Version Packages" PR; merging it tags and publishes the affected packages.

### Local development

The devcontainer at [.devcontainer/](.devcontainer/) pins Go 1.26 and a PostgreSQL sidecar.
