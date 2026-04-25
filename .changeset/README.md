# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for the npm-published packages in this monorepo (`apps/cli`, `packages/components`, `packages/sdk-*`).

When you make a user-visible change to one of those packages, run:

```sh
corepack pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major), and write a one-line summary. A markdown file appears in this directory and gets committed with your PR.

The `changesets` GitHub Action opens a "Version Packages" PR aggregating all pending changesets. Merging that PR bumps versions, updates `CHANGELOG.md` files, tags the affected packages, and publishes them to npm.

The Go server binary is **not** managed by changesets — it is released with `goreleaser` on `v*` tags. See [docs/adrs/002-multi-package-release-strategy.md](../docs/adrs/002-multi-package-release-strategy.md).

## Licensing reminder

npm packages published from this repo are **MIT-licensed**, not AGPL like the server. Every `package.json` under `apps/cli/` and `packages/*` must set `"license": "MIT"` and ship a `LICENSE` file. See [/LICENSING.md](../LICENSING.md).
