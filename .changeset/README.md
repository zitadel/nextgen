# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for the npm-published packages in this monorepo. The **public** packages are:

- `@zitadel/cli` (`apps/cli`)
- `@zitadel/api` (`packages/api`)
- `@zitadel/components` (`packages/components`)
- `@zitadel/sdk-core` (`packages/sdk-core`)
- `@zitadel/sdk-next` (`packages/sdk-next`)
- `@zitadel/sdk-nuxt` (`packages/sdk-nuxt`)
- `@zitadel/sdk-react` (`packages/sdk-react`)
- `@zitadel/sdk-vue` (`packages/sdk-vue`)
- `@zitadel/sdk-angular` (`packages/sdk-angular`)

Everything else (`@zitadel/api-mock`, `@zitadel/design-tokens`, `@zitadel/shared-component-styles`, `@zitadel/ui-react`, the demos, the console) is marked `"private": true` and is never published. The private `@zitadel/server-release` record is the exception: Changesets versions and tags it so the Go server artifacts have a reviewed product version even though Moon publishes the non-npm files.

When you make a user-visible change to one of the public packages, run:

```sh
corepack pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major), and write a one-line summary. A markdown file appears in this directory and gets committed with your PR.

## Alpha prerelease mode

The repo is currently in changesets **prerelease mode** with the `alpha` tag (see `.changeset/pre.json`). While in this mode:

- `changeset version` cuts versions like `0.1.0-alpha.0`, `0.1.0-alpha.1`, …
- Public packages are versioned independently. A release includes only the packages and product release record named by pending changesets.
- `changeset publish` publishes public npm packages under the **`alpha`** npm dist-tag while prerelease mode is active.
- A package that has never had a stable release is published to `latest` on its first publish (changesets behaviour), then to `alpha` thereafter until it has a stable release.

To leave alpha and cut a stable `latest` release:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version   # strips the -alpha suffix
```

## Publishing (npm trusted publishing / OIDC)

The manual `release-prepare.yml` workflow runs the [changesets GitHub Action](https://github.com/changesets/action) to open a "Version Packages" PR aggregating pending changesets. After that PR merges and CI is green, `release-publish.yml` runs Moon release tasks, publishes npm packages with `changeset publish`, pushes server containers, and updates the product GitHub Release.

Publishing authenticates with **npm trusted publishing (OIDC)** — there is **no `NPM_TOKEN`** secret. Before the first automated publish, a maintainer must, once per public package:

1. Ensure the package exists on npm (publish `0.0.x` manually the first time if needed, since a trusted publisher can only be attached to an existing package).
2. On npmjs.com → the package → **Settings → Trusted Publishing**, add a publisher:
   - Provider: **GitHub Actions**
   - Organization/owner: `zitadel`
   - Repository: `nextgen`
   - Workflow filename: `release-publish.yml` (exact, case-sensitive)
3. Optionally, under **Publishing access**, require 2FA and disallow tokens so only this workflow can publish.

While this repository is private, the workflow keeps npm provenance disabled
with `NPM_CONFIG_PROVENANCE=false`. Trusted publishing still authenticates with
short-lived OIDC credentials, but npm only accepts public provenance
attestations from public source repositories. Re-enable provenance when
`zitadel/nextgen` is public.

Changesets does not build the Go server binary. Moon release tasks read the
Changesets-versioned `@zitadel/server-release` package, create `v<version>`,
cross-build the Go server, publish containers, and update the product GitHub
Release. See
[docs/adrs/002-multi-package-release-strategy.md](../docs/adrs/002-multi-package-release-strategy.md)
and [docs/adrs/023-lockstep-alpha-release-train.md](../docs/adrs/023-lockstep-alpha-release-train.md).

## Licensing reminder

npm packages published from this repo are **MIT-licensed**, not AGPL like the
server. Public packages under `apps/cli/` and `packages/*` must set
`"license": "MIT"` and ship a package-level `LICENSE` file before publishing.
Private demo, design-system, and integration workspaces are covered by the path
exceptions in [/LICENSING.md](../LICENSING.md) while they remain private.
