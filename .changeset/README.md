# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for the Zitadel v5 alpha preview train. The **public** packages are:

- `@zitadel/cli` (`apps/cli`)
- `@zitadel/api` (`packages/api`)
- `@zitadel/components` (`packages/components`)
- `@zitadel/sdk-core` (`packages/sdk-core`)
- `@zitadel/sdk-next` (`packages/sdk-next`)
- `@zitadel/sdk-nuxt` (`packages/sdk-nuxt`)
- `@zitadel/sdk-react` (`packages/sdk-react`)
- `@zitadel/sdk-vue` (`packages/sdk-vue`)
- `@zitadel/sdk-angular` (`packages/sdk-angular`)

The private `@zitadel/product` package is not published. It exists only as the
Changesets target for runtime, API, docs-for-users, and product-level release
notes. Everything else (`@zitadel/api-mock`, `@zitadel/design-tokens`,
`@zitadel/shared-component-styles`, `@zitadel/ui-react`, `@zitadel/lint`, the
demos, the console) is marked `"private": true` and is never published.

When you make a user-visible change to one of the public packages or to the
product/runtime/API surface, run:

```sh
corepack pnpm changeset
```

Pick the affected package, or `@zitadel/product` for product-level changes, the
bump type (patch / minor / major), and write a one-line summary. A markdown file
appears in this directory and gets committed with your PR.

The v5 alpha release packages are fixed together in `.changeset/config.json`.
Any package or `@zitadel/product` changeset bumps the whole lockstep train.

## Alpha prerelease mode

The repo is currently in changesets **prerelease mode** with the `alpha` tag (see `.changeset/pre.json`). While in this mode:

- `changeset version` cuts versions like `5.0.0-alpha.0`, `5.0.0-alpha.1`, …
- `changeset publish` publishes them under the **`alpha`** npm dist-tag, **not** `latest`. So `npm install @zitadel/cli` keeps resolving the last stable release; consumers opt into prereleases with `@zitadel/cli@alpha`.
- Before automated publishing, bootstrap new public packages manually with the
  `alpha` dist-tag. This avoids any first-publish ambiguity for packages that
  do not yet have a stable `latest`.

To leave alpha and cut a stable `latest` release:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version   # strips the -alpha suffix
```

## Publishing (npm trusted publishing / OIDC)

The [`.github/workflows/release-npm.yml`](../.github/workflows/release-npm.yml) workflow runs the [changesets GitHub Action](https://github.com/changesets/action). Pushing changesets to `main` opens a "Version Packages" PR aggregating all pending changesets; merging that PR bumps versions, updates `CHANGELOG.md` files, and publishes to npm (under the `alpha` dist-tag while in prerelease mode).

Package publishes do **not** create GitHub Releases. Package changelogs and npm
package pages educate package consumers about detailed changes. The single
customer-facing GitHub Release is created by
[`release.yml`](../.github/workflows/release.yml) with GoReleaser; see
[`docs/releases.md`](../docs/releases.md).

Publishing authenticates with **npm trusted publishing (OIDC)** — there is **no `NPM_TOKEN`** secret. Before the first automated publish, a maintainer must, once per public package:

1. Ensure the package exists on npm (publish the current `5.0.0-alpha.0`
   package manually with the `alpha` dist-tag the first time if needed, since a
   trusted publisher can only be attached to an existing package).
2. On npmjs.com → the package → **Settings → Trusted Publishing**, add a publisher:
   - Provider: **GitHub Actions**
   - Organization/owner: `zitadel`
   - Repository: `nextgen`
   - Workflow filename: `release-npm.yml` (exact, case-sensitive)
3. Optionally, under **Publishing access**, require 2FA and disallow tokens so only this workflow can publish.

While this repository is private, the workflow keeps npm provenance disabled
with `NPM_CONFIG_PROVENANCE=false`. Trusted publishing still authenticates with
short-lived OIDC credentials, but npm only accepts public provenance
attestations from public source repositories. Re-enable provenance when
`zitadel/nextgen` is public.

Changesets owns the v5 alpha version number and changelogs. GoReleaser owns the
runtime artifacts and GitHub Release. The manual `release-zitadel` workflow
validates that the typed `v5.0.0-alpha.N` tag matches the package versions, then
passes generated release notes to GoReleaser. See [`docs/releases.md`](../docs/releases.md)
and [`docs/adrs/002-multi-package-release-strategy.md`](../docs/adrs/002-multi-package-release-strategy.md).

## Licensing reminder

npm packages published from this repo are **MIT-licensed**, not AGPL like the server. Every `package.json` under `apps/cli/` and `packages/*` must set `"license": "MIT"` and ship a `LICENSE` file. See [/LICENSING.md](../LICENSING.md).
