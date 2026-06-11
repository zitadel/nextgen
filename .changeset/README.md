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

Everything else (`@zitadel/api-mock`, `@zitadel/design-tokens`, `@zitadel/shared-component-styles`, `@zitadel/ui-react`, `@zitadel/lint`, the demos, the console) is marked `"private": true` and is never published.

When you make a user-visible change to one of the public packages, run:

```sh
corepack pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major), and write a one-line summary. A markdown file appears in this directory and gets committed with your PR.

## Alpha versions, preview channel

The repo is currently in changesets **prerelease mode** with the `alpha` tag
(see `.changeset/pre.json`). The `alpha` tag controls the version suffix; the
public npm channel for community testing is `preview`. While in this mode:

- `changeset version` cuts versions like `0.1.0-alpha.0`, `0.1.0-alpha.1`, …
- `scripts/publish-changesets.mjs` publishes them under the **`preview`** npm dist-tag, **not** `latest`, while `.changeset/pre.json` exists. So `npm install @zitadel/cli` keeps resolving the last stable release; consumers opt into preview bundles with `@zitadel/cli@preview`.
- The public packages are configured as a fixed MVP preview group, so the Version Packages PR keeps their versions aligned.

To leave alpha and cut a stable `latest` release:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version   # strips the -alpha suffix
```

## Publishing (npm trusted publishing / OIDC)

The [`.github/workflows/release-npm.yml`](../.github/workflows/release-npm.yml) workflow runs the [changesets GitHub Action](https://github.com/changesets/action). Pushing changesets to `main` opens a "Version Packages" PR aggregating all pending changesets; merging that PR bumps versions, updates `CHANGELOG.md` files, and publishes to npm. While `.changeset/pre.json` exists, the publish step uses the `preview` dist-tag; after `changeset pre exit`, it uses Changesets' default dist-tag (`latest`). Package-level GitHub Releases are disabled; GoReleaser owns the product-level `ZITADEL Preview` releases. For the full product release order, follow the operator runbook in [`docs/operations/releasing.md`](../docs/operations/releasing.md).

Publishing authenticates with **npm trusted publishing (OIDC)** — there is **no `NPM_TOKEN`** secret. Before the first automated publish, a maintainer must, once per public package:

1. Ensure the package exists on npm (publish `0.0.x` manually the first time if needed, since a trusted publisher can only be attached to an existing package).
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

The Go server binary is **not** managed by changesets — it is released with `goreleaser` through the manual [`release.yml`](../.github/workflows/release.yml) workflow while the repo is pre-release. See [docs/adrs/002-multi-package-release-strategy.md](../docs/adrs/002-multi-package-release-strategy.md) for the rationale and [`docs/operations/releasing.md`](../docs/operations/releasing.md) for the release checklist.

## Licensing reminder

npm packages published from this repo are **MIT-licensed**, not AGPL like the
server. Public packages under `apps/cli/` and `packages/*` must set
`"license": "MIT"` and ship a package-level `LICENSE` file before publishing.
Private demo, design-system, and integration workspaces are covered by the path
exceptions in [/LICENSING.md](../LICENSING.md) while they remain private.
